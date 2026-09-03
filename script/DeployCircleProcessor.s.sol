// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ThetaShieldCircleProcessor} from "../src/circle/ThetaShieldCircleProcessor.sol";
import {DeploymentValidation} from "../src/deployment/DeploymentValidation.sol";
import {ReactiveLegacyValidation} from "../src/deployment/ReactiveLegacyValidation.sol";
import {ThetaShieldTestToken} from "../src/demo/ThetaShieldTestToken.sol";
import {MockNormalizedReferencePriceFeed} from "../src/feeds/MockNormalizedReferencePriceFeed.sol";
import {PoolMedianReferenceSampler} from "../src/feeds/PoolMedianReferenceSampler.sol";
import {INormalizedReferencePriceFeed} from "../src/interfaces/INormalizedReferencePriceFeed.sol";
import {ThetaShieldLens} from "../src/lens/ThetaShieldLens.sol";
import {ThetaShieldAutomationExecutor} from "../src/reactive/ThetaShieldAutomationExecutor.sol";
import {ThetaShieldProfiles} from "./profiles/ThetaShieldProfiles.sol";
import {ThetaShieldReferenceMarket} from "./profiles/ThetaShieldReferenceMarket.sol";

interface IReferenceRouterWithManager {
    function manager() external view returns (IPoolManager);
}

