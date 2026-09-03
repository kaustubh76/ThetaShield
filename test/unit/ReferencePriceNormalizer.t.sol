// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ReferencePriceNormalizer} from "../../src/libraries/ReferencePriceNormalizer.sol";

contract ReferencePriceNormalizerHarness {
    function normalize(uint256 answer, uint8 decimals) external pure returns (uint256) {
        return ReferencePriceNormalizer.toWad(answer, decimals);
    }
}

contract ReferencePriceNormalizerTest is Test {
    ReferencePriceNormalizerHarness private harness;

    function setUp() external {
        harness = new ReferencePriceNormalizerHarness();
    }

    function test_normalizesLowerEqualAndHigherDecimalAnswers() external pure {
        assertEq(ReferencePriceNormalizer.toWad(2_500e8, 8), 2_500e18);
        assertEq(ReferencePriceNormalizer.toWad(2_500e18, 18), 2_500e18);
        assertEq(ReferencePriceNormalizer.toWad(2_500e24, 24), 2_500e18);
    }

    function test_rejectsZeroAndUnsupportedDecimals() external {
        vm.expectRevert(ReferencePriceNormalizer.ZeroPrice.selector);
        harness.normalize(0, 8);

        vm.expectRevert(abi.encodeWithSelector(ReferencePriceNormalizer.UnsupportedDecimals.selector, 37));
        harness.normalize(1, 37);
    }
}
