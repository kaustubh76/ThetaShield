// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ThetaShieldController} from "../../src/controller/ThetaShieldController.sol";
import {OwnedTwoStep} from "../../src/security/OwnedTwoStep.sol";

contract ThetaShieldControllerTest is Test {
    address private constant OWNER = 0xd1DcAAFf9356d5a42f2eE6F90179C4509386a83f;
    address private constant CALLBACK_PROXY = address(0xCA11BAC);
    address private constant RVM_ID = address(0xBEEF);
    bytes32 private constant POOL_ID = keccak256("theta-shield-test-pool");

    ThetaShieldController private controller;

    function setUp() external {
        vm.warp(1_800_000_000);
        controller = new ThetaShieldController(OWNER, CALLBACK_PROXY, RVM_ID);
        vm.prank(OWNER);
        controller.configurePool(POOL_ID, _config());
    }

    function test_usesProvidedAccountAsInitialOwner() external view {
        assertEq(controller.owner(), OWNER);
        assertEq(controller.callbackProxy(), CALLBACK_PROXY);
        assertEq(controller.expectedRvmId(), RVM_ID);
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

    function test_rejectsUnauthorizedCallbackSender() external {
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.InvalidCallbackProxy.selector, address(this)));
        controller.applyRecommendation(RVM_ID, POOL_ID, _validRecommendation(1));
    }

    function test_rejectsWrongRvmIdentifier() external {
        address wrongRvmId = address(0xBAD);
        vm.prank(CALLBACK_PROXY);
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.InvalidRvmId.selector, wrongRvmId));
        controller.applyRecommendation(wrongRvmId, POOL_ID, _validRecommendation(1));
    }

    function test_rejectsReplayAndOutOfOrderSequence() external {
        _apply(_validRecommendation(7));

        vm.startPrank(CALLBACK_PROXY);
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.RecommendationReplay.selector, 7, 7));
        controller.applyRecommendation(RVM_ID, POOL_ID, _validRecommendation(7));
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.RecommendationReplay.selector, 6, 7));
        controller.applyRecommendation(RVM_ID, POOL_ID, _validRecommendation(6));
        vm.stopPrank();
    }

    function test_rejectsFutureStaleAndMalformedWindows() external {
        ThetaShieldController.FeeRecommendation memory supplied = _validRecommendation(1);
        supplied.validAfter = uint64(block.timestamp + 1);
        supplied.validUntil = uint64(block.timestamp + 60);
        vm.prank(CALLBACK_PROXY);
        vm.expectRevert(
            abi.encodeWithSelector(
                ThetaShieldController.FutureRecommendation.selector, supplied.validAfter, uint64(block.timestamp)
            )
        );
        controller.applyRecommendation(RVM_ID, POOL_ID, supplied);

        supplied = _validRecommendation(1);
        supplied.validAfter = uint64(block.timestamp - 60);
        supplied.validUntil = uint64(block.timestamp);
        vm.prank(CALLBACK_PROXY);
        vm.expectRevert(
            abi.encodeWithSelector(
                ThetaShieldController.StaleRecommendation.selector, supplied.validUntil, uint64(block.timestamp)
            )
        );
        controller.applyRecommendation(RVM_ID, POOL_ID, supplied);

        supplied = _validRecommendation(1);
        supplied.validAfter = uint64(block.timestamp);
        supplied.validUntil = supplied.validAfter;
        vm.prank(CALLBACK_PROXY);
        vm.expectRevert(
            abi.encodeWithSelector(
                ThetaShieldController.InvalidRecommendationWindow.selector, supplied.validAfter, supplied.validUntil
            )
        );
        controller.applyRecommendation(RVM_ID, POOL_ID, supplied);
    }

    function test_rejectsOverlongRecommendation() external {
        ThetaShieldController.FeeRecommendation memory supplied = _validRecommendation(1);
        supplied.validUntil = supplied.validAfter + 301;

        vm.prank(CALLBACK_PROXY);
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.RecommendationLifetimeTooLong.selector, 301, 300));
        controller.applyRecommendation(RVM_ID, POOL_ID, supplied);
    }

    function test_rejectsOutOfBoundsFeeRiskAndConfidence() external {
        ThetaShieldController.FeeRecommendation memory supplied = _validRecommendation(1);
        supplied.zeroForOneFee = 10_001;
        vm.prank(CALLBACK_PROXY);
        vm.expectRevert(
            abi.encodeWithSelector(ThetaShieldController.FeeOutOfBounds.selector, true, 10_001, 500, 10_000)
        );
        controller.applyRecommendation(RVM_ID, POOL_ID, supplied);

        supplied = _validRecommendation(1);
        supplied.zeroForOneRiskWad = 101e18;
        vm.prank(CALLBACK_PROXY);
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.RiskOutOfBounds.selector, true, int128(101e18)));
        controller.applyRecommendation(RVM_ID, POOL_ID, supplied);

        supplied = _validRecommendation(1);
        supplied.confidenceBps = 10_001;
        vm.prank(CALLBACK_PROXY);
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.InvalidConfidence.selector, 10_001));
        controller.applyRecommendation(RVM_ID, POOL_ID, supplied);
    }

    function test_rejectsPremiumWithoutPositiveRiskOrEnoughConfidence() external {
        ThetaShieldController.FeeRecommendation memory supplied = _validRecommendation(1);
        supplied.zeroForOneRiskWad = -1;
        vm.prank(CALLBACK_PROXY);
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.FeeRiskMismatch.selector, true, 2_500, int128(-1)));
        controller.applyRecommendation(RVM_ID, POOL_ID, supplied);

        supplied = _validRecommendation(1);
        supplied.confidenceBps = 5_999;
        vm.prank(CALLBACK_PROXY);
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.InsufficientConfidence.selector, 5_999, 6_000));
        controller.applyRecommendation(RVM_ID, POOL_ID, supplied);
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

        vm.prank(CALLBACK_PROXY);
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldController.RecommendationReplay.selector, 5, 5));
        controller.applyRecommendation(RVM_ID, POOL_ID, _validRecommendation(5));
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
        vm.prank(CALLBACK_PROXY);
        controller.applyRecommendation(RVM_ID, POOL_ID, supplied);
    }

    function _config() private pure returns (ThetaShieldController.PoolFeeConfig memory) {
        return ThetaShieldController.PoolFeeConfig({
            baselineFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            confidenceFloorBps: 6_000,
            maximumRecommendationLifetime: 300,
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
