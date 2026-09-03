// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IMessageTransmitterV2} from "../../src/interfaces/IMessageTransmitterV2.sol";
import {ReactiveLegacy} from "../../src/reactive/ReactiveLegacy.sol";

contract InfrastructureForkTest is Test {
    function test_originCircleAndUniswapInfrastructureWhenForkIsConfigured() external {
        string memory rpcUrl = vm.envOr("ORIGIN_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            vm.skip(true, "ORIGIN_RPC_URL is not configured; opt-in fork check skipped");
            return;
        }

        _selectFork(rpcUrl, "ORIGIN_FORK_BLOCK_NUMBER");
        assertEq(block.chainid, vm.envUint("ORIGIN_CHAIN_ID"));
        _assertCode(vm.envAddress("ORIGIN_POOL_MANAGER"), "PoolManager");
        _assertCode(vm.envAddress("ORIGIN_SWAP_ROUTER"), "swap router");
        _assertCode(vm.envAddress("ORIGIN_MODIFY_LIQUIDITY_ROUTER"), "liquidity router");
        _assertCircleDomain(
            vm.envAddress("ORIGIN_CIRCLE_MESSAGE_TRANSMITTER"), uint32(vm.envUint("ORIGIN_CIRCLE_DOMAIN"))
        );
    }

    function test_processorCircleInfrastructureWhenForkIsConfigured() external {
        string memory rpcUrl = vm.envOr("PROCESSOR_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            vm.skip(true, "PROCESSOR_RPC_URL is not configured; opt-in fork check skipped");
            return;
        }

        _selectFork(rpcUrl, "PROCESSOR_FORK_BLOCK_NUMBER");
        assertEq(block.chainid, vm.envUint("PROCESSOR_CHAIN_ID"));
        _assertCircleDomain(
            vm.envAddress("PROCESSOR_CIRCLE_MESSAGE_TRANSMITTER"), uint32(vm.envUint("PROCESSOR_CIRCLE_DOMAIN"))
        );
        address callbackProxy = vm.envAddress("PROCESSOR_REACTIVE_CALLBACK_PROXY");
        assertEq(callbackProxy, ReactiveLegacy.ETHEREUM_SEPOLIA_CALLBACK_PROXY, "wrong Legacy callback proxy");
        _assertCode(callbackProxy, "Legacy callback proxy");
    }

    function test_reactiveLegacyInfrastructureWhenForkIsConfigured() external {
        string memory rpcUrl = vm.envOr("REACTIVE_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            vm.skip(true, "REACTIVE_RPC_URL is not configured; opt-in Legacy fork check skipped");
            return;
        }

        _selectFork(rpcUrl, "REACTIVE_FORK_BLOCK_NUMBER");
        assertEq(block.chainid, ReactiveLegacy.LASNA_CHAIN_ID, "not Legacy Lasna");
        _assertCode(ReactiveLegacy.SYSTEM_CONTRACT, "Legacy system contract");
        assertEq(
            ReactiveLegacy.SYSTEM_CONTRACT.codehash,
            ReactiveLegacy.LASNA_SYSTEM_CODE_HASH,
            "wrong Legacy system bytecode; check for an Omni RPC"
        );
    }

    function _assertCircleDomain(address transmitter, uint32 expectedDomain) private view {
        _assertCode(transmitter, "Circle MessageTransmitterV2");
        assertEq(IMessageTransmitterV2(transmitter).localDomain(), expectedDomain, "wrong Circle domain");
    }

    function _assertCode(address target, string memory label) private view {
        assertGt(target.code.length, 0, string.concat(label, " has no code"));
    }

    function _selectFork(string memory rpcUrl, string memory blockVariable) private {
        uint256 forkBlock = vm.envOr(blockVariable, uint256(0));
        if (forkBlock == 0) vm.createSelectFork(rpcUrl);
        else vm.createSelectFork(rpcUrl, forkBlock);
    }
}
