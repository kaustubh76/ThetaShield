// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {ReactiveTest} from "reactive-test-lib/base/ReactiveTest.sol";
import {ReactiveConstants} from "reactive-test-lib/constants/ReactiveConstants.sol";
import {CallbackResult, IReactive, LogRecord} from "reactive-test-lib/interfaces/IReactiveInterfaces.sol";
import {ReactiveSimulator} from "reactive-test-lib/simulator/ReactiveSimulator.sol";
import {ThetaShieldController} from "../../src/controller/ThetaShieldController.sol";
import {MockNormalizedReferencePriceFeed} from "../../src/feeds/MockNormalizedReferencePriceFeed.sol";
import {FeeCurve} from "../../src/libraries/FeeCurve.sol";
import {ThetaShieldReactive} from "../../src/reactive/ThetaShieldReactive.sol";

contract MockSwapObservationEmitter {
    bytes32 public immutable poolId;
    uint64 public observationId;

    event SwapObserved(
        bytes32 indexed poolId,
        uint64 indexed observationId,
        bool indexed zeroForOne,
        int128 amount0,
        int128 amount1,
        uint160 sqrtPriceX96After,
        uint24 appliedFeePips,
        bool usedBaseline,
        uint64 observedAt
    );

    constructor(bytes32 poolId_) {
        poolId = poolId_;
    }

    function emitObservation(bool zeroForOne, int128 amount0, int128 amount1, uint64 observedAt)
        external
        returns (uint64 id)
    {
        id = ++observationId;
        emit SwapObserved(poolId, id, zeroForOne, amount0, amount1, uint160(1 << 96), 500, true, observedAt);
    }
}

