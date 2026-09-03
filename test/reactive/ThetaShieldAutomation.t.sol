// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReactiveTest} from "reactive-test-lib/base/ReactiveTest.sol";
import {ReactiveConstants} from "reactive-test-lib/constants/ReactiveConstants.sol";
import {CallbackResult, IReactive, LogRecord} from "reactive-test-lib/interfaces/IReactiveInterfaces.sol";
import {ReactiveSimulator} from "reactive-test-lib/simulator/ReactiveSimulator.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {CircleMessages} from "../../src/circle/CircleMessages.sol";
import {ThetaShieldCircleProcessor} from "../../src/circle/ThetaShieldCircleProcessor.sol";
import {PoolMedianReferenceSampler} from "../../src/feeds/PoolMedianReferenceSampler.sol";
import {IMessageHandlerV2} from "../../src/interfaces/IMessageHandlerV2.sol";
import {FeeCurve} from "../../src/libraries/FeeCurve.sol";
import {ReactiveLegacy} from "../../src/reactive/ReactiveLegacy.sol";
import {ThetaShieldAutomationExecutor} from "../../src/reactive/ThetaShieldAutomationExecutor.sol";
import {ThetaShieldAutomationRSC} from "../../src/reactive/ThetaShieldAutomationRSC.sol";
import {MockMessageTransmitterV2} from "../mocks/MockMessageTransmitterV2.sol";

contract MockAutomationPoolStateReader {
    bytes32 private constant POOLS_SLOT = bytes32(uint256(6));
    mapping(bytes32 slot => bytes32 value) private _state;

    function setPool(PoolId poolId, uint160 sqrtPriceX96, uint128 liquidity) external {
        bytes32 stateSlot = keccak256(abi.encodePacked(PoolId.unwrap(poolId), POOLS_SLOT));
        _state[stateSlot] = bytes32(uint256(sqrtPriceX96));
        _state[bytes32(uint256(stateSlot) + 3)] = bytes32(uint256(liquidity));
    }

    function extsload(bytes32 slot) external view returns (bytes32) {
        return _state[slot];
    }
}

