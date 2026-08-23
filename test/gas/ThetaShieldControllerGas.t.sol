// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ThetaShieldController} from "../../src/controller/ThetaShieldController.sol";

contract ThetaShieldControllerGasTest is Test {
    bytes32 private constant POOL_ID = keccak256("phase7-gas-pool");
    address private constant CALLBACK_PROXY = address(0xCA11BAC);
    address private constant RVM_ID = address(0xBEEF);

    ThetaShieldController private controller;

    function setUp() public {
        vm.warp(1_800_000_000);
        controller = new ThetaShieldController(address(this), CALLBACK_PROXY, RVM_ID);
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
        vm.prank(CALLBACK_PROXY);
        controller.applyRecommendation(RVM_ID, POOL_ID, first);
        uint256 coldApplyGas = vm.stopSnapshotGas("phase7_apply_recommendation_cold");

        ThetaShieldController.FeeRecommendation memory second = _recommendation(2, 1_500, 750);
        vm.startSnapshotGas("phase7_apply_recommendation_warm");
        vm.prank(CALLBACK_PROXY);
        controller.applyRecommendation(RVM_ID, POOL_ID, second);
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
