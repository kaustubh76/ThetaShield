// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {ReactiveLegacyValidation} from "../src/deployment/ReactiveLegacyValidation.sol";
import {ReactiveLegacy} from "../src/reactive/ReactiveLegacy.sol";

/// @title ReactiveLegacyPreflight
/// @notice Read-only infrastructure and funding validation for Legacy Lasna. Never broadcasts.
contract ReactiveLegacyPreflight is Script {
    event PreflightPassed(bytes32 indexed scope, uint256 indexed chainId, bytes32 configurationFingerprint);

    function runProcessor() external returns (bytes32 fingerprint) {
        fingerprint = ReactiveLegacyValidation.validateProcessor(
            ReactiveLegacyValidation.ProcessorConfig({
                expectedChainId: vm.envUint("PROCESSOR_CHAIN_ID"),
                callbackProxy: vm.envAddress("PROCESSOR_REACTIVE_CALLBACK_PROXY"),
                sampler: vm.envAddress("REFERENCE_FEED"),
                processor: vm.envAddress("THETASHIELD_CIRCLE_PROCESSOR"),
                deployer: vm.envAddress("DEPLOYER_ADDRESS"),
                initialExecutorFundingWei: vm.envUint("PROCESSOR_REACTIVE_INITIAL_FUNDING_WEI")
            }),
            block.chainid
        );
        emit PreflightPassed("reactive-legacy-processor", block.chainid, fingerprint);
    }

    function runReactive() external returns (bytes32 fingerprint) {
        fingerprint = ReactiveLegacyValidation.validateReactive(
            ReactiveLegacyValidation.ReactiveConfig({
                expectedChainId: vm.envUint("REACTIVE_CHAIN_ID"),
                processorChainId: vm.envUint("PROCESSOR_CHAIN_ID"),
                systemContract: ReactiveLegacy.SYSTEM_CONTRACT,
                processor: vm.envAddress("THETASHIELD_CIRCLE_PROCESSOR"),
                executor: vm.envAddress("THETASHIELD_AUTOMATION_EXECUTOR"),
                deployer: vm.envAddress("DEPLOYER_ADDRESS"),
                cronTopic: vm.envUint("REACTIVE_CRON_TOPIC"),
                initialRscFundingWei: vm.envUint("REACTIVE_INITIAL_FUNDING_WEI")
            }),
            block.chainid
        );
        emit PreflightPassed("reactive-legacy-lasna", block.chainid, fingerprint);
    }
}
