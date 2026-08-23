// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {DeploymentValidation} from "../src/deployment/DeploymentValidation.sol";
import {MockNormalizedReferencePriceFeed} from "../src/feeds/MockNormalizedReferencePriceFeed.sol";

/// @title Phase8Acceptance
/// @notice Separate bounded acceptance actions so every paid transaction can be simulated and approved.
contract Phase8Acceptance is Script {
    using PoolIdLibrary for PoolKey;

    error PoolIdMismatch(bytes32 supplied, bytes32 computed);
    error InvalidSwapAmount(int256 supplied);
    error TimestampOverflow(uint256 supplied);

    event AcceptanceSwapSubmitted(bytes32 indexed poolId, bool indexed zeroForOne, int256 amountSpecified);
    event AcceptanceReferencePublished(
        bytes32 indexed marketId, bytes32 indexed sourceId, uint256 priceWad, uint256 confidenceWad, uint64 observedAt
    );

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

        bytes32 marketId = vm.envBytes32("REFERENCE_MARKET_ID");
        bytes32 sourceId = vm.envBytes32("REFERENCE_SOURCE_ID");
        uint256 priceWad = vm.envUint("ACCEPTANCE_REFERENCE_PRICE_WAD");
        uint256 confidenceWad = vm.envUint("ACCEPTANCE_REFERENCE_CONFIDENCE_WAD");
        // The explicit bound above proves this conversion is exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 observedAt = uint64(timestamp);

        vm.startBroadcast(deployer);
        feed.publish(marketId, sourceId, priceWad, confidenceWad, observedAt);
        vm.stopBroadcast();

        emit AcceptanceReferencePublished(marketId, sourceId, priceWad, confidenceWad, observedAt);
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
