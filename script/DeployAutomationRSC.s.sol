// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {ReactiveLegacyValidation} from "../src/deployment/ReactiveLegacyValidation.sol";
import {ReactiveLegacy} from "../src/reactive/ReactiveLegacy.sol";
import {ThetaShieldAutomationRSC} from "../src/reactive/ThetaShieldAutomationRSC.sol";
import {ThetaShieldProfiles} from "./profiles/ThetaShieldProfiles.sol";

/// @title DeployAutomationRSC
/// @notice Deploys and funds the Reactive Network scheduler and liveness guardian.
contract DeployAutomationRSC is Script {
    error ResearchProfileRequired(bytes32 suppliedProfileId);
    error ValueDoesNotFitUint64(string name, uint256 supplied);
    error ValueDoesNotFitUint8(string name, uint256 supplied);

    event AutomationRSCDeployed(
        address indexed reactiveContract,
        address indexed executor,
        address indexed processor,
        bytes32 profileId,
        uint256 initialFundingWei
    );

    function run() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        ThetaShieldProfiles.Profile memory profile =
            ThetaShieldProfiles.resolve(vm.envOr("THETASHIELD_PROFILE", string("RESEARCH_V1")));
        if (profile.id != ThetaShieldProfiles.researchV1().id) revert ResearchProfileRequired(profile.id);

        ThetaShieldAutomationRSC.NetworkConfig memory network = ThetaShieldAutomationRSC.NetworkConfig({
            monitoredChainId: vm.envUint("PROCESSOR_CHAIN_ID"),
            destinationChainId: vm.envUint("PROCESSOR_CHAIN_ID"),
            reactiveChainId: vm.envUint("REACTIVE_CHAIN_ID"),
            processor: vm.envAddress("THETASHIELD_CIRCLE_PROCESSOR"),
            executor: vm.envAddress("THETASHIELD_AUTOMATION_EXECUTOR"),
            cronTopic: vm.envUint("REACTIVE_CRON_TOPIC"),
            callbackGasLimit: _uint64Env("REACTIVE_CALLBACK_GAS_LIMIT"),
            epochDuration: profile.scheduler.epochDuration,
            retryDelay: _uint64Env("REACTIVE_RETRY_DELAY"),
            maximumRetries: _uint8Env("REACTIVE_MAXIMUM_RETRIES")
        });
        uint256 initialFunding = vm.envUint("REACTIVE_INITIAL_FUNDING_WEI");
        ReactiveLegacyValidation.validateReactive(
            ReactiveLegacyValidation.ReactiveConfig({
                expectedChainId: network.reactiveChainId,
                processorChainId: network.monitoredChainId,
                systemContract: ReactiveLegacy.SYSTEM_CONTRACT,
                processor: network.processor,
                executor: network.executor,
                deployer: deployer,
                cronTopic: network.cronTopic,
                initialRscFundingWei: initialFunding
            }),
            block.chainid
        );

        vm.startBroadcast(deployer);
        ThetaShieldAutomationRSC reactiveContract = new ThetaShieldAutomationRSC{value: initialFunding}(network);
        vm.stopBroadcast();

        emit AutomationRSCDeployed(
            address(reactiveContract), network.executor, network.processor, profile.id, initialFunding
        );
    }

    function _uint64Env(string memory name) private view returns (uint64 value) {
        uint256 supplied = vm.envUint(name);
        if (supplied > type(uint64).max) revert ValueDoesNotFitUint64(name, supplied);
        // Explicit bound above proves the cast is exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(supplied);
    }

    function _uint8Env(string memory name) private view returns (uint8 value) {
        uint256 supplied = vm.envUint(name);
        if (supplied > type(uint8).max) revert ValueDoesNotFitUint8(name, supplied);
        // Explicit bound above proves the cast is exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint8(supplied);
    }
}
