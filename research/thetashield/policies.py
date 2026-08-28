"""Bounded fee policies used by the historical and closed-loop research harnesses."""

from __future__ import annotations

from dataclasses import dataclass

from research.thetashield.model import (
    DEFAULT_SINGLE_SOURCE_CAP_WAD,
    FEE_PIPS,
    WAD,
    CoverageConfig,
    CoverageResult,
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
    population_sigma,
    push_persistence,
    smooth_directional_risk,
)
from research.thetashield.scenarios import TradeEvent

POLICY_NAMES = (
    "fixed_fee",
    "volatility_only",
    "raw_positive_markout",
    "dead_band_no_persistence",
    "thetashield",
)
EXTENDED_POLICY_NAMES = (*POLICY_NAMES, "coverage_thetashield")
TARGET_COVERAGE_WAD = 125 * WAD // 100
COVERAGE_GAIN_FEE_PIPS = 50
MINIMUM_ESTIMATED_LOSS_WAD = WAD // 1_000


@dataclass(frozen=True)
class ResearchConfig:
    base_fee_pips: int = 500
    minimum_fee_pips: int = 500
    maximum_fee_pips: int = 10_000
    maximum_increase_pips: int = 1_000
    maximum_decrease_pips: int = 500
    trailing_window: int = 32
    minimum_trailing_observations: int = 32
    dead_band_k_wad: int = 15 * 10**17
    epoch_observation_count: int = 8
    minimum_observation_notional_wad: int = WAD
    maximum_trade_notional_wad: int = 100 * WAD
    minimum_epoch_notional_wad: int = 8 * WAD
    required_toxic_epochs: int = 3
    persistence_window: int = 5
    target_observation_count: int = 8
    maximum_reference_dispersion_wad: int = 2 * 10**16
    confidence_cap_wad: int = DEFAULT_SINGLE_SOURCE_CAP_WAD
    confidence_floor_wad: int = 5 * 10**17
    toxic_threshold_wad: int = 75 * 10**13
    alpha_wad: int = 25 * 10**16
    fast_path_enabled: bool = False
    fast_path_confidence_floor_wad: int = 55 * 10**16
    fast_path_toxic_threshold_wad: int = 2 * 10**15
    fast_path_hold_epochs: int = 0
    markout_horizon_steps: int = 1
    markout_delay_steps: int = 2
    callback_delay_steps: int = 1
    recommendation_ttl_steps: int = 12


@dataclass(frozen=True)
class ScoredObservation:
    raw_markout_wad: int
    filtered_markout_wad: int
    notional_wad: int
    reference_dispersion_wad: int
    cold_start: bool
    applied_fee_pips: int


@dataclass(frozen=True)
class CompletedEpoch:
    aggregate_markout_wad: int
    confidence_wad: int
    included_cold_start: bool
    fee_revenue_wad: int
    estimated_loss_wad: int
    meets_minimum_epoch_notional: bool


class FeePolicy:
    name = "abstract"

    def __init__(self, config: ResearchConfig, gain_fee_pips: int) -> None:
        self.config = config
        self.gain_fee_pips = gain_fee_pips
        self.calculated_fees = {-1: config.base_fee_pips, 1: config.base_fee_pips}
        self.coverage_history: list[CoverageResult] = []

    def observe(self, event: TradeEvent) -> bool:
        raise NotImplementedError

    def _fee_config(self) -> FeeConfig:
        return FeeConfig(
            base_fee_pips=self.config.base_fee_pips,
            minimum_fee_pips=self.config.minimum_fee_pips,
            maximum_fee_pips=self.config.maximum_fee_pips,
            gain_fee_pips=self.gain_fee_pips,
            maximum_increase_pips=self.config.maximum_increase_pips,
            maximum_decrease_pips=self.config.maximum_decrease_pips,
            confidence_floor_wad=self.config.confidence_floor_wad,
        )

    def _set_directional_fee(
        self,
        direction: int,
        signed_risk_wad: int,
        confidence_wad: int,
        persistence_active: bool,
    ) -> None:
        result = calculate_fee(
            signed_risk_wad,
            confidence_wad,
            persistence_active,
            self.calculated_fees[direction],
            self._fee_config(),
        )
        self.calculated_fees[direction] = result.next_fee_pips


