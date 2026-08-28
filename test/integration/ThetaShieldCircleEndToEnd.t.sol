// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {CircleMessages} from "../../src/circle/CircleMessages.sol";
import {ThetaShieldCircleProcessor} from "../../src/circle/ThetaShieldCircleProcessor.sol";
import {ThetaShieldCircleTransport} from "../../src/circle/ThetaShieldCircleTransport.sol";
import {ThetaShieldController} from "../../src/controller/ThetaShieldController.sol";
import {HookAddressMiner} from "../../src/deployment/HookAddressMiner.sol";
import {MockNormalizedReferencePriceFeed} from "../../src/feeds/MockNormalizedReferencePriceFeed.sol";
import {ThetaShieldHook} from "../../src/hook/ThetaShieldHook.sol";
import {IMessageHandlerV2} from "../../src/interfaces/IMessageHandlerV2.sol";
import {IThetaShieldCircleTransport} from "../../src/interfaces/IThetaShieldCircleTransport.sol";
import {IThetaShieldController} from "../../src/interfaces/IThetaShieldController.sol";
import {FeeCurve} from "../../src/libraries/FeeCurve.sol";
import {FixedPointMath} from "../../src/libraries/FixedPointMath.sol";
import {MockMessageTransmitterV2} from "../mocks/MockMessageTransmitterV2.sol";

contract ThetaShieldCircleEndToEndTest is Deployers {
    uint32 private constant ORIGIN_DOMAIN = 10;
    uint32 private constant PROCESSOR_DOMAIN = 0;
    bytes32 private constant MARKET_ID = keccak256("TS/QUOTE");
    bytes32 private constant SOURCE_ID = keccak256("demo-reference");
    bytes32 private constant POOL_SWAP_TOPIC =
        keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");

    MockMessageTransmitterV2 private originTransmitter;
    MockMessageTransmitterV2 private processorTransmitter;
    MockNormalizedReferencePriceFeed private feed;
    ThetaShieldCircleTransport private transport;
    ThetaShieldCircleProcessor private processor;
    ThetaShieldController private controller;
    ThetaShieldHook private hook;
    bytes32 private poolId;

    function setUp() public {
        vm.warp(1_800_000_000);
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        originTransmitter = new MockMessageTransmitterV2();
        processorTransmitter = new MockMessageTransmitterV2();
        controller = new ThetaShieldController(address(this), originTransmitter);
        transport = new ThetaShieldCircleTransport(address(this), originTransmitter, PROCESSOR_DOMAIN);

        (address expectedHook, bytes32 salt) = HookAddressMiner.find(
            address(this),
            Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG,
            type(ThetaShieldHook).creationCode,
            abi.encode(
                manager, IThetaShieldController(address(controller)), IThetaShieldCircleTransport(address(transport))
            )
        );
        hook = new ThetaShieldHook{salt: salt}(
            manager, IThetaShieldController(address(controller)), IThetaShieldCircleTransport(address(transport))
        );
        assertEq(address(hook), expectedHook);

        PoolId typedPoolId;
        (key, typedPoolId) = initPoolAndAddLiquidity(
            currency0, currency1, IHooks(address(hook)), LPFeeLibrary.DYNAMIC_FEE_FLAG, SQRT_PRICE_1_1
        );
        poolId = PoolId.unwrap(typedPoolId);

        feed = new MockNormalizedReferencePriceFeed(address(this));
        bytes32[] memory sources = new bytes32[](1);
        sources[0] = SOURCE_ID;
        processor = new ThetaShieldCircleProcessor(
            ThetaShieldCircleProcessor.NetworkConfig({
                messageTransmitter: address(processorTransmitter),
                originDomain: ORIGIN_DOMAIN,
                originTransport: _addressToBytes32(address(transport)),
                referenceFeed: address(feed),
                controllerDomain: ORIGIN_DOMAIN,
                controller: _addressToBytes32(address(controller)),
                poolId: poolId,
                marketId: MARKET_ID
            }),
            ThetaShieldCircleProcessor.TokenConfig({token0Decimals: 18, token1Decimals: 18, baseIsToken0: true}),
            _schedulerConfig(),
            _feeCurveConfig(),
            sources
        );

        transport.configurePeers(address(hook), _addressToBytes32(address(processor)));
        controller.configureCirclePeer(PROCESSOR_DOMAIN, _addressToBytes32(address(processor)));
        controller.configurePool(poolId, _controllerConfig());
    }

    function test_realPoolSwapToCircleProcessorToLaterDynamicFee() external {
        swap(key, true, -1e15, ZERO_BYTES);
        _settleLatestObservation();

        (uint24 firstFee, bool firstFallback) = controller.feeForSwap(poolId, true);
        assertEq(firstFee, 500);
        assertFalse(firstFallback);

        swap(key, true, -1e15, ZERO_BYTES);
        _settleLatestObservation();

        (uint24 protectedFee, bool usedBaseline) = controller.feeForSwap(poolId, true);
        assertGt(protectedFee, 500);
        assertFalse(usedBaseline);

        vm.recordLogs();
        swap(key, true, -1e15, ZERO_BYTES);
        assertEq(_poolSwapFee(vm.getRecordedLogs()), protectedFee);
    }

    function _settleLatestObservation() private {
        MockMessageTransmitterV2.SentMessage memory observationMessage = originTransmitter.lastMessage();
        CircleMessages.Observation memory observation = CircleMessages.decodeObservation(observationMessage.messageBody);
        assertEq(observationMessage.sender, address(transport));
        assertEq(observationMessage.destinationDomain, PROCESSOR_DOMAIN);

        processorTransmitter.deliverFinalized(
            IMessageHandlerV2(address(processor)),
            ORIGIN_DOMAIN,
            _addressToBytes32(address(transport)),
            2_000,
            observationMessage.messageBody
        );

        uint64 matureAt = observation.observedAt + 10;
        vm.warp(matureAt);
        uint256 executionPriceWad =
            FixedPointMath.mulDivDown(_absolute(observation.amount1), 1e18, _absolute(observation.amount0));
        uint256 adverseReferenceWad = FixedPointMath.mulDivDown(executionPriceWad, 99, 100);
        feed.publish(MARKET_ID, SOURCE_ID, adverseReferenceWad, 1e18, matureAt);
        processor.syncReference(SOURCE_ID);
        assertFalse(processor.process());

        vm.warp(uint256(observation.observedAt) + 20);
        assertTrue(processor.process());
        MockMessageTransmitterV2.SentMessage memory recommendationMessage = processorTransmitter.lastMessage();
        originTransmitter.deliverFinalized(
            IMessageHandlerV2(address(controller)),
            PROCESSOR_DOMAIN,
            _addressToBytes32(address(processor)),
            2_000,
            recommendationMessage.messageBody
        );
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
            minimumReferenceSources: 1,
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

    function _controllerConfig() private pure returns (ThetaShieldController.PoolFeeConfig memory) {
        return ThetaShieldController.PoolFeeConfig({
            baselineFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            confidenceFloorBps: 5_000,
            maximumRecommendationLifetime: 600,
            minimumRecommendationInterval: 0,
            paused: false
        });
    }

    function _absolute(int128 value) private pure returns (uint256) {
        int256 widened = value;
        return uint256(widened < 0 ? -widened : widened);
    }

    function _addressToBytes32(address account) private pure returns (bytes32) {
        return bytes32(uint256(uint160(account)));
    }
}
