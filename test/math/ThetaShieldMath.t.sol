// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ThetaShieldUnits} from "../../src/base/ThetaShieldUnits.sol";
import {ConfidenceWeight} from "../../src/libraries/ConfidenceWeight.sol";
import {DeadBandFilter} from "../../src/libraries/DeadBandFilter.sol";
import {DirectionalMarkoutMath} from "../../src/libraries/DirectionalMarkoutMath.sol";
import {DirectionalRiskSmoother} from "../../src/libraries/DirectionalRiskSmoother.sol";
import {EpochAggregation} from "../../src/libraries/EpochAggregation.sol";
import {FeeCurve} from "../../src/libraries/FeeCurve.sol";
import {FixedPointMath} from "../../src/libraries/FixedPointMath.sol";
import {PersistenceWindow} from "../../src/libraries/PersistenceWindow.sol";
import {ReferencePriceDispersion} from "../../src/libraries/ReferencePriceDispersion.sol";
import {TrailingVolatility} from "../../src/libraries/TrailingVolatility.sol";

contract MathRevertHarness {
    function mulDivDown(uint256 x, uint256 y, uint256 denominator) external pure returns (uint256) {
        return FixedPointMath.mulDivDown(x, y, denominator);
    }

    function markout(uint256 executionPriceWad, uint256 referencePriceWad, int8 direction)
        external
        pure
        returns (int256)
    {
        return DirectionalMarkoutMath.calculate(executionPriceWad, referencePriceWad, direction);
    }
}