class FixedFeePolicy(FeePolicy):
    name = "fixed_fee"

    def observe(self, event: TradeEvent) -> bool:
        del event
        return False


class VolatilityOnlyPolicy(FeePolicy):
    name = "volatility_only"

    def __init__(self, config: ResearchConfig, gain_fee_pips: int) -> None:
        super().__init__(config, gain_fee_pips)
        self._history: list[int] = []
        self._epoch_count = 0

    def observe(self, event: TradeEvent) -> bool:
        markout_wad = directional_markout(event.execution_price_wad, event.reference_price_wad, event.direction)
        trailing = self._history[-self.config.trailing_window :]
        sigma_wad = population_sigma(trailing)
        cold_start = len(trailing) < self.config.minimum_trailing_observations
        self._history.append(markout_wad)
        self._epoch_count += 1
        if self._epoch_count < self.config.epoch_observation_count:
            return False
        self._epoch_count = 0

        risk_wad = 0 if cold_start else sigma_wad
        confidence_wad = 0 if cold_start else WAD
        for direction in (-1, 1):
            self._set_directional_fee(direction, risk_wad, confidence_wad, True)
        return True


class RawPositiveMarkoutPolicy(FeePolicy):
    name = "raw_positive_markout"

    def __init__(self, config: ResearchConfig, gain_fee_pips: int) -> None:
        super().__init__(config, gain_fee_pips)
        self._epochs = {-1: [], 1: []}

    def observe(self, event: TradeEvent) -> bool:
        markout_wad = directional_markout(event.execution_price_wad, event.reference_price_wad, event.direction)
        records = self._epochs[event.direction]
        records.append(EpochObservation(markout_wad, event.notional_wad))
        if len(records) < self.config.epoch_observation_count:
            return False
        aggregate = aggregate_epoch(records, _epoch_config(self.config))
        records.clear()
        risk_wad = aggregate.aggregate_markout_wad if aggregate.meets_minimum_epoch_notional else 0
        confidence_wad = WAD if aggregate.meets_minimum_epoch_notional else 0
        self._set_directional_fee(event.direction, risk_wad, confidence_wad, True)
        return True


