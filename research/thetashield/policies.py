"""Five fairly bounded fee policies evaluated by the Phase 5 harness."""

from __future__ import annotations

from dataclasses import dataclass

from research.thetashield.model import (
    DEFAULT_SINGLE_SOURCE_CAP_WAD,
    WAD,
    EpochConfig,
    EpochObservation,
    FeeConfig,
    aggregate_epoch,
    calculate_confidence,
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


class FeePolicy:
    name = "abstract"

    def __init__(self, config: ResearchConfig, gain_fee_pips: int) -> None:
        self.config = config
        self.gain_fee_pips = gain_fee_pips
        self.calculated_fees = {-1: config.base_fee_pips, 1: config.base_fee_pips}

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
        )

    def _append(self, direction: int, observation: ScoredObservation) -> tuple[int, int, bool] | None:
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
        records.clear()
        return aggregate.aggregate_markout_wad, confidence_wad, included_cold_start


class DeadBandNoPersistencePolicy(DeadBandPolicyBase):
    name = "dead_band_no_persistence"

    def observe(self, event: TradeEvent) -> bool:
        completed = self._append(event.direction, self._score(event))
        if completed is None:
            return False
        aggregate_wad, confidence_wad, included_cold_start = completed
        signed_risk_wad = aggregate_wad * confidence_wad // WAD
        if included_cold_start:
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

    def observe(self, event: TradeEvent) -> bool:
        completed = self._append(event.direction, self._score(event))
        if completed is None:
            return False
        aggregate_wad, confidence_wad, included_cold_start = completed
        risk = smooth_directional_risk(
            aggregate_wad,
            self._magnitude[event.direction],
            self.config.alpha_wad,
            confidence_wad,
        )
        self._magnitude[event.direction] = risk.magnitude_wad
        toxic = not included_cold_start and risk.signed_risk_wad > self.config.toxic_threshold_wad
        bitmap, active = push_persistence(
            self._persistence[event.direction],
            toxic,
            self.config.required_toxic_epochs,
            self.config.persistence_window,
        )
        self._persistence[event.direction] = bitmap
        if included_cold_start:
            confidence_wad = 0
        self._set_directional_fee(event.direction, risk.signed_risk_wad, confidence_wad, active)
        return True


def build_policy(name: str, config: ResearchConfig, gain_fee_pips: int) -> FeePolicy:
    policy_types = {
        "fixed_fee": FixedFeePolicy,
        "volatility_only": VolatilityOnlyPolicy,
        "raw_positive_markout": RawPositiveMarkoutPolicy,
        "dead_band_no_persistence": DeadBandNoPersistencePolicy,
        "thetashield": ThetaShieldPolicy,
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
