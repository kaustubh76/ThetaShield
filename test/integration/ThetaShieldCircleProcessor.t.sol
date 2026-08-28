// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CircleMessages} from "../../src/circle/CircleMessages.sol";
import {ThetaShieldCircleProcessor} from "../../src/circle/ThetaShieldCircleProcessor.sol";
import {ThetaShieldCircleTransport} from "../../src/circle/ThetaShieldCircleTransport.sol";
import {ThetaShieldController} from "../../src/controller/ThetaShieldController.sol";
import {MockNormalizedReferencePriceFeed} from "../../src/feeds/MockNormalizedReferencePriceFeed.sol";
import {IMessageHandlerV2} from "../../src/interfaces/IMessageHandlerV2.sol";
import {FeeCurve} from "../../src/libraries/FeeCurve.sol";
import {MockMessageTransmitterV2} from "../mocks/MockMessageTransmitterV2.sol";

contract ThetaShieldCircleProcessorTest is Test {
    uint32 private constant ORIGIN_DOMAIN = 10;
    uint32 private constant PROCESSOR_DOMAIN = 0;
    bytes32 private constant ORIGIN_TRANSPORT = bytes32(uint256(uint160(address(0xA11CE))));
    bytes32 private constant POOL_ID = keccak256("circle-processor-pool");
    bytes32 private constant MARKET_ID = keccak256("ETH/USD");
    bytes32 private constant SOURCE_ID = keccak256("mock-source");

    MockMessageTransmitterV2 private originTransmitter;
    MockMessageTransmitterV2 private processorTransmitter;
    MockNormalizedReferencePriceFeed private feed;
    ThetaShieldCircleProcessor private processor;
    ThetaShieldController private controller;

    function setUp() public {
        vm.warp(1_800_000_000);
        originTransmitter = new MockMessageTransmitterV2();
        processorTransmitter = new MockMessageTransmitterV2();
        feed = new MockNormalizedReferencePriceFeed(address(this));
        controller = new ThetaShieldController(address(this), originTransmitter);

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

    function test_finalizedCircleObservationIsQueued() external {
        _deliverObservation(_observation(1));

        (uint16 slot, bool active) = processor.observationSlot(1);
        assertTrue(active);
        ThetaShieldCircleProcessor.PendingObservation memory pending = processor.pendingObservation(slot);
        assertEq(pending.observationId, 1);
        assertEq(pending.executionPriceWad, 1e18);
        assertEq(pending.notionalWad, 1e18);
        assertEq(processor.pendingCount(), 1);
    }

    function test_rejectsWrongTransmitterPeerAndUnfinalizedDelivery() external {
        bytes memory messageBody = CircleMessages.encodeObservation(_observation(1));

        vm.expectRevert(
            abi.encodeWithSelector(ThetaShieldCircleProcessor.InvalidMessageTransmitter.selector, address(this))
        );
        processor.handleReceiveFinalizedMessage(ORIGIN_DOMAIN, ORIGIN_TRANSPORT, 2_000, messageBody);

        vm.expectRevert(
            abi.encodeWithSelector(ThetaShieldCircleProcessor.InvalidCirclePeer.selector, uint32(6), ORIGIN_TRANSPORT)
        );
        processorTransmitter.deliverFinalized(
            IMessageHandlerV2(address(processor)), 6, ORIGIN_TRANSPORT, 2_000, messageBody
        );

        vm.expectRevert(
            abi.encodeWithSelector(ThetaShieldCircleProcessor.UnfinalizedMessageRejected.selector, uint32(1_000))
        );
        processorTransmitter.deliverUnfinalized(
            IMessageHandlerV2(address(processor)), ORIGIN_DOMAIN, ORIGIN_TRANSPORT, 1_000, messageBody
        );
    }

    function test_observationReplayFailsClosed() external {
        _deliverObservation(_observation(1));
        vm.expectRevert(
            abi.encodeWithSelector(ThetaShieldCircleProcessor.ObservationReplay.selector, uint64(1), uint64(1))
        );
        _deliverObservation(_observation(1));
    }

    function test_referencePullIsAuthenticatedByConfiguredFeedAndIdempotent() external {
        feed.publish(MARKET_ID, SOURCE_ID, 99e16, 1e18, uint64(block.timestamp));
        assertTrue(processor.syncReference(SOURCE_ID));
        assertFalse(processor.syncReference(SOURCE_ID));

        (uint8 count,) = processor.referenceHistoryState(SOURCE_ID);
        assertEq(count, 1);
        assertEq(processor.latestReferenceSequence(SOURCE_ID), 1);
    }

    function test_permissionlessProcessingDispatchesCircleRecommendation() external {
        _completeEpoch(1, 99e16);
        assertEq(processorTransmitter.sentCount(), 1);

        MockMessageTransmitterV2.SentMessage memory sent = processorTransmitter.lastMessage();
        assertEq(sent.sender, address(processor));
        assertEq(sent.destinationDomain, ORIGIN_DOMAIN);
        assertEq(sent.recipient, _addressToBytes32(address(controller)));
        assertEq(sent.minFinalityThreshold, 2_000);

        CircleMessages.Recommendation memory recommendation = CircleMessages.decodeRecommendation(sent.messageBody);
        assertEq(recommendation.poolId, POOL_ID);
        assertEq(recommendation.sequence, 1);
        assertEq(recommendation.zeroForOneFee, 500);
    }

    function test_fullCircleLifecycleChangesLaterDirectionalPoolFee() external {
        _completeEpoch(1, 99e16);
        _relayLatestRecommendation();
        (uint24 coldFee, bool coldBaseline) = controller.feeForSwap(POOL_ID, true);
        assertEq(coldFee, 500);
        assertFalse(coldBaseline);

        _completeEpoch(2, 98e16);
        MockMessageTransmitterV2.SentMessage memory sent = processorTransmitter.lastMessage();
        CircleMessages.Recommendation memory recommendation = CircleMessages.decodeRecommendation(sent.messageBody);
        assertEq(recommendation.sequence, 2);
        assertGt(recommendation.zeroForOneFee, 500);
        assertEq(recommendation.oneForZeroFee, 500);

        _relayLatestRecommendation();
        (uint24 protectedFee, bool usedBaseline) = controller.feeForSwap(POOL_ID, true);
        assertEq(protectedFee, recommendation.zeroForOneFee);
        assertFalse(usedBaseline);
    }

    function test_epochFinalizationStoresCoverageFeedback() external {
        _completeEpoch(1, 99e16);
        _completeEpoch(2, 98e16);

        ThetaShieldCircleProcessor.SideState memory state = processor.sideState(true);
        assertTrue(state.latestCoverageEligible);
        assertEq(state.latestFeeRevenueWad, 0.0005e18);
        assertEq(state.latestEstimatedLossWad, 0.02e18);
        assertEq(state.latestCoverageRatioWad, 0.025e18);
        assertEq(state.latestCoverageDeficitWad, 1.225e18);
        assertEq(state.latestCoveragePremiumPips, 61);
        assertEq(state.epochFeeRevenueWad, 0);
        assertEq(state.epochEstimatedLossWad, 0);
    }

    function test_zeroLossWarmEpochDoesNotCreateCoverageDeficit() external {
        _completeEpoch(1, 1e18);
        _completeEpoch(2, 1.01e18);

        ThetaShieldCircleProcessor.SideState memory state = processor.sideState(true);
        assertFalse(state.latestCoverageEligible);
        assertEq(state.latestEstimatedLossWad, 0);
        assertEq(state.latestCoverageRatioWad, 1.25e18);
        assertEq(state.latestCoverageDeficitWad, 0);
        assertEq(state.latestCoveragePremiumPips, 0);
        assertEq(state.latestCalculatedFeePips, 500);
    }

    function _completeEpoch(uint64 observationId, uint256 referencePriceWad) private {
        _deliverObservation(_observation(observationId));
        (uint16 slot,) = processor.observationSlot(observationId);
        uint64 observedAt = processor.pendingObservation(slot).observedAt;
        vm.warp(uint256(observedAt) + 10);
        feed.publish(MARKET_ID, SOURCE_ID, referencePriceWad, 1e18, observedAt + 10);
        processor.syncReference(SOURCE_ID);
        assertFalse(processor.process());
        vm.warp(uint256(observedAt) + 20);
        assertTrue(processor.process());
    }

    function _relayLatestRecommendation() private {
        MockMessageTransmitterV2.SentMessage memory sent = processorTransmitter.lastMessage();
        originTransmitter.deliverFinalized(
            IMessageHandlerV2(address(controller)),
            PROCESSOR_DOMAIN,
            _addressToBytes32(sent.sender),
            2_000,
            sent.messageBody
        );
    }

    function _deliverObservation(CircleMessages.Observation memory observation) private {
        processorTransmitter.deliverFinalized(
            IMessageHandlerV2(address(processor)),
            ORIGIN_DOMAIN,
            ORIGIN_TRANSPORT,
            2_000,
            CircleMessages.encodeObservation(observation)
        );
    }

    function _observation(uint64 observationId) private view returns (CircleMessages.Observation memory) {
        return CircleMessages.Observation({
            poolId: POOL_ID,
            observationId: observationId,
            zeroForOne: true,
            amount0: -1e18,
            amount1: 1e18,
            sqrtPriceX96After: uint160(1 << 96),
            appliedFeePips: 500,
            usedBaseline: true,
            observedAt: uint64(block.timestamp)
        });
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

contract ThetaShieldCircleTransportTest is Test {
    MockMessageTransmitterV2 private transmitter;
    ThetaShieldCircleTransport private transport;
    bytes32 private constant PROCESSOR = bytes32(uint256(uint160(address(0xBEEF))));

    function setUp() public {
        transmitter = new MockMessageTransmitterV2();
        transport = new ThetaShieldCircleTransport(address(this), transmitter, 0);
        transport.configurePeers(address(this), PROCESSOR);
    }

    function test_dispatchesVersionedFinalizedObservation() external {
        CircleMessages.Observation memory observation = _observation();
        transport.sendObservation(observation);

        MockMessageTransmitterV2.SentMessage memory sent = transmitter.lastMessage();
        assertEq(sent.sender, address(transport));
        assertEq(sent.destinationDomain, 0);
        assertEq(sent.recipient, PROCESSOR);
        assertEq(sent.destinationCaller, bytes32(0));
        assertEq(sent.minFinalityThreshold, 2_000);
        CircleMessages.Observation memory decoded = CircleMessages.decodeObservation(sent.messageBody);
        assertEq(decoded.observationId, observation.observationId);
        assertEq(decoded.poolId, observation.poolId);
    }

    function test_onlyConfiguredHookCanDispatchAndPeersCannotChange() external {
        address caller = address(0xBAD);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldCircleTransport.OnlyHook.selector, caller));
        transport.sendObservation(_observation());

        vm.expectRevert(ThetaShieldCircleTransport.PeersAlreadySealed.selector);
        transport.configurePeers(address(this), PROCESSOR);
    }

    function _observation() private pure returns (CircleMessages.Observation memory) {
        return CircleMessages.Observation({
            poolId: keccak256("transport-pool"),
            observationId: 1,
            zeroForOne: true,
            amount0: -1e18,
            amount1: 1e18,
            sqrtPriceX96After: uint160(1 << 96),
            appliedFeePips: 500,
            usedBaseline: true,
            observedAt: 1_800_000_000
        });
    }
}
