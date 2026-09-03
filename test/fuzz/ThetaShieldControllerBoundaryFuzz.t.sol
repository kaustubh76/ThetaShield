// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CircleMessages} from "../../src/circle/CircleMessages.sol";
import {ThetaShieldController} from "../../src/controller/ThetaShieldController.sol";
import {IMessageHandlerV2} from "../../src/interfaces/IMessageHandlerV2.sol";
import {MockMessageTransmitterV2} from "../mocks/MockMessageTransmitterV2.sol";

contract ThetaShieldControllerBoundaryFuzzTest is Test {
    bytes32 private constant POOL_ID = keccak256("phase7-controller-fuzz-pool");
    uint32 private constant PROCESSOR_DOMAIN = 0;
    bytes32 private constant PROCESSOR = bytes32(uint256(uint160(address(0xBEEF))));

    ThetaShieldController private controller;
    MockMessageTransmitterV2 private transmitter;

    function setUp() public {
        vm.warp(1_800_000_000);
        transmitter = new MockMessageTransmitterV2();
        controller = new ThetaShieldController(address(this), transmitter);
        controller.configureCirclePeer(PROCESSOR_DOMAIN, PROCESSOR);
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

        vm.expectRevert(
            abi.encodeWithSelector(
                ThetaShieldController.FeeOutOfBounds.selector, zeroForOne, fee, uint24(500), uint24(10_000)
            )
        );
        _apply(recommendation);
    }

    function testFuzz_recommendationLifetimeBoundary(uint16 lifetimeSeed) external {
        uint64 lifetime = uint64(bound(lifetimeSeed, 1, 600));
        ThetaShieldController.FeeRecommendation memory recommendation = _recommendation(1, lifetime);

        if (lifetime <= 300) {
            _apply(recommendation);
            assertEq(controller.lastSequence(POOL_ID), 1);
        } else {
            vm.expectRevert(
                abi.encodeWithSelector(ThetaShieldController.RecommendationLifetimeTooLong.selector, lifetime, 300)
            );
            _apply(recommendation);
        }
    }

    function testFuzz_cooldownBoundary(uint8 elapsedSeed) external {
        controller.configurePool(POOL_ID, _config(60));
        _apply(_recommendation(1, 180));
        uint64 acceptedAt = uint64(block.timestamp);
        uint64 elapsed = uint64(bound(elapsedSeed, 0, 120));
        vm.warp(acceptedAt + elapsed);

        ThetaShieldController.FeeRecommendation memory recommendation = _recommendation(2, 180);
        if (elapsed >= 60) {
            _apply(recommendation);
            assertEq(controller.lastSequence(POOL_ID), 2);
        } else {
            vm.expectRevert(
                abi.encodeWithSelector(
                    ThetaShieldController.RecommendationTooSoon.selector, acceptedAt + 60, acceptedAt + elapsed
                )
            );
            _apply(recommendation);
        }
    }

    function _apply(ThetaShieldController.FeeRecommendation memory recommendation) private {
        CircleMessages.Recommendation memory delivered = CircleMessages.Recommendation({
            poolId: POOL_ID,
            zeroForOneFee: recommendation.zeroForOneFee,
            oneForZeroFee: recommendation.oneForZeroFee,
            zeroForOneRiskWad: recommendation.zeroForOneRiskWad,
            oneForZeroRiskWad: recommendation.oneForZeroRiskWad,
            confidenceBps: recommendation.confidenceBps,
            validAfter: recommendation.validAfter,
            validUntil: recommendation.validUntil,
            sequence: recommendation.sequence
        });
        transmitter.deliverFinalized(
            IMessageHandlerV2(address(controller)),
            PROCESSOR_DOMAIN,
            PROCESSOR,
            2_000,
            CircleMessages.encodeRecommendation(delivered)
        );
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
