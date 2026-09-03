// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CircleMessages} from "../../src/circle/CircleMessages.sol";
import {ThetaShieldController} from "../../src/controller/ThetaShieldController.sol";
import {IMessageHandlerV2} from "../../src/interfaces/IMessageHandlerV2.sol";
import {OwnedTwoStep} from "../../src/security/OwnedTwoStep.sol";
import {MockMessageTransmitterV2} from "../mocks/MockMessageTransmitterV2.sol";

contract ThetaShieldControllerTest is Test {
    address private constant OWNER = address(0xA11CE);
    uint32 private constant PROCESSOR_DOMAIN = 0;
    bytes32 private constant PROCESSOR = bytes32(uint256(uint160(address(0xBEEF))));
    bytes32 private constant POOL_ID = keccak256("theta-shield-test-pool");

    ThetaShieldController private controller;
    MockMessageTransmitterV2 private transmitter;

    function setUp() external {
        vm.warp(1_800_000_000);
        transmitter = new MockMessageTransmitterV2();
        controller = new ThetaShieldController(OWNER, transmitter);
        vm.prank(OWNER);
        controller.configureCirclePeer(PROCESSOR_DOMAIN, PROCESSOR);
        vm.prank(OWNER);
        controller.configurePool(POOL_ID, _config());
    }

    function test_usesProvidedAccountAsInitialOwner() external view {
        assertEq(controller.owner(), OWNER);
        assertEq(address(controller.messageTransmitter()), address(transmitter));
        assertEq(controller.processor(), PROCESSOR);
        assertTrue(controller.circlePeerSealed());
    }

    function test_unsetRecommendationUsesBaseline() external view {
        (uint24 zeroForOneFee, bool zeroForOneFallback) = controller.feeForSwap(POOL_ID, true);
        (uint24 oneForZeroFee, bool oneForZeroFallback) = controller.feeForSwap(POOL_ID, false);

        assertEq(zeroForOneFee, 500);
        assertEq(oneForZeroFee, 500);
        assertTrue(zeroForOneFallback);
        assertTrue(oneForZeroFallback);
    }

    function test_authenticatedRecommendationStoresDirectionalFeesAndRisk() external {
        ThetaShieldController.FeeRecommendation memory supplied = _validRecommendation(1);
        _apply(supplied);

        (uint24 zeroForOneFee, bool zeroForOneFallback) = controller.feeForSwap(POOL_ID, true);
        (uint24 oneForZeroFee, bool oneForZeroFallback) = controller.feeForSwap(POOL_ID, false);
        ThetaShieldController.FeeRecommendation memory stored = controller.currentRecommendation(POOL_ID);

        assertEq(zeroForOneFee, 2_500);
        assertEq(oneForZeroFee, 900);
        assertFalse(zeroForOneFallback);
        assertFalse(oneForZeroFallback);
        assertEq(stored.zeroForOneRiskWad, 4e18);
        assertEq(stored.oneForZeroRiskWad, 2e18);
        assertEq(stored.sequence, 1);
        assertEq(controller.lastSequence(POOL_ID), 1);
    }

    function test_rejectsUnauthorizedMessageTransmitter() external {
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.InvalidMessageTransmitter.selector, address(this)));
        controller.handleReceiveFinalizedMessage(
            PROCESSOR_DOMAIN, PROCESSOR, 2_000, _encodedRecommendation(_validRecommendation(1))
        );
    }

    function test_rejectsWrongCirclePeer() external {
        bytes32 wrongProcessor = bytes32(uint256(uint160(address(0xBAD))));
        vm.expectRevert(
            abi.encodeWithSelector(ThetaShieldController.InvalidCirclePeer.selector, PROCESSOR_DOMAIN, wrongProcessor)
        );
        transmitter.deliverFinalized(
            IMessageHandlerV2(address(controller)),
            PROCESSOR_DOMAIN,
            wrongProcessor,
            2_000,
            _encodedRecommendation(_validRecommendation(1))
        );
    }

    function test_rejectsReplayAndOutOfOrderSequence() external {
        _apply(_validRecommendation(7));

        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.RecommendationReplay.selector, 7, 7));
        _apply(_validRecommendation(7));
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.RecommendationReplay.selector, 6, 7));
        _apply(_validRecommendation(6));
    }

    function test_rejectsFutureStaleAndMalformedWindows() external {
        ThetaShieldController.FeeRecommendation memory supplied = _validRecommendation(1);
        supplied.validAfter = uint64(block.timestamp + 1);
        supplied.validUntil = uint64(block.timestamp + 60);
        vm.expectRevert(
            abi.encodeWithSelector(
                ThetaShieldController.FutureRecommendation.selector, supplied.validAfter, uint64(block.timestamp)
            )
        );
        _apply(supplied);

        supplied = _validRecommendation(1);
        supplied.validAfter = uint64(block.timestamp - 60);
        supplied.validUntil = uint64(block.timestamp);
        vm.expectRevert(
            abi.encodeWithSelector(
                ThetaShieldController.StaleRecommendation.selector, supplied.validUntil, uint64(block.timestamp)
            )
        );
        _apply(supplied);

        supplied = _validRecommendation(1);
        supplied.validAfter = uint64(block.timestamp);
        supplied.validUntil = supplied.validAfter;
        vm.expectRevert(
            abi.encodeWithSelector(
                ThetaShieldController.InvalidRecommendationWindow.selector, supplied.validAfter, supplied.validUntil
            )
        );
        _apply(supplied);
    }

    function test_rejectsOverlongRecommendation() external {
        ThetaShieldController.FeeRecommendation memory supplied = _validRecommendation(1);
        supplied.validUntil = supplied.validAfter + 301;

        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.RecommendationLifetimeTooLong.selector, 301, 300));
        _apply(supplied);
    }

    function test_enforcesConfiguredRecommendationCooldown() external {
        ThetaShieldController.PoolFeeConfig memory config = _config();
        config.minimumRecommendationInterval = 30;
        vm.prank(OWNER);
        controller.configurePool(POOL_ID, config);

        _apply(_validRecommendation(1));
        uint64 acceptedAt = uint64(block.timestamp);

        vm.expectRevert(
            abi.encodeWithSelector(ThetaShieldController.RecommendationTooSoon.selector, acceptedAt + 30, acceptedAt)
        );
        _apply(_validRecommendation(2));

        vm.warp(acceptedAt + 30);
        _apply(_validRecommendation(2));
        assertEq(controller.lastSequence(POOL_ID), 2);
        assertEq(controller.lastRecommendationAt(POOL_ID), acceptedAt + 30);
    }

    function test_rejectsCooldownLongerThanRecommendationLifetime() external {
        ThetaShieldController.PoolFeeConfig memory config = _config();
        config.minimumRecommendationInterval = config.maximumRecommendationLifetime + 1;

        vm.prank(OWNER);
        vm.expectRevert(ThetaShieldController.InvalidPoolConfiguration.selector);
        controller.configurePool(POOL_ID, config);
    }

    function test_rejectsOutOfBoundsFeeRiskAndConfidence() external {
        ThetaShieldController.FeeRecommendation memory supplied = _validRecommendation(1);
        supplied.zeroForOneFee = 10_001;
        vm.expectRevert(
            abi.encodeWithSelector(ThetaShieldController.FeeOutOfBounds.selector, true, 10_001, 500, 10_000)
        );
        _apply(supplied);

        supplied = _validRecommendation(1);
        supplied.zeroForOneRiskWad = 101e18;
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.RiskOutOfBounds.selector, true, int128(101e18)));
        _apply(supplied);

        supplied = _validRecommendation(1);
        supplied.confidenceBps = 10_001;
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.InvalidConfidence.selector, 10_001));
        _apply(supplied);
    }

    function test_rejectsPremiumWithoutPositiveRiskOrEnoughConfidence() external {
        ThetaShieldController.FeeRecommendation memory supplied = _validRecommendation(1);
        supplied.zeroForOneRiskWad = -1;
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.FeeRiskMismatch.selector, true, 2_500, int128(-1)));
        _apply(supplied);

        supplied = _validRecommendation(1);
        supplied.confidenceBps = 5_999;
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.InsufficientConfidence.selector, 5_999, 6_000));
        _apply(supplied);
    }

    function test_lowConfidenceBaselineUpdateAdvancesSequenceAndFallsBack() external {
        ThetaShieldController.FeeRecommendation memory supplied = _validRecommendation(3);
        supplied.zeroForOneFee = 500;
        supplied.oneForZeroFee = 500;
        supplied.zeroForOneRiskWad = 0;
        supplied.oneForZeroRiskWad = 0;
        supplied.confidenceBps = 5_999;
        _apply(supplied);

        (uint24 feePips, bool usedBaseline) = controller.feeForSwap(POOL_ID, true);
        assertEq(feePips, 500);
        assertTrue(usedBaseline);
        assertEq(controller.lastSequence(POOL_ID), 3);
    }

    function test_expiryAndPauseSelectBaseline() external {
        ThetaShieldController.FeeRecommendation memory supplied = _validRecommendation(1);
        _apply(supplied);

        vm.warp(supplied.validUntil);
        (uint24 expiredFee, bool expiredFallback) = controller.feeForSwap(POOL_ID, true);
        assertEq(expiredFee, 500);
        assertTrue(expiredFallback);

        vm.warp(supplied.validUntil - 1);
        vm.prank(OWNER);
        controller.setPoolPause(POOL_ID, true);
        (uint24 poolPausedFee, bool poolPausedFallback) = controller.feeForSwap(POOL_ID, true);
        assertEq(poolPausedFee, 500);
        assertTrue(poolPausedFallback);

        vm.prank(OWNER);
        controller.setPoolPause(POOL_ID, false);
        vm.prank(OWNER);
        controller.setGlobalPause(true);
        (uint24 globallyPausedFee, bool globallyPausedFallback) = controller.feeForSwap(POOL_ID, true);
        assertEq(globallyPausedFee, 500);
        assertTrue(globallyPausedFallback);
    }

    function test_reconfigurationInvalidatesFeeButPreservesReplayProtection() external {
        _apply(_validRecommendation(5));
        vm.prank(OWNER);
        controller.configurePool(POOL_ID, _config());

        (uint24 feePips, bool usedBaseline) = controller.feeForSwap(POOL_ID, true);
        assertEq(feePips, 500);
        assertTrue(usedBaseline);
        assertEq(controller.lastSequence(POOL_ID), 5);

        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.RecommendationReplay.selector, 5, 5));
        _apply(_validRecommendation(5));
    }

    function test_ownershipTransferRequiresPendingOwnerAcceptance() external {
        address nextOwner = address(0xA11CE);
        vm.prank(OWNER);
        controller.transferOwnership(nextOwner);

        vm.expectRevert(abi.encodeWithSelector(OwnedTwoStep.NotPendingOwner.selector, address(this)));
        controller.acceptOwnership();

        vm.prank(nextOwner);
        controller.acceptOwnership();
        assertEq(controller.owner(), nextOwner);
        assertEq(controller.pendingOwner(), address(0));
    }

    function test_unsupportedPoolReverts() external {
        bytes32 unknownPool = keccak256("unknown");
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.PoolNotConfigured.selector, unknownPool));
        controller.feeForSwap(unknownPool, true);
    }

    function _apply(ThetaShieldController.FeeRecommendation memory supplied) private {
        transmitter.deliverFinalized(
            IMessageHandlerV2(address(controller)), PROCESSOR_DOMAIN, PROCESSOR, 2_000, _encodedRecommendation(supplied)
        );
    }

    function _encodedRecommendation(ThetaShieldController.FeeRecommendation memory supplied)
        private
        pure
        returns (bytes memory)
    {
        return CircleMessages.encodeRecommendation(
            CircleMessages.Recommendation({
                poolId: POOL_ID,
                zeroForOneFee: supplied.zeroForOneFee,
                oneForZeroFee: supplied.oneForZeroFee,
                zeroForOneRiskWad: supplied.zeroForOneRiskWad,
                oneForZeroRiskWad: supplied.oneForZeroRiskWad,
                confidenceBps: supplied.confidenceBps,
                validAfter: supplied.validAfter,
                validUntil: supplied.validUntil,
                sequence: supplied.sequence
            })
        );
    }

    function _config() private pure returns (ThetaShieldController.PoolFeeConfig memory) {
        return ThetaShieldController.PoolFeeConfig({
            baselineFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            confidenceFloorBps: 6_000,
            maximumRecommendationLifetime: 300,
            minimumRecommendationInterval: 0,
            paused: false
        });
    }

    function _validRecommendation(uint64 sequence)
        private
        view
        returns (ThetaShieldController.FeeRecommendation memory)
    {
        return ThetaShieldController.FeeRecommendation({
            zeroForOneFee: 2_500,
            oneForZeroFee: 900,
            zeroForOneRiskWad: 4e18,
            oneForZeroRiskWad: 2e18,
            confidenceBps: 8_000,
            validAfter: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 180),
            sequence: sequence
        });
    }
}
