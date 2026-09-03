// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {CircleMessages} from "../../src/circle/CircleMessages.sol";
import {ThetaShieldController} from "../../src/controller/ThetaShieldController.sol";
import {IMessageHandlerV2} from "../../src/interfaces/IMessageHandlerV2.sol";
import {MockMessageTransmitterV2} from "../mocks/MockMessageTransmitterV2.sol";

contract ThetaShieldControllerHandler is Test {
    ThetaShieldController public immutable controller;
    MockMessageTransmitterV2 public immutable transmitter;
    bytes32 public immutable poolId;
    address public immutable owner;
    uint32 public immutable processorDomain;
    bytes32 public immutable processor;

    uint64 public expectedLastSequence;
    bool public replayAccepted;
    bool public unauthorizedAccepted;

    constructor(
        ThetaShieldController controller_,
        MockMessageTransmitterV2 transmitter_,
        bytes32 poolId_,
        address owner_,
        uint32 processorDomain_,
        bytes32 processor_
    ) {
        controller = controller_;
        transmitter = transmitter_;
        poolId = poolId_;
        owner = owner_;
        processorDomain = processorDomain_;
        processor = processor_;
    }

    function applyValid(
        uint24 zeroForOneFeeSeed,
        uint24 oneForZeroFeeSeed,
        uint128 riskSeed,
        uint16 confidenceSeed,
        uint64 lifetimeSeed
    ) external {
        uint24 zeroForOneFee = uint24(bound(zeroForOneFeeSeed, 500, 10_000));
        uint24 oneForZeroFee = uint24(bound(oneForZeroFeeSeed, 500, 10_000));
        bool premium = zeroForOneFee > 500 || oneForZeroFee > 500;
        uint16 confidenceBps = uint16(bound(confidenceSeed, premium ? 5_000 : 0, 10_000));
        int128 positiveRiskWad = int128(int256(bound(riskSeed, 1, 100e18)));
        uint64 lifetime = uint64(bound(lifetimeSeed, 1, 300));
        uint64 currentTime = uint64(block.timestamp);
        uint64 sequence = expectedLastSequence + 1;

        ThetaShieldController.FeeRecommendation memory recommendation = ThetaShieldController.FeeRecommendation({
            zeroForOneFee: zeroForOneFee,
            oneForZeroFee: oneForZeroFee,
            zeroForOneRiskWad: zeroForOneFee > 500 ? positiveRiskWad : int128(0),
            oneForZeroRiskWad: oneForZeroFee > 500 ? positiveRiskWad : int128(0),
            confidenceBps: confidenceBps,
            validAfter: currentTime,
            validUntil: currentTime + lifetime,
            sequence: sequence
        });

        _deliver(recommendation);
        expectedLastSequence = sequence;
    }

    function attemptReplay() external {
        if (expectedLastSequence == 0) return;
        uint64 currentTime = uint64(block.timestamp);
        ThetaShieldController.FeeRecommendation memory recommendation = controller.currentRecommendation(poolId);
        recommendation.validAfter = currentTime;
        recommendation.validUntil = currentTime + 300;
        try this.deliver(recommendation) {
            replayAccepted = true;
        } catch {}
    }

    function attemptUnauthorized(address caller) external {
        if (caller == address(transmitter)) caller = address(0xBAD);
        uint64 currentTime = uint64(block.timestamp);
        ThetaShieldController.FeeRecommendation memory recommendation = ThetaShieldController.FeeRecommendation({
            zeroForOneFee: 500,
            oneForZeroFee: 500,
            zeroForOneRiskWad: 0,
            oneForZeroRiskWad: 0,
            confidenceBps: 0,
            validAfter: currentTime,
            validUntil: currentTime + 300,
            sequence: expectedLastSequence + 1
        });
        vm.prank(caller);
        try controller.handleReceiveFinalizedMessage(processorDomain, processor, 2_000, _encoded(recommendation)) {
            unauthorizedAccepted = true;
        } catch {}
    }

    function deliver(ThetaShieldController.FeeRecommendation calldata recommendation) external {
        if (msg.sender != address(this)) revert();
        _deliver(recommendation);
    }

    function _deliver(ThetaShieldController.FeeRecommendation memory recommendation) private {
        transmitter.deliverFinalized(
            IMessageHandlerV2(address(controller)), processorDomain, processor, 2_000, _encoded(recommendation)
        );
    }

    function _encoded(ThetaShieldController.FeeRecommendation memory recommendation)
        private
        view
        returns (bytes memory)
    {
        return CircleMessages.encodeRecommendation(
            CircleMessages.Recommendation({
                poolId: poolId,
                zeroForOneFee: recommendation.zeroForOneFee,
                oneForZeroFee: recommendation.oneForZeroFee,
                zeroForOneRiskWad: recommendation.zeroForOneRiskWad,
                oneForZeroRiskWad: recommendation.oneForZeroRiskWad,
                confidenceBps: recommendation.confidenceBps,
                validAfter: recommendation.validAfter,
                validUntil: recommendation.validUntil,
                sequence: recommendation.sequence
            })
        );
    }

    function setGlobalPause(bool paused) external {
        vm.prank(owner);
        controller.setGlobalPause(paused);
    }

    function setPoolPause(bool paused) external {
        vm.prank(owner);
        controller.setPoolPause(poolId, paused);
    }

    function warp(uint32 elapsedSeed) external {
        vm.warp(block.timestamp + bound(elapsedSeed, 0, 7 days));
    }
}

