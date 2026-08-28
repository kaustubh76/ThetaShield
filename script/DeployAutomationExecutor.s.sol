// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {ThetaShieldCircleProcessor} from "../src/circle/ThetaShieldCircleProcessor.sol";
import {ReactiveLegacyValidation} from "../src/deployment/ReactiveLegacyValidation.sol";
import {PoolMedianReferenceSampler} from "../src/feeds/PoolMedianReferenceSampler.sol";
import {ThetaShieldAutomationExecutor} from "../src/reactive/ThetaShieldAutomationExecutor.sol";
import {ThetaShieldReferenceMarket} from "./profiles/ThetaShieldReferenceMarket.sol";

/// @title DeployAutomationExecutor
/// @notice Deploys the processor-chain callback target for permissionless bounded work.
contract DeployAutomationExecutor is Script {
    event AutomationExecutorDeployed(
        address indexed executor,
        address indexed sampler,
        address indexed processor,
        address callbackProxy,
        address rvmId,
        uint256 initialFundingWei,
        bytes32 source0,
        bytes32 source1,
        bytes32 source2
    );

    function run() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address callbackProxy = vm.envAddress("PROCESSOR_REACTIVE_CALLBACK_PROXY");
        PoolMedianReferenceSampler sampler = PoolMedianReferenceSampler(vm.envAddress("REFERENCE_FEED"));
        ThetaShieldCircleProcessor processor = ThetaShieldCircleProcessor(vm.envAddress("THETASHIELD_CIRCLE_PROCESSOR"));
        uint256 initialFunding = vm.envUint("PROCESSOR_REACTIVE_INITIAL_FUNDING_WEI");
        ReactiveLegacyValidation.validateProcessor(
            ReactiveLegacyValidation.ProcessorConfig({
                expectedChainId: vm.envUint("PROCESSOR_CHAIN_ID"),
                callbackProxy: callbackProxy,
                sampler: address(sampler),
                processor: address(processor),
                deployer: deployer,
                initialExecutorFundingWei: initialFunding
            }),
            block.chainid
        );

        bytes32[] memory sources = new bytes32[](3);
        sources[0] = ThetaShieldReferenceMarket.SOURCE_ID_0;
        sources[1] = ThetaShieldReferenceMarket.SOURCE_ID_1;
        sources[2] = ThetaShieldReferenceMarket.SOURCE_ID_2;

        vm.startBroadcast(deployer);
        ThetaShieldAutomationExecutor executor =
            new ThetaShieldAutomationExecutor{value: initialFunding}(callbackProxy, sampler, processor, sources);
        vm.stopBroadcast();

        emit AutomationExecutorDeployed(
            address(executor),
            address(sampler),
            address(processor),
            callbackProxy,
            executor.reactiveRvmId(),
            initialFunding,
            sources[0],
            sources[1],
            sources[2]
        );
    }
}