contract ThetaShieldMathTest is Test {
    MathRevertHarness private harness;

    function setUp() external {
        harness = new MathRevertHarness();
    }

    function test_mulDivRevertsOnZeroDenominator() external {
        vm.expectRevert(FixedPointMath.DivisionByZero.selector);
        harness.mulDivDown(1, 1, 0);
    }

    function test_mulDivRevertsWhenResultOverflows() external {
        vm.expectRevert(FixedPointMath.MulDivOverflow.selector);
        harness.mulDivDown(type(uint256).max, type(uint256).max, 1);
    }

    function test_fullPrecisionMulDivHandlesOverflowingProduct() external pure {
        assertEq(FixedPointMath.mulDivDown(type(uint256).max, type(uint256).max, type(uint256).max), type(uint256).max);
    }

    function test_signedMulDivRoundsTowardZero() external pure {
        assertEq(FixedPointMath.mulDivSigned(-5, 1, 2), -2);
        assertEq(FixedPointMath.mulDivSigned(5, -1, 2), -2);
    }

    function test_directionalMarkoutPreservesTraderDirection() external pure {
        uint256 executionPriceWad = 100 * ThetaShieldUnits.WAD;
        uint256 referencePriceWad = 101 * ThetaShieldUnits.WAD;

        assertEq(DirectionalMarkoutMath.calculate(executionPriceWad, referencePriceWad, 1), 1e16);
        assertEq(DirectionalMarkoutMath.calculate(executionPriceWad, referencePriceWad, -1), -1e16);
    }

    function test_directionalMarkoutRejectsInvalidInputs() external {
        vm.expectRevert(DirectionalMarkoutMath.ZeroExecutionPrice.selector);
        harness.markout(0, 1e18, 1);

        vm.expectRevert(abi.encodeWithSelector(DirectionalMarkoutMath.InvalidTradeDirection.selector, int8(0)));
        harness.markout(1e18, 1e18, 0);
    }

    function test_currentObservationCannotAffectOwnTrailingSigma() external pure {
        int256[] memory quiet = new int256[](4);
        quiet[0] = -2e15;
        quiet[1] = 0;
        quiet[2] = 2e15;
        quiet[3] = 0;

        int256[] memory burst = new int256[](4);
        burst[0] = quiet[0];
        burst[1] = quiet[1];
        burst[2] = quiet[2];
        burst[3] = 500e15;

        (uint256 quietSigma, uint256 quietCount) = TrailingVolatility.trailingSigma(quiet, 3, 3);
        (uint256 burstSigma, uint256 burstCount) = TrailingVolatility.trailingSigma(burst, 3, 3);

        assertEq(quietSigma, 1_632_993_161_855_452);
        assertEq(burstSigma, quietSigma);
        assertEq(quietCount, 3);
        assertEq(burstCount, quietCount);
    }

    function test_trailingSigmaColdStartIsMeasurementOnly() external pure {
        int256[] memory series = new int256[](1);
        series[0] = 4e15;

        (uint256 sigmaWad, uint256 sampleCount) = TrailingVolatility.trailingSigma(series, 1, 32);

        assertEq(sigmaWad, 0);
        assertEq(sampleCount, 1);
    }

    function test_deadBandPreservesNegativeEvidence() external pure {
        assertEq(DeadBandFilter.filter(-5e15, 2e15, 1.5e18), -2e15);
        assertEq(DeadBandFilter.filter(2e15, 2e15, 1.5e18), 0);
    }

    function test_epochAggregationAppliesFloorAndCap() external pure {
        EpochAggregation.Observation[] memory observations = new EpochAggregation.Observation[](3);
        observations[0] = EpochAggregation.Observation({filteredMarkoutWad: 4e15, notionalWad: 50e18});
        observations[1] = EpochAggregation.Observation({filteredMarkoutWad: -2e15, notionalWad: 200e18});
        observations[2] = EpochAggregation.Observation({filteredMarkoutWad: 9e15, notionalWad: 1e18});
        EpochAggregation.Config memory config = EpochAggregation.Config({
            minimumObservationNotionalWad: 10e18,
            maximumTradeNotionalWad: 100e18,
            minimumEpochNotionalWad: 150e18,
            maximumObservationCount: 8
        });

        EpochAggregation.Result memory result = EpochAggregation.aggregate(observations, config);

        assertEq(result.aggregateMarkoutWad, 0);
        assertEq(result.eligibleNotionalWad, 150e18);
        assertEq(result.eligibleObservationCount, 2);
        assertTrue(result.meetsMinimumEpochNotional);
    }

    function test_epochCanReportInsufficientNotionalWithoutInventingRisk() external pure {
        EpochAggregation.Observation[] memory observations = new EpochAggregation.Observation[](1);
        observations[0] = EpochAggregation.Observation({filteredMarkoutWad: 4e15, notionalWad: 10e18});
        EpochAggregation.Config memory config = EpochAggregation.Config({
            minimumObservationNotionalWad: 10e18,
            maximumTradeNotionalWad: 100e18,
            minimumEpochNotionalWad: 150e18,
            maximumObservationCount: 8
        });

        EpochAggregation.Result memory result = EpochAggregation.aggregate(observations, config);

        assertEq(result.aggregateMarkoutWad, 4e15);
        assertFalse(result.meetsMinimumEpochNotional);
    }

    function test_neutralEpochDoesNotResetNOfKHistory() external pure {
        uint256 bitmap;
        bitmap = PersistenceWindow.push(bitmap, true, 5);
        bitmap = PersistenceWindow.push(bitmap, true, 5);
        bitmap = PersistenceWindow.push(bitmap, false, 5);
        assertFalse(PersistenceWindow.isActive(bitmap, 3, 5));

        bitmap = PersistenceWindow.push(bitmap, true, 5);
        assertEq(bitmap, 13);
        assertTrue(PersistenceWindow.isActive(bitmap, 3, 5));
    }

    function test_referencePriceDispersionUsesRobustCenter() external pure {
        ReferencePriceDispersion.Sample[] memory samples = new ReferencePriceDispersion.Sample[](3);
        samples[0] = ReferencePriceDispersion.Sample({priceWad: 100e18, weightWad: 1e18});
        samples[1] = ReferencePriceDispersion.Sample({priceWad: 101e18, weightWad: 0.8e18});
        samples[2] = ReferencePriceDispersion.Sample({priceWad: 99e18, weightWad: 0.6e18});

        ReferencePriceDispersion.Result memory result = ReferencePriceDispersion.calculate(samples);

        assertEq(result.weightedMedianPriceWad, 100e18);
        assertEq(result.weightedMeanAbsoluteDeviationWad, 583_333_333_333_333_333);
        assertEq(result.normalizedDispersionWad, 5_833_333_333_333_333);
    }

    function test_twoSourceDispersionDoesNotDegenerateToZero() external pure {
        ReferencePriceDispersion.Sample[] memory samples = new ReferencePriceDispersion.Sample[](2);
        samples[0] = ReferencePriceDispersion.Sample({priceWad: 100e18, weightWad: 1e18});
        samples[1] = ReferencePriceDispersion.Sample({priceWad: 102e18, weightWad: 1e18});

        ReferencePriceDispersion.Result memory result = ReferencePriceDispersion.calculate(samples);

        assertEq(result.weightedMedianPriceWad, 100e18);
        assertEq(result.weightedMeanAbsoluteDeviationWad, 1e18);
        assertEq(result.normalizedDispersionWad, 0.01e18);
    }

    function test_confidenceMatchesMechanicalFormula() external pure {
        ConfidenceWeight.Components memory result =
            ConfidenceWeight.calculate(8, 10, 80e18, 100e18, 5e15, 20e15, 0.6e18);

        assertEq(result.countScoreWad, 0.8e18);
        assertEq(result.agreementScoreWad, 0.6e18);
        assertEq(result.dispersionScoreWad, 0.75e18);
        assertEq(result.uncappedConfidenceWad, 0.36e18);
        assertEq(result.confidenceWad, 0.36e18);
    }

    function test_singleSourceConfidenceCapIsEnforced() external pure {
        ConfidenceWeight.Components memory result = ConfidenceWeight.calculate(10, 10, 100e18, 100e18, 0, 1e18, 0.6e18);

        assertEq(result.uncappedConfidenceWad, 1e18);
        assertEq(result.confidenceWad, 0.6e18);
    }

    function test_halfAgreementHasZeroConfidence() external pure {
        ConfidenceWeight.Components memory result = ConfidenceWeight.calculate(10, 10, 50e18, 100e18, 0, 1e18, 1e18);

        assertEq(result.agreementScoreWad, 0);
        assertEq(result.confidenceWad, 0);
    }

    function test_smootherPreservesNegativeDirection() external pure {
        DirectionalRiskSmoother.Result memory result = DirectionalRiskSmoother.update(-4e15, 2e15, 0.25e18, 0.75e18);

        assertEq(result.magnitudeWad, 2.5e15);
        assertEq(result.signedRiskWad, -1.875e15);
    }

    function test_zeroAggregateDecaysMagnitudeWithoutDirectionalRisk() external pure {
        DirectionalRiskSmoother.Result memory result = DirectionalRiskSmoother.update(0, 4e15, 0.25e18, 1e18);

        assertEq(result.magnitudeWad, 3e15);
        assertEq(result.signedRiskWad, 0);
    }

    function test_feeCurveRequiresPositiveActiveConfidentRisk() external pure {
        FeeCurve.Config memory config = _feeConfig();
        FeeCurve.Result memory active = FeeCurve.calculate(4e15, 0.75e18, true, 500, config);
        FeeCurve.Result memory favorable = FeeCurve.calculate(-4e15, 0.75e18, true, 500, config);
        FeeCurve.Result memory inactive = FeeCurve.calculate(4e15, 0.75e18, false, 500, config);

        assertEq(active.premiumPips, 2_000);
        assertEq(active.targetFeePips, 2_500);
        assertEq(active.nextFeePips, 1_500);
        assertEq(favorable.targetFeePips, 500);
        assertEq(inactive.targetFeePips, 500);
    }

    function test_feeCurveCapsPremiumRelativeToBaseAndRateLimitsDecrease() external pure {
        FeeCurve.Config memory cappedConfig = FeeCurve.Config({
            baseFeePips: 1_000,
            minimumFeePips: 500,
            maximumFeePips: 2_000,
            gainFeePips: 1_000_000,
            coverageGainFeePips: 50,
            maximumIncreasePips: 2_000,
            maximumDecreasePips: 500,
            confidenceFloorWad: 0,
            targetCoverageWad: 1.25e18,
            minimumEstimatedLossWad: 0.001e18
        });
        FeeCurve.Result memory capped = FeeCurve.calculate(10e18, 1e18, true, 1_000, cappedConfig);
        FeeCurve.Result memory decreasing = FeeCurve.calculate(-1e18, 1e18, true, 2_000, cappedConfig);

        assertEq(capped.premiumPips, 1_000);
        assertEq(capped.targetFeePips, 2_000);
        assertEq(decreasing.targetFeePips, 1_000);
        assertEq(decreasing.nextFeePips, 1_500);
    }

    function test_closedLoopFeeComposesCoverageBeforeSharedRateLimit() external pure {
        FeeCurve.Result memory result = FeeCurve.calculateClosedLoop(
            4e15,
            0.75e18,
            true,
            500,
            FeeCurve.CoverageInput({feeRevenueWad: 1e18, estimatedLossWad: 2e18, meetsMinimumEpochNotional: true}),
            _feeConfig()
        );

        assertTrue(result.coverageEligible);
        assertEq(result.coverageRatioWad, 0.5e18);
        assertEq(result.coverageDeficitWad, 0.75e18);
        assertEq(result.toxicPremiumPips, 2_000);
        assertEq(result.coveragePremiumPips, 37);
        assertEq(result.premiumPips, 2_037);
        assertEq(result.targetFeePips, 2_537);
        assertEq(result.nextFeePips, 1_500);
    }

    function test_zeroLossEpochNeverInventsCoverageDeficit() external pure {
        FeeCurve.Result memory result = FeeCurve.calculateClosedLoop(
            4e15,
            0.75e18,
            true,
            500,
            FeeCurve.CoverageInput({feeRevenueWad: 1e18, estimatedLossWad: 0, meetsMinimumEpochNotional: true}),
            _feeConfig()
        );

        assertFalse(result.coverageEligible);
        assertEq(result.coverageRatioWad, 1.25e18);
        assertEq(result.coverageDeficitWad, 0);
        assertEq(result.coveragePremiumPips, 0);
        assertEq(result.premiumPips, result.toxicPremiumPips);
    }

    function _feeConfig() private pure returns (FeeCurve.Config memory) {
        return FeeCurve.Config({
            baseFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            gainFeePips: 500_000,
            coverageGainFeePips: 50,
            maximumIncreasePips: 1_000,
            maximumDecreasePips: 500,
            confidenceFloorWad: 0.5e18,
            targetCoverageWad: 1.25e18,
            minimumEstimatedLossWad: 0.001e18
        });
    }
}
