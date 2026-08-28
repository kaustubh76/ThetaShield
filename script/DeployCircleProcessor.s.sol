// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ThetaShieldCircleProcessor} from "../src/circle/ThetaShieldCircleProcessor.sol";
import {DeploymentValidation} from "../src/deployment/DeploymentValidation.sol";
import {MockNormalizedReferencePriceFeed} from "../src/feeds/MockNormalizedReferencePriceFeed.sol";
import {PoolMedianReferenceSampler} from "../src/feeds/PoolMedianReferenceSampler.sol";
import {INormalizedReferencePriceFeed} from "../src/interfaces/INormalizedReferencePriceFeed.sol";
import {ThetaShieldProfiles} from "./profiles/ThetaShieldProfiles.sol";

/// @title DeployCircleProcessor
/// @notice Deploys the Ethereum Sepolia reference sampler/feed and Circle processor.
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

        bool researchProfile = profile.id == ThetaShieldProfiles.researchV1().id;
        INormalizedReferencePriceFeed feed;
        bytes32[] memory sources;
        if (researchProfile) {
            PoolMedianReferenceSampler.PoolConfig[] memory poolConfigs = _researchPoolConfigs();
            sources = _researchSources(poolConfigs);
            vm.startBroadcast(deployer);
            feed = new PoolMedianReferenceSampler(
                IPoolManager(vm.envAddress("REFERENCE_POOL_MANAGER")), vm.envBytes32("REFERENCE_MARKET_ID"), poolConfigs
            );
            vm.stopBroadcast();
        } else {
            sources = new bytes32[](1);
            sources[0] = vm.envBytes32("REFERENCE_SOURCE_ID");
            vm.startBroadcast(deployer);
            feed = new MockNormalizedReferencePriceFeed(owner);
            vm.stopBroadcast();
        }

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
        vm.startBroadcast(deployer);
        ThetaShieldCircleProcessor processor =
            new ThetaShieldCircleProcessor(network, _tokenConfig(), profile.scheduler, profile.feeCurve, sources);
        vm.stopBroadcast();

        emit CircleProcessorDeploymentComplete(
            address(processor), address(feed), network.poolId, network.marketId, fingerprint, profile.id
        );
    }

    function _researchPoolConfigs() private view returns (PoolMedianReferenceSampler.PoolConfig[] memory configs) {
        configs = new PoolMedianReferenceSampler.PoolConfig[](3);
        uint8 token0Decimals = _uint8Env("REFERENCE_TOKEN0_DECIMALS");
        uint8 token1Decimals = _uint8Env("REFERENCE_TOKEN1_DECIMALS");
        bool baseIsToken0 = vm.envBool("REFERENCE_BASE_IS_TOKEN0");
        configs[0] = PoolMedianReferenceSampler.PoolConfig({
            poolId: PoolId.wrap(vm.envBytes32("REFERENCE_POOL_ID_0")),
            sourceId: vm.envBytes32("REFERENCE_SOURCE_ID_0"),
            minimumLiquidity: _uint128Env("REFERENCE_MINIMUM_LIQUIDITY_0"),
            token0Decimals: token0Decimals,
            token1Decimals: token1Decimals,
            baseIsToken0: baseIsToken0
        });
        configs[1] = PoolMedianReferenceSampler.PoolConfig({
            poolId: PoolId.wrap(vm.envBytes32("REFERENCE_POOL_ID_1")),
            sourceId: vm.envBytes32("REFERENCE_SOURCE_ID_1"),
            minimumLiquidity: _uint128Env("REFERENCE_MINIMUM_LIQUIDITY_1"),
            token0Decimals: token0Decimals,
            token1Decimals: token1Decimals,
            baseIsToken0: baseIsToken0
        });
        configs[2] = PoolMedianReferenceSampler.PoolConfig({
            poolId: PoolId.wrap(vm.envBytes32("REFERENCE_POOL_ID_2")),
            sourceId: vm.envBytes32("REFERENCE_SOURCE_ID_2"),
            minimumLiquidity: _uint128Env("REFERENCE_MINIMUM_LIQUIDITY_2"),
            token0Decimals: token0Decimals,
            token1Decimals: token1Decimals,
            baseIsToken0: baseIsToken0
        });
    }

    function _researchSources(PoolMedianReferenceSampler.PoolConfig[] memory configs)
        private
        pure
        returns (bytes32[] memory sources)
    {
        sources = new bytes32[](configs.length);
        for (uint256 index; index < configs.length; ++index) {
            sources[index] = configs[index].sourceId;
        }
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

    function _uint128Env(string memory name) private view returns (uint128 value) {
        uint256 supplied = vm.envUint(name);
        require(supplied <= type(uint128).max, "value does not fit uint128");
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint128(supplied);
    }

    function _uint8Env(string memory name) private view returns (uint8 value) {
        uint256 supplied = vm.envUint(name);
        require(supplied <= type(uint8).max, "value does not fit uint8");
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint8(supplied);
    }

    function _addressToBytes32(address account) private pure returns (bytes32) {
        return bytes32(uint256(uint160(account)));
    }
}
