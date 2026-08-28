// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CircleMessages} from "../../src/circle/CircleMessages.sol";
import {ThetaShieldCircleProcessor} from "../../src/circle/ThetaShieldCircleProcessor.sol";
import {ThetaShieldController} from "../../src/controller/ThetaShieldController.sol";
import {MockNormalizedReferencePriceFeed} from "../../src/feeds/MockNormalizedReferencePriceFeed.sol";
import {IMessageHandlerV2} from "../../src/interfaces/IMessageHandlerV2.sol";
import {FeeCurve} from "../../src/libraries/FeeCurve.sol";
import {ThetaShieldLens} from "../../src/lens/ThetaShieldLens.sol";
import {MockMessageTransmitterV2} from "../mocks/MockMessageTransmitterV2.sol";

contract MockThetaShieldObservationCounter {
    mapping(bytes32 poolId => uint64 count) public observationCount;

    function setObservationCount(bytes32 poolId, uint64 count) external {
        observationCount[poolId] = count;
    }
}

contract ThetaShieldLensTest is Test {
    uint32 private constant ORIGIN_DOMAIN = 10;
    uint32 private constant PROCESSOR_DOMAIN = 0;
    bytes32 private constant ORIGIN_TRANSPORT = bytes32(uint256(uint160(address(0xA11CE))));
    bytes32 private constant POOL_ID = keccak256("lens-pool");
    bytes32 private constant MARKET_ID = keccak256("ETH/USD");
    bytes32 private constant SOURCE_ID = keccak256("lens-source");

    MockMessageTransmitterV2 private originTransmitter;
    MockMessageTransmitterV2 private processorTransmitter;
    MockNormalizedReferencePriceFeed private feed;
    MockThetaShieldObservationCounter private observationCounter;
    ThetaShieldCircleProcessor private processor;
    ThetaShieldController private controller;
    ThetaShieldLens private lens;

    function setUp() public {
        vm.warp(1_800_000_000);
        originTransmitter = new MockMessageTransmitterV2();
        processorTransmitter = new MockMessageTransmitterV2();
        feed = new MockNormalizedReferencePriceFeed(address(this));
        observationCounter = new MockThetaShieldObservationCounter();
        controller = new ThetaShieldController(address(this), originTransmitter);
        lens = new ThetaShieldLens();

        bytes32[] memory sources = new bytes32[](1);
        sources[0] = SOURCE_ID;
        processor = new ThetaShieldCircleProcessor(
            ThetaShieldCircleProcessor.NetworkConfig({
                messageTransmitter: address(processorTransmitter),
                originDomain: ORIGIN_DOMAIN,
                originTransport: ORIGIN_TRANSPORT,
                referenceFeed: address(feed),
                controllerDomain: ORIGIN_DOMAIN,
                controller: _addressToBytes32(address(controller)),
                poolId: POOL_ID,
                marketId: MARKET_ID
            }),
            ThetaShieldCircleProcessor.TokenConfig({token0Decimals: 18, token1Decimals: 18, baseIsToken0: true}),
            _schedulerConfig(),
            _feeCurveConfig(),
            sources
        );

        controller.configureCirclePeer(PROCESSOR_DOMAIN, _addressToBytes32(address(processor)));
        controller.configurePool(POOL_ID, _controllerConfig());
    }

    function test_originSnapshotReportsFeeValidityPausesAndObservationCount() external {
        observationCounter.setObservationCount(POOL_ID, 42);
        ThetaShieldLens.OriginPoolSnapshot memory initial =
            lens.originPoolState(address(controller), address(observationCounter), POOL_ID);

        assertEq(initial.zeroForOneFeePips, 500);
        assertEq(initial.oneForZeroFeePips, 500);
        assertTrue(initial.zeroForOneUsedBaseline);
        assertTrue(initial.oneForZeroUsedBaseline);
        assertEq(initial.observationCount, 42);
        assertEq(initial.baselineFeePips, 500);
        assertTrue(initial.configured);

        CircleMessages.Recommendation memory recommendation = CircleMessages.Recommendation({
            poolId: POOL_ID,
            zeroForOneFee: 750,
            oneForZeroFee: 500,
            zeroForOneRiskWad: 1e15,
            oneForZeroRiskWad: 0,
            confidenceBps: 6_000,
            validAfter: uint64(block.timestamp - 1),
            validUntil: uint64(block.timestamp + 599),
            sequence: 1
        });
        originTransmitter.deliverFinalized(
            IMessageHandlerV2(address(controller)),
            PROCESSOR_DOMAIN,
            _addressToBytes32(address(processor)),
            2_000,
            CircleMessages.encodeRecommendation(recommendation)
        );

        ThetaShieldLens.OriginPoolSnapshot memory active =
            lens.originPoolState(address(controller), address(observationCounter), POOL_ID);
        assertEq(active.zeroForOneFeePips, 750);
        assertEq(active.oneForZeroFeePips, 500);
        assertFalse(active.zeroForOneUsedBaseline);
        assertFalse(active.oneForZeroUsedBaseline);
        assertEq(active.sequence, 1);
        assertEq(active.validAfter, recommendation.validAfter);
        assertEq(active.validUntil, recommendation.validUntil);
        assertEq(active.secondsUntilExpiry, 599);
        assertEq(active.confidenceBps, 6_000);

        controller.setPoolPause(POOL_ID, true);
        ThetaShieldLens.OriginPoolSnapshot memory paused =
            lens.originPoolState(address(controller), address(observationCounter), POOL_ID);
        assertTrue(paused.poolPaused);
        assertEq(paused.zeroForOneFeePips, 500);
        assertEq(paused.oneForZeroFeePips, 500);
        assertTrue(paused.zeroForOneUsedBaseline);
        assertTrue(paused.oneForZeroUsedBaseline);
    }

    function test_processorSnapshotReportsQueuesConfigurationsAndCoverageState() external view {
        ThetaShieldLens.ProcessorSnapshot memory snapshot = lens.processorState(address(processor));

        assertEq(snapshot.pendingCount, 0);
        assertEq(snapshot.scanCursor, 0);
        assertEq(snapshot.lastObservationId, 0);
        assertEq(snapshot.settledObservationCount, 0);
        assertEq(snapshot.expiredObservationCount, 0);
        assertEq(snapshot.droppedObservationCount, 0);
        assertEq(snapshot.recommendationSequence, 0);
        assertEq(snapshot.zeroForOneEffectiveFeePips, 500);
        assertEq(snapshot.oneForZeroEffectiveFeePips, 500);
        assertEq(snapshot.referenceSourceCount, 1);
        assertEq(keccak256(abi.encode(snapshot.scheduler)), keccak256(abi.encode(_schedulerConfig())));
        assertEq(keccak256(abi.encode(snapshot.feeCurve)), keccak256(abi.encode(_feeCurveConfig())));
        assertEq(snapshot.zeroForOne.latestCoverageRatioWad, 1.25e18);
        assertEq(snapshot.oneForZero.latestCoverageRatioWad, 1.25e18);
    }

    function test_referenceSnapshotReturnsConfiguredSourceAndHistory() external {
        feed.publish(MARKET_ID, SOURCE_ID, 1_234e15, 9e17, uint64(block.timestamp));
        assertTrue(processor.syncReference(SOURCE_ID));

        ThetaShieldLens.ReferenceSourceSnapshot memory snapshot =
            lens.referenceSourceState(address(processor), SOURCE_ID);
        assertEq(snapshot.sourceId, SOURCE_ID);
        assertEq(snapshot.sourceIndexPlusOne, 1);
        assertEq(snapshot.latestSequence, 1);
        assertEq(snapshot.count, 1);
        assertEq(snapshot.cursor, 1);
        assertEq(snapshot.records.length, 1);
        assertEq(snapshot.records[0].priceWad, 1_234e15);
        assertEq(snapshot.records[0].confidenceWad, 9e17);
        assertEq(snapshot.records[0].observedAt, block.timestamp);
        assertEq(snapshot.records[0].sequence, 1);
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
            minimumReferenceSources: 1,
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

    function _controllerConfig() private pure returns (ThetaShieldController.PoolFeeConfig memory) {
        return ThetaShieldController.PoolFeeConfig({
            baselineFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            confidenceFloorBps: 5_000,
            maximumRecommendationLifetime: 600,
            minimumRecommendationInterval: 0,
            paused: false
        });
    }

    function _addressToBytes32(address account) private pure returns (bytes32) {
        return bytes32(uint256(uint160(account)));
    }
}