class DeadBandPolicyBase(FeePolicy):
    def __init__(self, config: ResearchConfig, gain_fee_pips: int) -> None:
        super().__init__(config, gain_fee_pips)
        self._markout_history = {-1: [], 1: []}
        self._epochs = {-1: [], 1: []}

    def _score(self, event: TradeEvent) -> ScoredObservation:
        history = self._markout_history[event.direction]
        trailing = history[-self.config.trailing_window :]
        sigma_wad = population_sigma(trailing)
        cold_start = len(trailing) < self.config.minimum_trailing_observations
        raw_markout_wad = directional_markout(
            event.execution_price_wad, event.reference_price_wad, event.direction
        )
        filtered_markout_wad = dead_band_filter(raw_markout_wad, sigma_wad, self.config.dead_band_k_wad)
        history.append(raw_markout_wad)
        return ScoredObservation(
            raw_markout_wad=raw_markout_wad,
            filtered_markout_wad=filtered_markout_wad,
            notional_wad=event.notional_wad,
            reference_dispersion_wad=event.reference_dispersion_wad,
            cold_start=cold_start,
            applied_fee_pips=event.applied_fee_pips or self.config.base_fee_pips,
        )

    def _append(self, direction: int, observation: ScoredObservation) -> CompletedEpoch | None:
        records = self._epochs[direction]
        records.append(observation)
        if len(records) < self.config.epoch_observation_count:
            return None

        aggregate = aggregate_epoch(
            [EpochObservation(record.filtered_markout_wad, record.notional_wad) for record in records],
            _epoch_config(self.config),
        )
        eligible = [
            record
            for record in records
            if record.notional_wad >= self.config.minimum_observation_notional_wad
        ]
        included_cold_start = any(record.cold_start for record in eligible)
        capped = [min(record.notional_wad, self.config.maximum_trade_notional_wad) for record in eligible]
        total_notional_wad = sum(capped)
        agreeing_notional_wad = sum(
            notional
            for record, notional in zip(eligible, capped, strict=True)
            if (aggregate.aggregate_markout_wad > 0 and record.filtered_markout_wad > 0)
            or (aggregate.aggregate_markout_wad < 0 and record.filtered_markout_wad < 0)
        )
        maximum_dispersion_wad = max(
            (record.reference_dispersion_wad for record in eligible),
            default=0,
        )
        confidence_wad = 0
        if aggregate.meets_minimum_epoch_notional and aggregate.eligible_observation_count:
            confidence_wad = calculate_confidence(
                aggregate.eligible_observation_count,
                self.config.target_observation_count,
                agreeing_notional_wad,
                total_notional_wad,
                maximum_dispersion_wad,
                self.config.maximum_reference_dispersion_wad,
                self.config.confidence_cap_wad,
            ).confidence_wad
        fee_revenue_wad = sum(
            record.notional_wad * record.applied_fee_pips // FEE_PIPS
            for record in eligible
        )
        estimated_loss_wad = sum(
            record.notional_wad * max(record.raw_markout_wad, 0) // WAD
            for record in eligible
        )
        records.clear()
        return CompletedEpoch(
            aggregate_markout_wad=aggregate.aggregate_markout_wad,
            confidence_wad=confidence_wad,
            included_cold_start=included_cold_start,
            fee_revenue_wad=fee_revenue_wad,
            estimated_loss_wad=estimated_loss_wad,
            meets_minimum_epoch_notional=aggregate.meets_minimum_epoch_notional,
        )


class DeadBandNoPersistencePolicy(DeadBandPolicyBase):
    name = "dead_band_no_persistence"

    def observe(self, event: TradeEvent) -> bool:
        completed = self._append(event.direction, self._score(event))
        if completed is None:
            return False
        confidence_wad = completed.confidence_wad
        signed_risk_wad = completed.aggregate_markout_wad * confidence_wad // WAD
        if completed.included_cold_start:
            signed_risk_wad = 0
            confidence_wad = 0
        self._set_directional_fee(event.direction, signed_risk_wad, confidence_wad, True)
        return True


class ThetaShieldPolicy(DeadBandPolicyBase):
    name = "thetashield"

    def __init__(self, config: ResearchConfig, gain_fee_pips: int) -> None:
        super().__init__(config, gain_fee_pips)
        self._persistence = {-1: 0, 1: 0}
        self._magnitude = {-1: 0, 1: 0}
        self._fast_path_hold = {-1: 0, 1: 0}

    def observe(self, event: TradeEvent) -> bool:
        completed = self._append(event.direction, self._score(event))
        if completed is None:
            return False
        confidence_wad = completed.confidence_wad
        risk = smooth_directional_risk(
            completed.aggregate_markout_wad,
            self._magnitude[event.direction],
            self.config.alpha_wad,
            confidence_wad,
        )
        self._magnitude[event.direction] = risk.magnitude_wad
        toxic = not completed.included_cold_start and risk.signed_risk_wad > self.config.toxic_threshold_wad
        bitmap, active = push_persistence(
            self._persistence[event.direction],
            toxic,
            self.config.required_toxic_epochs,
            self.config.persistence_window,
        )
        self._persistence[event.direction] = bitmap
        instant_risk_wad = completed.aggregate_markout_wad * confidence_wad // WAD
        fast_path_triggered = (
            self.config.fast_path_enabled
            and not completed.included_cold_start
            and confidence_wad >= self.config.fast_path_confidence_floor_wad
            and instant_risk_wad > self.config.fast_path_toxic_threshold_wad
        )
        if fast_path_triggered:
            fast_path_active = True
            self._fast_path_hold[event.direction] = self.config.fast_path_hold_epochs
        elif self._fast_path_hold[event.direction] > 0:
            fast_path_active = True
            self._fast_path_hold[event.direction] -= 1
        else:
            fast_path_active = False
        if completed.included_cold_start:
            confidence_wad = 0
        self._set_directional_fee(
            event.direction,
            risk.signed_risk_wad,
            confidence_wad,
            active or fast_path_active,
        )
        return True


