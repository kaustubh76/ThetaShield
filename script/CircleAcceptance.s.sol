// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ThetaShieldCircleProcessor} from "../src/circle/ThetaShieldCircleProcessor.sol";
import {DeploymentValidation} from "../src/deployment/DeploymentValidation.sol";
import {MockNormalizedReferencePriceFeed} from "../src/feeds/MockNormalizedReferencePriceFeed.sol";
import {PoolMedianReferenceSampler} from "../src/feeds/PoolMedianReferenceSampler.sol";

/// @title CircleAcceptance
/// @notice Separate bounded actions so every paid transaction can be simulated and approved.
contract CircleAcceptance is Script {
    using PoolIdLibrary for PoolKey;

    error PoolIdMismatch(bytes32 supplied, bytes32 computed);
    error InvalidSwapAmount(int256 supplied);
    error TimestampOverflow(uint256 supplied);

    event AcceptanceSwapSubmitted(bytes32 indexed poolId, bool indexed zeroForOne, int256 amountSpecified);
    event AcceptanceReferencePublished(
        bytes32 indexed marketId, bytes32 indexed sourceId, uint256 priceWad, uint256 confidenceWad, uint64 observedAt
    );
    event AcceptancePoolsSampled(address indexed sampler, uint8 publishedCount);
    event AcceptanceProcessorAdvanced(address indexed processor, bool recommendationDispatched);

    function runSwap() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address swapRouter = vm.envAddress("ORIGIN_SWAP_ROUTER");
        DeploymentValidation.requireCode(swapRouter);
        PoolKey memory key = _poolKey();
        bytes32 computedPoolId = PoolId.unwrap(key.toId());
        bytes32 suppliedPoolId = vm.envBytes32("THETASHIELD_POOL_ID");
        if (computedPoolId != suppliedPoolId) revert PoolIdMismatch(suppliedPoolId, computedPoolId);

        int256 amountSpecified = vm.envInt("ACCEPTANCE_SWAP_AMOUNT");
        if (amountSpecified >= 0) revert InvalidSwapAmount(amountSpecified);
        bool zeroForOne = vm.envBool("ACCEPTANCE_ZERO_FOR_ONE");
        uint160 sqrtPriceLimit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        vm.startBroadcast(deployer);
        PoolSwapTest(swapRouter)
            .swap(
                key,
                IPoolManager.SwapParams({
                zeroForOne: zeroForOne, amountSpecified: amountSpecified, sqrtPriceLimitX96: sqrtPriceLimit
            }),
                PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
                bytes("")
            );
        vm.stopBroadcast();
        emit AcceptanceSwapSubmitted(suppliedPoolId, zeroForOne, amountSpecified);
    }

    function runReference() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        MockNormalizedReferencePriceFeed feed = MockNormalizedReferencePriceFeed(vm.envAddress("REFERENCE_FEED"));
        DeploymentValidation.requireCode(address(feed));
        uint256 timestamp = block.timestamp;
        if (timestamp > type(uint64).max) revert TimestampOverflow(timestamp);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 observedAt = uint64(timestamp);
        bytes32 marketId = vm.envBytes32("REFERENCE_MARKET_ID");
        bytes32 sourceId = vm.envBytes32("REFERENCE_SOURCE_ID");
        uint256 priceWad = vm.envUint("ACCEPTANCE_REFERENCE_PRICE_WAD");
        uint256 confidenceWad = vm.envUint("ACCEPTANCE_REFERENCE_CONFIDENCE_WAD");
        vm.startBroadcast(deployer);
        feed.publish(marketId, sourceId, priceWad, confidenceWad, observedAt);
        vm.stopBroadcast();
        emit AcceptanceReferencePublished(marketId, sourceId, priceWad, confidenceWad, observedAt);
    }

    /// @notice Permissionlessly samples the configured RESEARCH_V1 v4 reference pools.
    function runSampleReferences() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        PoolMedianReferenceSampler sampler = PoolMedianReferenceSampler(vm.envAddress("REFERENCE_FEED"));
        DeploymentValidation.requireCode(address(sampler));
        vm.startBroadcast(deployer);
        uint8 publishedCount = sampler.sample();
        vm.stopBroadcast();
        emit AcceptancePoolsSampled(address(sampler), publishedCount);
    }

    function runProcess() external {
        bytes32[] memory sources = new bytes32[](1);
        sources[0] = vm.envBytes32("REFERENCE_SOURCE_ID");
        _runProcess(sources);
    }

    /// @notice Syncs all three RESEARCH_V1 sources before advancing bounded processing.
    function runProcessResearch() external {
        bytes32[] memory sources = new bytes32[](3);
        sources[0] = vm.envBytes32("REFERENCE_SOURCE_ID_0");
        sources[1] = vm.envBytes32("REFERENCE_SOURCE_ID_1");
        sources[2] = vm.envBytes32("REFERENCE_SOURCE_ID_2");
        _runProcess(sources);
    }

    function _runProcess(bytes32[] memory sources) private {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        ThetaShieldCircleProcessor processor = ThetaShieldCircleProcessor(vm.envAddress("THETASHIELD_CIRCLE_PROCESSOR"));
        DeploymentValidation.requireCode(address(processor));
        vm.startBroadcast(deployer);
        for (uint256 index; index < sources.length; ++index) {
            processor.syncReference(sources[index]);
        }
        bool recommendationDispatched = processor.process();
        vm.stopBroadcast();
        emit AcceptanceProcessorAdvanced(address(processor), recommendationDispatched);
    }

    function _poolKey() private view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(vm.envAddress("DEMO_TOKEN0")),
            currency1: Currency.wrap(vm.envAddress("DEMO_TOKEN1")),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(vm.envAddress("THETASHIELD_HOOK"))
        });
    }
}
