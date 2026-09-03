// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ThetaShieldUnits} from "../../src/base/ThetaShieldUnits.sol";

contract ThetaShieldUnitsTest is Test {
    function test_canonicalDenominators() external pure {
        assertEq(ThetaShieldUnits.WAD, 1e18);
        assertEq(ThetaShieldUnits.BPS, 10_000);
        assertEq(ThetaShieldUnits.FEE_PIPS, 1_000_000);
    }

    function test_fiveBasisPointsEqualsFiveHundredFeePips() external pure {
        uint256 fiveBasisPoints = 5;
        uint256 feePips = fiveBasisPoints * ThetaShieldUnits.FEE_PIPS / ThetaShieldUnits.BPS;

        assertEq(feePips, 500);
    }
}
