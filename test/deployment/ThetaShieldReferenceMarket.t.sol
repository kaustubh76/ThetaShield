// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ThetaShieldTestToken} from "../../src/demo/ThetaShieldTestToken.sol";
import {PoolMedianReferenceSampler} from "../../src/feeds/PoolMedianReferenceSampler.sol";
import {INormalizedReferencePriceFeed} from "../../src/interfaces/INormalizedReferencePriceFeed.sol";
import {ThetaShieldReferenceMarket} from "../../script/profiles/ThetaShieldReferenceMarket.sol";

contract ThetaShieldReferenceMarketTest is Test {
    using PoolIdLibrary for PoolKey;

    uint128 private constant INITIAL_LIQUIDITY = 1e18;
    uint128 private constant MINIMUM_LIQUIDITY = 1e17;

    IPoolManager private manager;
    PoolModifyLiquidityTest private router;
    ThetaShieldTestToken private token0;
    ThetaShieldTestToken private token1;

    function setUp() public {
        manager = new PoolManager(address(this));
        router = new PoolModifyLiquidityTest(manager);
        ThetaShieldTestToken first = new ThetaShieldTestToken("Reference A", "RA", address(this), 100e18);
        ThetaShieldTestToken second = new ThetaShieldTestToken("Reference B", "RB", address(this), 100e18);
        (token0, token1) = address(first) < address(second) ? (first, second) : (second, first);
        token0.approve(address(router), type(uint256).max);
        token1.approve(address(router), type(uint256).max);
    }

    function test_threeTierMarketSamplesThreeIndependentSources() external {
        PoolMedianReferenceSampler.PoolConfig[] memory configs = new PoolMedianReferenceSampler.PoolConfig[](3);
        bytes32[3] memory observedPoolIds;

        for (uint256 index; index < 3; ++index) {
            PoolKey memory key = ThetaShieldReferenceMarket.poolKey(address(token0), address(token1), index);
            PoolId poolId = key.toId();
            observedPoolIds[index] = PoolId.unwrap(poolId);
            manager.initialize(key, ThetaShieldReferenceMarket.SQRT_PRICE_1_1);
            router.modifyLiquidity(
                key,
                IPoolManager.ModifyLiquidityParams({
                    tickLower: ThetaShieldReferenceMarket.TICK_LOWER,
                    tickUpper: ThetaShieldReferenceMarket.TICK_UPPER,
                    liquidityDelta: int256(uint256(INITIAL_LIQUIDITY)),
                    salt: bytes32(0)
                }),
                bytes("")
            );
            configs[index] = PoolMedianReferenceSampler.PoolConfig({
                poolId: poolId,
                sourceId: ThetaShieldReferenceMarket.sourceId(index),
                minimumLiquidity: MINIMUM_LIQUIDITY,
                token0Decimals: 18,
                token1Decimals: 18,
                baseIsToken0: true
            });
        }

        assertNotEq(observedPoolIds[0], observedPoolIds[1]);
        assertNotEq(observedPoolIds[1], observedPoolIds[2]);
        assertNotEq(observedPoolIds[0], observedPoolIds[2]);

        PoolMedianReferenceSampler sampler =
            new PoolMedianReferenceSampler(manager, ThetaShieldReferenceMarket.MARKET_ID, configs);
        assertEq(sampler.sample(), 3);
        for (uint256 index; index < 3; ++index) {
            INormalizedReferencePriceFeed.Reading memory reading =
                sampler.latestReading(ThetaShieldReferenceMarket.MARKET_ID, ThetaShieldReferenceMarket.sourceId(index));
            assertEq(reading.sequence, 1);
            assertEq(reading.priceWad, 1e18);
            assertEq(reading.confidenceWad, 1e18);
        }
    }

    function test_lockedTierAndSourceConfiguration() external pure {
        assertEq(ThetaShieldReferenceMarket.fee(0), 500);
        assertEq(ThetaShieldReferenceMarket.fee(1), 3_000);
        assertEq(ThetaShieldReferenceMarket.fee(2), 10_000);
        assertEq(ThetaShieldReferenceMarket.tickSpacing(0), 10);
        assertEq(ThetaShieldReferenceMarket.tickSpacing(1), 60);
        assertEq(ThetaShieldReferenceMarket.tickSpacing(2), 200);
        assertNotEq(ThetaShieldReferenceMarket.SOURCE_ID_0, ThetaShieldReferenceMarket.SOURCE_ID_1);
        assertNotEq(ThetaShieldReferenceMarket.SOURCE_ID_1, ThetaShieldReferenceMarket.SOURCE_ID_2);
    }
}
