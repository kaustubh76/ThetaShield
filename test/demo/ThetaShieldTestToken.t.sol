// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ThetaShieldTestToken} from "../../src/demo/ThetaShieldTestToken.sol";

contract ThetaShieldTestTokenTest is Test {
    ThetaShieldTestToken private token;
    address private constant HOLDER = address(0xA11CE);
    address private constant SPENDER = address(0xB0B);
    address private constant RECIPIENT = address(0xCAFE);

    function setUp() public {
        token = new ThetaShieldTestToken("ThetaShield Test", "TST", HOLDER, 100e18);
    }

    function test_constructorMintsFixedSupply() external view {
        assertEq(token.totalSupply(), 100e18);
        assertEq(token.balanceOf(HOLDER), 100e18);
        assertEq(token.decimals(), 18);
    }

    function test_transferAndFiniteAllowance() external {
        vm.prank(HOLDER);
        token.approve(SPENDER, 5e18);

        vm.prank(SPENDER);
        assertTrue(token.transferFrom(HOLDER, RECIPIENT, 3e18));

        assertEq(token.balanceOf(RECIPIENT), 3e18);
        assertEq(token.balanceOf(HOLDER), 97e18);
        assertEq(token.allowance(HOLDER, SPENDER), 2e18);
    }

    function test_maxAllowanceIsNotReduced() external {
        vm.prank(HOLDER);
        token.approve(SPENDER, type(uint256).max);

        vm.prank(SPENDER);
        assertTrue(token.transferFrom(HOLDER, RECIPIENT, 1e18));

        assertEq(token.allowance(HOLDER, SPENDER), type(uint256).max);
    }
}
