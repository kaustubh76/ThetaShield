// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {AbstractReactive} from "reactive-lib/abstract-base/AbstractReactive.sol";
import {IReactive} from "reactive-lib/interfaces/IReactive.sol";
import {ReactiveLegacy} from "./ReactiveLegacy.sol";

/// @title ThetaShieldAutomationRSC
/// @notice Reactive Network maturity scheduler and liveness guardian for bounded ThetaShield work.
/// @dev Circle remains the authenticated data plane. This RSC can only request the same
///      permissionless executor cycle available to any keeper.
contract ThetaShieldAutomationRSC is AbstractReactive {
    uint256 public constant LEGACY_LASNA_CHAIN_ID = ReactiveLegacy.LASNA_CHAIN_ID;
    uint256 public constant LEGACY_RELEASE_CRON_TOPIC = ReactiveLegacy.RELEASE_CRON_TOPIC;
    uint256 public constant OBSERVATION_QUEUED_TOPIC =
        uint256(keccak256("ObservationQueued(uint64,uint16,bool,uint128,uint128,uint64,uint64)"));
    uint256 public constant AUTOMATION_CYCLE_TOPIC = uint256(
        keccak256(
            "AutomationCycleCompleted(uint64,address,bool,uint8,uint8,uint16,uint16,uint64,uint64,uint64,uint64,uint64,uint64,bool,bool,bool)"
        )
    );
    uint64 public constant MINIMUM_CALLBACK_GAS = 100_000;
    uint8 public constant MAXIMUM_RETRY_LIMIT = 16;

    enum Phase {
        Idle,
        AwaitMaturity,
        AwaitCycle,
        AwaitFinalization,
        Retry
    }

    struct NetworkConfig {
        uint256 monitoredChainId;
        uint256 destinationChainId;
        uint256 reactiveChainId;
        address processor;
        address executor;
        uint256 cronTopic;
        uint64 callbackGasLimit;
        uint64 epochDuration;
        uint64 retryDelay;
        uint8 maximumRetries;
    }

    struct AutomationCycleData {
        uint8 publishedSources;
        uint8 syncedSources;
        uint16 pendingBefore;
        uint16 pendingAfter;
        uint64 settledBefore;
        uint64 settledAfter;
        uint64 expiredBefore;
        uint64 expiredAfter;
        uint64 recommendationBefore;
        uint64 recommendationAfter;
        bool samplerSucceeded;
        bool processSucceeded;
        bool recommendationDispatched;
    }

    NetworkConfig public networkConfig;
    Phase public phase;
    Phase public triggerPhase;
    uint64 public dueAt;
    uint64 public queuedMaturityAt;
    uint64 public lastCycleId;
    uint64 public wakeRequestCount;
    uint64 public observationSignalCount;
    uint8 public consecutiveRetries;

    error InvalidNetworkConfiguration();
    error InvalidLegacyNetworkConfiguration(
        uint256 monitoredChainId, uint256 destinationChainId, uint256 reactiveChainId, uint256 cronTopic
    );
    error UnsupportedLog(uint256 chainId, address emitter, uint256 topic0);
    error InvalidObservationLog();
    error InvalidAutomationLog();
    error TimestampOverflow();
    error CounterOverflow();

    event ObservationSignalArmed(uint64 indexed observationId, uint64 matureAt, uint64 dueAt, Phase phase);
    event WakeRequested(uint64 indexed requestId, Phase indexed triggerPhase, uint64 dueAt);
    event WakeSuppressed(Phase indexed phase, uint64 dueAt, uint64 currentTime);
    event AutomationCycleObserved(
        uint64 indexed cycleId,
        uint16 pendingAfter,
        bool processSucceeded,
        bool recommendationDispatched,
        Phase nextPhase,
        uint64 nextDueAt
    );
    event GuardianHalted(uint64 indexed cycleId, uint8 consecutiveRetries);

    constructor(NetworkConfig memory networkConfig_) payable {
        if (
            networkConfig_.monitoredChainId == 0 || networkConfig_.destinationChainId == 0
                || networkConfig_.reactiveChainId == 0 || networkConfig_.processor == address(0)
                || networkConfig_.executor == address(0) || networkConfig_.cronTopic == 0
                || networkConfig_.callbackGasLimit < MINIMUM_CALLBACK_GAS || networkConfig_.epochDuration == 0
                || networkConfig_.retryDelay == 0 || networkConfig_.maximumRetries == 0
                || networkConfig_.maximumRetries > MAXIMUM_RETRY_LIMIT
        ) revert InvalidNetworkConfiguration();
        if (
            networkConfig_.monitoredChainId != ReactiveLegacy.ETHEREUM_SEPOLIA_CHAIN_ID
                || networkConfig_.destinationChainId != ReactiveLegacy.ETHEREUM_SEPOLIA_CHAIN_ID
                || networkConfig_.reactiveChainId != ReactiveLegacy.LASNA_CHAIN_ID
                || networkConfig_.cronTopic != ReactiveLegacy.RELEASE_CRON_TOPIC
        ) {
            revert InvalidLegacyNetworkConfiguration(
                networkConfig_.monitoredChainId,
                networkConfig_.destinationChainId,
                networkConfig_.reactiveChainId,
                networkConfig_.cronTopic
            );
        }
        networkConfig = networkConfig_;

        if (!vm) _subscribe(networkConfig_);
    }

    /// @inheritdoc IReactive
    function react(IReactive.LogRecord calldata log) external override vmOnly {
        // Legacy delivers events inside the isolated ReactVM with the RVM identity
        // as msg.sender. `vmOnly` is the trust boundary; requiring SERVICE_ADDR here
        // would reject every real Legacy event even though simulator calls can use it.
        NetworkConfig memory config = networkConfig;
        if (
            log.chain_id == config.monitoredChainId && log._contract == config.processor
                && log.topic_0 == OBSERVATION_QUEUED_TOPIC
        ) {
            _handleObservation(log);
            return;
        }
        if (
            log.chain_id == config.monitoredChainId && log._contract == config.executor
                && log.topic_0 == AUTOMATION_CYCLE_TOPIC && log.topic_3 == 1
        ) {
            _handleAutomationCycle(log);
            return;
        }
        if (
            log.chain_id == config.reactiveChainId && log._contract == address(SERVICE_ADDR)
                && log.topic_0 == config.cronTopic
        ) {
            _handleCron();
            return;
        }

        revert UnsupportedLog(log.chain_id, log._contract, log.topic_0);
    }

    function _subscribe(NetworkConfig memory config) private {
        service.subscribe(
            config.monitoredChainId,
            config.processor,
            OBSERVATION_QUEUED_TOPIC,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );
        // topic_3 == 1 filters for cycles authenticated through executeFromReactive.
        service.subscribe(
            config.monitoredChainId, config.executor, AUTOMATION_CYCLE_TOPIC, REACTIVE_IGNORE, REACTIVE_IGNORE, 1
        );
        service.subscribe(config.reactiveChainId, address(SERVICE_ADDR), config.cronTopic, 0, 0, 0);
    }

    function _handleObservation(IReactive.LogRecord calldata log) private {
        if (log.topic_1 == 0 || log.data.length != 128) revert InvalidObservationLog();
        (,, uint64 matureAt, uint64 expiresAt) = abi.decode(log.data, (uint128, uint128, uint64, uint64));
        if (matureAt == 0 || expiresAt <= matureAt) revert InvalidObservationLog();
        if (observationSignalCount == type(uint64).max) revert CounterOverflow();
        ++observationSignalCount;

        if (phase == Phase.Idle || phase == Phase.AwaitMaturity) {
            if (phase == Phase.Idle || matureAt < dueAt) dueAt = matureAt;
            phase = Phase.AwaitMaturity;
        } else if (queuedMaturityAt == 0 || matureAt < queuedMaturityAt) {
            queuedMaturityAt = matureAt;
        }

        // The indexed observation ID is bounded to uint64 by the processor event.
        // forge-lint: disable-next-line(unsafe-typecast)
        emit ObservationSignalArmed(uint64(log.topic_1), matureAt, dueAt, phase);
    }

    function _handleCron() private {
        uint64 currentTime = _currentTime();
        Phase currentPhase = phase;
        if (
            currentPhase == Phase.Idle || currentPhase == Phase.AwaitCycle || currentTime < dueAt
                || (currentPhase != Phase.AwaitMaturity
                    && currentPhase != Phase.AwaitFinalization
                    && currentPhase != Phase.Retry)
        ) {
            emit WakeSuppressed(currentPhase, dueAt, currentTime);
            return;
        }

        if (wakeRequestCount == type(uint64).max) revert CounterOverflow();
        uint64 requestId = ++wakeRequestCount;
        triggerPhase = currentPhase;
        phase = Phase.AwaitCycle;
        bytes memory payload = abi.encodeWithSignature("executeFromReactive(address)", address(0));
        emit Callback(networkConfig.destinationChainId, networkConfig.executor, networkConfig.callbackGasLimit, payload);
        emit WakeRequested(requestId, currentPhase, dueAt);
    }

    function _handleAutomationCycle(IReactive.LogRecord calldata log) private {
        if (log.topic_1 == 0 || log.data.length != 416) revert InvalidAutomationLog();
        // The indexed cycle ID is bounded to uint64 by the executor event.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 cycleId = uint64(log.topic_1);
        if (cycleId <= lastCycleId) return;
        lastCycleId = cycleId;

        AutomationCycleData memory cycle = abi.decode(log.data, (AutomationCycleData));

        if (!cycle.processSucceeded || cycle.pendingAfter != 0) {
            _scheduleRetry(cycleId);
        } else if (triggerPhase == Phase.AwaitFinalization) {
            consecutiveRetries = 0;
            _resumeQueuedObservationOrIdle();
        } else {
            consecutiveRetries = 0;
            phase = Phase.AwaitFinalization;
            dueAt = _addTime(_currentTime(), networkConfig.epochDuration);
        }

        emit AutomationCycleObserved(
            cycleId, cycle.pendingAfter, cycle.processSucceeded, cycle.recommendationDispatched, phase, dueAt
        );
    }

    function _scheduleRetry(uint64 cycleId) private {
        uint8 retries = consecutiveRetries + 1;
        consecutiveRetries = retries;
        if (retries > networkConfig.maximumRetries) {
            phase = Phase.Idle;
            dueAt = 0;
            emit GuardianHalted(cycleId, retries);
            return;
        }
        phase = Phase.Retry;
        dueAt = _addTime(_currentTime(), networkConfig.retryDelay);
    }

    function _resumeQueuedObservationOrIdle() private {
        uint64 queued = queuedMaturityAt;
        queuedMaturityAt = 0;
        if (queued != 0) {
            phase = Phase.AwaitMaturity;
            dueAt = queued;
        } else {
            phase = Phase.Idle;
            dueAt = 0;
        }
    }

    function _currentTime() private view returns (uint64 currentTime) {
        // Timestamp is used for bounded scheduling, with processor maturity remaining authoritative.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > type(uint64).max) revert TimestampOverflow();
        // Explicit bound above proves the cast is exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(block.timestamp);
    }

    function _addTime(uint64 currentTime, uint64 delay) private pure returns (uint64 result) {
        uint256 sum = uint256(currentTime) + delay;
        if (sum > type(uint64).max) revert TimestampOverflow();
        // Explicit bound above proves the cast is exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(sum);
    }
}
