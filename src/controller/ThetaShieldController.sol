// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {ThetaShieldUnits} from "../base/ThetaShieldUnits.sol";
import {IThetaShieldController} from "../interfaces/IThetaShieldController.sol";
import {OwnedTwoStep} from "../security/OwnedTwoStep.sol";

/// @title ThetaShieldController
/// @notice Authenticated origin-chain receiver and directional fee store.
contract ThetaShieldController is IThetaShieldController, OwnedTwoStep {
    /// @notice Absolute safety bound for a signed normalized risk value.
    uint256 public constant MAX_ABSOLUTE_RISK_WAD = 100e18;

    struct PoolFeeConfig {
        uint24 baselineFeePips;
        uint24 minimumFeePips;
        uint24 maximumFeePips;
        uint16 confidenceFloorBps;
        uint64 maximumRecommendationLifetime;
        uint64 minimumRecommendationInterval;
        bool paused;
    }

    struct FeeRecommendation {
        uint24 zeroForOneFee;
        uint24 oneForZeroFee;
        int128 zeroForOneRiskWad;
        int128 oneForZeroRiskWad;
        uint16 confidenceBps;
        uint64 validAfter;
        uint64 validUntil;
        uint64 sequence;
    }

    address public immutable callbackProxy;
    address public immutable expectedRvmId;
    bool public globallyPaused;

    mapping(bytes32 poolId => PoolFeeConfig config) private _poolConfigs;
    mapping(bytes32 poolId => FeeRecommendation recommendation) private _recommendations;
    mapping(bytes32 poolId => bool configured) public isPoolConfigured;
    mapping(bytes32 poolId => uint64 sequence) public lastSequence;
    mapping(bytes32 poolId => uint64 timestamp) public lastRecommendationAt;

    error InvalidCallbackProxy(address caller);
    error InvalidRvmId(address supplied);
    error PoolNotConfigured(bytes32 poolId);
    error InvalidPoolId();
    error InvalidPoolConfiguration();
    error RecommendationReplay(uint64 supplied, uint64 lastAccepted);
    error FutureRecommendation(uint64 validAfter, uint64 currentTime);
    error StaleRecommendation(uint64 validUntil, uint64 currentTime);
    error InvalidRecommendationWindow(uint64 validAfter, uint64 validUntil);
    error RecommendationLifetimeTooLong(uint64 supplied, uint64 maximum);
    error RecommendationTooSoon(uint256 earliest, uint64 currentTime);
    error FeeOutOfBounds(bool zeroForOne, uint24 supplied, uint24 minimum, uint24 maximum);
    error InvalidConfidence(uint16 confidenceBps);
    error RiskOutOfBounds(bool zeroForOne, int128 supplied);
    error FeeRiskMismatch(bool zeroForOne, uint24 feePips, int128 riskWad);
    error InsufficientConfidence(uint16 supplied, uint16 required);

    event PoolConfigured(
        bytes32 indexed poolId,
        uint24 baselineFeePips,
        uint24 minimumFeePips,
        uint24 maximumFeePips,
        uint16 confidenceFloorBps,
        uint64 maximumRecommendationLifetime,
        uint64 minimumRecommendationInterval,
        bool paused
    );
    event RecommendationApplied(
        bytes32 indexed poolId,
        address indexed rvmId,
        uint64 indexed sequence,
        uint24 zeroForOneFee,
        uint24 oneForZeroFee,
        int128 zeroForOneRiskWad,
        int128 oneForZeroRiskWad,
        uint16 confidenceBps,
        uint64 validAfter,
        uint64 validUntil
    );
    event GlobalPauseSet(bool paused);
    event PoolPauseSet(bytes32 indexed poolId, bool paused);

    constructor(address initialOwner, address callbackProxy_, address expectedRvmId_) OwnedTwoStep(initialOwner) {
        if (callbackProxy_ == address(0) || expectedRvmId_ == address(0)) revert ZeroAddress();
        callbackProxy = callbackProxy_;
        expectedRvmId = expectedRvmId_;
    }

    /// @notice Adds or updates a supported pool without resetting replay protection.
    function configurePool(bytes32 poolId, PoolFeeConfig calldata config) external onlyOwner {
        if (poolId == bytes32(0)) revert InvalidPoolId();
        if (
            config.minimumFeePips > config.baselineFeePips || config.baselineFeePips > config.maximumFeePips
                || config.maximumFeePips > ThetaShieldUnits.FEE_PIPS || config.confidenceFloorBps > ThetaShieldUnits.BPS
                || config.maximumRecommendationLifetime == 0
                || config.minimumRecommendationInterval > config.maximumRecommendationLifetime
        ) revert InvalidPoolConfiguration();

        _poolConfigs[poolId] = config;
        isPoolConfigured[poolId] = true;
        delete _recommendations[poolId];

        emit PoolConfigured(
            poolId,
            config.baselineFeePips,
            config.minimumFeePips,
            config.maximumFeePips,
            config.confidenceFloorBps,
            config.maximumRecommendationLifetime,
            config.minimumRecommendationInterval,
            config.paused
        );
    }

    /// @notice Pauses or unpauses every configured pool.
    function setGlobalPause(bool paused) external onlyOwner {
        globallyPaused = paused;
        emit GlobalPauseSet(paused);
    }

    /// @notice Pauses or unpauses one configured pool.
    function setPoolPause(bytes32 poolId, bool paused) external onlyOwner {
        _requireConfigured(poolId);
        _poolConfigs[poolId].paused = paused;
        emit PoolPauseSet(poolId, paused);
    }

    /// @notice Applies a sequenced recommendation delivered by the configured callback proxy.
    /// @dev Reactive callback delivery overwrites the first argument with the RVM identifier.
    function applyRecommendation(address rvmId, bytes32 poolId, FeeRecommendation calldata recommendation) external {
        if (msg.sender != callbackProxy) revert InvalidCallbackProxy(msg.sender);
        if (rvmId != expectedRvmId) revert InvalidRvmId(rvmId);
        _requireConfigured(poolId);

        uint64 previousSequence = lastSequence[poolId];
        if (recommendation.sequence <= previousSequence) {
            revert RecommendationReplay(recommendation.sequence, previousSequence);
        }

        uint64 currentTime = uint64(block.timestamp);
        if (recommendation.validUntil <= recommendation.validAfter) {
            revert InvalidRecommendationWindow(recommendation.validAfter, recommendation.validUntil);
        }
        if (recommendation.validAfter > currentTime) {
            revert FutureRecommendation(recommendation.validAfter, currentTime);
        }
        if (recommendation.validUntil <= currentTime) {
            revert StaleRecommendation(recommendation.validUntil, currentTime);
        }

        PoolFeeConfig memory config = _poolConfigs[poolId];
        uint64 lifetime = recommendation.validUntil - recommendation.validAfter;
        if (lifetime > config.maximumRecommendationLifetime) {
            revert RecommendationLifetimeTooLong(lifetime, config.maximumRecommendationLifetime);
        }
        uint64 previousRecommendationAt = lastRecommendationAt[poolId];
        if (previousRecommendationAt != 0) {
            uint256 earliestRecommendationAt = uint256(previousRecommendationAt) + config.minimumRecommendationInterval;
            if (uint256(currentTime) < earliestRecommendationAt) {
                revert RecommendationTooSoon(earliestRecommendationAt, currentTime);
            }
        }
        if (recommendation.confidenceBps > ThetaShieldUnits.BPS) {
            revert InvalidConfidence(recommendation.confidenceBps);
        }
        if (
            recommendation.confidenceBps < config.confidenceFloorBps
                && (recommendation.zeroForOneFee > config.baselineFeePips
                    || recommendation.oneForZeroFee > config.baselineFeePips)
        ) {
            revert InsufficientConfidence(recommendation.confidenceBps, config.confidenceFloorBps);
        }

        _validateDirection(true, recommendation.zeroForOneFee, recommendation.zeroForOneRiskWad, config);
        _validateDirection(false, recommendation.oneForZeroFee, recommendation.oneForZeroRiskWad, config);

        _recommendations[poolId] = recommendation;
        lastSequence[poolId] = recommendation.sequence;
        lastRecommendationAt[poolId] = currentTime;

        emit RecommendationApplied(
            poolId,
            rvmId,
            recommendation.sequence,
            recommendation.zeroForOneFee,
            recommendation.oneForZeroFee,
            recommendation.zeroForOneRiskWad,
            recommendation.oneForZeroRiskWad,
            recommendation.confidenceBps,
            recommendation.validAfter,
            recommendation.validUntil
        );
    }

    /// @inheritdoc IThetaShieldController
    function feeForSwap(bytes32 poolId, bool zeroForOne) external view returns (uint24 feePips, bool usedBaseline) {
        _requireConfigured(poolId);
        PoolFeeConfig memory config = _poolConfigs[poolId];
        FeeRecommendation memory recommendation = _recommendations[poolId];

        // Timestamp expiry is an explicit safety property. Small proposer skew
        // only makes the controller choose the conservative baseline sooner.
        // forge-lint: disable-next-line(block-timestamp)
        bool recommendationNotStarted = block.timestamp < recommendation.validAfter;
        // forge-lint: disable-next-line(block-timestamp)
        bool recommendationExpired = block.timestamp >= recommendation.validUntil;
        if (
            globallyPaused || config.paused || recommendation.sequence == 0 || recommendationNotStarted
                || recommendationExpired || recommendation.confidenceBps < config.confidenceFloorBps
        ) return (config.baselineFeePips, true);

        feePips = zeroForOne ? recommendation.zeroForOneFee : recommendation.oneForZeroFee;
        return (feePips, false);
    }

    function poolConfig(bytes32 poolId) external view returns (PoolFeeConfig memory) {
        _requireConfigured(poolId);
        return _poolConfigs[poolId];
    }

    function currentRecommendation(bytes32 poolId) external view returns (FeeRecommendation memory) {
        _requireConfigured(poolId);
        return _recommendations[poolId];
    }

    function _validateDirection(bool zeroForOne, uint24 feePips, int128 riskWad, PoolFeeConfig memory config)
        private
        pure
    {
        if (feePips < config.minimumFeePips || feePips > config.maximumFeePips) {
            revert FeeOutOfBounds(zeroForOne, feePips, config.minimumFeePips, config.maximumFeePips);
        }
        if (_absoluteRisk(riskWad) > MAX_ABSOLUTE_RISK_WAD) revert RiskOutOfBounds(zeroForOne, riskWad);
        if (feePips > config.baselineFeePips && riskWad <= 0) {
            revert FeeRiskMismatch(zeroForOne, feePips, riskWad);
        }
    }

    function _absoluteRisk(int128 riskWad) private pure returns (uint256) {
        int256 widened = riskWad;
        return uint256(widened < 0 ? -widened : widened);
    }

    function _requireConfigured(bytes32 poolId) private view {
        if (!isPoolConfigured[poolId]) revert PoolNotConfigured(poolId);
    }
}