contract ThetaShieldReactiveTest is ReactiveTest {
    uint256 private constant ORIGIN_CHAIN_ID = 11_155_111;
    uint256 private constant REACTIVE_CHAIN_ID = 5_318_007;
    uint256 private constant CRON_TOPIC_1 = 0xf02d6ea5c22a71cffe930a4523fcb4f129be6c804db50e4202fb4e0b07ccb514;
    bytes32 private constant POOL_ID = keccak256("theta-shield-reactive-pool");
    bytes32 private constant MARKET_ID = keccak256("ETH-USD");
    bytes32 private constant SOURCE_A = keccak256("mock-source-a");

    MockSwapObservationEmitter private hookEmitter;
    MockNormalizedReferencePriceFeed private referenceFeed;
    ThetaShieldController private controller;
    ThetaShieldReactive private scheduler;

    function setUp() public override {
        super.setUp();
        reactiveChainId = REACTIVE_CHAIN_ID;
        vm.warp(1_800_000_000);

        hookEmitter = new MockSwapObservationEmitter(POOL_ID);
        referenceFeed = new MockNormalizedReferencePriceFeed(address(this));
        controller = new ThetaShieldController(address(this), address(proxy), rvmId);
        controller.configurePool(POOL_ID, _controllerConfig());

        bytes32[] memory sources = new bytes32[](1);
        sources[0] = SOURCE_A;
        scheduler = _deployScheduler(address(hookEmitter), address(referenceFeed), 8, 8, 1, sources);
    }

    function test_constructorRegistersExactSwapReferenceAndCronSubscriptions() external view {
        assertEq(sys.subscriptionCount(), 3);

        address[] memory swapSubscribers = sys.getMatchingSubscribers(
            ORIGIN_CHAIN_ID, address(hookEmitter), scheduler.SWAP_OBSERVED_TOPIC(), uint256(POOL_ID), 1, 1
        );
        address[] memory referenceSubscribers = sys.getMatchingSubscribers(
            ORIGIN_CHAIN_ID,
            address(referenceFeed),
            scheduler.REFERENCE_PRICE_TOPIC(),
            uint256(MARKET_ID),
            uint256(SOURCE_A),
            1
        );
        address[] memory cronSubscribers =
            sys.getMatchingSubscribers(reactiveChainId, address(ReactiveConstants.SERVICE_ADDR), CRON_TOPIC_1, 0, 0, 0);

        assertEq(swapSubscribers.length, 1);
        assertEq(swapSubscribers[0], address(scheduler));
        assertEq(referenceSubscribers.length, 1);
        assertEq(referenceSubscribers[0], address(scheduler));
        assertEq(cronSubscribers.length, 1);
        assertEq(cronSubscribers[0], address(scheduler));
    }

    function test_observationCannotMatureEarlyAndEligibleReferenceSettlesIt() external {
        uint64 observedAt = _time();
        _emitSwap(hookEmitter, observedAt);
        assertEq(scheduler.pendingCount(), 1);

        vm.warp(block.timestamp + 59);
        _publishReference(referenceFeed, 99e18);
        CallbackResult[] memory earlyResults = _triggerCron();
        assertNoCallbacks(earlyResults);
        assertEq(scheduler.pendingCount(), 1);
        assertEq(scheduler.settledObservationCount(), 0);

        vm.warp(block.timestamp + 1);
        _publishReference(referenceFeed, 99e18);
        CallbackResult[] memory maturityResults = _triggerCron();
        assertNoCallbacks(maturityResults);
        assertEq(scheduler.pendingCount(), 0);
        assertEq(scheduler.settledObservationCount(), 1);
        assertEq(scheduler.expiredObservationCount(), 0);
    }

    function test_missingReferencePriceExpiresObservation() external {
        _emitSwap(hookEmitter, _time());
        vm.warp(block.timestamp + 121);

        CallbackResult[] memory results = _triggerCron();

        assertNoCallbacks(results);
        assertEq(scheduler.pendingCount(), 0);
        assertEq(scheduler.settledObservationCount(), 0);
        assertEq(scheduler.expiredObservationCount(), 1);
    }

    function test_referenceReplayAndFutureTimestampRevert() external {
        LogRecord memory accepted = _referenceLog(1, _time());
        ReactiveSimulator.deliverRawEvent(vm, IReactive(address(scheduler)), accepted);
        assertEq(scheduler.latestReferenceSequence(SOURCE_A), 1);

        vm.expectRevert(abi.encodeWithSelector(ThetaShieldReactive.ReferenceReplay.selector, SOURCE_A, 1, 1));
        vm.prank(address(ReactiveConstants.SERVICE_ADDR));
        IReactive(address(scheduler)).react(accepted);

        uint64 futureTimestamp = _time() + 6;
        LogRecord memory future = _referenceLog(2, futureTimestamp);
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldReactive.EventFromFuture.selector, futureTimestamp, _time()));
        vm.prank(address(ReactiveConstants.SERVICE_ADDR));
        IReactive(address(scheduler)).react(future);
    }

    function test_referenceWithinClockSkewIsStoredButNotUsedBeforeItsTimestamp() external {
        _emitSwap(hookEmitter, _time());
        vm.warp(block.timestamp + 60);

        uint64 referenceTimestamp = _time() + 5;
        ReactiveSimulator.deliverRawEvent(vm, IReactive(address(scheduler)), _referenceLog(1, referenceTimestamp));
        _triggerCron();
        assertEq(scheduler.pendingCount(), 1);
        assertEq(scheduler.settledObservationCount(), 0);

        vm.warp(block.timestamp + 5);
        _triggerCron();
        assertEq(scheduler.pendingCount(), 0);
        assertEq(scheduler.settledObservationCount(), 1);
    }

    function test_reactRejectsCallerOtherThanReactiveService() external {
        LogRecord memory referenceLog = _referenceLog(1, _time());
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldReactive.OnlyReactiveService.selector, address(this)));
        IReactive(address(scheduler)).react(referenceLog);
    }

    function test_processingAndPendingCapacityAreBounded() external {
        MockSwapObservationEmitter boundedEmitter = new MockSwapObservationEmitter(POOL_ID);
        MockNormalizedReferencePriceFeed boundedFeed = new MockNormalizedReferencePriceFeed(address(this));
        bytes32[] memory sources = new bytes32[](1);
        sources[0] = SOURCE_A;
        ThetaShieldReactive bounded = _deployScheduler(address(boundedEmitter), address(boundedFeed), 4, 2, 1, sources);

        uint64 observedAt = _time();
        for (uint256 index; index < 5; ++index) {
            _emitSwap(boundedEmitter, observedAt);
        }
        assertEq(bounded.pendingCount(), 4);
        assertEq(bounded.droppedObservationCount(), 1);

        vm.warp(block.timestamp + 60);
        _publishReference(boundedFeed, 99e18);
        _triggerCron();
        assertEq(bounded.pendingCount(), 2);
        assertEq(bounded.settledObservationCount(), 2);

        _triggerCron();
        assertEq(bounded.pendingCount(), 0);
        assertEq(bounded.settledObservationCount(), 4);
    }

    function test_callbackPayloadUpdatesAuthenticatedController() external {
        _settleCurrentObservation(99e18);
        vm.warp(block.timestamp + 31);

        CallbackResult[] memory results = _triggerCron();

        assertCallbackCount(results, 1);
        assertCallbackEmitted(results, address(controller));
        assertCallbackSuccess(results, 0);
        ThetaShieldController.FeeRecommendation memory recommendation = controller.currentRecommendation(POOL_ID);
        assertEq(recommendation.sequence, 1);
        assertEq(recommendation.zeroForOneFee, 500);
        assertEq(recommendation.oneForZeroFee, 500);
        assertEq(controller.lastSequence(POOL_ID), 1);
        assertLe(recommendation.validAfter, block.timestamp);
        assertGt(recommendation.validUntil, block.timestamp);
    }

    function test_postColdStartToxicEpochSchedulesDirectionalPremium() external {
        _settleCurrentObservation(99e18);
        vm.warp(block.timestamp + 31);
        CallbackResult[] memory coldStartCallback = _triggerCron();
        assertCallbackSuccess(coldStartCallback, 0);

        _settleCurrentObservation(99e18);
        vm.warp(block.timestamp + 31);
        CallbackResult[] memory activeCallback = _triggerCron();

        assertCallbackCount(activeCallback, 1);
        assertCallbackSuccess(activeCallback, 0);
        ThetaShieldController.FeeRecommendation memory recommendation = controller.currentRecommendation(POOL_ID);
        assertEq(recommendation.sequence, 2);
        assertGt(recommendation.zeroForOneFee, 500);
        assertEq(recommendation.oneForZeroFee, 500);
        assertGt(recommendation.zeroForOneRiskWad, 0);
        assertEq(recommendation.confidenceBps, 10_000);
    }

    function test_confidentFastPathProtectsBeforePersistenceThreshold() external {
        MockSwapObservationEmitter fastEmitter = new MockSwapObservationEmitter(POOL_ID);
        MockNormalizedReferencePriceFeed fastFeed = new MockNormalizedReferencePriceFeed(address(this));
        bytes32[] memory sources = new bytes32[](1);
        sources[0] = SOURCE_A;
        ThetaShieldReactive fastScheduler =
            _deploySchedulerWithProtection(address(fastEmitter), address(fastFeed), 8, 8, 1, sources, true, 2, 3);

        _emitSwap(fastEmitter, _time());
        vm.warp(block.timestamp + 60);
        _publishReference(fastFeed, 99e18);
        assertNoCallbacks(_triggerCron());
        vm.warp(block.timestamp + 31);
        assertCallbackSuccess(_triggerCron(), 0);

        _emitSwap(fastEmitter, _time());
        vm.warp(block.timestamp + 60);
        _publishReference(fastFeed, 99e18);
        assertNoCallbacks(_triggerCron());
        vm.warp(block.timestamp + 31);
        assertCallbackSuccess(_triggerCron(), 0);

        ThetaShieldReactive.SideState memory state = fastScheduler.sideState(true);
        assertFalse(state.latestPersistenceActive);
        assertTrue(state.latestFastPathActive);
        assertGt(fastScheduler.effectiveFee(true), 500);
    }

    function test_longCronGapResetsAncientEpochBeforeSchedulingRecommendation() external {
        _settleCurrentObservation(99e18);
        vm.warp(block.timestamp + 31);
        CallbackResult[] memory coldStartCallback = _triggerCron();
        assertCallbackSuccess(coldStartCallback, 0);

        _settleCurrentObservation(99e18);
        vm.warp(block.timestamp + 257 * 30);
        CallbackResult[] memory delayedCallback = _triggerCron();

        assertCallbackCount(delayedCallback, 1);
        assertCallbackSuccess(delayedCallback, 0);
        ThetaShieldController.FeeRecommendation memory recommendation = controller.currentRecommendation(POOL_ID);
        assertEq(recommendation.sequence, 2);
        assertEq(recommendation.zeroForOneFee, 500);
        assertEq(recommendation.oneForZeroFee, 500);
        assertEq(scheduler.effectiveFee(true), 500);
    }

    function _settleCurrentObservation(uint256 referencePriceWad) private {
        _emitSwap(hookEmitter, _time());
        vm.warp(block.timestamp + 60);
        _publishReference(referenceFeed, referencePriceWad);
        CallbackResult[] memory results = _triggerCron();
        assertNoCallbacks(results);
    }

    function _triggerCron() private returns (CallbackResult[] memory) {
        LogRecord memory log = LogRecord({
            chain_id: reactiveChainId,
            _contract: address(ReactiveConstants.SERVICE_ADDR),
            topic_0: CRON_TOPIC_1,
            topic_1: 0,
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

    function _referenceLog(uint64 sequence, uint64 observedAt) private view returns (LogRecord memory) {
        return LogRecord({
            chain_id: ORIGIN_CHAIN_ID,
            _contract: address(referenceFeed),
            topic_0: scheduler.REFERENCE_PRICE_TOPIC(),
            topic_1: uint256(MARKET_ID),
            topic_2: uint256(SOURCE_A),
            topic_3: sequence,
            data: abi.encode(uint256(99e18), uint256(1e18), observedAt),
            block_number: block.number,
            op_code: 0,
            block_hash: 0,
            tx_hash: 0,
            log_index: 0
        });
    }

    function _emitSwap(MockSwapObservationEmitter emitter, uint64 observedAt) private {
        CallbackResult[] memory results = triggerAndReact(
            address(emitter),
            abi.encodeCall(
                MockSwapObservationEmitter.emitObservation, (true, int128(-1e18), int128(100e18), observedAt)
            ),
            ORIGIN_CHAIN_ID
        );
        assertNoCallbacks(results);
    }

    function _publishReference(MockNormalizedReferencePriceFeed feed, uint256 priceWad) private {
        CallbackResult[] memory results = triggerAndReact(
            address(feed),
            abi.encodeCall(MockNormalizedReferencePriceFeed.publish, (MARKET_ID, SOURCE_A, priceWad, 1e18, _time())),
            ORIGIN_CHAIN_ID
        );
        assertNoCallbacks(results);
    }

    function _deployScheduler(
        address hook,
        address feed,
        uint16 maximumPending,
        uint16 maximumProcess,
        uint16 minimumTrailing,
        bytes32[] memory sources
    ) private returns (ThetaShieldReactive deployed) {
        return _deploySchedulerWithProtection(
            hook, feed, maximumPending, maximumProcess, minimumTrailing, sources, false, 1, 1
        );
    }

    function _deploySchedulerWithProtection(
        address hook,
        address feed,
        uint16 maximumPending,
        uint16 maximumProcess,
        uint16 minimumTrailing,
        bytes32[] memory sources,
        bool fastPathEnabled,
        uint16 requiredToxicEpochs,
        uint16 persistenceWindow
    ) private returns (ThetaShieldReactive deployed) {
        deployed = new ThetaShieldReactive(
            ThetaShieldReactive.NetworkConfig({
                originChainId: ORIGIN_CHAIN_ID,
                referenceChainId: ORIGIN_CHAIN_ID,
                reactiveChainId: reactiveChainId,
                hook: hook,
                referenceFeed: feed,
                controller: address(controller),
                poolId: POOL_ID,
                marketId: MARKET_ID,
                cronTopic: CRON_TOPIC_1,
                callbackGasLimit: 1_000_000
            }),
            ThetaShieldReactive.TokenConfig({token0Decimals: 18, token1Decimals: 18, baseIsToken0: true}),
            ThetaShieldReactive.SchedulerConfig({
                markoutHorizon: 60,
                observationLifetime: 120,
                referenceSelectionWindow: 10,
                epochDuration: 30,
                recommendationLifetime: 180,
                callbackClockSkew: 5,
                maximumEventFutureSkew: 5,
                maximumPendingObservations: maximumPending,
                maximumProcessPerCron: maximumProcess,
                maximumEpochObservations: 16,
                trailingWindow: 8,
                minimumTrailingObservations: minimumTrailing,
                targetObservationCount: 1,
                requiredToxicEpochs: requiredToxicEpochs,
                persistenceWindow: persistenceWindow,
                fastPathHoldEpochs: 0,
                maximumReferenceSamplesPerSource: 4,
                minimumReferenceSources: 1,
                fastPathEnabled: fastPathEnabled,
                minimumObservationNotionalWad: 1e18,
                maximumTradeNotionalWad: 1_000e18,
                minimumEpochNotionalWad: 1e18,
                coldStartSigmaWad: 0,
                deadBandKWad: 0,
                maximumDispersionWad: 0.05e18,
                confidenceCapWad: 1e18,
                toxicThresholdWad: 0.001e18,
                alphaWad: 1e18,
                fastPathConfidenceFloorWad: fastPathEnabled ? 0.5e18 : 0,
                fastPathToxicThresholdWad: fastPathEnabled ? 0.001e18 : 0
            }),
            FeeCurve.Config({
                baseFeePips: 500,
                minimumFeePips: 500,
                maximumFeePips: 10_000,
                gainFeePips: 100_000,
                maximumIncreasePips: 2_000,
                maximumDecreasePips: 2_000,
                confidenceFloorWad: 0.5e18
            }),
            sources
        );
        enableVmMode(address(deployed));
    }

    function _controllerConfig() private pure returns (ThetaShieldController.PoolFeeConfig memory) {
        return ThetaShieldController.PoolFeeConfig({
            baselineFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            confidenceFloorBps: 5_000,
            maximumRecommendationLifetime: 300,
            paused: false
        });
    }

    function _time() private view returns (uint64) {
        // Test timestamps are deliberately bounded far below uint64 max.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(vm.getBlockTimestamp());
    }
}
