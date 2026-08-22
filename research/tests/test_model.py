from __future__ import annotations

import unittest

from research.thetashield.model import (
    WAD,
    ConfidenceComponents,
    EpochConfig,
    EpochObservation,
    FeeConfig,
    aggregate_epoch,
    calculate_confidence,
    calculate_fee,
    dead_band_filter,
    directional_markout,
    push_persistence,
    reference_price_dispersion,
    smooth_directional_risk,
    trailing_sigma,
    ReferenceSample,
)


class DirectionalMathTest(unittest.TestCase):
    def test_markout_preserves_direction(self) -> None:
        execution = 100 * WAD
        reference = 101 * WAD
        self.assertEqual(directional_markout(execution, reference, 1), 10**16)
        self.assertEqual(directional_markout(execution, reference, -1), -(10**16))

    def test_current_observation_cannot_change_own_sigma(self) -> None:
        history = [-(2 * 10**15), 0, 2 * 10**15]
        quiet_current = history + [0]
        burst_current = history + [500 * 10**15]
        self.assertEqual(trailing_sigma(quiet_current, 3, 3), trailing_sigma(burst_current, 3, 3))

    def test_negative_markout_remains_negative_after_filter(self) -> None:
        filtered = dead_band_filter(-(5 * 10**15), 2 * 10**15, 15 * 10**17)
        self.assertEqual(filtered, -(2 * 10**15))


class AggregationAndPersistenceTest(unittest.TestCase):
    def test_notional_floor_and_cap(self) -> None:
        result = aggregate_epoch(
            [
                EpochObservation(4 * 10**15, 50 * WAD),
                EpochObservation(-(2 * 10**15), 200 * WAD),
                EpochObservation(9 * 10**15, WAD),
            ],
            EpochConfig(10 * WAD, 100 * WAD, 150 * WAD, 8),
        )
        self.assertEqual(result.aggregate_markout_wad, 0)
        self.assertEqual(result.eligible_notional_wad, 150 * WAD)
        self.assertEqual(result.eligible_observation_count, 2)
        self.assertTrue(result.meets_minimum_epoch_notional)

    def test_neutral_epoch_does_not_erase_n_of_k_history(self) -> None:
        bitmap = 0
        bitmap, active = push_persistence(bitmap, True, 3, 5)
        self.assertFalse(active)
        bitmap, active = push_persistence(bitmap, True, 3, 5)
        self.assertFalse(active)
        bitmap, active = push_persistence(bitmap, False, 3, 5)
        self.assertFalse(active)
        bitmap, active = push_persistence(bitmap, True, 3, 5)
        self.assertTrue(active)
        self.assertEqual(bitmap, 0b01101)


class ConfidenceAndFeeTest(unittest.TestCase):
    def test_reference_dispersion(self) -> None:
        result = reference_price_dispersion(
            [
                ReferenceSample(100 * WAD, WAD),
                ReferenceSample(101 * WAD, 8 * 10**17),
                ReferenceSample(99 * WAD, 6 * 10**17),
            ]
        )
        self.assertEqual(result, (100 * WAD, 583_333_333_333_333_333, 5_833_333_333_333_333))

    def test_confidence_formula(self) -> None:
        result = calculate_confidence(
            observation_count=8,
            target_observation_count=10,
            agreeing_notional_wad=80 * WAD,
            total_notional_wad=100 * WAD,
            reference_dispersion_wad=5 * 10**15,
            maximum_dispersion_wad=2 * 10**16,
            confidence_cap_wad=6 * 10**17,
        )
        self.assertEqual(
            result,
            ConfidenceComponents(
                count_score_wad=8 * 10**17,
                agreement_score_wad=6 * 10**17,
                dispersion_score_wad=75 * 10**16,
                uncapped_confidence_wad=36 * 10**16,
                confidence_wad=36 * 10**16,
            ),
        )

    def test_single_source_cap_is_enforced(self) -> None:
        result = calculate_confidence(10, 10, 100 * WAD, 100 * WAD, 0, WAD, 6 * 10**17)
        self.assertEqual(result.uncapped_confidence_wad, WAD)
        self.assertEqual(result.confidence_wad, 6 * 10**17)

    def test_smoothing_preserves_negative_direction(self) -> None:
        result = smooth_directional_risk(-(4 * 10**15), 2 * 10**15, 25 * 10**16, 75 * 10**16)
        self.assertEqual(result.magnitude_wad, 25 * 10**14)
        self.assertEqual(result.signed_risk_wad, -(1_875 * 10**12))

    def test_fee_requires_positive_active_confident_risk(self) -> None:
        config = FeeConfig(500, 500, 10_000, 500_000, 1_000, 500, 5 * 10**17)
        active = calculate_fee(4 * 10**15, 75 * 10**16, True, 500, config)
        favorable = calculate_fee(-(4 * 10**15), 75 * 10**16, True, 500, config)
        inactive = calculate_fee(4 * 10**15, 75 * 10**16, False, 500, config)
        self.assertEqual((active.premium_pips, active.target_fee_pips, active.next_fee_pips), (2000, 2500, 1500))
        self.assertEqual(favorable.target_fee_pips, 500)
        self.assertEqual(inactive.target_fee_pips, 500)


if __name__ == "__main__":
    unittest.main()
