// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ThetaShieldProfiles} from "../../script/profiles/ThetaShieldProfiles.sol";
import {ThetaShieldUnits} from "../../src/base/ThetaShieldUnits.sol";

contract ConfigMirrorTest is Test {
    function test_researchProfileMatchesLockedPhase61AndCoverageParameters() external pure {
        ThetaShieldProfiles.Profile memory profile = ThetaShieldProfiles.researchV1();

        assertEq(profile.id, keccak256("THETASHIELD_RESEARCH_V1"));
        assertEq(profile.scheduler.trailingWindow, 16);
        assertEq(profile.scheduler.minimumTrailingObservations, 16);
        assertEq(profile.scheduler.maximumEpochObservations, 4);
        assertEq(profile.scheduler.targetObservationCount, 4);
        assertEq(profile.scheduler.deadBandKWad, 1e18);
        assertEq(profile.scheduler.requiredToxicEpochs, 3);
        assertEq(profile.scheduler.persistenceWindow, 5);
        assertEq(profile.scheduler.alphaWad, 0.25e18);
        assertTrue(profile.scheduler.fastPathEnabled);
        assertEq(profile.scheduler.fastPathConfidenceFloorWad, 0.5e18);
        assertEq(profile.scheduler.fastPathToxicThresholdWad, 0.00075e18);
        assertEq(profile.scheduler.minimumReferenceSources, 3);
        assertEq(profile.scheduler.confidenceCapWad, 1e18);
        assertEq(profile.feeCurve.maximumIncreasePips, 500);
        assertEq(profile.feeCurve.maximumDecreasePips, 100);
        assertEq(profile.feeCurve.gainFeePips, 450_000);
        assertEq(profile.feeCurve.coverageGainFeePips, 50);
        assertEq(profile.feeCurve.targetCoverageWad, 1.25e18);
    }

    function test_demoProfileIsDistinctAndPreservesExplicitDemoBehavior() external pure {
        ThetaShieldProfiles.Profile memory research = ThetaShieldProfiles.researchV1();
        ThetaShieldProfiles.Profile memory demo = ThetaShieldProfiles.demoV1();

        assertNotEq(research.id, demo.id);
        assertEq(demo.id, keccak256("THETASHIELD_CIRCLE_SINGLE_SOURCE_TESTNET_DEMO_V1"));
        assertEq(demo.scheduler.deadBandKWad, 0);
        assertEq(demo.scheduler.requiredToxicEpochs, 1);
        assertEq(demo.scheduler.persistenceWindow, 1);
        assertEq(demo.scheduler.alphaWad, 1e18);
        assertFalse(demo.scheduler.fastPathEnabled);
    }

    function test_originAndProcessorConfigurationCannotDrift() external pure {
        _assertMirror(ThetaShieldProfiles.researchV1());
        _assertMirror(ThetaShieldProfiles.demoV1());
    }

    function _assertMirror(ThetaShieldProfiles.Profile memory profile) private pure {
        assertEq(profile.controller.minimumFeePips, profile.feeCurve.minimumFeePips);
        assertEq(profile.controller.baselineFeePips, profile.feeCurve.baseFeePips);
        assertEq(profile.controller.maximumFeePips, profile.feeCurve.maximumFeePips);
        assertEq(
            uint256(profile.controller.confidenceFloorBps) * ThetaShieldUnits.WAD / ThetaShieldUnits.BPS,
            profile.feeCurve.confidenceFloorWad
        );
        assertLe(profile.scheduler.recommendationLifetime, profile.controller.maximumRecommendationLifetime);
        assertGe(profile.scheduler.epochDuration, profile.controller.minimumRecommendationInterval);
    }
}
