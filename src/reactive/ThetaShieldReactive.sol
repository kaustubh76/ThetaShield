// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {AbstractReactive} from "reactive-lib/abstract-base/AbstractReactive.sol";
import {ThetaShieldUnits} from "../base/ThetaShieldUnits.sol";
import {ThetaShieldController} from "../controller/ThetaShieldController.sol";
import {ConfidenceWeight} from "../libraries/ConfidenceWeight.sol";
import {DeadBandFilter} from "../libraries/DeadBandFilter.sol";
import {DirectionalMarkoutMath} from "../libraries/DirectionalMarkoutMath.sol";
import {DirectionalRiskSmoother} from "../libraries/DirectionalRiskSmoother.sol";
import {EpochAggregation} from "../libraries/EpochAggregation.sol";
import {FeeCurve} from "../libraries/FeeCurve.sol";
import {FixedPointMath} from "../libraries/FixedPointMath.sol";
import {PersistenceWindow} from "../libraries/PersistenceWindow.sol";
import {ReferencePriceDispersion} from "../libraries/ReferencePriceDispersion.sol";
import {TrailingVolatility} from "../libraries/TrailingVolatility.sol";

/// @title ThetaShieldReactive
/// @notice One-pool bounded scheduler for delayed markout and fee callbacks.
/// @dev One deployment intentionally serves one pool/market. This makes every
///      observation, source, epoch, and CRON loop statically bounded.
contract ThetaShieldReactive is AbstractReactive {
    uint16 public constant ABSOLUTE_MAX_PENDING = 256;
    uint16 public constant ABSOLUTE_MAX_PROCESS_PER_CRON = 64;
    uint16 public constant ABSOLUTE_MAX_EPOCH_OBSERVATIONS = 128;
    uint8 public constant ABSOLUTE_MAX_REFERENCE_SOURCES = 16;
    uint8 public constant ABSOLUTE_MAX_REFERENCE_HISTORY = 8;
    uint16 public constant ABSOLUTE_MAX_FAST_PATH_HOLD_EPOCHS = 16;
    uint256 public constant MAX_ABSOLUTE_MARKOUT_WAD = 10e18;

    uint256 public constant SWAP_OBSERVED_TOPIC =
        uint256(keccak256("SwapObserved(bytes32,uint64,bool,int128,int128,uint160,uint24,bool,uint64)"));
    uint256 public constant REFERENCE_PRICE_TOPIC =
        uint256(keccak256("ReferencePricePublished(bytes32,bytes32,uint64,uint256,uint256,uint64)"));

    struct NetworkConfig {
        uint256 originChainId;
        uint256 referenceChainId;
        uint256 reactiveChainId;
        address hook;
        address referenceFeed;
        address controller;
        bytes32 poolId;
        bytes32 marketId;
        uint256 cronTopic;
        uint64 callbackGasLimit;
    }

    struct TokenConfig {
        uint8 token0Decimals;
        uint8 token1Decimals;
        bool baseIsToken0;
    }

    struct SchedulerConfig {
        uint64 markoutHorizon;
        uint64 observationLifetime;
        uint64 referenceSelectionWindow;
        uint64 epochDuration;
        uint64 recommendationLifetime;
        uint64 callbackClockSkew;
        uint64 maximumEventFutureSkew;
        uint16 maximumPendingObservations;
        uint16 maximumProcessPerCron;
        uint16 maximumEpochObservations;
        uint16 trailingWindow;
        uint16 minimumTrailingObservations;
        uint16 targetObservationCount;
        uint16 requiredToxicEpochs;
        uint16 persistenceWindow;
        uint16 fastPathHoldEpochs;
        uint8 maximumReferenceSamplesPerSource;
        uint8 minimumReferenceSources;
        bool fastPathEnabled;
        uint256 minimumObservationNotionalWad;
        uint256 maximumTradeNotionalWad;
        uint256 minimumEpochNotionalWad;
        uint256 coldStartSigmaWad;
        uint256 deadBandKWad;
        uint256 maximumDispersionWad;
        uint256 confidenceCapWad;
        uint256 toxicThresholdWad;
        uint256 alphaWad;
        uint256 fastPathConfidenceFloorWad;
        uint256 fastPathToxicThresholdWad;
    }

    struct PendingObservation {
        uint64 observationId;
        uint64 observedAt;
        uint64 matureAt;
        uint64 expiresAt;
        uint128 executionPriceWad;
        uint128 notionalWad;
        uint24 appliedFeePips;
        int8 traderDirection;
        bool zeroForOne;
        bool usedBaseline;
    }

    struct SwapEventData {
        int128 amount0;
        int128 amount1;
        uint160 sqrtPriceX96After;
        uint24 appliedFeePips;
        bool usedBaseline;
        uint64 observedAt;
    }

    struct ReferenceRecord {
        uint128 priceWad;
        uint128 confidenceWad;
        uint64 observedAt;
        uint64 sequence;
    }

    struct EpochObservationRecord {
        int256 filteredMarkoutWad;
        uint256 notionalWad;
        uint256 referenceDispersionWad;
        bool coldStart;
    }

    struct EpochComputation {
        int256 aggregateMarkoutWad;
        uint256 eligibleNotionalWad;
        uint256 maximumReferenceDispersionWad;
        uint256 confidenceWad;
        uint16 eligibleObservationCount;
        bool meetsMinimumEpochNotional;
        bool includedColdStart;
    }

    struct SideState {
        uint64 openEpochId;
        uint64 lastFinalizedEpochId;
        uint16 epochObservationCount;
        uint16 historyCount;
        uint16 historyCursor;
        uint16 fastPathHoldRemaining;
        uint256 persistenceBitmap;
        uint256 smoothedMagnitudeWad;
        int128 latestRiskWad;
        uint256 latestConfidenceWad;
        uint24 latestCalculatedFeePips;
        bool latestPersistenceActive;
        bool latestFastPathActive;
        bool epochOpen;
        bool hasFinalizedEpoch;
    }

    enum DropReason {
        Capacity,
        InvalidMarkout,
        EpochCapacity
    }

    NetworkConfig public networkConfig;
    TokenConfig public tokenConfig;
    SchedulerConfig private schedulerConfig;

    FeeCurve.Config private _feeCurveConfig;
    bytes32[] private _referenceSources;
    mapping(bytes32 sourceId => uint8 indexPlusOne) public referenceSourceIndex;
    mapping(bytes32 sourceId => uint64 sequence) public latestReferenceSequence;
    mapping(bytes32 sourceId => mapping(uint8 slot => ReferenceRecord record)) private _referenceHistory;
    mapping(bytes32 sourceId => uint8 count) private _referenceHistoryCount;
    mapping(bytes32 sourceId => uint8 cursor) private _referenceHistoryCursor;

    PendingObservation[] private _pendingSlots;
    uint16[] private _freeSlots;
    mapping(uint64 observationId => uint16 slotPlusOne) private _observationSlots;
    uint16 public pendingCount;
    uint16 public scanCursor;
    uint64 public lastObservationId;
    uint64 public settledObservationCount;
    uint64 public expiredObservationCount;
    uint64 public droppedObservationCount;

    SideState[2] private _sideStates;
    mapping(uint8 side => mapping(uint16 index => int256 markoutWad)) private _markoutHistory;
    mapping(uint8 side => mapping(uint16 index => EpochObservationRecord record)) private _epochObservations;

    uint64 public callbackSequence;

    error InvalidNetworkConfiguration();
    error InvalidSchedulerConfiguration();
    error InvalidReferenceSource(bytes32 sourceId);
    error DuplicateReferenceSource(bytes32 sourceId);
    error OnlyReactiveService(address caller);
    error UnsupportedLog(uint256 chainId, address emitter, uint256 topic0);
    error InvalidSwapLog();
    error ObservationReplay(uint64 supplied, uint64 previous);
    error InvalidReferenceLog();
    error ReferenceReplay(bytes32 sourceId, uint64 supplied, uint64 previous);
    error EventFromFuture(uint64 observedAt, uint64 currentTime);
    error TimestampOverflow();
    error ValueOutOfBounds();
    error CallbackSequenceOverflow();

    event ObservationQueued(
        uint64 indexed observationId,
        uint16 indexed slot,
        bool indexed zeroForOne,
        uint128 executionPriceWad,
        uint128 notionalWad,
        uint64 matureAt,
        uint64 expiresAt
    );
    event ObservationSettled(
        uint64 indexed observationId,
        bool indexed zeroForOne,
        int256 markoutWad,
        int256 filteredMarkoutWad,
        uint256 trailingSigmaWad,
        uint256 referencePriceWad,
        uint256 referenceDispersionWad,
        uint8 referenceCount,
        bool coldStart
    );
    event ObservationExpired(uint64 indexed observationId, bool indexed zeroForOne, uint64 expiresAt);
    event ObservationDropped(uint64 indexed observationId, bool indexed zeroForOne, DropReason reason);
    event ReferenceAccepted(
        bytes32 indexed sourceId, uint64 indexed sequence, uint256 priceWad, uint256 confidenceWad, uint64 observedAt
    );
    event EpochFinalized(
        bool indexed zeroForOne,
        uint64 indexed epochId,
        int256 aggregateMarkoutWad,
        int128 signedRiskWad,
        uint256 confidenceWad,
        uint256 persistenceBitmap,
        bool persistenceActive,
        bool fastPathActive,
        uint24 calculatedFeePips,
        uint16 eligibleObservationCount,
        uint256 eligibleNotionalWad,
        uint256 maximumReferenceDispersionWad,
        bool includedColdStart
    );
    event RecommendationScheduled(
        uint64 indexed sequence,
        uint24 zeroForOneFeePips,
        uint24 oneForZeroFeePips,
        int128 zeroForOneRiskWad,
        int128 oneForZeroRiskWad,
        uint16 confidenceBps,
        uint64 validAfter,
        uint64 validUntil
    );

    constructor(
        NetworkConfig memory networkConfig_,
        TokenConfig memory tokenConfig_,
        SchedulerConfig memory schedulerConfig_,
        FeeCurve.Config memory feeCurveConfig_,
        bytes32[] memory referenceSources_
    ) payable {
        _validateConfiguration(networkConfig_, tokenConfig_, schedulerConfig_, feeCurveConfig_, referenceSources_);

        networkConfig = networkConfig_;
        tokenConfig = tokenConfig_;
        schedulerConfig = schedulerConfig_;
        _feeCurveConfig = feeCurveConfig_;

        for (uint256 index; index < referenceSources_.length; ++index) {
            bytes32 sourceId = referenceSources_[index];
            if (sourceId == bytes32(0)) revert InvalidReferenceSource(sourceId);
            if (referenceSourceIndex[sourceId] != 0) revert DuplicateReferenceSource(sourceId);
            // Source count is bounded to 16 and therefore fits in uint8.
            // forge-lint: disable-next-line(unsafe-typecast)
            referenceSourceIndex[sourceId] = uint8(index + 1);
            _referenceSources.push(sourceId);
        }

        for (uint16 count = schedulerConfig_.maximumPendingObservations; count > 0; --count) {
            _pendingSlots.push();
            _freeSlots.push(count - 1);
        }

        _sideStates[0].latestCalculatedFeePips = feeCurveConfig_.baseFeePips;
        _sideStates[1].latestCalculatedFeePips = feeCurveConfig_.baseFeePips;

        if (!vm) _subscribe();
    }

    /// @notice Processes one subscribed swap, reference, or CRON log.
    function react(LogRecord calldata log) external override vmOnly {
        if (msg.sender != address(SERVICE_ADDR)) revert OnlyReactiveService(msg.sender);

        if (log.topic_0 == SWAP_OBSERVED_TOPIC) {
            _handleSwap(log);
            return;
        }
        if (log.topic_0 == REFERENCE_PRICE_TOPIC) {
            _handleReference(log);
            return;
        }
        if (log.topic_0 == networkConfig.cronTopic) {
            _handleCron(log);
            return;
        }

        revert UnsupportedLog(log.chain_id, log._contract, log.topic_0);
    }

    function referenceSourceCount() external view returns (uint256) {
        return _referenceSources.length;
    }

    function referenceSourceAt(uint256 index) external view returns (bytes32) {
        return _referenceSources[index];
    }

    function feeCurveConfig() external view returns (FeeCurve.Config memory) {
        return _feeCurveConfig;
    }

    function pendingObservation(uint16 slot) external view returns (PendingObservation memory) {
        return _pendingSlots[slot];
    }

    function observationSlot(uint64 observationId) external view returns (uint16 slot, bool active) {
        uint16 slotPlusOne = _observationSlots[observationId];
        if (slotPlusOne == 0) return (0, false);
        return (slotPlusOne - 1, true);
    }

    function referenceRecord(bytes32 sourceId, uint8 slot) external view returns (ReferenceRecord memory) {
        return _referenceHistory[sourceId][slot];
    }

    function referenceHistoryState(bytes32 sourceId) external view returns (uint8 count, uint8 cursor) {
        return (_referenceHistoryCount[sourceId], _referenceHistoryCursor[sourceId]);
    }

    function sideState(bool zeroForOne) external view returns (SideState memory) {
        return _sideStates[_sideIndex(zeroForOne)];
    }

    function effectiveFee(bool zeroForOne) external view returns (uint24) {
        return _effectiveFee(_sideStates[_sideIndex(zeroForOne)]);
    }

    function _subscribe() private {
        service.subscribe(
            networkConfig.originChainId,
            networkConfig.hook,
            SWAP_OBSERVED_TOPIC,
            uint256(networkConfig.poolId),
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );
        service.subscribe(
            networkConfig.referenceChainId,
            networkConfig.referenceFeed,
            REFERENCE_PRICE_TOPIC,
            uint256(networkConfig.marketId),
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );
        service.subscribe(
            networkConfig.reactiveChainId,
            address(SERVICE_ADDR),
            networkConfig.cronTopic,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );
    }

    function _handleSwap(LogRecord calldata log) private {
        if (
            log.chain_id != networkConfig.originChainId || log._contract != networkConfig.hook
                || log.topic_1 != uint256(networkConfig.poolId) || log.topic_2 == 0 || log.topic_2 > type(uint64).max
                || log.topic_3 > 1 || log.data.length != 192
        ) revert InvalidSwapLog();

        // Topic bounds above make both conversions exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 observationId = uint64(log.topic_2);
        if (observationId <= lastObservationId) revert ObservationReplay(observationId, lastObservationId);

        SwapEventData memory eventData = _decodeSwapEvent(log.data);
        uint64 currentTime = _currentTime();
        if (uint256(eventData.observedAt) > uint256(currentTime) + schedulerConfig.maximumEventFutureSkew) {
            revert EventFromFuture(eventData.observedAt, currentTime);
        }

        lastObservationId = observationId;
        _queueObservation(observationId, log.topic_3 == 1, eventData, currentTime);
    }

    function _queueObservation(
        uint64 observationId,
        bool zeroForOne,
        SwapEventData memory eventData,
        uint64 currentTime
    ) private {
        (uint128 executionPriceWad, uint128 notionalWad, int8 traderDirection) =
            _executionData(eventData.amount0, eventData.amount1, zeroForOne);
        (uint64 matureAt, uint64 expiresAt) = _observationTimes(eventData.observedAt);

        if (currentTime >= expiresAt) {
            ++expiredObservationCount;
            emit ObservationExpired(observationId, zeroForOne, expiresAt);
            return;
        }
        if (_freeSlots.length == 0) {
            ++droppedObservationCount;
            emit ObservationDropped(observationId, zeroForOne, DropReason.Capacity);
            return;
        }

        uint256 lastFreeIndex = _freeSlots.length - 1;
        uint16 slot = _freeSlots[lastFreeIndex];
        _freeSlots.pop();
        PendingObservation storage queued = _pendingSlots[slot];
        queued.observationId = observationId;
        queued.observedAt = eventData.observedAt;
        queued.matureAt = matureAt;
        queued.expiresAt = expiresAt;
        queued.executionPriceWad = executionPriceWad;
        queued.notionalWad = notionalWad;
        queued.appliedFeePips = eventData.appliedFeePips;
        queued.traderDirection = traderDirection;
        queued.zeroForOne = zeroForOne;
        queued.usedBaseline = eventData.usedBaseline;
        _observationSlots[observationId] = slot + 1;
        ++pendingCount;

        emit ObservationQueued(observationId, slot, zeroForOne, executionPriceWad, notionalWad, matureAt, expiresAt);
    }

    function _decodeSwapEvent(bytes calldata data) private pure returns (SwapEventData memory eventData) {
        (
            eventData.amount0,
            eventData.amount1,
            eventData.sqrtPriceX96After,
            eventData.appliedFeePips,
            eventData.usedBaseline,
            eventData.observedAt
        ) = abi.decode(data, (int128, int128, uint160, uint24, bool, uint64));
        if (
            eventData.amount0 == 0 || eventData.amount1 == 0 || (eventData.amount0 < 0) == (eventData.amount1 < 0)
                || eventData.sqrtPriceX96After == 0 || eventData.appliedFeePips > ThetaShieldUnits.FEE_PIPS
                || eventData.observedAt == 0
        ) revert InvalidSwapLog();
    }

    function _handleReference(LogRecord calldata log) private {
        if (
            log.chain_id != networkConfig.referenceChainId || log._contract != networkConfig.referenceFeed
                || log.topic_1 != uint256(networkConfig.marketId) || log.topic_2 == 0 || log.topic_3 == 0
                || log.topic_3 > type(uint64).max || log.data.length != 96
        ) revert InvalidReferenceLog();

        bytes32 sourceId = bytes32(log.topic_2);
        if (referenceSourceIndex[sourceId] == 0) revert InvalidReferenceSource(sourceId);
        // Topic bounds above make this conversion exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 sequence = uint64(log.topic_3);
        uint64 previousSequence = latestReferenceSequence[sourceId];
        if (sequence <= previousSequence) revert ReferenceReplay(sourceId, sequence, previousSequence);

        (uint256 priceWad, uint256 confidenceWad, uint64 observedAt) = abi.decode(log.data, (uint256, uint256, uint64));
        if (
            priceWad == 0 || priceWad > type(uint128).max || confidenceWad == 0 || confidenceWad > ThetaShieldUnits.WAD
                || observedAt == 0
        ) revert InvalidReferenceLog();

        uint64 currentTime = _currentTime();
        if (uint256(observedAt) > uint256(currentTime) + schedulerConfig.maximumEventFutureSkew) {
            revert EventFromFuture(observedAt, currentTime);
        }

        latestReferenceSequence[sourceId] = sequence;
        uint8 cursor = _referenceHistoryCursor[sourceId];
        // Values were bounded above to their packed storage types.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 packedPriceWad = uint128(priceWad);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 packedConfidenceWad = uint128(confidenceWad);
        _referenceHistory[sourceId][cursor] = ReferenceRecord({
            priceWad: packedPriceWad, confidenceWad: packedConfidenceWad, observedAt: observedAt, sequence: sequence
        });

        uint8 historyLimit = schedulerConfig.maximumReferenceSamplesPerSource;
        _referenceHistoryCursor[sourceId] = cursor + 1 == historyLimit ? 0 : cursor + 1;
        uint8 count = _referenceHistoryCount[sourceId];
        if (count < historyLimit) _referenceHistoryCount[sourceId] = count + 1;

        emit ReferenceAccepted(sourceId, sequence, priceWad, confidenceWad, observedAt);
    }

    function _handleCron(LogRecord calldata log) private {
        if (
            log.chain_id != networkConfig.reactiveChainId || log._contract != address(SERVICE_ADDR)
                || log.topic_0 != networkConfig.cronTopic
        ) revert UnsupportedLog(log.chain_id, log._contract, log.topic_0);

        bool finalized = _processPending();
        if (_finalizeMatureEpoch(0)) finalized = true;
        if (_finalizeMatureEpoch(1)) finalized = true;
        if (finalized) _scheduleRecommendation();
    }

    function _processPending() private returns (bool finalized) {
        uint16 slotCount = schedulerConfig.maximumPendingObservations;
        uint16 maximumToInspect = schedulerConfig.maximumProcessPerCron;
        uint64 currentTime = _currentTime();

        for (uint16 inspected; inspected < maximumToInspect; ++inspected) {
            uint16 slot = scanCursor;
            scanCursor = slot + 1 == slotCount ? 0 : slot + 1;
            PendingObservation memory observation = _pendingSlots[slot];
            if (observation.observationId == 0 || currentTime < observation.matureAt) continue;

            ReferencePriceDispersion.Sample[] memory samples = _eligibleReferences(observation);
            uint64 selectionEndsAt = _selectionEndsAt(observation);
            bool enoughSources = samples.length >= schedulerConfig.minimumReferenceSources;
            if (samples.length != 0 && (enoughSources || currentTime >= selectionEndsAt)) {
                if (_settleObservation(slot, observation, samples)) finalized = true;
            } else if (currentTime >= observation.expiresAt) {
                _expireObservation(slot, observation);
            }
        }
    }

    function _settleObservation(
        uint16 slot,
        PendingObservation memory observation,
        ReferencePriceDispersion.Sample[] memory samples
    ) private returns (bool finalized) {
        ReferencePriceDispersion.Result memory referenceResult = ReferencePriceDispersion.calculate(samples);
        int256 markoutWad = DirectionalMarkoutMath.calculate(
            observation.executionPriceWad, referenceResult.weightedMedianPriceWad, observation.traderDirection
        );
        if (FixedPointMath.abs(markoutWad) > MAX_ABSOLUTE_MARKOUT_WAD) {
            ++droppedObservationCount;
            emit ObservationDropped(observation.observationId, observation.zeroForOne, DropReason.InvalidMarkout);
            _releaseObservation(slot, observation.observationId);
            return false;
        }

        uint8 side = _sideIndex(observation.zeroForOne);
        (uint256 sigmaWad, bool coldStart) = _scoreTrailingSigma(side);
        int256 filteredMarkoutWad = DeadBandFilter.filter(markoutWad, sigmaWad, schedulerConfig.deadBandKWad);
        _storeMarkout(side, markoutWad);

        finalized = _appendEpochObservation(
            side,
            EpochObservationRecord({
                filteredMarkoutWad: filteredMarkoutWad,
                notionalWad: observation.notionalWad,
                referenceDispersionWad: referenceResult.normalizedDispersionWad,
                coldStart: coldStart
            })
        );

        ++settledObservationCount;
        emit ObservationSettled(
            observation.observationId,
            observation.zeroForOne,
            markoutWad,
            filteredMarkoutWad,
            sigmaWad,
            referenceResult.weightedMedianPriceWad,
            referenceResult.normalizedDispersionWad,
            // Source count is bounded to 16.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint8(samples.length),
            coldStart
        );
        _releaseObservation(slot, observation.observationId);
    }

    function _expireObservation(uint16 slot, PendingObservation memory observation) private {
        ++expiredObservationCount;
        emit ObservationExpired(observation.observationId, observation.zeroForOne, observation.expiresAt);
        _releaseObservation(slot, observation.observationId);
    }

    function _releaseObservation(uint16 slot, uint64 observationId) private {
        delete _pendingSlots[slot];
        delete _observationSlots[observationId];
        _freeSlots.push(slot);
        --pendingCount;
    }

    function _eligibleReferences(PendingObservation memory observation)
        private
        view
        returns (ReferencePriceDispersion.Sample[] memory samples)
    {
        uint256 sourceCount = _referenceSources.length;
        ReferencePriceDispersion.Sample[] memory temporary = new ReferencePriceDispersion.Sample[](sourceCount);
        uint256 eligibleCount;
        uint64 upperBound = _selectionEndsAt(observation);
        uint64 currentTime = _currentTime();

        for (uint256 sourceIndex; sourceIndex < sourceCount; ++sourceIndex) {
            bytes32 sourceId = _referenceSources[sourceIndex];
            uint8 historyCount = _referenceHistoryCount[sourceId];
            ReferenceRecord memory selected;
            for (uint8 recordIndex; recordIndex < historyCount; ++recordIndex) {
                ReferenceRecord memory candidate = _referenceHistory[sourceId][recordIndex];
                if (
                    candidate.observedAt >= observation.matureAt && candidate.observedAt <= upperBound
                        && candidate.observedAt <= currentTime
                        && (selected.observedAt == 0 || candidate.observedAt < selected.observedAt)
                ) selected = candidate;
            }
            if (selected.observedAt != 0) {
                temporary[eligibleCount++] =
                    ReferencePriceDispersion.Sample({priceWad: selected.priceWad, weightWad: selected.confidenceWad});
            }
        }

        samples = new ReferencePriceDispersion.Sample[](eligibleCount);
        for (uint256 index; index < eligibleCount; ++index) {
            samples[index] = temporary[index];
        }
    }

    function _selectionEndsAt(PendingObservation memory observation) private view returns (uint64) {
        uint256 end = uint256(observation.matureAt) + schedulerConfig.referenceSelectionWindow;
        if (end > observation.expiresAt) end = observation.expiresAt;
        // The result is capped by the uint64 observation expiry.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(end);
    }

    function _scoreTrailingSigma(uint8 side) private view returns (uint256 sigmaWad, bool coldStart) {
        SideState storage state = _sideStates[side];
        uint16 count = state.historyCount;
        int256[] memory trailing = new int256[](uint256(count) + 1);
        for (uint16 index; index < count; ++index) {
            trailing[index] = _markoutHistory[side][index];
        }

        (sigmaWad,) = TrailingVolatility.trailingSigma(trailing, count, schedulerConfig.trailingWindow);
        coldStart = count < schedulerConfig.minimumTrailingObservations;
        if (coldStart) sigmaWad = schedulerConfig.coldStartSigmaWad;
    }

    function _storeMarkout(uint8 side, int256 markoutWad) private {
        SideState storage state = _sideStates[side];
        uint16 cursor = state.historyCursor;
        _markoutHistory[side][cursor] = markoutWad;
        uint16 window = schedulerConfig.trailingWindow;
        state.historyCursor = cursor + 1 == window ? 0 : cursor + 1;
        if (state.historyCount < window) ++state.historyCount;
    }

    function _appendEpochObservation(uint8 side, EpochObservationRecord memory observation)
        private
        returns (bool finalized)
    {
        SideState storage state = _sideStates[side];
        uint64 currentEpochId = _currentTime() / schedulerConfig.epochDuration;

        if (state.epochOpen && state.openEpochId != currentEpochId) {
            finalized = _finalizeSide(side);
        }
        if (!state.epochOpen) {
            _applyMissingEpochs(side, currentEpochId);
            state.epochOpen = true;
            state.openEpochId = currentEpochId;
        }

        uint16 count = state.epochObservationCount;
        if (count >= schedulerConfig.maximumEpochObservations) {
            ++droppedObservationCount;
            emit ObservationDropped(0, side == 0, DropReason.EpochCapacity);
            return finalized;
        }
        _epochObservations[side][count] = observation;
        state.epochObservationCount = count + 1;
    }

    function _finalizeMatureEpoch(uint8 side) private returns (bool) {
        SideState storage state = _sideStates[side];
        if (!state.epochOpen) return false;
        uint64 currentEpochId = _currentTime() / schedulerConfig.epochDuration;
        if (currentEpochId <= state.openEpochId) return false;
        _finalizeSide(side);
        _applyMissingEpochs(side, currentEpochId);
        return true;
    }

    function _finalizeSide(uint8 side) private returns (bool) {
        SideState storage state = _sideStates[side];
        uint16 count = state.epochObservationCount;
        EpochComputation memory computation = _computeEpoch(side, count);

        int256 riskInputWad = computation.meetsMinimumEpochNotional ? computation.aggregateMarkoutWad : int256(0);
        DirectionalRiskSmoother.Result memory smoothed = DirectionalRiskSmoother.update(
            riskInputWad, state.smoothedMagnitudeWad, schedulerConfig.alphaWad, computation.confidenceWad
        );
        state.smoothedMagnitudeWad = smoothed.magnitudeWad;
        state.latestRiskWad = _toInt128(smoothed.signedRiskWad);
        state.latestConfidenceWad = computation.confidenceWad;

        bool toxic = computation.meetsMinimumEpochNotional && !computation.includedColdStart
            && smoothed.signedRiskWad > int256(schedulerConfig.toxicThresholdWad);
        state.persistenceBitmap =
            PersistenceWindow.push(state.persistenceBitmap, toxic, schedulerConfig.persistenceWindow);
        bool persistenceActive = PersistenceWindow.isActive(
            state.persistenceBitmap, schedulerConfig.requiredToxicEpochs, schedulerConfig.persistenceWindow
        );
        state.latestPersistenceActive = persistenceActive;
        bool fastPathActive = _updateFastPath(state, computation);
        state.latestFastPathActive = fastPathActive;

        FeeCurve.Result memory fee = FeeCurve.calculate(
            smoothed.signedRiskWad,
            computation.confidenceWad,
            persistenceActive || fastPathActive,
            state.latestCalculatedFeePips,
            _feeCurveConfig
        );
        state.latestCalculatedFeePips = fee.nextFeePips;

        uint64 finalizedEpochId = state.openEpochId;
        state.lastFinalizedEpochId = finalizedEpochId;
        state.hasFinalizedEpoch = true;
        state.epochOpen = false;
        state.epochObservationCount = 0;
        for (uint16 index; index < count; ++index) {
            delete _epochObservations[side][index];
        }

        _emitEpochFinalized(side, finalizedEpochId, computation, persistenceActive, fastPathActive, fee.nextFeePips);
        return true;
    }

    function _updateFastPath(SideState storage state, EpochComputation memory computation)
        private
        returns (bool active)
    {
        if (!schedulerConfig.fastPathEnabled) return false;
        int256 instantRiskWad = FixedPointMath.mulDivSigned(
            computation.aggregateMarkoutWad, FixedPointMath.toInt256(computation.confidenceWad), ThetaShieldUnits.WAD
        );
        bool triggered = computation.meetsMinimumEpochNotional && !computation.includedColdStart
            && computation.confidenceWad >= schedulerConfig.fastPathConfidenceFloorWad
            && instantRiskWad > int256(schedulerConfig.fastPathToxicThresholdWad);
        if (triggered) {
            state.fastPathHoldRemaining = schedulerConfig.fastPathHoldEpochs;
            return true;
        }
        if (state.fastPathHoldRemaining != 0) {
            --state.fastPathHoldRemaining;
            return true;
        }
        return false;
    }

    function _emitEpochFinalized(
        uint8 side,
        uint64 finalizedEpochId,
        EpochComputation memory computation,
        bool persistenceActive,
        bool fastPathActive,
        uint24 feePips
    ) private {
        SideState storage state = _sideStates[side];
        emit EpochFinalized(
            side == 0,
            finalizedEpochId,
            computation.aggregateMarkoutWad,
            state.latestRiskWad,
            computation.confidenceWad,
            state.persistenceBitmap,
            persistenceActive,
            fastPathActive,
            feePips,
            computation.eligibleObservationCount,
            computation.eligibleNotionalWad,
            computation.maximumReferenceDispersionWad,
            computation.includedColdStart
        );
    }

    function _computeEpoch(uint8 side, uint16 count) private view returns (EpochComputation memory computation) {
        EpochAggregation.Observation[] memory observations = new EpochAggregation.Observation[](count);
        for (uint16 index; index < count; ++index) {
            EpochObservationRecord storage record = _epochObservations[side][index];
            observations[index] = EpochAggregation.Observation({
                filteredMarkoutWad: record.filteredMarkoutWad, notionalWad: record.notionalWad
            });
        }

        EpochAggregation.Result memory aggregate = EpochAggregation.aggregate(observations, _epochConfig());
        (uint256 agreeingNotionalWad, uint256 maximumReferenceDispersionWad, bool includedColdStart) =
            _epochMetrics(side, count, aggregate.aggregateMarkoutWad);

        if (aggregate.meetsMinimumEpochNotional && aggregate.eligibleObservationCount != 0) {
            ConfidenceWeight.Components memory confidence = ConfidenceWeight.calculate(
                aggregate.eligibleObservationCount,
                schedulerConfig.targetObservationCount,
                agreeingNotionalWad,
                aggregate.eligibleNotionalWad,
                maximumReferenceDispersionWad,
                schedulerConfig.maximumDispersionWad,
                schedulerConfig.confidenceCapWad
            );
            computation.confidenceWad = confidence.confidenceWad;
        }
        computation.aggregateMarkoutWad = aggregate.aggregateMarkoutWad;
        computation.eligibleNotionalWad = aggregate.eligibleNotionalWad;
        computation.maximumReferenceDispersionWad = maximumReferenceDispersionWad;
        computation.eligibleObservationCount = aggregate.eligibleObservationCount;
        computation.meetsMinimumEpochNotional = aggregate.meetsMinimumEpochNotional;
        computation.includedColdStart = includedColdStart;
    }

    function _epochMetrics(uint8 side, uint16 count, int256 aggregateMarkoutWad)
        private
        view
        returns (uint256 agreeingNotionalWad, uint256 maximumDispersionWad, bool includedColdStart)
    {
        for (uint16 index; index < count; ++index) {
            EpochObservationRecord storage record = _epochObservations[side][index];
            if (record.notionalWad < schedulerConfig.minimumObservationNotionalWad) continue;
            uint256 cappedNotionalWad = record.notionalWad > schedulerConfig.maximumTradeNotionalWad
                ? schedulerConfig.maximumTradeNotionalWad
                : record.notionalWad;
            if (
                (aggregateMarkoutWad > 0 && record.filteredMarkoutWad > 0)
                    || (aggregateMarkoutWad < 0 && record.filteredMarkoutWad < 0)
            ) agreeingNotionalWad += cappedNotionalWad;
            if (record.referenceDispersionWad > maximumDispersionWad) {
                maximumDispersionWad = record.referenceDispersionWad;
            }
            if (record.coldStart) includedColdStart = true;
        }
    }

    function _applyMissingEpochs(uint8 side, uint64 nextEpochId) private {
        SideState storage state = _sideStates[side];
        if (!state.hasFinalizedEpoch || nextEpochId <= state.lastFinalizedEpochId + 1) return;
        uint64 missing = nextEpochId - state.lastFinalizedEpochId - 1;

        if (missing > 256) {
            state.persistenceBitmap = 0;
            state.smoothedMagnitudeWad = 0;
            state.latestRiskWad = 0;
            state.latestConfidenceWad = 0;
            state.latestCalculatedFeePips = _feeCurveConfig.baseFeePips;
            state.latestPersistenceActive = false;
            state.latestFastPathActive = false;
            state.fastPathHoldRemaining = 0;
            return;
        }

        for (uint64 index; index < missing; ++index) {
            state.persistenceBitmap =
                PersistenceWindow.push(state.persistenceBitmap, false, schedulerConfig.persistenceWindow);
            DirectionalRiskSmoother.Result memory decayed =
                DirectionalRiskSmoother.update(0, state.smoothedMagnitudeWad, schedulerConfig.alphaWad, 0);
            state.smoothedMagnitudeWad = decayed.magnitudeWad;
            FeeCurve.Result memory fee = FeeCurve.calculate(0, 0, false, state.latestCalculatedFeePips, _feeCurveConfig);
            state.latestCalculatedFeePips = fee.nextFeePips;
        }
        if (missing >= state.fastPathHoldRemaining) {
            state.fastPathHoldRemaining = 0;
        } else {
            // The branch proves missing is smaller than the uint16 hold counter.
            // forge-lint: disable-next-line(unsafe-typecast)
            state.fastPathHoldRemaining -= uint16(missing);
        }
        state.latestRiskWad = 0;
        state.latestConfidenceWad = 0;
        state.latestPersistenceActive = false;
        state.latestFastPathActive = false;
    }

    function _scheduleRecommendation() private {
        if (callbackSequence == type(uint64).max) revert CallbackSequenceOverflow();
        uint64 sequence = callbackSequence + 1;
        callbackSequence = sequence;

        SideState storage zeroForOne = _sideStates[0];
        SideState storage oneForZero = _sideStates[1];
        uint24 zeroForOneFeePips = _effectiveFee(zeroForOne);
        uint24 oneForZeroFeePips = _effectiveFee(oneForZero);
        uint256 confidenceWad = _sharedConfidence(
            zeroForOneFeePips, oneForZeroFeePips, zeroForOne.latestConfidenceWad, oneForZero.latestConfidenceWad
        );
        // Confidence is bounded to WAD, so the basis-point result fits uint16.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint16 confidenceBps =
            uint16(FixedPointMath.mulDivDown(confidenceWad, ThetaShieldUnits.BPS, ThetaShieldUnits.WAD));

        uint64 currentTime = _currentTime();
        uint64 validAfter =
            currentTime > schedulerConfig.callbackClockSkew ? currentTime - schedulerConfig.callbackClockSkew : 0;
        uint256 validUntilWide = uint256(validAfter) + schedulerConfig.recommendationLifetime;
        if (validUntilWide > type(uint64).max) revert TimestampOverflow();
        // Bound checked above.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 validUntil = uint64(validUntilWide);

        ThetaShieldController.FeeRecommendation memory recommendation = ThetaShieldController.FeeRecommendation({
            zeroForOneFee: zeroForOneFeePips,
            oneForZeroFee: oneForZeroFeePips,
            zeroForOneRiskWad: zeroForOne.latestRiskWad,
            oneForZeroRiskWad: oneForZero.latestRiskWad,
            confidenceBps: confidenceBps,
            validAfter: validAfter,
            validUntil: validUntil,
            sequence: sequence
        });
        bytes memory payload = abi.encodeWithSelector(
            ThetaShieldController.applyRecommendation.selector, address(0), networkConfig.poolId, recommendation
        );

        emit RecommendationScheduled(
            sequence,
            zeroForOneFeePips,
            oneForZeroFeePips,
            zeroForOne.latestRiskWad,
            oneForZero.latestRiskWad,
            confidenceBps,
            validAfter,
            validUntil
        );
        emit Callback(networkConfig.originChainId, networkConfig.controller, networkConfig.callbackGasLimit, payload);
    }

    function _effectiveFee(SideState storage state) private view returns (uint24) {
        if (
            (!state.latestPersistenceActive && !state.latestFastPathActive) || state.latestRiskWad <= 0
                || state.latestConfidenceWad < _feeCurveConfig.confidenceFloorWad
        ) return _feeCurveConfig.baseFeePips;
        return state.latestCalculatedFeePips;
    }

    function _sharedConfidence(
        uint24 zeroForOneFee,
        uint24 oneForZeroFee,
        uint256 zeroForOneConfidence,
        uint256 oneForZeroConfidence
    ) private view returns (uint256) {
        bool zeroForOnePremium = zeroForOneFee > _feeCurveConfig.baseFeePips;
        bool oneForZeroPremium = oneForZeroFee > _feeCurveConfig.baseFeePips;
        if (zeroForOnePremium && oneForZeroPremium) {
            return zeroForOneConfidence < oneForZeroConfidence ? zeroForOneConfidence : oneForZeroConfidence;
        }
        if (zeroForOnePremium) return zeroForOneConfidence;
        if (oneForZeroPremium) return oneForZeroConfidence;
        return zeroForOneConfidence > oneForZeroConfidence ? zeroForOneConfidence : oneForZeroConfidence;
    }

    function _executionData(int128 amount0, int128 amount1, bool zeroForOne)
        private
        view
        returns (uint128 executionPriceWad, uint128 notionalWad, int8 traderDirection)
    {
        uint256 token0Wad =
            FixedPointMath.mulDivDown(_absolute(amount0), ThetaShieldUnits.WAD, 10 ** tokenConfig.token0Decimals);
        uint256 token1Wad =
            FixedPointMath.mulDivDown(_absolute(amount1), ThetaShieldUnits.WAD, 10 ** tokenConfig.token1Decimals);
        uint256 baseAmountWad = tokenConfig.baseIsToken0 ? token0Wad : token1Wad;
        uint256 quoteAmountWad = tokenConfig.baseIsToken0 ? token1Wad : token0Wad;
        if (baseAmountWad == 0 || quoteAmountWad == 0) revert ValueOutOfBounds();

        uint256 priceWad = FixedPointMath.mulDivDown(quoteAmountWad, ThetaShieldUnits.WAD, baseAmountWad);
        if (priceWad == 0 || priceWad > type(uint128).max || quoteAmountWad > type(uint128).max) {
            revert ValueOutOfBounds();
        }
        // Values were bounded above.
        // forge-lint: disable-next-line(unsafe-typecast)
        executionPriceWad = uint128(priceWad);
        // forge-lint: disable-next-line(unsafe-typecast)
        notionalWad = uint128(quoteAmountWad);
        traderDirection = zeroForOne == tokenConfig.baseIsToken0 ? int8(-1) : int8(1);
    }

    function _observationTimes(uint64 observedAt) private view returns (uint64 matureAt, uint64 expiresAt) {
        uint256 mature = uint256(observedAt) + schedulerConfig.markoutHorizon;
        uint256 expires = uint256(observedAt) + schedulerConfig.observationLifetime;
        if (mature > type(uint64).max || expires > type(uint64).max) revert TimestampOverflow();
        // Both values were bounded above.
        // forge-lint: disable-next-line(unsafe-typecast)
        matureAt = uint64(mature);
        // forge-lint: disable-next-line(unsafe-typecast)
        expiresAt = uint64(expires);
    }

    function _epochConfig() private view returns (EpochAggregation.Config memory) {
        return EpochAggregation.Config({
            minimumObservationNotionalWad: schedulerConfig.minimumObservationNotionalWad,
            maximumTradeNotionalWad: schedulerConfig.maximumTradeNotionalWad,
            minimumEpochNotionalWad: schedulerConfig.minimumEpochNotionalWad,
            maximumObservationCount: schedulerConfig.maximumEpochObservations
        });
    }

    function _validateConfiguration(
        NetworkConfig memory network,
        TokenConfig memory tokens,
        SchedulerConfig memory scheduler,
        FeeCurve.Config memory feeConfig,
        bytes32[] memory sources
    ) private pure {
        if (
            network.originChainId == 0 || network.referenceChainId == 0 || network.reactiveChainId == 0
                || network.hook == address(0) || network.referenceFeed == address(0) || network.controller == address(0)
                || network.poolId == bytes32(0) || network.marketId == bytes32(0) || network.cronTopic == 0
                || network.callbackGasLimit == 0
        ) revert InvalidNetworkConfiguration();
        if (tokens.token0Decimals > 36 || tokens.token1Decimals > 36) revert InvalidSchedulerConfiguration();
        if (sources.length == 0 || sources.length > ABSOLUTE_MAX_REFERENCE_SOURCES) {
            revert InvalidSchedulerConfiguration();
        }
        if (
            scheduler.markoutHorizon == 0 || scheduler.observationLifetime <= scheduler.markoutHorizon
                || scheduler.referenceSelectionWindow == 0
                || scheduler.referenceSelectionWindow > scheduler.observationLifetime - scheduler.markoutHorizon
                || scheduler.epochDuration == 0 || scheduler.recommendationLifetime == 0
                || scheduler.callbackClockSkew >= scheduler.recommendationLifetime
                || scheduler.maximumPendingObservations == 0
                || scheduler.maximumPendingObservations > ABSOLUTE_MAX_PENDING || scheduler.maximumProcessPerCron == 0
                || scheduler.maximumProcessPerCron > ABSOLUTE_MAX_PROCESS_PER_CRON
                || scheduler.maximumProcessPerCron > scheduler.maximumPendingObservations
                || scheduler.maximumEpochObservations == 0
                || scheduler.maximumEpochObservations > ABSOLUTE_MAX_EPOCH_OBSERVATIONS || scheduler.trailingWindow == 0
                || scheduler.trailingWindow > 256 || scheduler.minimumTrailingObservations == 0
                || scheduler.minimumTrailingObservations > scheduler.trailingWindow
                || scheduler.targetObservationCount == 0 || scheduler.requiredToxicEpochs == 0
                || scheduler.persistenceWindow == 0 || scheduler.persistenceWindow > 256
                || scheduler.requiredToxicEpochs > scheduler.persistenceWindow
                || scheduler.fastPathHoldEpochs > ABSOLUTE_MAX_FAST_PATH_HOLD_EPOCHS
                || scheduler.maximumReferenceSamplesPerSource == 0
                || scheduler.maximumReferenceSamplesPerSource > ABSOLUTE_MAX_REFERENCE_HISTORY
                || scheduler.minimumReferenceSources == 0 || scheduler.minimumReferenceSources > sources.length
                || scheduler.coldStartSigmaWad > MAX_ABSOLUTE_MARKOUT_WAD || scheduler.deadBandKWad > 10e18
                || scheduler.maximumDispersionWad == 0 || scheduler.confidenceCapWad > ThetaShieldUnits.WAD
                || scheduler.toxicThresholdWad > MAX_ABSOLUTE_MARKOUT_WAD || scheduler.alphaWad == 0
                || scheduler.alphaWad > ThetaShieldUnits.WAD
        ) revert InvalidSchedulerConfiguration();
        if (
            scheduler.fastPathEnabled
                && (scheduler.fastPathConfidenceFloorWad > ThetaShieldUnits.WAD
                    || scheduler.fastPathToxicThresholdWad == 0
                    || scheduler.fastPathToxicThresholdWad > MAX_ABSOLUTE_MARKOUT_WAD)
        ) revert InvalidSchedulerConfiguration();
        if (
            feeConfig.minimumFeePips > feeConfig.baseFeePips || feeConfig.baseFeePips > feeConfig.maximumFeePips
                || feeConfig.maximumFeePips > ThetaShieldUnits.FEE_PIPS
                || feeConfig.confidenceFloorWad > ThetaShieldUnits.WAD
        ) revert InvalidSchedulerConfiguration();

        EpochAggregation.Observation[] memory empty = new EpochAggregation.Observation[](0);
        EpochAggregation.aggregate(
            empty,
            EpochAggregation.Config({
                minimumObservationNotionalWad: scheduler.minimumObservationNotionalWad,
                maximumTradeNotionalWad: scheduler.maximumTradeNotionalWad,
                minimumEpochNotionalWad: scheduler.minimumEpochNotionalWad,
                maximumObservationCount: scheduler.maximumEpochObservations
            })
        );
        PersistenceWindow.isActive(0, scheduler.requiredToxicEpochs, scheduler.persistenceWindow);
    }

    function _absolute(int128 value) private pure returns (uint256) {
        int256 widened = value;
        return uint256(widened < 0 ? -widened : widened);
    }

    function _toInt128(int256 value) private pure returns (int128) {
        if (value < type(int128).min || value > type(int128).max) revert ValueOutOfBounds();
        // Explicit bounds make this cast exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        return int128(value);
    }

    function _currentTime() private view returns (uint64) {
        uint256 timestamp = block.timestamp;
        if (timestamp > type(uint64).max) revert TimestampOverflow();
        // Explicit bounds make this cast exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(timestamp);
    }

    function _sideIndex(bool zeroForOne) private pure returns (uint8) {
        return zeroForOne ? 0 : 1;
    }
}
