// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AbstractCallback} from "reactive-lib/abstract-base/AbstractCallback.sol";
import {ThetaShieldCircleProcessor} from "../circle/ThetaShieldCircleProcessor.sol";
import {PoolMedianReferenceSampler} from "../feeds/PoolMedianReferenceSampler.sol";

/// @title ThetaShieldAutomationExecutor
/// @notice Bounded, permissionless processor-chain work target for Reactive callbacks and keepers.
/// @dev It can only sample the sealed feed, sync configured sources, and call the processor's
///      permissionless process method. It cannot construct or install recommendations itself.
contract ThetaShieldAutomationExecutor is AbstractCallback {
    uint8 public constant MAXIMUM_SOURCES = 16;

    enum Step {
        Sample,
        Sync,
        Process
    }

    struct CycleResult {
        uint64 cycleId;
        uint16 pendingBefore;
        uint16 pendingAfter;
        uint64 settledBefore;
        uint64 settledAfter;
        uint64 expiredBefore;
        uint64 expiredAfter;
        uint64 recommendationBefore;
        uint64 recommendationAfter;
        uint8 publishedSources;
        uint8 syncedSources;
        bool samplerSucceeded;
        bool processSucceeded;
        bool recommendationDispatched;
        bool reactiveTrigger;
    }

    PoolMedianReferenceSampler public immutable sampler;
    ThetaShieldCircleProcessor public immutable processor;
    address public immutable reactiveCallbackProxy;
    address public immutable reactiveRvmId;
    bytes32[] private _sources;
    uint64 public cycleCount;
    CycleResult public lastCycle;
    bool private _executing;

    error InvalidCallbackProxy();
    error InvalidAutomationTarget();
    error InvalidSourceCount(uint256 supplied);
    error InvalidSource(bytes32 sourceId);
    error CycleOverflow();
    error ReentrantExecution();

    event AutomationStepFailed(uint64 indexed cycleId, Step indexed step, bytes32 indexed sourceId, bytes reason);
    event AutomationCycleCompleted(
        uint64 indexed cycleId,
        address indexed caller,
        bool indexed reactiveTrigger,
        uint8 publishedSources,
        uint8 syncedSources,
        uint16 pendingBefore,
        uint16 pendingAfter,
        uint64 settledBefore,
        uint64 settledAfter,
        uint64 expiredBefore,
        uint64 expiredAfter,
        uint64 recommendationBefore,
        uint64 recommendationAfter,
        bool samplerSucceeded,
        bool processSucceeded,
        bool recommendationDispatched
    );

    constructor(
        address callbackProxy,
        PoolMedianReferenceSampler sampler_,
        ThetaShieldCircleProcessor processor_,
        bytes32[] memory sources_
    ) payable AbstractCallback(callbackProxy) {
        if (callbackProxy == address(0) || callbackProxy.code.length == 0) {
            revert InvalidCallbackProxy();
        }
        if (address(sampler_).code.length == 0 || address(processor_).code.length == 0) {
            revert InvalidAutomationTarget();
        }
        if (sources_.length == 0 || sources_.length > MAXIMUM_SOURCES) revert InvalidSourceCount(sources_.length);

        for (uint256 index; index < sources_.length; ++index) {
            bytes32 sourceId = sources_[index];
            if (
                sourceId == bytes32(0) || !sampler_.isSourceConfigured(sourceId)
                    || processor_.referenceSourceIndex(sourceId) == 0
            ) revert InvalidSource(sourceId);
            _sources.push(sourceId);
        }

        sampler = sampler_;
        processor = processor_;
        reactiveCallbackProxy = callbackProxy;
        reactiveRvmId = msg.sender;
    }

    function sourceCount() external view returns (uint256) {
        return _sources.length;
    }

    function sourceAt(uint256 index) external view returns (bytes32) {
        return _sources[index];
    }

    function lastCycleResult() external view returns (CycleResult memory result) {
        return lastCycle;
    }

    /// @notice Allows any keeper to advance exactly one bounded automation cycle.
    function execute() external returns (CycleResult memory result) {
        return _execute(false);
    }

    /// @notice Authenticated Reactive callback entry point; first argument is injected by ReactVM.
    function executeFromReactive(address callbackRvmId)
        external
        authorizedSenderOnly
        rvmIdOnly(callbackRvmId)
        returns (CycleResult memory result)
    {
        return _execute(true);
    }

    function _execute(bool reactiveTrigger) private returns (CycleResult memory result) {
        if (_executing) revert ReentrantExecution();
        _executing = true;

        uint64 previousCycle = cycleCount;
        if (previousCycle == type(uint64).max) revert CycleOverflow();
        uint64 cycleId = previousCycle + 1;
        result.cycleId = cycleId;
        result.pendingBefore = processor.pendingCount();
        result.settledBefore = processor.settledObservationCount();
        result.expiredBefore = processor.expiredObservationCount();
        result.recommendationBefore = processor.recommendationSequence();
        result.reactiveTrigger = reactiveTrigger;

        try sampler.sample() returns (uint8 publishedSources) {
            result.samplerSucceeded = true;
            result.publishedSources = publishedSources;
        } catch (bytes memory reason) {
            emit AutomationStepFailed(cycleId, Step.Sample, bytes32(0), reason);
        }

        for (uint256 index; index < _sources.length; ++index) {
            bytes32 sourceId = _sources[index];
            try processor.syncReference(sourceId) returns (bool accepted) {
                if (accepted) ++result.syncedSources;
            } catch (bytes memory reason) {
                emit AutomationStepFailed(cycleId, Step.Sync, sourceId, reason);
            }
        }

        try processor.process() returns (bool recommendationDispatched) {
            result.processSucceeded = true;
            result.recommendationDispatched = recommendationDispatched;
        } catch (bytes memory reason) {
            emit AutomationStepFailed(cycleId, Step.Process, bytes32(0), reason);
        }

        result.pendingAfter = processor.pendingCount();
        result.settledAfter = processor.settledObservationCount();
        result.expiredAfter = processor.expiredObservationCount();
        result.recommendationAfter = processor.recommendationSequence();
        cycleCount = cycleId;
        lastCycle = result;
        _executing = false;

        emit AutomationCycleCompleted(
            cycleId,
            msg.sender,
            reactiveTrigger,
            result.publishedSources,
            result.syncedSources,
            result.pendingBefore,
            result.pendingAfter,
            result.settledBefore,
            result.settledAfter,
            result.expiredBefore,
            result.expiredAfter,
            result.recommendationBefore,
            result.recommendationAfter,
            result.samplerSucceeded,
            result.processSucceeded,
            result.recommendationDispatched
        );
    }
}