contract ThetaShieldControllerInvariantTest is StdInvariant, Test {
    bytes32 private constant POOL_ID = keccak256("phase7-invariant-pool");
    uint32 private constant PROCESSOR_DOMAIN = 0;
    bytes32 private constant PROCESSOR = bytes32(uint256(uint160(address(0xBEEF))));

    ThetaShieldController private controller;
    ThetaShieldControllerHandler private handler;
    MockMessageTransmitterV2 private transmitter;

    function setUp() public {
        vm.warp(1_800_000_000);
        transmitter = new MockMessageTransmitterV2();
        controller = new ThetaShieldController(address(this), transmitter);
        controller.configureCirclePeer(PROCESSOR_DOMAIN, PROCESSOR);
        controller.configurePool(
            POOL_ID,
            ThetaShieldController.PoolFeeConfig({
                baselineFeePips: 500,
                minimumFeePips: 500,
                maximumFeePips: 10_000,
                confidenceFloorBps: 5_000,
                maximumRecommendationLifetime: 300,
                minimumRecommendationInterval: 0,
                paused: false
            })
        );
        handler = new ThetaShieldControllerHandler(
            controller, transmitter, POOL_ID, address(this), PROCESSOR_DOMAIN, PROCESSOR
        );

        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = handler.applyValid.selector;
        selectors[1] = handler.attemptReplay.selector;
        selectors[2] = handler.attemptUnauthorized.selector;
        selectors[3] = handler.setGlobalPause.selector;
        selectors[4] = handler.setPoolPause.selector;
        selectors[5] = handler.warp.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        excludeContract(address(controller));
    }

    function invariant_feeSelectionAlwaysStaysWithinConfiguredBounds() external view {
        (uint24 zeroForOneFee,) = controller.feeForSwap(POOL_ID, true);
        (uint24 oneForZeroFee,) = controller.feeForSwap(POOL_ID, false);
        assertGe(zeroForOneFee, 500);
        assertLe(zeroForOneFee, 10_000);
        assertGe(oneForZeroFee, 500);
        assertLe(oneForZeroFee, 10_000);
    }

    function invariant_sequenceNeverRollsBackOrDesynchronizes() external view {
        assertEq(controller.lastSequence(POOL_ID), handler.expectedLastSequence());
    }

    function invariant_replayAndUnauthorizedCallsNeverSucceed() external view {
        assertFalse(handler.replayAccepted());
        assertFalse(handler.unauthorizedAccepted());
    }

    function invariant_activePremiumAlwaysHasPositiveRiskAndConfidence() external view {
        ThetaShieldController.FeeRecommendation memory recommendation = controller.currentRecommendation(POOL_ID);
        (uint24 zeroForOneFee, bool zeroBaseline) = controller.feeForSwap(POOL_ID, true);
        (uint24 oneForZeroFee, bool oneBaseline) = controller.feeForSwap(POOL_ID, false);
        if (!zeroBaseline && zeroForOneFee > 500) {
            assertGt(recommendation.zeroForOneRiskWad, 0);
            assertGe(recommendation.confidenceBps, 5_000);
        }
        if (!oneBaseline && oneForZeroFee > 500) {
            assertGt(recommendation.oneForZeroRiskWad, 0);
            assertGe(recommendation.confidenceBps, 5_000);
        }
    }

    function invariant_pauseAlwaysForcesBaseline() external view {
        ThetaShieldController.PoolFeeConfig memory config = controller.poolConfig(POOL_ID);
        if (controller.globallyPaused() || config.paused) {
            (uint24 zeroForOneFee, bool zeroBaseline) = controller.feeForSwap(POOL_ID, true);
            (uint24 oneForZeroFee, bool oneBaseline) = controller.feeForSwap(POOL_ID, false);
            assertTrue(zeroBaseline);
            assertTrue(oneBaseline);
            assertEq(zeroForOneFee, 500);
            assertEq(oneForZeroFee, 500);
        }
    }
}
