// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {ThetaShieldCircleProcessor} from "../circle/ThetaShieldCircleProcessor.sol";
import {ThetaShieldController} from "../controller/ThetaShieldController.sol";
import {FeeCurve} from "../libraries/FeeCurve.sol";

interface IThetaShieldObservationCounter {
    function observationCount(bytes32 poolId) external view returns (uint64);
}

/// @title ThetaShieldLens
/// @notice Stateless, permissionless aggregation of origin and processor protocol state.
contract ThetaShieldLens {
    struct OriginPoolSnapshot {
        uint24 zeroForOneFeePips;
        uint24 oneForZeroFeePips;
        bool zeroForOneUsedBaseline;
        bool oneForZeroUsedBaseline;
        uint64 sequence;
        uint64 validAfter;
        uint64 validUntil;
        uint64 secondsUntilExpiry;
        uint16 confidenceBps;
        bool globallyPaused;
        bool poolPaused;
        uint64 observationCount;
        uint24 baselineFeePips;
        bool configured;
    }

    struct ProcessorSnapshot {
        uint16 pendingCount;
        uint16 scanCursor;
        uint64 lastObservationId;
        uint64 settledObservationCount;
        uint64 expiredObservationCount;
        uint64 droppedObservationCount;
        uint64 recommendationSequence;
        uint24 zeroForOneEffectiveFeePips;
        uint24 oneForZeroEffectiveFeePips;
        uint256 referenceSourceCount;
        ThetaShieldCircleProcessor.SideState zeroForOne;
        ThetaShieldCircleProcessor.SideState oneForZero;
        ThetaShieldCircleProcessor.SchedulerConfig scheduler;
        FeeCurve.Config feeCurve;
    }

    struct ReferenceSourceSnapshot {
        bytes32 sourceId;
        uint8 sourceIndexPlusOne;
        uint64 latestSequence;
        uint8 count;
        uint8 cursor;
        ThetaShieldCircleProcessor.ReferenceRecord[] records;
    }

    function originPoolState(address controllerAddress, address hookAddress, bytes32 poolId)
        external
        view
        returns (OriginPoolSnapshot memory snapshot)
    {
        ThetaShieldController controller = ThetaShieldController(controllerAddress);
        ThetaShieldController.PoolFeeConfig memory config = controller.poolConfig(poolId);
        ThetaShieldController.FeeRecommendation memory recommendation = controller.currentRecommendation(poolId);
        (snapshot.zeroForOneFeePips, snapshot.zeroForOneUsedBaseline) = controller.feeForSwap(poolId, true);
        (snapshot.oneForZeroFeePips, snapshot.oneForZeroUsedBaseline) = controller.feeForSwap(poolId, false);
        snapshot.sequence = recommendation.sequence;
        snapshot.validAfter = recommendation.validAfter;
        snapshot.validUntil = recommendation.validUntil;
        // Timestamp is used only to display remaining validity; controller logic remains authoritative.
        // forge-lint: disable-next-line(block-timestamp)
        uint256 currentTime = block.timestamp;
        if (recommendation.validUntil > currentTime) {
            // The subtraction is bounded by the uint64 recommendation lifetime.
            // forge-lint: disable-next-line(unsafe-typecast)
            snapshot.secondsUntilExpiry = uint64(uint256(recommendation.validUntil) - currentTime);
        }
        snapshot.confidenceBps = recommendation.confidenceBps;
        snapshot.globallyPaused = controller.globallyPaused();
        snapshot.poolPaused = config.paused;
        snapshot.observationCount = IThetaShieldObservationCounter(hookAddress).observationCount(poolId);
        snapshot.baselineFeePips = config.baselineFeePips;
        snapshot.configured = controller.isPoolConfigured(poolId);
    }

    function processorState(address processorAddress) external view returns (ProcessorSnapshot memory snapshot) {
        ThetaShieldCircleProcessor processor = ThetaShieldCircleProcessor(processorAddress);
        snapshot.pendingCount = processor.pendingCount();
        snapshot.scanCursor = processor.scanCursor();
        snapshot.lastObservationId = processor.lastObservationId();
        snapshot.settledObservationCount = processor.settledObservationCount();
        snapshot.expiredObservationCount = processor.expiredObservationCount();
        snapshot.droppedObservationCount = processor.droppedObservationCount();
        snapshot.recommendationSequence = processor.recommendationSequence();
        snapshot.zeroForOneEffectiveFeePips = processor.effectiveFee(true);
        snapshot.oneForZeroEffectiveFeePips = processor.effectiveFee(false);
        snapshot.referenceSourceCount = processor.referenceSourceCount();
        snapshot.zeroForOne = processor.sideState(true);
        snapshot.oneForZero = processor.sideState(false);
        snapshot.scheduler = processor.schedulerConfiguration();
        snapshot.feeCurve = processor.feeCurveConfig();
    }

    function referenceSourceState(address processorAddress, bytes32 sourceId)
        external
        view
        returns (ReferenceSourceSnapshot memory snapshot)
    {
        ThetaShieldCircleProcessor processor = ThetaShieldCircleProcessor(processorAddress);
        snapshot.sourceId = sourceId;
        snapshot.sourceIndexPlusOne = processor.referenceSourceIndex(sourceId);
        snapshot.latestSequence = processor.latestReferenceSequence(sourceId);
        (snapshot.count, snapshot.cursor) = processor.referenceHistoryState(sourceId);
        snapshot.records = new ThetaShieldCircleProcessor.ReferenceRecord[](snapshot.count);
        for (uint8 index; index < snapshot.count; ++index) {
            snapshot.records[index] = processor.referenceRecord(sourceId, index);
        }
    }
}
