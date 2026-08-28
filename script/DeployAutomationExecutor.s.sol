// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {ThetaShieldCircleProcessor} from "../src/circle/ThetaShieldCircleProcessor.sol";
import {DeploymentValidation} from "../src/deployment/DeploymentValidation.sol";
import {PoolMedianReferenceSampler} from "../src/feeds/PoolMedianReferenceSampler.sol";
import {ThetaShieldAutomationExecutor} from "../src/reactive/ThetaShieldAutomationExecutor.sol";

/// @title DeployAutomationExecutor
/// @notice Deploys the processor-chain callback target for permissionless bounded work.
contract DeployAutomationExecutor is Script {
    event AutomationExecutorDeployed(
        address indexed executor,
        address indexed sampler,
        address indexed processor,
        address callbackProxy,
        bytes32 source0,
        bytes32 source1,
        bytes32 source2
    );

    function run() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address callbackProxy = vm.envAddress("PROCESSOR_REACTIVE_CALLBACK_PROXY");
        PoolMedianReferenceSampler sampler = PoolMedianReferenceSampler(vm.envAddress("REFERENCE_FEED"));
        ThetaShieldCircleProcessor processor = ThetaShieldCircleProcessor(vm.envAddress("THETASHIELD_CIRCLE_PROCESSOR"));
        DeploymentValidation.requireCode(callbackProxy);
        DeploymentValidation.requireCode(address(sampler));
        DeploymentValidation.requireCode(address(processor));

        bytes32[] memory sources = new bytes32[](3);
        sources[0] = vm.envBytes32("REFERENCE_SOURCE_ID_0");
        sources[1] = vm.envBytes32("REFERENCE_SOURCE_ID_1");
        sources[2] = vm.envBytes32("REFERENCE_SOURCE_ID_2");

        vm.startBroadcast(deployer);
        ThetaShieldAutomationExecutor executor =
            new ThetaShieldAutomationExecutor(callbackProxy, sampler, processor, sources);
        vm.stopBroadcast();

        emit AutomationExecutorDeployed(
            address(executor), address(sampler), address(processor), callbackProxy, sources[0], sources[1], sources[2]
        );
    }
}
