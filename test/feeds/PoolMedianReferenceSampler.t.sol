// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ThetaShieldCircleProcessor} from "../../src/circle/ThetaShieldCircleProcessor.sol";
import {PoolMedianReferenceSampler} from "../../src/feeds/PoolMedianReferenceSampler.sol";
import {INormalizedReferencePriceFeed} from "../../src/interfaces/INormalizedReferencePriceFeed.sol";
import {FeeCurve} from "../../src/libraries/FeeCurve.sol";
import {MockMessageTransmitterV2} from "../mocks/MockMessageTransmitterV2.sol";

contract MockV4PoolStateReader {
    bytes32 private constant POOLS_SLOT = bytes32(uint256(6));
    mapping(bytes32 slot => bytes32 value) private _state;

    function setPool(PoolId poolId, uint160 sqrtPriceX96, uint128 liquidity) external {
        bytes32 stateSlot = keccak256(abi.encodePacked(PoolId.unwrap(poolId), POOLS_SLOT));
        _state[stateSlot] = bytes32(uint256(sqrtPriceX96));
        _state[bytes32(uint256(stateSlot) + 3)] = bytes32(uint256(liquidity));
    }

    function extsload(bytes32 slot) external view returns (bytes32) {
        return _state[slot];
    }
}

contract PoolMedianReferenceSamplerTest is Test {
    bytes32 private constant MARKET_ID = keccak256("ETH/USD");
    uint160 private constant SQRT_PRICE_1_1 = uint160(1 << 96);

    MockV4PoolStateReader private manager;
    PoolMedianReferenceSampler private sampler;
    PoolId[3] private poolIds;
    bytes32[3] private sourceIds;

    function setUp() public {
        vm.warp(1_800_000_000);
        manager = new MockV4PoolStateReader();
        for (uint256 index; index < 3; ++index) {
            poolIds[index] = PoolId.wrap(keccak256(abi.encode("pool", index)));
            sourceIds[index] = keccak256(abi.encode("source", index));
        }
        manager.setPool(poolIds[0], SQRT_PRICE_1_1, 1_000);
        manager.setPool(poolIds[1], SQRT_PRICE_1_1, 2_000);
        manager.setPool(poolIds[2], SQRT_PRICE_1_1, 99);
        sampler = new PoolMedianReferenceSampler(IPoolManager(address(manager)), MARKET_ID, _configs(100, 18, 18, true));
    }

    function test_permissionlessSamplePublishesDistinctEligibleSources() external {
        vm.prank(address(0xB0B));
        assertEq(sampler.sample(), 2);

        for (uint256 index; index < 2; ++index) {
            INormalizedReferencePriceFeed.Reading memory reading = sampler.latestReading(MARKET_ID, sourceIds[index]);
            assertEq(reading.sequence, 1);
            assertEq(reading.priceWad, 1e18);
            assertEq(reading.confidenceWad, 1e18);
            assertEq(reading.observedAt, block.timestamp);
        }
        assertEq(sampler.latestReading(MARKET_ID, sourceIds[2]).sequence, 0);

        manager.setPool(poolIds[2], SQRT_PRICE_1_1, 100);
        vm.warp(block.timestamp + 1);
        assertEq(sampler.sample(), 3);
        assertEq(sampler.latestReading(MARKET_ID, sourceIds[0]).sequence, 2);
        assertEq(sampler.latestReading(MARKET_ID, sourceIds[2]).sequence, 1);
    }

    function test_normalizesTokenDecimalsAndBaseOrientation() external {
        PoolMedianReferenceSampler token0Base = new PoolMedianReferenceSampler(
            IPoolManager(address(manager)), keccak256("TOKEN0/QUOTE"), _configs(1, 18, 6, true)
        );
        assertEq(token0Base.sample(), 3);
        assertEq(token0Base.latestReading(keccak256("TOKEN0/QUOTE"), sourceIds[0]).priceWad, 1e30);

        PoolMedianReferenceSampler token1Base = new PoolMedianReferenceSampler(
            IPoolManager(address(manager)), keccak256("TOKEN1/QUOTE"), _configs(1, 18, 18, false)
        );
        assertEq(token1Base.sample(), 3);
        assertEq(token1Base.latestReading(keccak256("TOKEN1/QUOTE"), sourceIds[0]).priceWad, 1e18);
    }

    function test_constructorRejectsDuplicatePoolsAndSources() external {
        PoolMedianReferenceSampler.PoolConfig[] memory configs = _configs(100, 18, 18, true);
        configs[1].sourceId = configs[0].sourceId;
        vm.expectRevert(abi.encodeWithSelector(PoolMedianReferenceSampler.DuplicateSource.selector, sourceIds[0]));
        new PoolMedianReferenceSampler(IPoolManager(address(manager)), MARKET_ID, configs);

        configs = _configs(100, 18, 18, true);
        configs[1].poolId = configs[0].poolId;
        vm.expectRevert(abi.encodeWithSelector(PoolMedianReferenceSampler.DuplicatePool.selector, poolIds[0]));
        new PoolMedianReferenceSampler(IPoolManager(address(manager)), MARKET_ID, configs);

        configs = _configs(100, 18, 18, true);
        configs[1].token1Decimals = 6;
        vm.expectRevert(
            abi.encodeWithSelector(PoolMedianReferenceSampler.InconsistentMarketConfiguration.selector, uint256(1))
        );
        new PoolMedianReferenceSampler(IPoolManager(address(manager)), MARKET_ID, configs);
    }

    function test_processorConsumesAllThreeSamplerSourcesWithoutAdapterChanges() external {
        manager.setPool(poolIds[2], SQRT_PRICE_1_1, 1_000);
        assertEq(sampler.sample(), 3);

        MockMessageTransmitterV2 transmitter = new MockMessageTransmitterV2();
        bytes32[] memory sources = _sourceArray();
        ThetaShieldCircleProcessor processor = new ThetaShieldCircleProcessor(
            ThetaShieldCircleProcessor.NetworkConfig({
                messageTransmitter: address(transmitter),
                originDomain: 10,
                originTransport: bytes32(uint256(uint160(address(0xA11CE)))),
                referenceFeed: address(sampler),
                controllerDomain: 10,
                controller: bytes32(uint256(uint160(address(0xC0FFEE)))),
                poolId: keccak256("protected-pool"),
                marketId: MARKET_ID
            }),
            ThetaShieldCircleProcessor.TokenConfig({token0Decimals: 18, token1Decimals: 18, baseIsToken0: true}),
            _schedulerConfig(),
            _feeCurveConfig(),
            sources
        );

        for (uint256 index; index < sources.length; ++index) {
            assertTrue(processor.syncReference(sources[index]));
            assertEq(processor.latestReferenceSequence(sources[index]), 1);
            (uint8 count,) = processor.referenceHistoryState(sources[index]);
            assertEq(count, 1);
        }
    }

    function _configs(uint128 minimumLiquidity, uint8 token0Decimals, uint8 token1Decimals, bool baseIsToken0)
        private
        view
        returns (PoolMedianReferenceSampler.PoolConfig[] memory configs)
    {
        configs = new PoolMedianReferenceSampler.PoolConfig[](3);
        for (uint256 index; index < configs.length; ++index) {
            configs[index] = PoolMedianReferenceSampler.PoolConfig({
                poolId: poolIds[index],
                sourceId: sourceIds[index],
                minimumLiquidity: minimumLiquidity,
                token0Decimals: token0Decimals,
                token1Decimals: token1Decimals,
                baseIsToken0: baseIsToken0
            });
        }
    }

    function _sourceArray() private view returns (bytes32[] memory sources) {
        sources = new bytes32[](3);
        for (uint256 index; index < sources.length; ++index) {
            sources[index] = sourceIds[index];
        }
    }

    function _schedulerConfig() private pure returns (ThetaShieldCircleProcessor.SchedulerConfig memory) {
        return ThetaShieldCircleProcessor.SchedulerConfig({
            markoutHorizon: 10,
            observationLifetime: 3_600,
            referenceSelectionWindow: 1_800,
            epochDuration: 10,
            recommendationLifetime: 600,
            callbackClockSkew: 30,
            maximumEventFutureSkew: 5,
            maximumPendingObservations: 8,
            maximumProcessPerCall: 8,
            maximumEpochObservations: 8,
            trailingWindow: 4,
            minimumTrailingObservations: 1,
            targetObservationCount: 1,
            requiredToxicEpochs: 1,
            persistenceWindow: 1,
            fastPathHoldEpochs: 0,
            maximumReferenceSamplesPerSource: 4,
            minimumReferenceSources: 3,
            fastPathEnabled: true,
            minimumObservationNotionalWad: 1,
            maximumTradeNotionalWad: 100e18,
            minimumEpochNotionalWad: 1,
            coldStartSigmaWad: 0,
            deadBandKWad: 0,
            maximumDispersionWad: 1e18,
            confidenceCapWad: 1e18,
            toxicThresholdWad: 1,
            alphaWad: 1e18,
            fastPathConfidenceFloorWad: 1e18,
            fastPathToxicThresholdWad: 1
        });
    }

    function _feeCurveConfig() private pure returns (FeeCurve.Config memory) {
        return FeeCurve.Config({
            baseFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            gainFeePips: 1_000_000,
            coverageGainFeePips: 50,
            maximumIncreasePips: 9_500,
            maximumDecreasePips: 9_500,
            confidenceFloorWad: 5e17,
            targetCoverageWad: 1.25e18,
            minimumEstimatedLossWad: 0.001e18
        });
    }
}
