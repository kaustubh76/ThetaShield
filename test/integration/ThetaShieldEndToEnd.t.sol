// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ReactiveTest} from "reactive-test-lib/base/ReactiveTest.sol";
import {ReactiveConstants} from "reactive-test-lib/constants/ReactiveConstants.sol";
import {CallbackResult, LogRecord} from "reactive-test-lib/interfaces/IReactiveInterfaces.sol";
import {ReactiveSimulator} from "reactive-test-lib/simulator/ReactiveSimulator.sol";
import {ThetaShieldController} from "../../src/controller/ThetaShieldController.sol";
import {MockNormalizedReferencePriceFeed} from "../../src/feeds/MockNormalizedReferencePriceFeed.sol";
import {ThetaShieldHook} from "../../src/hook/ThetaShieldHook.sol";
import {IThetaShieldController} from "../../src/interfaces/IThetaShieldController.sol";
import {FeeCurve} from "../../src/libraries/FeeCurve.sol";
import {FixedPointMath} from "../../src/libraries/FixedPointMath.sol";
import {ThetaShieldReactive} from "../../src/reactive/ThetaShieldReactive.sol";
import {HookAddressMiner} from "../../src/deployment/HookAddressMiner.sol";

contract ThetaShieldEndToEndTest is Deployers, ReactiveTest {
    uint256 private constant ORIGIN_CHAIN_ID = 11_155_111;
    uint256 private constant REACTIVE_CHAIN_ID = 5_318_007;
    uint256 private constant CRON_TOPIC_1 = 0xf02d6ea5c22a71cffe930a4523fcb4f129be6c804db50e4202fb4e0b07ccb514;
    bytes32 private constant MARKET_ID = keccak256("ETH-USD");
    bytes32 private constant SOURCE_ID = keccak256("phase-4-mock-source");
    int256 private constant SWAP_AMOUNT = -1e15;
    bytes32 private constant POOL_SWAP_TOPIC =
        keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
    bytes32 private constant OBSERVATION_TOPIC =
        keccak256("SwapObserved(bytes32,uint64,bool,int128,int128,uint160,uint24,bool,uint64)");

    ThetaShieldController private controller;
    ThetaShieldHook private hook;
    MockNormalizedReferencePriceFeed private referenceFeed;
    ThetaShieldReactive private scheduler;
    bytes32 private poolId;

    function setUp() public override {
        ReactiveTest.setUp();
        reactiveChainId = REACTIVE_CHAIN_ID;
        vm.warp(1_800_000_000);

        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        controller = new ThetaShieldController(address(this), address(proxy), rvmId);
        uint160 flags = Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
        (address expectedAddress, bytes32 salt) = HookAddressMiner.find(
            address(this),
            flags,
            type(ThetaShieldHook).creationCode,
            abi.encode(manager, IThetaShieldController(address(controller)))
        );
        hook = new ThetaShieldHook{salt: salt}(manager, IThetaShieldController(address(controller)));
        assertEq(address(hook), expectedAddress);

        PoolId typedPoolId;
        (key, typedPoolId) = initPoolAndAddLiquidity(
            currency0, currency1, IHooks(address(hook)), LPFeeLibrary.DYNAMIC_FEE_FLAG, SQRT_PRICE_1_1
        );
        poolId = PoolId.unwrap(typedPoolId);
        controller.configurePool(poolId, _controllerConfig());

        referenceFeed = new MockNormalizedReferencePriceFeed(address(this));
        bytes32[] memory sources = new bytes32[](1);
        sources[0] = SOURCE_ID;
        scheduler = _deployScheduler(sources);
        enableVmMode(address(scheduler));
    }

    function test_realSwapToReactiveCallbackChangesLaterPoolFee() external {
        (, CallbackResult[] memory activeCallback) = _activateDirectionalPremium();
        assertCallbackCount(activeCallback, 1);
        assertCallbackSuccess(activeCallback, 0);

        ThetaShieldController.FeeRecommendation memory recommendation = controller.currentRecommendation(poolId);
        assertEq(recommendation.sequence, 2);
        assertGt(recommendation.zeroForOneFee, 500);
        assertEq(recommendation.oneForZeroFee, 500);
        assertEq(controller.lastSequence(poolId), 2);

        vm.recordLogs();
        swap(key, true, SWAP_AMOUNT, ZERO_BYTES);
        Vm.Log[] memory entries = vm.getRecordedLogs();

        assertEq(_poolSwapFee(entries), recommendation.zeroForOneFee);
        assertEq(_observationFee(entries), recommendation.zeroForOneFee);
        assertFalse(_observationUsedBaseline(entries));
        assertEq(hook.observationCount(poolId), 3);
    }

    function test_expiredReactiveRecommendationFallsBackOnRealPool() external {
        _activateDirectionalPremium();
        ThetaShieldController.FeeRecommendation memory recommendation = controller.currentRecommendation(poolId);
        assertGt(recommendation.zeroForOneFee, 500);
        vm.warp(recommendation.validUntil);

        vm.recordLogs();
        swap(key, true, SWAP_AMOUNT, ZERO_BYTES);
        Vm.Log[] memory entries = vm.getRecordedLogs();

        assertEq(_poolSwapFee(entries), 500);
        assertEq(_observationFee(entries), 500);
        assertTrue(_observationUsedBaseline(entries));
    }

    function test_replayedAndOutOfOrderCallbacksCannotReplaceActiveFee() external {
        (CallbackResult[] memory firstCallback, CallbackResult[] memory activeCallback) = _activateDirectionalPremium();
        ThetaShieldController.FeeRecommendation memory active = controller.currentRecommendation(poolId);
        assertEq(active.sequence, 2);

        (bool replaySuccess, bytes memory replayResult) = proxy.executeCallback(
            activeCallback[0].target, activeCallback[0].payload, activeCallback[0].gasLimit, rvmId
        );
        assertFalse(replaySuccess);
        assertEq(_revertSelector(replayResult), ThetaShieldController.RecommendationReplay.selector);

        (bool outOfOrderSuccess, bytes memory outOfOrderResult) =
            proxy.executeCallback(firstCallback[0].target, firstCallback[0].payload, firstCallback[0].gasLimit, rvmId);
        assertFalse(outOfOrderSuccess);
        assertEq(_revertSelector(outOfOrderResult), ThetaShieldController.RecommendationReplay.selector);

        ThetaShieldController.FeeRecommendation memory unchanged = controller.currentRecommendation(poolId);
        assertEq(unchanged.sequence, 2);
        assertEq(unchanged.zeroForOneFee, active.zeroForOneFee);
        assertEq(controller.lastSequence(poolId), 2);
    }

    function _activateDirectionalPremium()
        private
        returns (CallbackResult[] memory firstCallback, CallbackResult[] memory activeCallback)
    {
        _reactiveSwap(true);
        _settleObservationWithAdverseReference(1);
        vm.warp(block.timestamp + 31);
        firstCallback = _triggerCron();
        assertCallbackCount(firstCallback, 1);
        assertCallbackEmitted(firstCallback, address(controller));
        assertCallbackSuccess(firstCallback, 0);
        assertEq(controller.currentRecommendation(poolId).zeroForOneFee, 500);

        _reactiveSwap(true);
        _settleObservationWithAdverseReference(2);
        vm.warp(block.timestamp + 31);
        activeCallback = _triggerCron();
        assertCallbackCount(activeCallback, 1);
        assertCallbackEmitted(activeCallback, address(controller));
        assertCallbackSuccess(activeCallback, 0);
    }

    function _reactiveSwap(bool zeroForOne) private {
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: SWAP_AMOUNT,
            sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
        });
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        CallbackResult[] memory results = triggerAndReact(
            address(swapRouter), abi.encodeCall(PoolSwapTest.swap, (key, params, settings, ZERO_BYTES)), ORIGIN_CHAIN_ID
        );
        assertNoCallbacks(results);
    }

    function _settleObservationWithAdverseReference(uint64 observationId) private {
        (uint16 slot, bool active) = scheduler.observationSlot(observationId);
        assertTrue(active);
        ThetaShieldReactive.PendingObservation memory observation = scheduler.pendingObservation(slot);
        assertEq(observation.observationId, observationId);
        assertTrue(observation.zeroForOne);
        assertEq(observation.appliedFeePips, 500);

        vm.warp(block.timestamp + 60);
        uint256 referencePriceWad = FixedPointMath.mulDivDown(observation.executionPriceWad, 99, 100);
        CallbackResult[] memory referenceResults = triggerAndReact(
            address(referenceFeed),
            abi.encodeCall(
                MockNormalizedReferencePriceFeed.publish, (MARKET_ID, SOURCE_ID, referencePriceWad, 1e18, _time())
            ),
            ORIGIN_CHAIN_ID
        );
        assertNoCallbacks(referenceResults);

        CallbackResult[] memory cronResults = _triggerCron();
        assertNoCallbacks(cronResults);
        assertEq(scheduler.settledObservationCount(), observationId);
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

    function _deployScheduler(bytes32[] memory sources) private returns (ThetaShieldReactive deployed) {
        deployed = new ThetaShieldReactive(
            ThetaShieldReactive.NetworkConfig({
                originChainId: ORIGIN_CHAIN_ID,
                referenceChainId: ORIGIN_CHAIN_ID,
                reactiveChainId: reactiveChainId,
                hook: address(hook),
                referenceFeed: address(referenceFeed),
                controller: address(controller),
                poolId: poolId,
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
                maximumPendingObservations: 8,
                maximumProcessPerCron: 8,
                maximumEpochObservations: 8,
                trailingWindow: 8,
                minimumTrailingObservations: 1,
                targetObservationCount: 1,
                requiredToxicEpochs: 1,
                persistenceWindow: 1,
                fastPathHoldEpochs: 0,
                maximumReferenceSamplesPerSource: 4,
                minimumReferenceSources: 1,
                fastPathEnabled: false,
                minimumObservationNotionalWad: 1,
                maximumTradeNotionalWad: 100e18,
                minimumEpochNotionalWad: 1,
                coldStartSigmaWad: 0,
                deadBandKWad: 0,
                maximumDispersionWad: 0.05e18,
                confidenceCapWad: 1e18,
                toxicThresholdWad: 0.001e18,
                alphaWad: 1e18,
                fastPathConfidenceFloorWad: 0,
                fastPathToxicThresholdWad: 0
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
    }

    function _controllerConfig() private pure returns (ThetaShieldController.PoolFeeConfig memory) {
        return ThetaShieldController.PoolFeeConfig({
            baselineFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            confidenceFloorBps: 5_000,
            maximumRecommendationLifetime: 300,
            minimumRecommendationInterval: 0,
            paused: false
        });
    }

    function _poolSwapFee(Vm.Log[] memory entries) private view returns (uint24 feePips) {
        for (uint256 index; index < entries.length; ++index) {
            Vm.Log memory entry = entries[index];
            if (entry.emitter == address(manager) && entry.topics[0] == POOL_SWAP_TOPIC) {
                (,,,,, feePips) = abi.decode(entry.data, (int128, int128, uint160, uint128, int24, uint24));
                return feePips;
            }
        }
        revert("PoolManager Swap event not found");
    }

    function _observationFee(Vm.Log[] memory entries) private view returns (uint24 appliedFeePips) {
        Vm.Log memory entry = _observation(entries);
        (,,, appliedFeePips,,) = abi.decode(entry.data, (int128, int128, uint160, uint24, bool, uint64));
    }

    function _observationUsedBaseline(Vm.Log[] memory entries) private view returns (bool usedBaseline) {
        Vm.Log memory entry = _observation(entries);
        (,,,, usedBaseline,) = abi.decode(entry.data, (int128, int128, uint160, uint24, bool, uint64));
    }

    function _observation(Vm.Log[] memory entries) private view returns (Vm.Log memory) {
        for (uint256 index; index < entries.length; ++index) {
            Vm.Log memory entry = entries[index];
            if (entry.emitter == address(hook) && entry.topics[0] == OBSERVATION_TOPIC) return entry;
        }
        revert("ThetaShield SwapObserved event not found");
    }

    function _revertSelector(bytes memory returnData) private pure returns (bytes4 selector) {
        if (returnData.length < 4) revert("Missing revert selector");
        assembly {
            selector := mload(add(returnData, 0x20))
        }
    }

    function _time() private view returns (uint64) {
        // Test timestamps are deliberately bounded far below uint64 max.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(vm.getBlockTimestamp());
    }
}
