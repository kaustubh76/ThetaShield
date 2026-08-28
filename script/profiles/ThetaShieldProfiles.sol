// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {ThetaShieldCircleProcessor} from "../../src/circle/ThetaShieldCircleProcessor.sol";
import {ThetaShieldController} from "../../src/controller/ThetaShieldController.sol";
import {FeeCurve} from "../../src/libraries/FeeCurve.sol";

/// @title ThetaShieldProfiles
/// @notice Shared, named origin and processor configurations for deployments and tests.
library ThetaShieldProfiles {
    bytes32 internal constant RESEARCH_V1_ID = keccak256("THETASHIELD_RESEARCH_V1");
    bytes32 internal constant DEMO_V1_ID = keccak256("THETASHIELD_CIRCLE_SINGLE_SOURCE_TESTNET_DEMO_V1");
    bytes32 internal constant RESEARCH_V1_NAME_HASH = keccak256("RESEARCH_V1");
    bytes32 internal constant DEMO_V1_NAME_HASH = keccak256("DEMO_V1");

    struct Profile {
        bytes32 id;
        ThetaShieldCircleProcessor.SchedulerConfig scheduler;
        FeeCurve.Config feeCurve;
        ThetaShieldController.PoolFeeConfig controller;
    }

    error UnknownProfile(string supplied);

    function resolve(string memory name) internal pure returns (Profile memory) {
        bytes32 nameHash = keccak256(bytes(name));
        if (nameHash == RESEARCH_V1_NAME_HASH) return researchV1();
        if (nameHash == DEMO_V1_NAME_HASH) return demoV1();
        revert UnknownProfile(name);
    }

    function researchV1() internal pure returns (Profile memory profile) {
        profile.id = RESEARCH_V1_ID;
        profile.scheduler = ThetaShieldCircleProcessor.SchedulerConfig({
            markoutHorizon: 60,
            observationLifetime: 7_200,
            referenceSelectionWindow: 3_600,
            epochDuration: 60,
            recommendationLifetime: 3_600,
            callbackClockSkew: 60,
            maximumEventFutureSkew: 30,
            maximumPendingObservations: 32,
            maximumProcessPerCall: 32,
            maximumEpochObservations: 4,
            trailingWindow: 16,
            minimumTrailingObservations: 16,
            targetObservationCount: 4,
            requiredToxicEpochs: 3,
            persistenceWindow: 5,
            fastPathHoldEpochs: 0,
            maximumReferenceSamplesPerSource: 4,
            minimumReferenceSources: 1,
            fastPathEnabled: true,
            minimumObservationNotionalWad: 1e18,
            maximumTradeNotionalWad: 100e18,
            minimumEpochNotionalWad: 8e18,
            coldStartSigmaWad: 0,
            deadBandKWad: 1e18,
            maximumDispersionWad: 0.02e18,
            confidenceCapWad: 0.6e18,
            toxicThresholdWad: 0.00075e18,
            alphaWad: 0.25e18,
            fastPathConfidenceFloorWad: 0.5e18,
            fastPathToxicThresholdWad: 0.00075e18
        });
        profile.feeCurve = FeeCurve.Config({
            baseFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            gainFeePips: 450_000,
            coverageGainFeePips: 50,
            maximumIncreasePips: 500,
            maximumDecreasePips: 100,
            confidenceFloorWad: 0.5e18,
            targetCoverageWad: 1.25e18,
            minimumEstimatedLossWad: 0.001e18
        });
        profile.controller = _controllerConfig();
    }

    function demoV1() internal pure returns (Profile memory profile) {
        profile.id = DEMO_V1_ID;
        profile.scheduler = ThetaShieldCircleProcessor.SchedulerConfig({
            markoutHorizon: 60,
            observationLifetime: 7_200,
            referenceSelectionWindow: 3_600,
            epochDuration: 60,
            recommendationLifetime: 3_600,
            callbackClockSkew: 60,
            maximumEventFutureSkew: 30,
            maximumPendingObservations: 8,
            maximumProcessPerCall: 8,
            maximumEpochObservations: 8,
            trailingWindow: 8,
            minimumTrailingObservations: 1,
            targetObservationCount: 1,
            requiredToxicEpochs: 1,
            persistenceWindow: 1,
            fastPathHoldEpochs: 0,
            maximumReferenceSamplesPerSource: 4,
            minimumReferenceSources: 1,
            fastPathEnabled: false,
            minimumObservationNotionalWad: 1,
            maximumTradeNotionalWad: 100e18,
            minimumEpochNotionalWad: 1,
            coldStartSigmaWad: 0,
            deadBandKWad: 0,
            maximumDispersionWad: 0.05e18,
            confidenceCapWad: 0.6e18,
            toxicThresholdWad: 0.001e18,
            alphaWad: 1e18,
            fastPathConfidenceFloorWad: 0,
            fastPathToxicThresholdWad: 0
        });
        profile.feeCurve = FeeCurve.Config({
            baseFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            gainFeePips: 100_000,
            coverageGainFeePips: 50,
            maximumIncreasePips: 2_000,
            maximumDecreasePips: 2_000,
            confidenceFloorWad: 0.5e18,
            targetCoverageWad: 1.25e18,
            minimumEstimatedLossWad: 0.001e18
        });
        profile.controller = _controllerConfig();
    }

    function _controllerConfig() private pure returns (ThetaShieldController.PoolFeeConfig memory) {
        return ThetaShieldController.PoolFeeConfig({
            baselineFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            confidenceFloorBps: 5_000,
            maximumRecommendationLifetime: 7_200,
            minimumRecommendationInterval: 60,
            paused: false
        });
    }
}
