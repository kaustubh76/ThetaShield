// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {DeploymentValidation} from "../src/deployment/DeploymentValidation.sol";

/// @title Phase7DeploymentPreflight
/// @notice Read-only network and infrastructure validation. This script never broadcasts.
contract Phase7DeploymentPreflight is Script {
    event PreflightPassed(bytes32 indexed scope, uint256 indexed chainId, bytes32 configurationFingerprint);

    /// @notice Validates origin infrastructure from environment variables without deploying.
    function runOrigin() external returns (bytes32 fingerprint) {
        DeploymentValidation.OriginConfig memory config = DeploymentValidation.OriginConfig({
            expectedChainId: vm.envUint("ORIGIN_CHAIN_ID"),
            poolManager: vm.envAddress("ORIGIN_POOL_MANAGER"),
            callbackProxy: vm.envAddress("ORIGIN_CALLBACK_PROXY"),
            owner: vm.envAddress("THETASHIELD_OWNER"),
            deployer: vm.envAddress("DEPLOYER_ADDRESS"),
            expectedRvmId: vm.envAddress("EXPECTED_RVM_ID")
        });
        fingerprint = DeploymentValidation.validateOrigin(config, block.chainid);
        emit PreflightPassed("origin", block.chainid, fingerprint);
    }

    /// @notice Validates Reactive infrastructure and cross-chain identifiers without deploying.
    function runReactive() external returns (bytes32 fingerprint) {
        DeploymentValidation.ReactiveConfig memory config = DeploymentValidation.ReactiveConfig({
            expectedChainId: vm.envUint("REACTIVE_CHAIN_ID"),
            originChainId: vm.envUint("ORIGIN_CHAIN_ID"),
            referenceChainId: vm.envUint("REFERENCE_CHAIN_ID"),
            systemContract: vm.envAddress("REACTIVE_SYSTEM_CONTRACT"),
            hook: vm.envAddress("THETASHIELD_HOOK"),
            referenceFeed: vm.envAddress("REFERENCE_FEED"),
            controller: vm.envAddress("THETASHIELD_CONTROLLER"),
            poolId: vm.envBytes32("THETASHIELD_POOL_ID"),
            marketId: vm.envBytes32("REFERENCE_MARKET_ID"),
            cronTopic: vm.envUint("REACTIVE_CRON_TOPIC_1"),
            callbackGasLimit: vm.envUint("REACTIVE_CALLBACK_GAS_LIMIT")
        });
        fingerprint = DeploymentValidation.validateReactive(config, block.chainid);
        emit PreflightPassed("reactive", block.chainid, fingerprint);
    }
}
