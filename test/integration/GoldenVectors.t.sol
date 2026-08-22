// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ConfidenceWeight} from "../../src/libraries/ConfidenceWeight.sol";
import {DeadBandFilter} from "../../src/libraries/DeadBandFilter.sol";
import {DirectionalMarkoutMath} from "../../src/libraries/DirectionalMarkoutMath.sol";
import {DirectionalRiskSmoother} from "../../src/libraries/DirectionalRiskSmoother.sol";
import {EpochAggregation} from "../../src/libraries/EpochAggregation.sol";
import {FeeCurve} from "../../src/libraries/FeeCurve.sol";
import {PersistenceWindow} from "../../src/libraries/PersistenceWindow.sol";
import {ReferencePriceDispersion} from "../../src/libraries/ReferencePriceDispersion.sol";
import {TrailingVolatility} from "../../src/libraries/TrailingVolatility.sol";

contract GoldenVectorsTest is Test {
    string private vectors;

    function setUp() external {
        vectors = vm.readFile("research/datasets/golden_vectors.json");
    }

    function test_markoutGoldenVectors() external view {
        for (uint256 index; index < 4; ++index) {
            string memory root = string.concat(".markout[", vm.toString(index), "]");
            uint256 executionPriceWad = vm.parseJsonUint(vectors, string.concat(root, ".execution_price_wad"));
            uint256 referencePriceWad = vm.parseJsonUint(vectors, string.concat(root, ".reference_price_wad"));
            int8 direction = int8(vm.parseJsonInt(vectors, string.concat(root, ".direction")));
            int256 expected = vm.parseJsonInt(vectors, string.concat(root, ".expected_markout_wad"));

            assertEq(DirectionalMarkoutMath.calculate(executionPriceWad, referencePriceWad, direction), expected);
        }
    }

    function test_trailingVolatilityGoldenVector() external view {
        int256[] memory series = vm.parseJsonIntArray(vectors, ".trailing_volatility.series_wad");
        uint256 currentIndex = vm.parseJsonUint(vectors, ".trailing_volatility.current_index");
        uint256 window = vm.parseJsonUint(vectors, ".trailing_volatility.window");
        (uint256 sigmaWad, uint256 sampleCount) = TrailingVolatility.trailingSigma(series, currentIndex, window);

        assertEq(sigmaWad, vm.parseJsonUint(vectors, ".trailing_volatility.expected_sigma_wad"));
        assertEq(sampleCount, vm.parseJsonUint(vectors, ".trailing_volatility.expected_sample_count"));
    }

    function test_deadBandGoldenVectors() external view {
        for (uint256 index; index < 3; ++index) {
            string memory root = string.concat(".dead_band[", vm.toString(index), "]");
            int256 actual = DeadBandFilter.filter(
                vm.parseJsonInt(vectors, string.concat(root, ".markout_wad")),
                vm.parseJsonUint(vectors, string.concat(root, ".sigma_wad")),
                vm.parseJsonUint(vectors, string.concat(root, ".k_wad"))
            );
            assertEq(actual, vm.parseJsonInt(vectors, string.concat(root, ".expected_filtered_wad")));
        }
    }

    function test_epochGoldenVector() external view {
        int256[] memory markouts = vm.parseJsonIntArray(vectors, ".epoch.filtered_markouts_wad");
        uint256[] memory notionals = vm.parseJsonUintArray(vectors, ".epoch.notionals_wad");
        EpochAggregation.Observation[] memory observations = new EpochAggregation.Observation[](markouts.length);
        for (uint256 index; index < markouts.length; ++index) {
            observations[index] = EpochAggregation.Observation(markouts[index], notionals[index]);
        }
        EpochAggregation.Config memory config = EpochAggregation.Config({
            minimumObservationNotionalWad: vm.parseJsonUint(vectors, ".epoch.minimum_observation_notional_wad"),
            maximumTradeNotionalWad: vm.parseJsonUint(vectors, ".epoch.maximum_trade_notional_wad"),
            minimumEpochNotionalWad: vm.parseJsonUint(vectors, ".epoch.minimum_epoch_notional_wad"),
            maximumObservationCount: uint16(vm.parseJsonUint(vectors, ".epoch.maximum_observation_count"))
        });
        EpochAggregation.Result memory result = EpochAggregation.aggregate(observations, config);

        assertEq(result.aggregateMarkoutWad, vm.parseJsonInt(vectors, ".epoch.expected_aggregate_markout_wad"));
        assertEq(result.eligibleNotionalWad, vm.parseJsonUint(vectors, ".epoch.expected_eligible_notional_wad"));
        assertEq(
            result.eligibleObservationCount, vm.parseJsonUint(vectors, ".epoch.expected_eligible_observation_count")
        );
        assertEq(
            result.meetsMinimumEpochNotional, vm.parseJsonBool(vectors, ".epoch.expected_meets_minimum_epoch_notional")
        );
    }

    function test_referenceDispersionGoldenVector() external view {
        uint256[] memory prices = vm.parseJsonUintArray(vectors, ".reference_dispersion.prices_wad");
        uint256[] memory weights = vm.parseJsonUintArray(vectors, ".reference_dispersion.weights_wad");
        ReferencePriceDispersion.Sample[] memory samples = new ReferencePriceDispersion.Sample[](prices.length);
        for (uint256 index; index < prices.length; ++index) {
            samples[index] = ReferencePriceDispersion.Sample(prices[index], weights[index]);
        }
        ReferencePriceDispersion.Result memory result = ReferencePriceDispersion.calculate(samples);

        assertEq(
            result.weightedMedianPriceWad,
            vm.parseJsonUint(vectors, ".reference_dispersion.expected_weighted_median_price_wad")
        );
        assertEq(
            result.weightedMeanAbsoluteDeviationWad,
            vm.parseJsonUint(vectors, ".reference_dispersion.expected_weighted_mean_absolute_deviation_wad")
        );
        assertEq(
            result.normalizedDispersionWad,
            vm.parseJsonUint(vectors, ".reference_dispersion.expected_normalized_dispersion_wad")
        );
    }

    function test_confidenceGoldenVector() external view {
        ConfidenceWeight.Components memory result = ConfidenceWeight.calculate(
            vm.parseJsonUint(vectors, ".confidence.observation_count"),
            vm.parseJsonUint(vectors, ".confidence.target_observation_count"),
            vm.parseJsonUint(vectors, ".confidence.agreeing_notional_wad"),
            vm.parseJsonUint(vectors, ".confidence.total_notional_wad"),
            vm.parseJsonUint(vectors, ".confidence.reference_dispersion_wad"),
            vm.parseJsonUint(vectors, ".confidence.maximum_dispersion_wad"),
            vm.parseJsonUint(vectors, ".confidence.confidence_cap_wad")
        );

        assertEq(result.countScoreWad, vm.parseJsonUint(vectors, ".confidence.expected_count_score_wad"));
        assertEq(result.agreementScoreWad, vm.parseJsonUint(vectors, ".confidence.expected_agreement_score_wad"));
        assertEq(result.dispersionScoreWad, vm.parseJsonUint(vectors, ".confidence.expected_dispersion_score_wad"));
        assertEq(
            result.uncappedConfidenceWad, vm.parseJsonUint(vectors, ".confidence.expected_uncapped_confidence_wad")
        );
        assertEq(result.confidenceWad, vm.parseJsonUint(vectors, ".confidence.expected_confidence_wad"));
    }

    function test_persistenceGoldenVector() external view {
        uint16 required = uint16(vm.parseJsonUint(vectors, ".persistence.required_toxic_epochs"));
        uint16 windowLength = uint16(vm.parseJsonUint(vectors, ".persistence.window_length"));
        uint256 bitmap;
        for (uint256 index; index < 4; ++index) {
            string memory root = string.concat(".persistence.steps[", vm.toString(index), "]");
            bitmap =
                PersistenceWindow.push(bitmap, vm.parseJsonBool(vectors, string.concat(root, ".toxic")), windowLength);
            assertEq(bitmap, vm.parseJsonUint(vectors, string.concat(root, ".expected_bitmap")));
            assertEq(
                PersistenceWindow.isActive(bitmap, required, windowLength),
                vm.parseJsonBool(vectors, string.concat(root, ".expected_active"))
            );
        }
    }

    function test_smoothingGoldenVector() external view {
        DirectionalRiskSmoother.Result memory result = DirectionalRiskSmoother.update(
            vm.parseJsonInt(vectors, ".smoothing.aggregate_markout_wad"),
            vm.parseJsonUint(vectors, ".smoothing.previous_magnitude_wad"),
            vm.parseJsonUint(vectors, ".smoothing.alpha_wad"),
            vm.parseJsonUint(vectors, ".smoothing.confidence_wad")
        );

        assertEq(result.magnitudeWad, vm.parseJsonUint(vectors, ".smoothing.expected_magnitude_wad"));
        assertEq(result.signedRiskWad, vm.parseJsonInt(vectors, ".smoothing.expected_signed_risk_wad"));
    }

    function test_feeGoldenVector() external view {
        FeeCurve.Config memory config = FeeCurve.Config({
            baseFeePips: uint24(vm.parseJsonUint(vectors, ".fee.base_fee_pips")),
            minimumFeePips: uint24(vm.parseJsonUint(vectors, ".fee.minimum_fee_pips")),
            maximumFeePips: uint24(vm.parseJsonUint(vectors, ".fee.maximum_fee_pips")),
            gainFeePips: uint24(vm.parseJsonUint(vectors, ".fee.gain_fee_pips")),
            maximumIncreasePips: uint24(vm.parseJsonUint(vectors, ".fee.maximum_increase_pips")),
            maximumDecreasePips: uint24(vm.parseJsonUint(vectors, ".fee.maximum_decrease_pips")),
            confidenceFloorWad: vm.parseJsonUint(vectors, ".fee.confidence_floor_wad")
        });
        FeeCurve.Result memory result = FeeCurve.calculate(
            vm.parseJsonInt(vectors, ".fee.signed_risk_wad"),
            vm.parseJsonUint(vectors, ".fee.confidence_wad"),
            vm.parseJsonBool(vectors, ".fee.persistence_active"),
            uint24(vm.parseJsonUint(vectors, ".fee.previous_fee_pips")),
            config
        );

        assertEq(result.premiumPips, vm.parseJsonUint(vectors, ".fee.expected_premium_pips"));
        assertEq(result.targetFeePips, vm.parseJsonUint(vectors, ".fee.expected_target_fee_pips"));
        assertEq(result.nextFeePips, vm.parseJsonUint(vectors, ".fee.expected_next_fee_pips"));
    }
}
