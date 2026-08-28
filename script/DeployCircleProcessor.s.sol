// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ThetaShieldCircleProcessor} from "../src/circle/ThetaShieldCircleProcessor.sol";
import {DeploymentValidation} from "../src/deployment/DeploymentValidation.sol";
import {MockNormalizedReferencePriceFeed} from "../src/feeds/MockNormalizedReferencePriceFeed.sol";
import {ThetaShieldProfiles} from "./profiles/ThetaShieldProfiles.sol";

/// @title DeployCircleProcessor
/// @notice Deploys the Ethereum Sepolia reference feed and Circle processor.
contract DeployCircleProcessor is Script {
    error InitialOwnerMustBeDeployer(address owner, address deployer);

    event CircleProcessorDeploymentComplete(
        address indexed processor,
        address indexed referenceFeed,
        bytes32 indexed poolId,
        bytes32 marketId,
        bytes32 preflightFingerprint,
        bytes32 profileId
    );

    function run() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address owner = vm.envAddress("THETASHIELD_OWNER");
        ThetaShieldProfiles.Profile memory profile = _selectedProfile();
        if (owner != deployer) revert InitialOwnerMustBeDeployer(owner, deployer);

        vm.startBroadcast(deployer);
        MockNormalizedReferencePriceFeed feed = new MockNormalizedReferencePriceFeed(owner);
        vm.stopBroadcast();

        ThetaShieldCircleProcessor.NetworkConfig memory network = ThetaShieldCircleProcessor.NetworkConfig({
            messageTransmitter: vm.envAddress("PROCESSOR_CIRCLE_MESSAGE_TRANSMITTER"),
            originDomain: _uint32Env("ORIGIN_CIRCLE_DOMAIN"),
            originTransport: _addressToBytes32(vm.envAddress("THETASHIELD_CIRCLE_TRANSPORT")),
            referenceFeed: address(feed),
            controllerDomain: _uint32Env("ORIGIN_CIRCLE_DOMAIN"),
            controller: _addressToBytes32(vm.envAddress("THETASHIELD_CONTROLLER")),
            poolId: vm.envBytes32("THETASHIELD_POOL_ID"),
            marketId: vm.envBytes32("REFERENCE_MARKET_ID")
        });
        bytes32 fingerprint = DeploymentValidation.validateProcessor(
            DeploymentValidation.ProcessorConfig({
                expectedChainId: vm.envUint("PROCESSOR_CHAIN_ID"),
                expectedCircleDomain: _uint32Env("PROCESSOR_CIRCLE_DOMAIN"),
                messageTransmitter: network.messageTransmitter,
                expectedMessageTransmitter: vm.envAddress("PROCESSOR_EXPECTED_CIRCLE_MESSAGE_TRANSMITTER"),
                referenceFeed: network.referenceFeed,
                originDomain: network.originDomain,
                originTransport: network.originTransport,
                controllerDomain: network.controllerDomain,
                controller: network.controller,
                poolId: network.poolId,
                marketId: network.marketId
            }),
            block.chainid
        );
        bytes32[] memory sources = new bytes32[](1);
        sources[0] = vm.envBytes32("REFERENCE_SOURCE_ID");

        vm.startBroadcast(deployer);
        ThetaShieldCircleProcessor processor =
            new ThetaShieldCircleProcessor(network, _tokenConfig(), profile.scheduler, profile.feeCurve, sources);
        vm.stopBroadcast();

        emit CircleProcessorDeploymentComplete(
            address(processor), address(feed), network.poolId, network.marketId, fingerprint, profile.id
        );
    }

    function _tokenConfig() private pure returns (ThetaShieldCircleProcessor.TokenConfig memory) {
        return ThetaShieldCircleProcessor.TokenConfig({token0Decimals: 18, token1Decimals: 18, baseIsToken0: true});
    }

    function _selectedProfile() private view returns (ThetaShieldProfiles.Profile memory profile) {
        string memory name = vm.envOr("THETASHIELD_PROFILE", string("RESEARCH_V1"));
        profile = ThetaShieldProfiles.resolve(name);
        if (profile.id == ThetaShieldProfiles.demoV1().id) {
            console2.log("WARNING: DEMO_V1 disables the researched filtering and persistence defaults");
        }
    }

    function _uint32Env(string memory name) private view returns (uint32 value) {
        uint256 supplied = vm.envUint(name);
        require(supplied <= type(uint32).max, "Circle domain does not fit uint32");
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint32(supplied);
    }

    function _addressToBytes32(address account) private pure returns (bytes32) {
        return bytes32(uint256(uint160(account)));
    }
}
