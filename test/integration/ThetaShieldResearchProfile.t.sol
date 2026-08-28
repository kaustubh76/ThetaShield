// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ThetaShieldProfiles} from "../../script/profiles/ThetaShieldProfiles.sol";
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
import {FixedPointMath} from "../../src/libraries/FixedPointMath.sol";
import {MockMessageTransmitterV2} from "../mocks/MockMessageTransmitterV2.sol";

contract ThetaShieldResearchProfileTest is Deployers {
    uint32 private constant ORIGIN_DOMAIN = 10;
    uint32 private constant PROCESSOR_DOMAIN = 0;
    bytes32 private constant MARKET_ID = keccak256("TS/QUOTE");
    bytes32 private constant SOURCE_ID_0 = keccak256("research-reference-0");
    bytes32 private constant SOURCE_ID_1 = keccak256("research-reference-1");
    bytes32 private constant SOURCE_ID_2 = keccak256("research-reference-2");
    bytes32 private constant POOL_SWAP_TOPIC =
        keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
    uint256 private constant OBSERVATIONS_PER_EPOCH = 4;
    int256 private constant SWAP_AMOUNT = -3e18;

    MockMessageTransmitterV2 private originTransmitter;
    MockMessageTransmitterV2 private processorTransmitter;
    MockNormalizedReferencePriceFeed private feed;
    ThetaShieldCircleTransport private transport;
    ThetaShieldCircleProcessor private processor;
    ThetaShieldController private controller;
    ThetaShieldHook private hook;
    ThetaShieldProfiles.Profile private profile;
    bytes32 private poolId;

    function setUp() public {
        vm.warp(1_800_000_000);
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();
        profile = ThetaShieldProfiles.researchV1();

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
        seedMoreLiquidity(key, 10_000e18, 10_000e18);
        poolId = PoolId.unwrap(typedPoolId);

        feed = new MockNormalizedReferencePriceFeed(address(this));
        bytes32[] memory sources = _referenceSources();
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
            profile.scheduler,
            profile.feeCurve,
            sources
        );

        transport.configurePeers(address(hook), _addressToBytes32(address(processor)));
        controller.configureCirclePeer(PROCESSOR_DOMAIN, _addressToBytes32(address(processor)));
        controller.configurePool(poolId, profile.controller);
    }

    function test_benignNoiseNeverLeavesBaselineAtResearchParameters() external {
        for (uint256 epoch; epoch < 7; ++epoch) {
            _runEpoch(false, epoch);
            (uint24 feePips,) = controller.feeForSwap(poolId, true);
            assertEq(feePips, profile.feeCurve.baseFeePips);
        }

        ThetaShieldCircleProcessor.SideState memory state = processor.sideState(true);
        assertFalse(state.latestPersistenceActive);
        assertFalse(state.latestFastPathActive);
    }

    function test_persistentInformedFlowRaisesOnlyItsDirectionAtResearchParameters() external {
        for (uint256 epoch; epoch < 7; ++epoch) {
            _runEpoch(true, epoch);
            (uint24 zeroForOneFee,) = controller.feeForSwap(poolId, true);
            (uint24 oneForZeroFee,) = controller.feeForSwap(poolId, false);
            if (epoch < 4) assertEq(zeroForOneFee, profile.feeCurve.baseFeePips);
            if (epoch == 4) {
                assertTrue(processor.sideState(true).latestFastPathActive);
                assertGt(zeroForOneFee, profile.feeCurve.baseFeePips);
            }
            assertEq(oneForZeroFee, profile.feeCurve.baseFeePips);
        }

        ThetaShieldCircleProcessor.SideState memory state = processor.sideState(true);
        assertTrue(state.latestPersistenceActive);
        assertGt(state.latestCalculatedFeePips, profile.feeCurve.baseFeePips);

        (uint24 protectedFee, bool usedBaseline) = controller.feeForSwap(poolId, true);
        assertGt(protectedFee, profile.feeCurve.baseFeePips);
        assertFalse(usedBaseline);

        vm.recordLogs();
        swap(key, true, SWAP_AMOUNT, ZERO_BYTES);
        assertEq(_poolSwapFee(vm.getRecordedLogs()), protectedFee);
    }

    function _runEpoch(bool persistentAdverse, uint256 epochIndex) private {
        uint256 firstMessageIndex = originTransmitter.sentCount();
        for (uint256 index; index < OBSERVATIONS_PER_EPOCH; ++index) {
            swap(key, true, SWAP_AMOUNT, ZERO_BYTES);
        }

        CircleMessages.Observation memory lastObservation;
        for (uint256 index; index < OBSERVATIONS_PER_EPOCH; ++index) {
            MockMessageTransmitterV2.SentMessage memory sent = originTransmitter.sentMessage(firstMessageIndex + index);
            CircleMessages.Observation memory observation = CircleMessages.decodeObservation(sent.messageBody);
            processorTransmitter.deliverFinalized(
                IMessageHandlerV2(address(processor)),
                ORIGIN_DOMAIN,
                _addressToBytes32(address(transport)),
                2_000,
                sent.messageBody
            );
            lastObservation = observation;
        }

        uint64 matureAt = lastObservation.observedAt + profile.scheduler.markoutHorizon;
        vm.warp(matureAt);
        uint256 executionPriceWad =
            FixedPointMath.mulDivDown(_absolute(lastObservation.amount1), 1e18, _absolute(lastObservation.amount0));
        uint256 referencePriceWad;
        if (persistentAdverse) {
            referencePriceWad = FixedPointMath.mulDivDown(executionPriceWad, 99, 100);
        } else {
            uint256 offsetBps = epochIndex % 2 == 0 ? 5 : 10_005;
            referencePriceWad = epochIndex % 2 == 0
                ? FixedPointMath.mulDivDown(executionPriceWad, 9_995, 10_000)
                : FixedPointMath.mulDivDown(executionPriceWad, offsetBps, 10_000);
        }
        bytes32[] memory sources = _referenceSources();
        for (uint256 index; index < sources.length; ++index) {
            feed.publish(MARKET_ID, sources[index], referencePriceWad, 1e18, matureAt);
            processor.syncReference(sources[index]);
        }
        assertFalse(processor.process());

        vm.warp(
            uint256(lastObservation.observedAt) + profile.scheduler.markoutHorizon + profile.scheduler.epochDuration
        );
        assertTrue(processor.process());
        MockMessageTransmitterV2.SentMessage memory recommendation = processorTransmitter.lastMessage();
        originTransmitter.deliverFinalized(
            IMessageHandlerV2(address(controller)),
            PROCESSOR_DOMAIN,
            _addressToBytes32(address(processor)),
            2_000,
            recommendation.messageBody
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

    function _absolute(int128 value) private pure returns (uint256) {
        int256 widened = value;
        return uint256(widened < 0 ? -widened : widened);
    }

    function _referenceSources() private pure returns (bytes32[] memory sources) {
        sources = new bytes32[](3);
        sources[0] = SOURCE_ID_0;
        sources[1] = SOURCE_ID_1;
        sources[2] = SOURCE_ID_2;
    }

    function _addressToBytes32(address account) private pure returns (bytes32) {
        return bytes32(uint256(uint160(account)));
    }
}
