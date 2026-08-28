// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ThetaShieldUnits} from "../base/ThetaShieldUnits.sol";
import {INormalizedReferencePriceFeed} from "../interfaces/INormalizedReferencePriceFeed.sol";
import {FixedPointMath} from "../libraries/FixedPointMath.sol";
import {ReferencePriceNormalizer} from "../libraries/ReferencePriceNormalizer.sol";

/// @title PoolMedianReferenceSampler
/// @notice Permissionlessly samples bounded v4 pools into distinct normalized reference sources.
/// @dev The Circle processor consumes these source readings and performs the robust median,
///      dispersion, and agreement calculation. This contract deliberately has no owner.
contract PoolMedianReferenceSampler is INormalizedReferencePriceFeed {
    using StateLibrary for IPoolManager;

    uint8 public constant MINIMUM_POOL_COUNT = 2;
    uint8 public constant MAXIMUM_POOL_COUNT = 16;
    uint8 private constant NORMALIZED_DECIMALS = 18;
    uint256 private constant Q64 = 1 << 64;
    uint256 private constant Q128 = 1 << 128;

    struct PoolConfig {
        PoolId poolId;
        bytes32 sourceId;
        uint128 minimumLiquidity;
        uint8 token0Decimals;
        uint8 token1Decimals;
        bool baseIsToken0;
    }

    enum SkipReason {
        Uninitialized,
        InsufficientLiquidity,
        UnrepresentablePrice
    }

    IPoolManager public immutable poolManager;
    bytes32 public immutable marketId;
    PoolConfig[] private _poolConfigs;
    mapping(bytes32 sourceId => bool configured) public isSourceConfigured;
    mapping(bytes32 market => mapping(bytes32 sourceId => Reading reading)) private _latestReadings;

    error InvalidPoolManager();
    error InvalidMarketId();
    error InvalidPoolCount(uint256 supplied);
    error InvalidPoolConfiguration(uint256 index);
    error InconsistentMarketConfiguration(uint256 index);
    error DuplicatePool(PoolId poolId);
    error DuplicateSource(bytes32 sourceId);
    error SequenceOverflow(bytes32 sourceId);

    event PoolSampleSkipped(
        bytes32 indexed marketId, bytes32 indexed sourceId, PoolId indexed poolId, SkipReason reason, uint128 liquidity
    );

    constructor(IPoolManager poolManager_, bytes32 marketId_, PoolConfig[] memory poolConfigs_) {
        if (address(poolManager_) == address(0) || address(poolManager_).code.length == 0) {
            revert InvalidPoolManager();
        }
        if (marketId_ == bytes32(0)) revert InvalidMarketId();
        if (poolConfigs_.length < MINIMUM_POOL_COUNT || poolConfigs_.length > MAXIMUM_POOL_COUNT) {
            revert InvalidPoolCount(poolConfigs_.length);
        }

        for (uint256 index; index < poolConfigs_.length; ++index) {
            PoolConfig memory config = poolConfigs_[index];
            if (
                PoolId.unwrap(config.poolId) == bytes32(0) || config.sourceId == bytes32(0)
                    || config.minimumLiquidity == 0
                    || config.token0Decimals > ReferencePriceNormalizer.MAX_SUPPORTED_DECIMALS
                    || config.token1Decimals > ReferencePriceNormalizer.MAX_SUPPORTED_DECIMALS
            ) revert InvalidPoolConfiguration(index);
            if (
                index != 0
                    && (config.token0Decimals != poolConfigs_[0].token0Decimals
                        || config.token1Decimals != poolConfigs_[0].token1Decimals
                        || config.baseIsToken0 != poolConfigs_[0].baseIsToken0)
            ) revert InconsistentMarketConfiguration(index);
            if (isSourceConfigured[config.sourceId]) revert DuplicateSource(config.sourceId);
            for (uint256 previous; previous < index; ++previous) {
                if (PoolId.unwrap(poolConfigs_[previous].poolId) == PoolId.unwrap(config.poolId)) {
                    revert DuplicatePool(config.poolId);
                }
            }

            isSourceConfigured[config.sourceId] = true;
            _poolConfigs.push(config);
        }

        poolManager = poolManager_;
        marketId = marketId_;
    }

    function poolCount() external view returns (uint256) {
        return _poolConfigs.length;
    }

    function poolConfig(uint256 index) external view returns (PoolConfig memory) {
        return _poolConfigs[index];
    }

    /// @notice Samples every configured pool and publishes each eligible pool as one source.
    /// @return publishedCount Number of source readings updated by this call.
    function sample() external returns (uint8 publishedCount) {
        // A block timestamp cannot realistically approach the uint64 range.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 observedAt = uint64(block.timestamp);

        for (uint256 index; index < _poolConfigs.length; ++index) {
            PoolConfig memory config = _poolConfigs[index];
            (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(config.poolId);
            if (sqrtPriceX96 == 0) {
                emit PoolSampleSkipped(marketId, config.sourceId, config.poolId, SkipReason.Uninitialized, 0);
                continue;
            }

            uint128 liquidity = poolManager.getLiquidity(config.poolId);
            if (liquidity < config.minimumLiquidity) {
                emit PoolSampleSkipped(
                    marketId, config.sourceId, config.poolId, SkipReason.InsufficientLiquidity, liquidity
                );
                continue;
            }

            uint256 priceWad = _priceWad(sqrtPriceX96, config);
            if (priceWad == 0) {
                emit PoolSampleSkipped(
                    marketId, config.sourceId, config.poolId, SkipReason.UnrepresentablePrice, liquidity
                );
                continue;
            }

            Reading memory previous = _latestReadings[marketId][config.sourceId];
            if (previous.sequence == type(uint64).max) revert SequenceOverflow(config.sourceId);
            uint64 sequence = previous.sequence + 1;
            _latestReadings[marketId][config.sourceId] = Reading({
                sequence: sequence, priceWad: priceWad, confidenceWad: ThetaShieldUnits.WAD, observedAt: observedAt
            });
            emit ReferencePricePublished(
                marketId, config.sourceId, sequence, priceWad, ThetaShieldUnits.WAD, observedAt
            );
            ++publishedCount;
        }
    }

    /// @inheritdoc INormalizedReferencePriceFeed
    function latestReading(bytes32 requestedMarketId, bytes32 sourceId) external view returns (Reading memory reading) {
        return _latestReadings[requestedMarketId][sourceId];
    }

    function _priceWad(uint160 sqrtPriceX96, PoolConfig memory config) private pure returns (uint256) {
        // sqrtPriceX96^2 / 2^64 produces token1/token0 in Q128 without losing
        // precision at the supported Uniswap tick extremes.
        uint256 ratioX128 = FixedPointMath.mulDivDown(sqrtPriceX96, sqrtPriceX96, Q64);
        if (ratioX128 == 0) return 0;

        uint256 normalizedAnswer;
        if (config.baseIsToken0) {
            normalizedAnswer = _token1PerToken0Wad(ratioX128, config.token0Decimals, config.token1Decimals);
        } else {
            normalizedAnswer = _token0PerToken1Wad(ratioX128, config.token0Decimals, config.token1Decimals);
        }
        if (normalizedAnswer == 0) return 0;

        // Keep the normalization boundary explicit and shared with other feed adapters.
        return ReferencePriceNormalizer.toWad(normalizedAnswer, NORMALIZED_DECIMALS);
    }

    function _token1PerToken0Wad(uint256 ratioX128, uint8 token0Decimals, uint8 token1Decimals)
        private
        pure
        returns (uint256)
    {
        if (token0Decimals >= token1Decimals) {
            uint256 scale = 10 ** (NORMALIZED_DECIMALS + token0Decimals - token1Decimals);
            return FixedPointMath.mulDivDown(ratioX128, scale, Q128);
        }
        uint256 divisor = 10 ** (token1Decimals - token0Decimals);
        return FixedPointMath.mulDivDown(ratioX128, ThetaShieldUnits.WAD, Q128 * divisor);
    }

    function _token0PerToken1Wad(uint256 ratioX128, uint8 token0Decimals, uint8 token1Decimals)
        private
        pure
        returns (uint256)
    {
        if (token1Decimals >= token0Decimals) {
            uint256 scale = 10 ** (NORMALIZED_DECIMALS + token1Decimals - token0Decimals);
            return FixedPointMath.mulDivDown(Q128, scale, ratioX128);
        }

        uint256 divisor = 10 ** (token0Decimals - token1Decimals);
        // floor(floor(x / y) / z) == floor(x / (y * z)); this avoids
        // overflowing the denominator at extreme ratios while preserving floor semantics.
        return FixedPointMath.mulDivDown(Q128, ThetaShieldUnits.WAD, ratioX128) / divisor;
    }
}
