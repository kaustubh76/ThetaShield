"""Generate deterministic cross-language golden vectors for Phase 1."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from research.thetashield.model import (
    WAD,
    CoverageConfig,
    EpochConfig,
    EpochObservation,
    FeeConfig,
    aggregate_epoch,
    calculate_closed_loop_fee,
    calculate_confidence,
    calculate_coverage,
    calculate_fee,
    dead_band_filter,
    directional_markout,
    push_persistence,
    reference_price_dispersion,
    smooth_directional_risk,
    trailing_sigma,
    ReferenceSample,
)


def build_vectors() -> dict[str, Any]:
    """Return all vectors as plain JSON-compatible data."""
    markout_inputs = [
        (100 * WAD, 101 * WAD, 1),
        (100 * WAD, 99 * WAD, 1),
        (100 * WAD, 101 * WAD, -1),
        (2_500 * WAD, 2_512_500_000_000_000_000_000, 1),
    ]
    markout = [
        {
            "execution_price_wad": execution,
            "reference_price_wad": reference,
            "direction": direction,
            "expected_markout_wad": directional_markout(execution, reference, direction),
        }
        for execution, reference, direction in markout_inputs
    ]

    trailing_series = [-2 * 10**15, 0, 2 * 10**15, 50 * 10**15]
    sigma_wad, sample_count = trailing_sigma(trailing_series, 3, 3)

    dead_band_inputs = [
        (5 * 10**15, 2 * 10**15, 15 * 10**17),
        (-5 * 10**15, 2 * 10**15, 15 * 10**17),
        (2 * 10**15, 2 * 10**15, 15 * 10**17),
    ]
    dead_band = [
        {
            "markout_wad": markout_wad,
            "sigma_wad": sigma,
            "k_wad": k_wad,
            "expected_filtered_wad": dead_band_filter(markout_wad, sigma, k_wad),
        }
        for markout_wad, sigma, k_wad in dead_band_inputs
    ]

    epoch_config = EpochConfig(
        minimum_observation_notional_wad=10 * WAD,
        maximum_trade_notional_wad=100 * WAD,
        minimum_epoch_notional_wad=150 * WAD,
        maximum_observation_count=8,
    )
    epoch_observations = [
        EpochObservation(4 * 10**15, 50 * WAD),
        EpochObservation(-2 * 10**15, 200 * WAD),
        EpochObservation(9 * 10**15, 1 * WAD),
    ]
    epoch_result = aggregate_epoch(epoch_observations, epoch_config)

    references = [
        ReferenceSample(100 * WAD, WAD),
        ReferenceSample(101 * WAD, 8 * 10**17),
        ReferenceSample(99 * WAD, 6 * 10**17),
    ]
    median_wad, mean_deviation_wad, dispersion_wad = reference_price_dispersion(references)

    confidence = calculate_confidence(
        observation_count=8,
        target_observation_count=10,
        agreeing_notional_wad=80 * WAD,
        total_notional_wad=100 * WAD,
        reference_dispersion_wad=5 * 10**15,
        maximum_dispersion_wad=2 * 10**16,
        confidence_cap_wad=6 * 10**17,
    )

    persistence_bitmap = 0
    persistence_steps = []
    for toxic in (True, True, False, True):
        persistence_bitmap, active = push_persistence(persistence_bitmap, toxic, 3, 5)
        persistence_steps.append(
            {"toxic": toxic, "expected_bitmap": persistence_bitmap, "expected_active": active}
        )

    risk = smooth_directional_risk(
        aggregate_markout_wad=-4 * 10**15,
        previous_magnitude_wad=2 * 10**15,
        alpha_wad=25 * 10**16,
        confidence_wad=75 * 10**16,
    )

    fee_config = FeeConfig(
        base_fee_pips=500,
        minimum_fee_pips=500,
        maximum_fee_pips=10_000,
        gain_fee_pips=500_000,
        maximum_increase_pips=1_000,
        maximum_decrease_pips=500,
        confidence_floor_wad=5 * 10**17,
    )
    fee = calculate_fee(
        signed_risk_wad=4 * 10**15,
        confidence_wad=75 * 10**16,
        persistence_active=True,
        previous_fee_pips=500,
        config=fee_config,
    )
    coverage_config = CoverageConfig(
        target_coverage_wad=125 * WAD // 100,
        coverage_gain_fee_pips=50,
        minimum_estimated_loss_wad=WAD // 1_000,
    )
    coverage_fee_config = FeeConfig(
        base_fee_pips=500,
        minimum_fee_pips=500,
        maximum_fee_pips=10_000,
        gain_fee_pips=450_000,
        maximum_increase_pips=1_000,
        maximum_decrease_pips=500,
        confidence_floor_wad=5 * 10**17,
    )
    coverage = calculate_coverage(WAD, 2 * WAD, True, coverage_config)
    closed_loop_fee = calculate_closed_loop_fee(
        signed_risk_wad=4 * 10**15,
        confidence_wad=75 * 10**16,
        persistence_active=True,
        previous_fee_pips=500,
        fee_config=coverage_fee_config,
        coverage=coverage,
        coverage_config=coverage_config,
    )

    return {
        "schema_version": 2,
        "rounding": "unsigned-down;signed-toward-zero;sqrt-down",
        "markout": markout,
        "trailing_volatility": {
            "series_wad": trailing_series,
            "current_index": 3,
            "window": 3,
            "expected_sigma_wad": sigma_wad,
            "expected_sample_count": sample_count,
        },
        "dead_band": dead_band,
        "epoch": {
            "minimum_observation_notional_wad": epoch_config.minimum_observation_notional_wad,
            "maximum_trade_notional_wad": epoch_config.maximum_trade_notional_wad,
            "minimum_epoch_notional_wad": epoch_config.minimum_epoch_notional_wad,
            "maximum_observation_count": epoch_config.maximum_observation_count,
            "filtered_markouts_wad": [item.filtered_markout_wad for item in epoch_observations],
            "notionals_wad": [item.notional_wad for item in epoch_observations],
            "expected_aggregate_markout_wad": epoch_result.aggregate_markout_wad,
            "expected_eligible_notional_wad": epoch_result.eligible_notional_wad,
            "expected_eligible_observation_count": epoch_result.eligible_observation_count,
            "expected_meets_minimum_epoch_notional": epoch_result.meets_minimum_epoch_notional,
        },
        "reference_dispersion": {
            "prices_wad": [item.price_wad for item in references],
            "weights_wad": [item.weight_wad for item in references],
            "expected_weighted_median_price_wad": median_wad,
            "expected_weighted_mean_absolute_deviation_wad": mean_deviation_wad,
            "expected_normalized_dispersion_wad": dispersion_wad,
        },
        "confidence": {
            "observation_count": 8,
            "target_observation_count": 10,
            "agreeing_notional_wad": 80 * WAD,
            "total_notional_wad": 100 * WAD,
            "reference_dispersion_wad": 5 * 10**15,
            "maximum_dispersion_wad": 2 * 10**16,
            "confidence_cap_wad": 6 * 10**17,
            "expected_count_score_wad": confidence.count_score_wad,
            "expected_agreement_score_wad": confidence.agreement_score_wad,
            "expected_dispersion_score_wad": confidence.dispersion_score_wad,
            "expected_uncapped_confidence_wad": confidence.uncapped_confidence_wad,
            "expected_confidence_wad": confidence.confidence_wad,
        },
        "persistence": {
            "required_toxic_epochs": 3,
            "window_length": 5,
            "steps": persistence_steps,
        },
        "smoothing": {
            "aggregate_markout_wad": -4 * 10**15,
            "previous_magnitude_wad": 2 * 10**15,
            "alpha_wad": 25 * 10**16,
            "confidence_wad": 75 * 10**16,
            "expected_magnitude_wad": risk.magnitude_wad,
            "expected_signed_risk_wad": risk.signed_risk_wad,
        },
        "fee": {
            "signed_risk_wad": 4 * 10**15,
            "confidence_wad": 75 * 10**16,
            "persistence_active": True,
            "previous_fee_pips": 500,
            "base_fee_pips": fee_config.base_fee_pips,
            "minimum_fee_pips": fee_config.minimum_fee_pips,
            "maximum_fee_pips": fee_config.maximum_fee_pips,
            "gain_fee_pips": fee_config.gain_fee_pips,
            "maximum_increase_pips": fee_config.maximum_increase_pips,
            "maximum_decrease_pips": fee_config.maximum_decrease_pips,
            "confidence_floor_wad": fee_config.confidence_floor_wad,
            "expected_premium_pips": fee.premium_pips,
            "expected_target_fee_pips": fee.target_fee_pips,
            "expected_next_fee_pips": fee.next_fee_pips,
        },
        "coverage_fee": {
            "signed_risk_wad": 4 * 10**15,
            "confidence_wad": 75 * 10**16,
            "persistence_active": True,
            "previous_fee_pips": 500,
            "base_fee_pips": coverage_fee_config.base_fee_pips,
            "minimum_fee_pips": coverage_fee_config.minimum_fee_pips,
            "maximum_fee_pips": coverage_fee_config.maximum_fee_pips,
            "gain_fee_pips": coverage_fee_config.gain_fee_pips,
            "coverage_gain_fee_pips": coverage_config.coverage_gain_fee_pips,
            "maximum_increase_pips": coverage_fee_config.maximum_increase_pips,
            "maximum_decrease_pips": coverage_fee_config.maximum_decrease_pips,
            "confidence_floor_wad": coverage_fee_config.confidence_floor_wad,
            "target_coverage_wad": coverage_config.target_coverage_wad,
            "minimum_estimated_loss_wad": coverage_config.minimum_estimated_loss_wad,
            "fee_revenue_wad": coverage.fee_revenue_wad,
            "estimated_loss_wad": coverage.estimated_loss_wad,
            "meets_minimum_epoch_notional": True,
            "expected_coverage_eligible": coverage.eligible,
            "expected_coverage_ratio_wad": coverage.coverage_ratio_wad,
            "expected_coverage_deficit_wad": coverage.coverage_deficit_wad,
            "expected_toxic_premium_pips": closed_loop_fee.toxic_premium_pips,
            "expected_coverage_premium_pips": closed_loop_fee.coverage_premium_pips,
            "expected_total_premium_pips": closed_loop_fee.total_premium_pips,
            "expected_target_fee_pips": closed_loop_fee.target_fee_pips,
            "expected_next_fee_pips": closed_loop_fee.next_fee_pips,
        },
    }


def serialize_vectors(vectors: dict[str, Any]) -> str:
    return json.dumps(vectors, indent=2, sort_keys=True) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("research/datasets/golden_vectors.json"),
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    generated = serialize_vectors(build_vectors())
    if args.check:
        committed = args.output.read_text(encoding="utf-8")
        if committed != generated:
            raise SystemExit(f"golden vectors are stale: regenerate {args.output}")
        return
    args.output.write_text(generated, encoding="utf-8")


if __name__ == "__main__":
    main()