/// @title DeployCircleProcessor
/// @notice Deploys the Ethereum Sepolia reference sampler/feed and Circle processor.
contract DeployCircleProcessor is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    struct ReferenceDeployment {
        PoolMedianReferenceSampler sampler;
        address token0;
        address token1;
        PoolId[3] poolIds;
        bytes32[] sources;
    }

    error InitialOwnerMustBeDeployer(address owner, address deployer);
    error ApprovalFailed(address token, address spender);
    error InvalidReferenceLiquidity(uint256 initialLiquidity, uint256 minimumLiquidity);
    error ReferenceRouterManagerMismatch(address router, address suppliedManager, address routerManager);
    error ReferencePoolLiquidityMismatch(bytes32 poolId, uint128 actual, uint128 expected);

    event ReferenceMarketDeploymentComplete(
        address indexed token0,
        address indexed token1,
        address indexed poolManager,
        address modifyLiquidityRouter,
        bytes32 poolId0,
        bytes32 poolId1,
        bytes32 poolId2,
        bytes32 marketId,
        uint128 initialLiquidity,
        uint128 minimumLiquidity
    );

    event CircleProcessorDeploymentComplete(
        address indexed processor,
        address indexed referenceFeed,
        address indexed automationExecutor,
        address processorLens,
        address referenceToken0,
        address referenceToken1,
        bytes32 protectedPoolId,
        bytes32 marketId,
        bytes32 preflightFingerprint,
        bytes32 profileId,
        uint256 executorFundingWei
    );

    function run() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address owner = vm.envAddress("THETASHIELD_OWNER");
        ThetaShieldProfiles.Profile memory profile = _selectedProfile();
        if (owner != deployer) revert InitialOwnerMustBeDeployer(owner, deployer);

        bool researchProfile = profile.id == ThetaShieldProfiles.researchV1().id;
        INormalizedReferencePriceFeed feed;
        bytes32[] memory sources;
        ReferenceDeployment memory referenceDeployment;
        if (researchProfile) {
            referenceDeployment = _deployReferenceMarket(deployer);
            feed = referenceDeployment.sampler;
            sources = referenceDeployment.sources;
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
            marketId: researchProfile ? ThetaShieldReferenceMarket.MARKET_ID : vm.envBytes32("REFERENCE_MARKET_ID")
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
        uint256 executorFunding = researchProfile ? vm.envUint("PROCESSOR_REACTIVE_INITIAL_FUNDING_WEI") : 0;
        vm.startBroadcast(deployer);
        ThetaShieldCircleProcessor processor =
            new ThetaShieldCircleProcessor(network, _tokenConfig(), profile.scheduler, profile.feeCurve, sources);
        ThetaShieldLens lens = new ThetaShieldLens();
        ThetaShieldAutomationExecutor executor;
        if (researchProfile) {
            address callbackProxy = vm.envAddress("PROCESSOR_REACTIVE_CALLBACK_PROXY");
            ReactiveLegacyValidation.validateProcessor(
                ReactiveLegacyValidation.ProcessorConfig({
                    expectedChainId: vm.envUint("PROCESSOR_CHAIN_ID"),
                    callbackProxy: callbackProxy,
                    sampler: address(referenceDeployment.sampler),
                    processor: address(processor),
                    deployer: deployer,
                    initialExecutorFundingWei: executorFunding
                }),
                block.chainid
            );
            executor = new ThetaShieldAutomationExecutor{value: executorFunding}(
                callbackProxy, referenceDeployment.sampler, processor, sources
            );
        }
        vm.stopBroadcast();

        emit CircleProcessorDeploymentComplete(
            address(processor),
            address(feed),
            address(executor),
            address(lens),
            referenceDeployment.token0,
            referenceDeployment.token1,
            network.poolId,
            network.marketId,
            fingerprint,
            profile.id,
            executorFunding
        );
    }

    function _deployReferenceMarket(address deployer) private returns (ReferenceDeployment memory deployment) {
        IPoolManager poolManager = IPoolManager(ThetaShieldReferenceMarket.ETHEREUM_SEPOLIA_POOL_MANAGER);
        address modifyLiquidityRouter = ThetaShieldReferenceMarket.ETHEREUM_SEPOLIA_MODIFY_LIQUIDITY_ROUTER;
        _validateReferenceInfrastructure(poolManager, modifyLiquidityRouter);

        uint256 suppliedLiquidity = vm.envOr("REFERENCE_INITIAL_LIQUIDITY", uint256(1e18));
        uint256 suppliedMinimum = vm.envOr("REFERENCE_MINIMUM_LIQUIDITY", uint256(1e17));
        if (
            suppliedLiquidity == 0 || suppliedLiquidity > uint256(uint128(type(int128).max)) || suppliedMinimum == 0
                || suppliedMinimum > suppliedLiquidity
        ) revert InvalidReferenceLiquidity(suppliedLiquidity, suppliedMinimum);
        // The bounds above prove these conversions are exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 initialLiquidity = uint128(suppliedLiquidity);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 minimumLiquidity = uint128(suppliedMinimum);
        uint256 tokenSupply = vm.envOr("REFERENCE_TEST_TOKEN_SUPPLY_WEI", uint256(100e18));

        vm.startBroadcast(deployer);
        ThetaShieldTestToken firstToken =
            new ThetaShieldTestToken("ThetaShield Reference Alpha", "tsrALPHA", deployer, tokenSupply);
        ThetaShieldTestToken secondToken =
            new ThetaShieldTestToken("ThetaShield Reference Beta", "tsrBETA", deployer, tokenSupply);
        (ThetaShieldTestToken token0, ThetaShieldTestToken token1) =
            address(firstToken) < address(secondToken) ? (firstToken, secondToken) : (secondToken, firstToken);
        deployment.token0 = address(token0);
        deployment.token1 = address(token1);
        _approve(token0, modifyLiquidityRouter);
        _approve(token1, modifyLiquidityRouter);

        for (uint256 index; index < deployment.poolIds.length; ++index) {
            PoolKey memory key = ThetaShieldReferenceMarket.poolKey(address(token0), address(token1), index);
            deployment.poolIds[index] = key.toId();
            poolManager.initialize(key, ThetaShieldReferenceMarket.SQRT_PRICE_1_1);
            PoolModifyLiquidityTest(modifyLiquidityRouter)
                .modifyLiquidity(
                    key,
                    IPoolManager.ModifyLiquidityParams({
                    tickLower: ThetaShieldReferenceMarket.TICK_LOWER,
                    tickUpper: ThetaShieldReferenceMarket.TICK_UPPER,
                    liquidityDelta: int256(uint256(initialLiquidity)),
                    salt: bytes32(0)
                }),
                    bytes("")
                );
        }

        PoolMedianReferenceSampler.PoolConfig[] memory poolConfigs =
            _researchPoolConfigs(deployment.poolIds, minimumLiquidity);
        deployment.sources = _researchSources(poolConfigs);
        deployment.sampler =
            new PoolMedianReferenceSampler(poolManager, ThetaShieldReferenceMarket.MARKET_ID, poolConfigs);
        vm.stopBroadcast();

        for (uint256 index; index < deployment.poolIds.length; ++index) {
            uint128 actualLiquidity = poolManager.getLiquidity(deployment.poolIds[index]);
            if (actualLiquidity < initialLiquidity) {
                revert ReferencePoolLiquidityMismatch(
                    PoolId.unwrap(deployment.poolIds[index]), actualLiquidity, initialLiquidity
                );
            }
        }
        emit ReferenceMarketDeploymentComplete(
            deployment.token0,
            deployment.token1,
            address(poolManager),
            modifyLiquidityRouter,
            PoolId.unwrap(deployment.poolIds[0]),
            PoolId.unwrap(deployment.poolIds[1]),
            PoolId.unwrap(deployment.poolIds[2]),
            ThetaShieldReferenceMarket.MARKET_ID,
            initialLiquidity,
            minimumLiquidity
        );
    }

    function _researchPoolConfigs(PoolId[3] memory poolIds, uint128 minimumLiquidity)
        private
        pure
        returns (PoolMedianReferenceSampler.PoolConfig[] memory configs)
    {
        configs = new PoolMedianReferenceSampler.PoolConfig[](3);
        for (uint256 index; index < configs.length; ++index) {
            configs[index] = PoolMedianReferenceSampler.PoolConfig({
                poolId: poolIds[index],
                sourceId: ThetaShieldReferenceMarket.sourceId(index),
                minimumLiquidity: minimumLiquidity,
                token0Decimals: 18,
                token1Decimals: 18,
                baseIsToken0: true
            });
        }
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

    function _validateReferenceInfrastructure(IPoolManager poolManager, address modifyLiquidityRouter) private view {
        DeploymentValidation.requireCode(address(poolManager));
        DeploymentValidation.requireCode(modifyLiquidityRouter);
        address routerManager = address(IReferenceRouterWithManager(modifyLiquidityRouter).manager());
        if (routerManager != address(poolManager)) {
            revert ReferenceRouterManagerMismatch(modifyLiquidityRouter, address(poolManager), routerManager);
        }
    }

    function _approve(ThetaShieldTestToken token, address spender) private {
        if (!token.approve(spender, type(uint256).max)) revert ApprovalFailed(address(token), spender);
    }

    function _addressToBytes32(address account) private pure returns (bytes32) {
        return bytes32(uint256(uint160(account)));
    }
}
