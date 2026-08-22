"""Deterministic Phase 1 experiment for symmetric benign markout noise."""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Any

from research.thetashield.model import (
    WAD,
    calculate_confidence,
    dead_band_filter,
    push_persistence,
    smooth_directional_risk,
    trailing_sigma,
)

SEED = 1_337
OBSERVATION_COUNT = 4_096
NOISE_SIGMA_WAD = 2 * 10**15
TRAILING_WINDOW = 32
MINIMUM_TRAILING_OBSERVATIONS = 32
DEAD_BAND_K_WAD = 15 * 10**17
EPOCH_SIZE = 8
TOXIC_THRESHOLD_WAD = 75 * 10**13
EWMA_ALPHA_WAD = 25 * 10**16
SINGLE_SOURCE_CAP_WAD = 6 * 10**17


def run_experiment() -> dict[str, Any]:
    random_source = random.Random(SEED)
    half_sample = [round(random_source.gauss(0, NOISE_SIGMA_WAD)) for _ in range(OBSERVATION_COUNT // 2)]
    markouts_wad = half_sample + [-value for value in half_sample]
    random_source.shuffle(markouts_wad)

    filtered_wad: list[int] = []
    sigma_used_wad: list[int] = []
    for index, markout_wad in enumerate(markouts_wad):
        sigma_wad, sample_count = trailing_sigma(markouts_wad, index, TRAILING_WINDOW)
        sigma_used_wad.append(sigma_wad)
        if sample_count < MINIMUM_TRAILING_OBSERVATIONS:
            filtered_wad.append(0)
            continue
        filtered_wad.append(dead_band_filter(markout_wad, sigma_wad, DEAD_BAND_K_WAD))

    bitmap = 0
    previous_magnitude_wad = 0
    active_epochs = 0
    toxic_epochs = 0
    epoch_count = 0
    for start in range(MINIMUM_TRAILING_OBSERVATIONS, OBSERVATION_COUNT, EPOCH_SIZE):
        epoch = filtered_wad[start : start + EPOCH_SIZE]
        if len(epoch) < EPOCH_SIZE:
            break
        epoch_count += 1
        aggregate_wad = sum(epoch) // len(epoch)
        if aggregate_wad > 0:
            agreeing_count = sum(value > 0 for value in epoch)
        elif aggregate_wad < 0:
            agreeing_count = sum(value < 0 for value in epoch)
        else:
            agreeing_count = 0
        confidence = calculate_confidence(
            observation_count=len(epoch),
            target_observation_count=EPOCH_SIZE,
            agreeing_notional_wad=agreeing_count * WAD,
            total_notional_wad=len(epoch) * WAD,
            reference_dispersion_wad=0,
            maximum_dispersion_wad=10**16,
            confidence_cap_wad=SINGLE_SOURCE_CAP_WAD,
        )
        risk = smooth_directional_risk(
            aggregate_wad,
            previous_magnitude_wad,
            EWMA_ALPHA_WAD,
            confidence.confidence_wad,
        )
        previous_magnitude_wad = risk.magnitude_wad
        toxic = risk.signed_risk_wad > TOXIC_THRESHOLD_WAD
        toxic_epochs += int(toxic)
        bitmap, active = push_persistence(bitmap, toxic, 3, 5)
        active_epochs += int(active)

    burst_series = [0] * TRAILING_WINDOW + [50 * 10**15]
    excluded_sigma_wad, _ = trailing_sigma(burst_series, TRAILING_WINDOW, TRAILING_WINDOW)
    inclusive_sigma_wad, _ = trailing_sigma(burst_series, TRAILING_WINDOW + 1, TRAILING_WINDOW + 1)

    scored = filtered_wad[MINIMUM_TRAILING_OBSERVATIONS:]
    nonzero = [value for value in scored if value]
    positive_count = sum(value > 0 for value in nonzero)
    negative_count = sum(value < 0 for value in nonzero)
    return {
        "schema_version": 1,
        "experiment": "phase1_symmetric_benign_noise",
        "seed": SEED,
        "observation_count": OBSERVATION_COUNT,
        "noise_sigma_wad": NOISE_SIGMA_WAD,
        "trailing_window": TRAILING_WINDOW,
        "minimum_trailing_observations": MINIMUM_TRAILING_OBSERVATIONS,
        "dead_band_k_wad": DEAD_BAND_K_WAD,
        "epoch_size": EPOCH_SIZE,
        "persistence_n": 3,
        "persistence_k": 5,
        "toxic_threshold_wad": TOXIC_THRESHOLD_WAD,
        "raw_signed_sum_wad": sum(markouts_wad),
        "raw_mean_wad": sum(markouts_wad) // len(markouts_wad),
        "filtered_signed_sum_wad": sum(scored),
        "filtered_mean_wad": sum(scored) // len(scored),
        "mean_trailing_sigma_wad": sum(sigma_used_wad[MINIMUM_TRAILING_OBSERVATIONS:])
        // len(sigma_used_wad[MINIMUM_TRAILING_OBSERVATIONS:]),
        "nonzero_filtered_observations": len(nonzero),
        "positive_filtered_observations": positive_count,
        "negative_filtered_observations": negative_count,
        "epoch_count": epoch_count,
        "toxic_epoch_count": toxic_epochs,
        "active_epoch_count": active_epochs,
        "false_positive_active_rate_wad": active_epochs * WAD // epoch_count,
        "burst_sigma_excluding_current_wad": excluded_sigma_wad,
        "burst_sigma_including_current_wad": inclusive_sigma_wad,
    }


def validate_result(result: dict[str, Any]) -> None:
    if result["raw_signed_sum_wad"] != 0:
        raise AssertionError("antithetic benign input must have zero raw signed sum")
    if abs(result["filtered_mean_wad"]) > 2 * 10**13:
        raise AssertionError("filtered benign mean exceeds the 0.2 bp Phase 1 tolerance")
    if result["false_positive_active_rate_wad"] > WAD // 100:
        raise AssertionError("benign false-positive active rate exceeds 1%")
    if result["burst_sigma_excluding_current_wad"] != 0:
        raise AssertionError("current burst affected its own trailing sigma")
    if result["burst_sigma_including_current_wad"] <= 0:
        raise AssertionError("self-inclusion control did not detect burst-induced widening")


def serialize(result: dict[str, Any]) -> str:
    return json.dumps(result, indent=2, sort_keys=True) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("research/reports/phase1_benign_noise.json"),
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    result = run_experiment()
    validate_result(result)
    generated = serialize(result)
    if args.check:
        committed = args.output.read_text(encoding="utf-8")
        if committed != generated:
            raise SystemExit(f"experiment report is stale: regenerate {args.output}")
        return
    args.output.write_text(generated, encoding="utf-8")


if __name__ == "__main__":
    main()