contract ThetaShieldAutomationTest is ReactiveTest {
    uint256 private constant PROCESSOR_CHAIN_ID = 11_155_111;
    uint256 private constant REACTIVE_CHAIN_ID = 5_318_007;
    uint32 private constant ORIGIN_DOMAIN = 10;
    bytes32 private constant ORIGIN_TRANSPORT = bytes32(uint256(uint160(address(0xA11CE))));
    bytes32 private constant PROTECTED_POOL_ID = keccak256("automation-protected-pool");
    bytes32 private constant MARKET_ID = keccak256("ETH/USD");
    uint160 private constant SQRT_PRICE_1_1 = uint160(1 << 96);

    MockMessageTransmitterV2 private transmitter;
    MockAutomationPoolStateReader private manager;
    PoolMedianReferenceSampler private sampler;
    ThetaShieldCircleProcessor private processor;
    ThetaShieldAutomationExecutor private executor;
    ThetaShieldAutomationRSC private rsc;
    PoolId[3] private referencePoolIds;
    bytes32[3] private sourceIds;

    function setUp() public override {
        super.setUp();
        reactiveChainId = REACTIVE_CHAIN_ID;
        vm.warp(1_800_000_000);

        transmitter = new MockMessageTransmitterV2();
        manager = new MockAutomationPoolStateReader();
        for (uint256 index; index < 3; ++index) {
            referencePoolIds[index] = PoolId.wrap(keccak256(abi.encode("automation-pool", index)));
            sourceIds[index] = keccak256(abi.encode("automation-source", index));
            manager.setPool(referencePoolIds[index], SQRT_PRICE_1_1, 1_000);
        }
        sampler = new PoolMedianReferenceSampler(IPoolManager(address(manager)), MARKET_ID, _poolConfigs());

        bytes32[] memory sources = _sources();
        processor = new ThetaShieldCircleProcessor(
            ThetaShieldCircleProcessor.NetworkConfig({
                messageTransmitter: address(transmitter),
                originDomain: ORIGIN_DOMAIN,
                originTransport: ORIGIN_TRANSPORT,
                referenceFeed: address(sampler),
                controllerDomain: ORIGIN_DOMAIN,
                controller: bytes32(uint256(uint160(address(0xC0FFEE)))),
                poolId: PROTECTED_POOL_ID,
                marketId: MARKET_ID
            }),
            ThetaShieldCircleProcessor.TokenConfig({token0Decimals: 18, token1Decimals: 18, baseIsToken0: true}),
            _schedulerConfig(),
            _feeCurveConfig(),
            sources
        );
        executor = new ThetaShieldAutomationExecutor(address(proxy), sampler, processor, sources);
        rsc = new ThetaShieldAutomationRSC(_networkConfig());
        enableVmMode(address(rsc));
    }

    function test_registersProcessorExecutorAndCronSubscriptions() external view {
        assertEq(sys.subscriptionCount(), 3);

        address[] memory observations =
            sys.getMatchingSubscribers(PROCESSOR_CHAIN_ID, address(processor), rsc.OBSERVATION_QUEUED_TOPIC(), 1, 0, 1);
        address[] memory cycles = sys.getMatchingSubscribers(
            PROCESSOR_CHAIN_ID, address(executor), rsc.AUTOMATION_CYCLE_TOPIC(), 1, uint256(uint160(address(proxy))), 1
        );
        address[] memory cron = sys.getMatchingSubscribers(
            REACTIVE_CHAIN_ID,
            address(ReactiveConstants.SERVICE_ADDR),
            ReactiveLegacy.RELEASE_CRON_TOPIC,
            block.number,
            0,
            0
        );

        assertEq(observations.length, 1);
        assertEq(observations[0], address(rsc));
        assertEq(cycles.length, 1);
        assertEq(cycles[0], address(rsc));
        assertEq(cron.length, 1);
        assertEq(cron[0], address(rsc));
        assertEq(rsc.LEGACY_LASNA_CHAIN_ID(), ReactiveLegacy.LASNA_CHAIN_ID);
        assertEq(rsc.LEGACY_RELEASE_CRON_TOPIC(), ReactiveLegacy.RELEASE_CRON_TOPIC);
        assertEq(executor.reactiveCallbackProxy(), address(proxy));
        assertEq(executor.reactiveRvmId(), address(this));
    }

    function test_rejectsSimulatorPlaceholderCronTopicThatLegacyWouldNeverEmit() external {
        ThetaShieldAutomationRSC.NetworkConfig memory config = _networkConfig();
        config.cronTopic = ReactiveConstants.CRON_TOPIC_10;
        vm.expectRevert(
            abi.encodeWithSelector(
                ThetaShieldAutomationRSC.InvalidLegacyNetworkConfiguration.selector,
                PROCESSOR_CHAIN_ID,
                PROCESSOR_CHAIN_ID,
                REACTIVE_CHAIN_ID,
                ReactiveConstants.CRON_TOPIC_10
            )
        );
        new ThetaShieldAutomationRSC(config);
    }

    function test_legacyReactVmAcceptsRvmIdentityCaller() external {
        LogRecord memory log = LogRecord({
            chain_id: PROCESSOR_CHAIN_ID,
            _contract: address(processor),
            topic_0: rsc.OBSERVATION_QUEUED_TOPIC(),
            topic_1: 42,
            topic_2: 0,
            topic_3: 1,
            data: abi.encode(uint128(1e18), uint128(1e18), uint64(block.timestamp + 10), uint64(block.timestamp + 100)),
            block_number: block.number,
            op_code: 0,
            block_hash: 0,
            tx_hash: 0,
            log_index: 0
        });

        // Legacy uses the RVM identity as msg.sender. VM isolation, not a
        // SERVICE_ADDR sender equality check, authenticates this call.
        IReactive(address(rsc)).react(log);

        assertEq(rsc.observationSignalCount(), 1);
        assertEq(uint8(rsc.phase()), uint8(ThetaShieldAutomationRSC.Phase.AwaitMaturity));
        assertEq(rsc.dueAt(), block.timestamp + 10);
    }

    function test_reactiveMaturityAndFinalizationCallbacksAdvanceCircleProcessor() external {
        _deliverObservationThroughReactiveLifecycle();
        assertEq(uint8(rsc.phase()), uint8(ThetaShieldAutomationRSC.Phase.AwaitMaturity));
        assertEq(rsc.dueAt(), block.timestamp + 10);

        vm.warp(block.timestamp + 9);
        assertNoCallbacks(_triggerLegacyCron());
        assertEq(processor.pendingCount(), 1);

        vm.warp(block.timestamp + 1);
        CallbackResult[] memory maturity = _triggerLegacyCron();
        assertCallbackCount(maturity, 1);
        assertCallbackEmitted(maturity, address(executor));
        assertCallbackSuccess(maturity, 0);
        assertEq(processor.pendingCount(), 0);
        assertEq(processor.settledObservationCount(), 1);
        assertEq(processor.recommendationSequence(), 0);
        assertTrue(executor.lastCycleResult().reactiveTrigger);

        _deliverAutomationCycleLog(1, 1, 0, 0, 1, 0, 0, true, false);
        assertEq(uint8(rsc.phase()), uint8(ThetaShieldAutomationRSC.Phase.AwaitFinalization));
        assertEq(rsc.dueAt(), block.timestamp + 10);

        vm.warp(block.timestamp + 10);
        CallbackResult[] memory finalization = _triggerLegacyCron();
        assertCallbackCount(finalization, 1);
        assertCallbackSuccess(finalization, 0);
        assertEq(processor.recommendationSequence(), 1);

        _deliverAutomationCycleLog(2, 0, 0, 1, 1, 0, 1, true, true);
        assertEq(uint8(rsc.phase()), uint8(ThetaShieldAutomationRSC.Phase.Idle));
        assertEq(rsc.dueAt(), 0);
    }

    function test_executorKeepsPermissionlessFallbackButAuthenticatesReactiveLane() external {
        vm.prank(address(0xB0B));
        ThetaShieldAutomationExecutor.CycleResult memory permissionless = executor.execute();
        assertFalse(permissionless.reactiveTrigger);
        assertTrue(permissionless.samplerSucceeded);
        assertTrue(permissionless.processSucceeded);

        vm.expectRevert(bytes("Authorized sender only"));
        executor.executeFromReactive(address(this));

        vm.expectRevert(bytes("Authorized RVM ID only"));
        vm.prank(address(proxy));
        executor.executeFromReactive(address(0xBAD));
    }

    function test_missingReferencesScheduleBoundedRetry() external {
        _deliverObservationThroughReactiveLifecycle();
        for (uint256 index; index < 3; ++index) {
            manager.setPool(referencePoolIds[index], SQRT_PRICE_1_1, 0);
        }

        vm.warp(block.timestamp + 10);
        CallbackResult[] memory maturity = _triggerLegacyCron();
        assertCallbackSuccess(maturity, 0);
        assertEq(processor.pendingCount(), 1);

        _deliverAutomationCycleLog(1, 1, 1, 0, 0, 0, 0, true, false);
        assertEq(uint8(rsc.phase()), uint8(ThetaShieldAutomationRSC.Phase.Retry));
        assertEq(rsc.consecutiveRetries(), 1);
        assertEq(rsc.dueAt(), block.timestamp + 1);
    }

    function _deliverObservationThroughReactiveLifecycle() private {
        CircleMessages.Observation memory observation = CircleMessages.Observation({
            poolId: PROTECTED_POOL_ID,
            observationId: 1,
            zeroForOne: true,
            amount0: -1e18,
            amount1: 1e18,
            sqrtPriceX96After: SQRT_PRICE_1_1,
            appliedFeePips: 500,
            usedBaseline: true,
            observedAt: uint64(block.timestamp)
        });
        CallbackResult[] memory callbacks = triggerAndReact(
            address(transmitter),
            abi.encodeCall(
                MockMessageTransmitterV2.deliverFinalized,
                (
                    IMessageHandlerV2(address(processor)),
                    ORIGIN_DOMAIN,
                    ORIGIN_TRANSPORT,
                    uint32(2_000),
                    CircleMessages.encodeObservation(observation)
                )
            ),
            PROCESSOR_CHAIN_ID
        );
        assertNoCallbacks(callbacks);
        assertEq(processor.pendingCount(), 1);
    }

    function _deliverAutomationCycleLog(
        uint64 cycleId,
        uint16 pendingBefore,
        uint16 pendingAfter,
        uint64 settledBefore,
        uint64 settledAfter,
        uint64 recommendationBefore,
        uint64 recommendationAfter,
        bool processSucceeded,
        bool recommendationDispatched
    ) private {
        LogRecord memory log = LogRecord({
            chain_id: PROCESSOR_CHAIN_ID,
            _contract: address(executor),
            topic_0: rsc.AUTOMATION_CYCLE_TOPIC(),
            topic_1: cycleId,
            topic_2: uint256(uint160(address(proxy))),
            topic_3: 1,
            data: abi.encode(
                uint8(3),
                uint8(3),
                pendingBefore,
                pendingAfter,
                settledBefore,
                settledAfter,
                uint64(0),
                uint64(0),
                recommendationBefore,
                recommendationAfter,
                true,
                processSucceeded,
                recommendationDispatched
            ),
            block_number: block.number,
            op_code: 0,
            block_hash: 0,
            tx_hash: 0,
            log_index: 0
        });
        ReactiveSimulator.deliverRawEvent(vm, IReactive(address(rsc)), log);
    }

    function _triggerLegacyCron() private returns (CallbackResult[] memory results) {
        LogRecord memory log = LogRecord({
            chain_id: REACTIVE_CHAIN_ID,
            _contract: address(ReactiveConstants.SERVICE_ADDR),
            topic_0: ReactiveLegacy.RELEASE_CRON_TOPIC,
            // Legacy Cron events index the live RNK block number here.
            topic_1: block.number,
            topic_2: 0,
            topic_3: 0,
            data: abi.encode(block.number),
            block_number: block.number,
            op_code: 0,
            block_hash: 0,
            tx_hash: 0,
            log_index: 0
        });
        return ReactiveSimulator.deliverEvent(vm, log, sys, proxy, rvmId, reactiveChainId);
    }

    function _networkConfig() private view returns (ThetaShieldAutomationRSC.NetworkConfig memory) {
        return ThetaShieldAutomationRSC.NetworkConfig({
            monitoredChainId: PROCESSOR_CHAIN_ID,
            destinationChainId: PROCESSOR_CHAIN_ID,
            reactiveChainId: REACTIVE_CHAIN_ID,
            processor: address(processor),
            executor: address(executor),
            cronTopic: ReactiveLegacy.RELEASE_CRON_TOPIC,
            callbackGasLimit: 5_000_000,
            epochDuration: 10,
            retryDelay: 1,
            maximumRetries: 3
        });
    }

    function _poolConfigs() private view returns (PoolMedianReferenceSampler.PoolConfig[] memory configs) {
        configs = new PoolMedianReferenceSampler.PoolConfig[](3);
        for (uint256 index; index < configs.length; ++index) {
            configs[index] = PoolMedianReferenceSampler.PoolConfig({
                poolId: referencePoolIds[index],
                sourceId: sourceIds[index],
                minimumLiquidity: 100,
                token0Decimals: 18,
                token1Decimals: 18,
                baseIsToken0: true
            });
        }
    }

    function _sources() private view returns (bytes32[] memory sources) {
        sources = new bytes32[](3);
        for (uint256 index; index < sources.length; ++index) {
            sources[index] = sourceIds[index];
        }
    }

    function _schedulerConfig() private pure returns (ThetaShieldCircleProcessor.SchedulerConfig memory) {
        return ThetaShieldCircleProcessor.SchedulerConfig({
            markoutHorizon: 10,
            observationLifetime: 3_600,
            referenceSelectionWindow: 1_800,
            epochDuration: 10,
            recommendationLifetime: 600,
            callbackClockSkew: 30,
            maximumEventFutureSkew: 5,
            maximumPendingObservations: 8,
            maximumProcessPerCall: 8,
            maximumEpochObservations: 8,
            trailingWindow: 4,
            minimumTrailingObservations: 1,
            targetObservationCount: 1,
            requiredToxicEpochs: 1,
            persistenceWindow: 1,
            fastPathHoldEpochs: 0,
            maximumReferenceSamplesPerSource: 4,
            minimumReferenceSources: 3,
            fastPathEnabled: true,
            minimumObservationNotionalWad: 1,
            maximumTradeNotionalWad: 100e18,
            minimumEpochNotionalWad: 1,
            coldStartSigmaWad: 0,
            deadBandKWad: 0,
            maximumDispersionWad: 1e18,
            confidenceCapWad: 1e18,
            toxicThresholdWad: 1,
            alphaWad: 1e18,
            fastPathConfidenceFloorWad: 1e18,
            fastPathToxicThresholdWad: 1
        });
    }

    function _feeCurveConfig() private pure returns (FeeCurve.Config memory) {
        return FeeCurve.Config({
            baseFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            gainFeePips: 1_000_000,
            coverageGainFeePips: 50,
            maximumIncreasePips: 9_500,
            maximumDecreasePips: 9_500,
            confidenceFloorWad: 5e17,
            targetCoverageWad: 1.25e18,
            minimumEstimatedLossWad: 0.001e18
        });
    }
}