class CoverageThetaShieldPolicy(ThetaShieldPolicy):
    """ThetaShield with a persistence-gated coverage-deficit feedback premium."""

    name = "coverage_thetashield"

    def _coverage_config(self) -> CoverageConfig:
        return CoverageConfig(
            target_coverage_wad=TARGET_COVERAGE_WAD,
            coverage_gain_fee_pips=COVERAGE_GAIN_FEE_PIPS,
            minimum_estimated_loss_wad=MINIMUM_ESTIMATED_LOSS_WAD,
        )

    def observe(self, event: TradeEvent) -> bool:
        completed = self._append(event.direction, self._score(event))
        if completed is None:
            return False
        confidence_wad = completed.confidence_wad
        risk = smooth_directional_risk(
            completed.aggregate_markout_wad,
            self._magnitude[event.direction],
            self.config.alpha_wad,
            confidence_wad,
        )
        self._magnitude[event.direction] = risk.magnitude_wad
        toxic = (
            not completed.included_cold_start
            and completed.meets_minimum_epoch_notional
            and risk.signed_risk_wad > self.config.toxic_threshold_wad
        )
        bitmap, persistence_active = push_persistence(
            self._persistence[event.direction],
            toxic,
            self.config.required_toxic_epochs,
            self.config.persistence_window,
        )
        self._persistence[event.direction] = bitmap

        instant_risk_wad = completed.aggregate_markout_wad * confidence_wad // WAD
        fast_path_triggered = (
            self.config.fast_path_enabled
            and not completed.included_cold_start
            and confidence_wad >= self.config.fast_path_confidence_floor_wad
            and instant_risk_wad > self.config.fast_path_toxic_threshold_wad
        )
        if fast_path_triggered:
            fast_path_active = True
            self._fast_path_hold[event.direction] = self.config.fast_path_hold_epochs
        elif self._fast_path_hold[event.direction] > 0:
            fast_path_active = True
            self._fast_path_hold[event.direction] -= 1
        else:
            fast_path_active = False

        coverage = calculate_coverage(
            completed.fee_revenue_wad,
            completed.estimated_loss_wad,
            completed.meets_minimum_epoch_notional and not completed.included_cold_start,
            self._coverage_config(),
        )
        self.coverage_history.append(coverage)
        if completed.included_cold_start:
            confidence_wad = 0
        fee = calculate_closed_loop_fee(
            signed_risk_wad=risk.signed_risk_wad,
            confidence_wad=confidence_wad,
            persistence_active=persistence_active or fast_path_active,
            previous_fee_pips=self.calculated_fees[event.direction],
            fee_config=self._fee_config(),
            coverage=coverage,
            coverage_config=self._coverage_config(),
        )
        self.calculated_fees[event.direction] = fee.next_fee_pips
        return True


def build_policy(name: str, config: ResearchConfig, gain_fee_pips: int) -> FeePolicy:
    policy_types = {
        "fixed_fee": FixedFeePolicy,
        "volatility_only": VolatilityOnlyPolicy,
        "raw_positive_markout": RawPositiveMarkoutPolicy,
        "dead_band_no_persistence": DeadBandNoPersistencePolicy,
        "thetashield": ThetaShieldPolicy,
        "coverage_thetashield": CoverageThetaShieldPolicy,
    }
    try:
        return policy_types[name](config, gain_fee_pips)
    except KeyError as error:
        raise KeyError(f"unknown policy: {name}") from error


def _epoch_config(config: ResearchConfig) -> EpochConfig:
    return EpochConfig(
        minimum_observation_notional_wad=config.minimum_observation_notional_wad,
        maximum_trade_notional_wad=config.maximum_trade_notional_wad,
        minimum_epoch_notional_wad=config.minimum_epoch_notional_wad,
        maximum_observation_count=config.epoch_observation_count,
    )
