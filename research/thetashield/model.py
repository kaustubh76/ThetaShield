"""Independent integer reference implementation of the ThetaShield controller.

All normalized prices, markouts, confidence values, and dimensionless parameters
use 1e18 fixed-point integers. Division matches Solidity's round-toward-zero
behavior for signed values. Fee values use Uniswap fee pips, where 1e6 is 100%.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import isqrt
from typing import Sequence

WAD = 10**18
BPS = 10_000
FEE_PIPS = 1_000_000
MAX_TRAILING_OBSERVATIONS = 256
MAX_ABS_MARKOUT_WAD = 10 * WAD
MAX_REFERENCE_SOURCES = 16
DEFAULT_SINGLE_SOURCE_CAP_WAD = 6 * 10**17


def _trunc_div(numerator: int, denominator: int) -> int:
    if denominator == 0:
        raise ZeroDivisionError("division by zero")
    magnitude = abs(numerator) // abs(denominator)
    return -magnitude if (numerator < 0) != (denominator < 0) else magnitude


def _validate_wad_weight(value_wad: int, label: str) -> None:
    if not 0 <= value_wad <= WAD:
        raise ValueError(f"{label} must be between 0 and WAD")


def directional_markout(execution_price_wad: int, reference_price_wad: int, direction: int) -> int:
    """Return d * (reference - execution) / execution in WAD units."""
    if execution_price_wad <= 0:
        raise ValueError("execution price must be positive")
    if reference_price_wad < 0:
        raise ValueError("reference price cannot be negative")
    if direction not in (-1, 1):
        raise ValueError("direction must be +1 or -1")
    unsigned_directional_move = _trunc_div((reference_price_wad - execution_price_wad) * WAD, execution_price_wad)
    return direction * unsigned_directional_move


def population_sigma(values_wad: Sequence[int]) -> int:
    """Return integer population standard deviation in WAD units."""
    if len(values_wad) > MAX_TRAILING_OBSERVATIONS:
        raise ValueError("trailing sample is unbounded")
    if any(abs(value) > MAX_ABS_MARKOUT_WAD for value in values_wad):
        raise ValueError("markout exceeds the documented research bound")
    if len(values_wad) < 2:
        return 0
    mean_wad = _trunc_div(sum(values_wad), len(values_wad))
    variance_wad_squared = sum((value - mean_wad) ** 2 for value in values_wad) // len(values_wad)
    return isqrt(variance_wad_squared)


def trailing_sigma(markouts_wad: Sequence[int], current_index: int, window: int) -> tuple[int, int]:
    """Score index i using [max(0, i-W), i), never including index i."""
    if window <= 0:
        raise ValueError("window must be positive")
    if not 0 <= current_index <= len(markouts_wad):
        raise IndexError("current index is outside the series")
    start = max(0, current_index - window)
    trailing = markouts_wad[start:current_index]
    return population_sigma(trailing), len(trailing)


def dead_band_filter(markout_wad: int, sigma_wad: int, k_wad: int) -> int:
    """Apply sign(m) * max(abs(m) - k*sigma, 0)."""
    if sigma_wad < 0 or k_wad < 0:
        raise ValueError("sigma and k must be non-negative")
    band_wad = sigma_wad * k_wad // WAD
    excess_wad = max(abs(markout_wad) - band_wad, 0)
    if markout_wad < 0:
        return -excess_wad
    return excess_wad


@dataclass(frozen=True)
class EpochObservation:
    filtered_markout_wad: int
    notional_wad: int


@dataclass(frozen=True)
class EpochConfig:
    minimum_observation_notional_wad: int
    maximum_trade_notional_wad: int
    minimum_epoch_notional_wad: int
    maximum_observation_count: int


@dataclass(frozen=True)
class EpochResult:
    aggregate_markout_wad: int
    eligible_notional_wad: int
    eligible_observation_count: int
    meets_minimum_epoch_notional: bool


def aggregate_epoch(observations: Sequence[EpochObservation], config: EpochConfig) -> EpochResult:
    """Return capped-notional weighted filtered markout for one direction."""
    if not 1 <= config.maximum_observation_count <= 256:
        raise ValueError("maximum observation count must be in [1, 256]")
    if config.maximum_trade_notional_wad <= 0:
        raise ValueError("maximum trade notional must be positive")
    if config.minimum_observation_notional_wad <= 0 or config.minimum_epoch_notional_wad <= 0:
        raise ValueError("minimum observation and epoch notionals must be positive")
    if config.minimum_observation_notional_wad > config.maximum_trade_notional_wad:
        raise ValueError("minimum observation notional exceeds the cap")
    if len(observations) > config.maximum_observation_count:
        raise ValueError("too many observations")

    weighted_sum_wad = 0
    total_notional_wad = 0
    count = 0
    for observation in observations:
        if observation.notional_wad < config.minimum_observation_notional_wad:
            continue
        if abs(observation.filtered_markout_wad) > MAX_ABS_MARKOUT_WAD:
            raise ValueError("filtered markout exceeds the documented bound")
        capped_notional_wad = min(observation.notional_wad, config.maximum_trade_notional_wad)
        weighted_sum_wad += _trunc_div(
            observation.filtered_markout_wad * capped_notional_wad,
            WAD,
        )
        total_notional_wad += capped_notional_wad
        count += 1

    aggregate_markout_wad = 0
    if total_notional_wad:
        aggregate_markout_wad = _trunc_div(weighted_sum_wad * WAD, total_notional_wad)
    return EpochResult(
        aggregate_markout_wad=aggregate_markout_wad,
        eligible_notional_wad=total_notional_wad,
        eligible_observation_count=count,
        meets_minimum_epoch_notional=total_notional_wad >= config.minimum_epoch_notional_wad,
    )


def push_persistence(bitmap: int, toxic: bool, required_toxic_epochs: int, window_length: int) -> tuple[int, bool]:
    """Push an epoch and return the bounded bitmap and n-of-k state."""
    if not 1 <= required_toxic_epochs <= window_length <= 256:
        raise ValueError("invalid n-of-k persistence configuration")
    mask = (1 << window_length) - 1
    updated = ((bitmap << 1) | int(toxic)) & mask
    return updated, updated.bit_count() >= required_toxic_epochs


@dataclass(frozen=True)
class ReferenceSample:
    price_wad: int
    weight_wad: int


def reference_price_dispersion(samples: Sequence[ReferenceSample]) -> tuple[int, int, int]:
    """Return weighted median, weighted mean absolute deviation, and normalized dispersion."""
    if not 1 <= len(samples) <= MAX_REFERENCE_SOURCES:
        raise ValueError("invalid reference sample count")
    if any(
        sample.price_wad <= 0
        or sample.price_wad > (1 << 128) - 1
        or not 0 < sample.weight_wad <= WAD
        for sample in samples
    ):
        raise ValueError("invalid reference sample")

    ordered = sorted(samples, key=lambda sample: sample.price_wad)
    total_weight_wad = sum(sample.weight_wad for sample in ordered)
    threshold = (total_weight_wad + 1) // 2
    cumulative = 0
    weighted_median_price_wad = 0
    for sample in ordered:
        cumulative += sample.weight_wad
        if cumulative >= threshold:
            weighted_median_price_wad = sample.price_wad
            break

    weighted_deviation_sum_wad = sum(
        abs(sample.price_wad - weighted_median_price_wad) * sample.weight_wad // WAD
        for sample in ordered
    )
    weighted_mean_absolute_deviation_wad = weighted_deviation_sum_wad * WAD // total_weight_wad
    normalized_dispersion_wad = weighted_mean_absolute_deviation_wad * WAD // weighted_median_price_wad
    return (
        weighted_median_price_wad,
        weighted_mean_absolute_deviation_wad,
        normalized_dispersion_wad,
    )


@dataclass(frozen=True)
class ConfidenceComponents:
    count_score_wad: int
    agreement_score_wad: int
    dispersion_score_wad: int
    uncapped_confidence_wad: int
    confidence_wad: int


def calculate_confidence(
    observation_count: int,
    target_observation_count: int,
    agreeing_notional_wad: int,
    total_notional_wad: int,
    reference_dispersion_wad: int,
    maximum_dispersion_wad: int,
    confidence_cap_wad: int,
) -> ConfidenceComponents:
    """Calculate the fully mechanical confidence formula using integer arithmetic."""
    _validate_wad_weight(confidence_cap_wad, "confidence cap")
    if target_observation_count <= 0 or total_notional_wad <= 0 or maximum_dispersion_wad <= 0:
        raise ValueError("confidence denominators must be positive")
    if observation_count < 0 or reference_dispersion_wad < 0:
        raise ValueError("confidence inputs cannot be negative")
    if not 0 <= agreeing_notional_wad <= total_notional_wad:
        raise ValueError("agreeing notional is outside total notional")

    count_score_wad = min(observation_count, target_observation_count) * WAD // target_observation_count
    agreement_wad = agreeing_notional_wad * WAD // total_notional_wad
    agreement_score_wad = max((agreement_wad - WAD // 2) * 2, 0)
    dispersion_score_wad = (
        max(maximum_dispersion_wad - reference_dispersion_wad, 0) * WAD
        // maximum_dispersion_wad
    )
    count_agreement_wad = count_score_wad * agreement_score_wad // WAD
    uncapped_confidence_wad = count_agreement_wad * dispersion_score_wad // WAD
    return ConfidenceComponents(
        count_score_wad=count_score_wad,
        agreement_score_wad=agreement_score_wad,
        dispersion_score_wad=dispersion_score_wad,
        uncapped_confidence_wad=uncapped_confidence_wad,
        confidence_wad=min(uncapped_confidence_wad, confidence_cap_wad),
    )


@dataclass(frozen=True)
class RiskResult:
    magnitude_wad: int
    signed_risk_wad: int


def smooth_directional_risk(
    aggregate_markout_wad: int,
    previous_magnitude_wad: int,
    alpha_wad: int,
    confidence_wad: int,
) -> RiskResult:
    """Smooth magnitude and apply the current aggregate sign and confidence."""
    _validate_wad_weight(alpha_wad, "alpha")
    _validate_wad_weight(confidence_wad, "confidence")
    if previous_magnitude_wad < 0:
        raise ValueError("previous magnitude cannot be negative")
    magnitude_wad = (
        abs(aggregate_markout_wad) * alpha_wad // WAD
        + previous_magnitude_wad * (WAD - alpha_wad) // WAD
    )
    risk_magnitude_wad = magnitude_wad * confidence_wad // WAD
    direction = (aggregate_markout_wad > 0) - (aggregate_markout_wad < 0)
    return RiskResult(magnitude_wad, direction * risk_magnitude_wad)


@dataclass(frozen=True)
class FeeConfig:
    base_fee_pips: int
    minimum_fee_pips: int
    maximum_fee_pips: int
    gain_fee_pips: int
    maximum_increase_pips: int
    maximum_decrease_pips: int
    confidence_floor_wad: int


@dataclass(frozen=True)
class FeeResult:
    premium_pips: int
    target_fee_pips: int
    next_fee_pips: int


def calculate_fee(
    signed_risk_wad: int,
    confidence_wad: int,
    persistence_active: bool,
    previous_fee_pips: int,
    config: FeeConfig,
) -> FeeResult:
    """Map positive active risk to a bounded and rate-limited directional fee."""
    if not config.minimum_fee_pips <= config.base_fee_pips <= config.maximum_fee_pips <= FEE_PIPS:
        raise ValueError("invalid fee bounds")
    _validate_wad_weight(config.confidence_floor_wad, "confidence floor")
    _validate_wad_weight(confidence_wad, "confidence")
    if not config.minimum_fee_pips <= previous_fee_pips <= config.maximum_fee_pips:
        raise ValueError("previous fee is outside configured bounds")

    premium_pips = 0
    if persistence_active and confidence_wad >= config.confidence_floor_wad and signed_risk_wad > 0:
        premium_pips = signed_risk_wad * config.gain_fee_pips // WAD
        premium_pips = min(premium_pips, config.maximum_fee_pips - config.base_fee_pips)
    target_fee_pips = min(
        max(config.base_fee_pips + premium_pips, config.minimum_fee_pips),
        config.maximum_fee_pips,
    )

    if target_fee_pips > previous_fee_pips:
        next_fee_pips = min(target_fee_pips, previous_fee_pips + config.maximum_increase_pips)
    else:
        next_fee_pips = max(target_fee_pips, previous_fee_pips - config.maximum_decrease_pips)
        next_fee_pips = min(max(next_fee_pips, config.minimum_fee_pips), config.maximum_fee_pips)
    return FeeResult(premium_pips, target_fee_pips, next_fee_pips)


@dataclass(frozen=True)
class CoverageConfig:
    target_coverage_wad: int
    coverage_gain_fee_pips: int
    minimum_estimated_loss_wad: int


@dataclass(frozen=True)
class CoverageResult:
    fee_revenue_wad: int
    estimated_loss_wad: int
    coverage_ratio_wad: int
    coverage_deficit_wad: int
    eligible: bool


@dataclass(frozen=True)
class ClosedLoopFeeResult:
    toxic_premium_pips: int
    coverage_premium_pips: int
    total_premium_pips: int
    target_fee_pips: int
    next_fee_pips: int


def calculate_coverage(
    fee_revenue_wad: int,
    estimated_loss_wad: int,
    meets_minimum_epoch_notional: bool,
    config: CoverageConfig,
) -> CoverageResult:
    """Return a bounded coverage signal without inventing a deficit for zero-loss epochs."""
    if fee_revenue_wad < 0 or estimated_loss_wad < 0:
        raise ValueError("coverage accounting cannot be negative")
    if config.target_coverage_wad <= 0 or config.coverage_gain_fee_pips < 0:
        raise ValueError("invalid coverage configuration")
    if config.minimum_estimated_loss_wad <= 0:
        raise ValueError("minimum estimated loss must be positive")

    eligible = meets_minimum_epoch_notional and estimated_loss_wad >= config.minimum_estimated_loss_wad
    if not eligible:
        return CoverageResult(
            fee_revenue_wad=fee_revenue_wad,
            estimated_loss_wad=estimated_loss_wad,
            coverage_ratio_wad=config.target_coverage_wad,
            coverage_deficit_wad=0,
            eligible=False,
        )

    ratio_wad = fee_revenue_wad * WAD // estimated_loss_wad
    deficit_wad = max(config.target_coverage_wad - ratio_wad, 0)
    return CoverageResult(
        fee_revenue_wad=fee_revenue_wad,
        estimated_loss_wad=estimated_loss_wad,
        coverage_ratio_wad=ratio_wad,
        coverage_deficit_wad=deficit_wad,
        eligible=True,
    )


def calculate_closed_loop_fee(
    signed_risk_wad: int,
    confidence_wad: int,
    persistence_active: bool,
    previous_fee_pips: int,
    fee_config: FeeConfig,
    coverage: CoverageResult,
    coverage_config: CoverageConfig,
) -> ClosedLoopFeeResult:
    """Compose toxic-flow and coverage-deficit premiums before one shared rate limit."""
    if not fee_config.minimum_fee_pips <= fee_config.base_fee_pips <= fee_config.maximum_fee_pips <= FEE_PIPS:
        raise ValueError("invalid fee bounds")
    _validate_wad_weight(fee_config.confidence_floor_wad, "confidence floor")
    _validate_wad_weight(confidence_wad, "confidence")
    if not fee_config.minimum_fee_pips <= previous_fee_pips <= fee_config.maximum_fee_pips:
        raise ValueError("previous fee is outside configured bounds")

    toxic_premium_pips = 0
    coverage_premium_pips = 0
    active = persistence_active and confidence_wad >= fee_config.confidence_floor_wad and signed_risk_wad > 0
    if active:
        toxic_premium_pips = signed_risk_wad * fee_config.gain_fee_pips // WAD
        if coverage.eligible:
            coverage_premium_pips = (
                coverage.coverage_deficit_wad * coverage_config.coverage_gain_fee_pips // WAD
            )

    maximum_premium = fee_config.maximum_fee_pips - fee_config.base_fee_pips
    total_premium_pips = min(toxic_premium_pips + coverage_premium_pips, maximum_premium)
    target_fee_pips = min(
        max(fee_config.base_fee_pips + total_premium_pips, fee_config.minimum_fee_pips),
        fee_config.maximum_fee_pips,
    )
    if target_fee_pips > previous_fee_pips:
        next_fee_pips = min(target_fee_pips, previous_fee_pips + fee_config.maximum_increase_pips)
    else:
        next_fee_pips = max(target_fee_pips, previous_fee_pips - fee_config.maximum_decrease_pips)
        next_fee_pips = min(max(next_fee_pips, fee_config.minimum_fee_pips), fee_config.maximum_fee_pips)
    return ClosedLoopFeeResult(
        toxic_premium_pips=min(toxic_premium_pips, maximum_premium),
        coverage_premium_pips=min(coverage_premium_pips, maximum_premium),
        total_premium_pips=total_premium_pips,
        target_fee_pips=target_fee_pips,
        next_fee_pips=next_fee_pips,
    )
