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
        _selectFork(rpcUrl, "ORIGIN_FORK_BLOCK_NUMBER");

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
        bytes32 expectedSystemCodeHash = vm.envBytes32("REACTIVE_SYSTEM_CODEHASH");
        assertEq(configuredSystem, REACTIVE_SYSTEM, "Reactive system address differs from pinned library");
        _selectFork(rpcUrl, "REACTIVE_FORK_BLOCK_NUMBER");

        assertEq(block.chainid, expectedChainId);
        assertGt(configuredSystem.code.length, 0, "Reactive system contract has no code");
        assertEq(configuredSystem.codehash, expectedSystemCodeHash, "Reactive system bytecode is not Lasna Omni");
    }

    function _selectFork(string memory rpcUrl, string memory blockVariable) private {
        uint256 forkBlock = vm.envOr(blockVariable, uint256(0));
        if (forkBlock == 0) {
            vm.createSelectFork(rpcUrl);
        } else {
            vm.createSelectFork(rpcUrl, forkBlock);
        }
    }
}
