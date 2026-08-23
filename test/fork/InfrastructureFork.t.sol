// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

contract InfrastructureForkTest is Test {
    address private constant REACTIVE_SYSTEM = 0x0000000000000000000000000000000000fffFfF;

    function test_originInfrastructureWhenForkIsConfigured() external {
        string memory rpcUrl = vm.envOr("ORIGIN_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            vm.skip(true, "ORIGIN_RPC_URL is not configured; opt-in fork check skipped");
            return;
        }

        uint256 expectedChainId = vm.envUint("ORIGIN_CHAIN_ID");
        address poolManager = vm.envAddress("ORIGIN_POOL_MANAGER");
        address callbackProxy = vm.envAddress("ORIGIN_CALLBACK_PROXY");
        vm.createSelectFork(rpcUrl);

        assertEq(block.chainid, expectedChainId);
        assertGt(poolManager.code.length, 0, "PoolManager has no code on configured origin chain");
        assertGt(callbackProxy.code.length, 0, "callback proxy has no code on configured origin chain");
    }

    function test_reactiveInfrastructureWhenForkIsConfigured() external {
        string memory rpcUrl = vm.envOr("REACTIVE_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            vm.skip(true, "REACTIVE_RPC_URL is not configured; opt-in fork check skipped");
            return;
        }

        uint256 expectedChainId = vm.envUint("REACTIVE_CHAIN_ID");
        address configuredSystem = vm.envAddress("REACTIVE_SYSTEM_CONTRACT");
        assertEq(configuredSystem, REACTIVE_SYSTEM, "Reactive system address differs from pinned library");
        vm.createSelectFork(rpcUrl);

        assertEq(block.chainid, expectedChainId);
        assertGt(configuredSystem.code.length, 0, "Reactive system contract has no code");
    }
}
