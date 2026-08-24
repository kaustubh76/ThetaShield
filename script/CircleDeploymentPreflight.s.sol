// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {DeploymentValidation} from "../src/deployment/DeploymentValidation.sol";

/// @title CircleDeploymentPreflight
/// @notice Read-only validation for the two-chain Circle release. Never broadcasts.
contract CircleDeploymentPreflight is Script {
    event PreflightPassed(bytes32 indexed scope, uint256 indexed chainId, bytes32 configurationFingerprint);

    function runOrigin() external returns (bytes32 fingerprint) {
        DeploymentValidation.OriginConfig memory config = DeploymentValidation.OriginConfig({
            expectedChainId: vm.envUint("ORIGIN_CHAIN_ID"),
            expectedCircleDomain: _uint32Env("ORIGIN_CIRCLE_DOMAIN"),
            poolManager: vm.envAddress("ORIGIN_POOL_MANAGER"),
            messageTransmitter: vm.envAddress("ORIGIN_CIRCLE_MESSAGE_TRANSMITTER"),
            expectedMessageTransmitter: vm.envAddress("ORIGIN_EXPECTED_CIRCLE_MESSAGE_TRANSMITTER"),
            swapRouter: vm.envAddress("ORIGIN_SWAP_ROUTER"),
            modifyLiquidityRouter: vm.envAddress("ORIGIN_MODIFY_LIQUIDITY_ROUTER"),
            owner: vm.envAddress("THETASHIELD_OWNER"),
            deployer: vm.envAddress("DEPLOYER_ADDRESS")
        });
        fingerprint = DeploymentValidation.validateOrigin(config, block.chainid);
        emit PreflightPassed("circle-origin", block.chainid, fingerprint);
    }

    function runProcessor() external returns (bytes32 fingerprint) {
        DeploymentValidation.ProcessorConfig memory config = DeploymentValidation.ProcessorConfig({
            expectedChainId: vm.envUint("PROCESSOR_CHAIN_ID"),
            expectedCircleDomain: _uint32Env("PROCESSOR_CIRCLE_DOMAIN"),
            messageTransmitter: vm.envAddress("PROCESSOR_CIRCLE_MESSAGE_TRANSMITTER"),
            expectedMessageTransmitter: vm.envAddress("PROCESSOR_EXPECTED_CIRCLE_MESSAGE_TRANSMITTER"),
            referenceFeed: vm.envAddress("REFERENCE_FEED"),
            originDomain: _uint32Env("ORIGIN_CIRCLE_DOMAIN"),
            originTransport: _addressToBytes32(vm.envAddress("THETASHIELD_CIRCLE_TRANSPORT")),
            controllerDomain: _uint32Env("ORIGIN_CIRCLE_DOMAIN"),
            controller: _addressToBytes32(vm.envAddress("THETASHIELD_CONTROLLER")),
            poolId: vm.envBytes32("THETASHIELD_POOL_ID"),
            marketId: vm.envBytes32("REFERENCE_MARKET_ID")
        });
        fingerprint = DeploymentValidation.validateProcessor(config, block.chainid);
        emit PreflightPassed("circle-processor", block.chainid, fingerprint);
    }

    function _uint32Env(string memory name) private view returns (uint32 value) {
        uint256 supplied = vm.envUint(name);
        require(supplied <= type(uint32).max, "Circle domain does not fit uint32");
        // The explicit bound above proves this conversion is exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint32(supplied);
    }

    function _addressToBytes32(address account) private pure returns (bytes32) {
        return bytes32(uint256(uint160(account)));
    }
}
