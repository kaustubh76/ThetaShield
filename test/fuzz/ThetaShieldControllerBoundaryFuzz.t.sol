// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ThetaShieldController} from "../../src/controller/ThetaShieldController.sol";

contract ThetaShieldControllerBoundaryFuzzTest is Test {
    bytes32 private constant POOL_ID = keccak256("phase7-controller-fuzz-pool");
    address private constant CALLBACK_PROXY = address(0xCA11BAC);
    address private constant RVM_ID = address(0xBEEF);

    ThetaShieldController private controller;

    function setUp() public {
        vm.warp(1_800_000_000);
        controller = new ThetaShieldController(address(this), CALLBACK_PROXY, RVM_ID);
        controller.configurePool(POOL_ID, _config(0));
    }

    function testFuzz_feeBoundsAreClosed(uint24 feeSeed, bool zeroForOne) external {
        uint24 fee = uint24(bound(feeSeed, 500, 10_000));
        ThetaShieldController.FeeRecommendation memory recommendation = _recommendation(1, 180);
        recommendation.zeroForOneFee = zeroForOne ? fee : 500;
        recommendation.oneForZeroFee = zeroForOne ? 500 : fee;
        recommendation.zeroForOneRiskWad = zeroForOne && fee > 500 ? int128(1) : int128(0);
        recommendation.oneForZeroRiskWad = !zeroForOne && fee > 500 ? int128(1) : int128(0);

        _apply(recommendation);
        (uint24 storedFee, bool usedBaseline) = controller.feeForSwap(POOL_ID, zeroForOne);
        assertEq(storedFee, fee);
        assertFalse(usedBaseline);
    }

    function testFuzz_outOfRangeFeeFailsClosed(uint24 feeSeed, bool zeroForOne) external {
        uint24 fee = uint24(bound(feeSeed, 10_001, 1_000_000));
        ThetaShieldController.FeeRecommendation memory recommendation = _recommendation(1, 180);
        recommendation.zeroForOneFee = zeroForOne ? fee : 500;
        recommendation.oneForZeroFee = zeroForOne ? 500 : fee;
        recommendation.zeroForOneRiskWad = zeroForOne ? int128(1) : int128(0);
        recommendation.oneForZeroRiskWad = zeroForOne ? int128(0) : int128(1);

        vm.prank(CALLBACK_PROXY);
        vm.expectRevert(
            abi.encodeWithSelector(
                ThetaShieldController.FeeOutOfBounds.selector, zeroForOne, fee, uint24(500), uint24(10_000)
            )
        );
        controller.applyRecommendation(RVM_ID, POOL_ID, recommendation);
    }

    function testFuzz_recommendationLifetimeBoundary(uint16 lifetimeSeed) external {
        uint64 lifetime = uint64(bound(lifetimeSeed, 1, 600));
        ThetaShieldController.FeeRecommendation memory recommendation = _recommendation(1, lifetime);

        vm.prank(CALLBACK_PROXY);
        if (lifetime <= 300) {
            controller.applyRecommendation(RVM_ID, POOL_ID, recommendation);
            assertEq(controller.lastSequence(POOL_ID), 1);
        } else {
            vm.expectRevert(
                abi.encodeWithSelector(ThetaShieldController.RecommendationLifetimeTooLong.selector, lifetime, 300)
            );
            controller.applyRecommendation(RVM_ID, POOL_ID, recommendation);
        }
    }

    function testFuzz_cooldownBoundary(uint8 elapsedSeed) external {
        controller.configurePool(POOL_ID, _config(60));
        _apply(_recommendation(1, 180));
        uint64 acceptedAt = uint64(block.timestamp);
        uint64 elapsed = uint64(bound(elapsedSeed, 0, 120));
        vm.warp(acceptedAt + elapsed);

        ThetaShieldController.FeeRecommendation memory recommendation = _recommendation(2, 180);
        vm.prank(CALLBACK_PROXY);
        if (elapsed >= 60) {
            controller.applyRecommendation(RVM_ID, POOL_ID, recommendation);
            assertEq(controller.lastSequence(POOL_ID), 2);
        } else {
            vm.expectRevert(
                abi.encodeWithSelector(
                    ThetaShieldController.RecommendationTooSoon.selector, acceptedAt + 60, acceptedAt + elapsed
                )
            );
            controller.applyRecommendation(RVM_ID, POOL_ID, recommendation);
        }
    }

    function _apply(ThetaShieldController.FeeRecommendation memory recommendation) private {
        vm.prank(CALLBACK_PROXY);
        controller.applyRecommendation(RVM_ID, POOL_ID, recommendation);
    }

    function _config(uint64 minimumRecommendationInterval)
        private
        pure
        returns (ThetaShieldController.PoolFeeConfig memory)
    {
        return ThetaShieldController.PoolFeeConfig({
            baselineFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            confidenceFloorBps: 5_000,
            maximumRecommendationLifetime: 300,
            minimumRecommendationInterval: minimumRecommendationInterval,
            paused: false
        });
    }

    function _recommendation(uint64 sequence, uint64 lifetime)
        private
        view
        returns (ThetaShieldController.FeeRecommendation memory)
    {
        return ThetaShieldController.FeeRecommendation({
            zeroForOneFee: 500,
            oneForZeroFee: 500,
            zeroForOneRiskWad: 0,
            oneForZeroRiskWad: 0,
            confidenceBps: 10_000,
            validAfter: uint64(block.timestamp),
            validUntil: uint64(block.timestamp) + lifetime,
            sequence: sequence
        });
    }
}
