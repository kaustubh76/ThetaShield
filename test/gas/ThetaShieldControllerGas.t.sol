// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CircleMessages} from "../../src/circle/CircleMessages.sol";
import {ThetaShieldController} from "../../src/controller/ThetaShieldController.sol";
import {IMessageHandlerV2} from "../../src/interfaces/IMessageHandlerV2.sol";
import {MockMessageTransmitterV2} from "../mocks/MockMessageTransmitterV2.sol";

contract ThetaShieldControllerGasTest is Test {
    bytes32 private constant POOL_ID = keccak256("phase7-gas-pool");
    uint32 private constant PROCESSOR_DOMAIN = 0;
    bytes32 private constant PROCESSOR = bytes32(uint256(uint160(address(0xBEEF))));

    ThetaShieldController private controller;
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
    }

    function test_measureControllerOperationGas() external {
        ThetaShieldController.FeeRecommendation memory first = _recommendation(1, 1_000, 500);
        vm.startSnapshotGas("phase7_apply_recommendation_cold");
        _apply(first);
        uint256 coldApplyGas = vm.stopSnapshotGas("phase7_apply_recommendation_cold");

        ThetaShieldController.FeeRecommendation memory second = _recommendation(2, 1_500, 750);
        vm.startSnapshotGas("phase7_apply_recommendation_warm");
        _apply(second);
        uint256 warmApplyGas = vm.stopSnapshotGas("phase7_apply_recommendation_warm");

        vm.startSnapshotGas("phase7_fee_for_swap_warm");
        controller.feeForSwap(POOL_ID, true);
        uint256 feeReadGas = vm.stopSnapshotGas("phase7_fee_for_swap_warm");

        emit log_named_uint("PHASE7_APPLY_RECOMMENDATION_COLD_GAS", coldApplyGas);
        emit log_named_uint("PHASE7_APPLY_RECOMMENDATION_WARM_GAS", warmApplyGas);
        emit log_named_uint("PHASE7_FEE_FOR_SWAP_WARM_GAS", feeReadGas);

        assertLt(coldApplyGas, 200_000);
        assertLt(warmApplyGas, 100_000);
        assertLt(feeReadGas, 30_000);
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

    function _recommendation(uint64 sequence, uint24 zeroForOneFee, uint24 oneForZeroFee)
        private
        view
        returns (ThetaShieldController.FeeRecommendation memory)
    {
        return ThetaShieldController.FeeRecommendation({
            zeroForOneFee: zeroForOneFee,
            oneForZeroFee: oneForZeroFee,
            zeroForOneRiskWad: zeroForOneFee > 500 ? int128(1e18) : int128(0),
            oneForZeroRiskWad: oneForZeroFee > 500 ? int128(1e18) : int128(0),
            confidenceBps: 8_000,
            validAfter: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 180),
            sequence: sequence
        });
    }
}
