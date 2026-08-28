"""Shared-stream economic and delivery simulator for Phase 5 policy comparisons."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, replace
from decimal import Decimal, localcontext
from math import isqrt
from statistics import mean

from research.thetashield.model import FEE_PIPS, WAD, directional_markout
from research.thetashield.policies import ResearchConfig, build_policy
from research.thetashield.scenarios import TradeEvent


@dataclass(frozen=True)
class FlowElasticityConfig:
    """Fee sensitivity for deterministic counterfactual flow retention."""

    benign_beta_wad: int = 300 * WAD
    toxic_beta_wad: int = 40 * WAD


def retention_probability_wad(
    fee_pips: int,
    base_fee_pips: int,
    beta_wad: int,
) -> int:
    """Return exp(-beta * fee premium) in WAD without binary floating point."""
    if not 0 <= base_fee_pips <= fee_pips <= FEE_PIPS:
        raise ValueError("invalid fee for elasticity model")
    if beta_wad < 0:
        raise ValueError("elasticity beta cannot be negative")
    premium_pips = fee_pips - base_fee_pips
    if premium_pips == 0 or beta_wad == 0:
        return WAD
    with localcontext() as context:
        context.prec = 60
        exponent = -(Decimal(beta_wad) / Decimal(WAD)) * (
            Decimal(premium_pips) / Decimal(FEE_PIPS)
        )
        probability = exponent.exp()
        return max(0, min(WAD, int(probability * Decimal(WAD))))


def deterministic_flow_draw_wad(event: TradeEvent) -> int:
    """Return a policy-independent reproducible draw in [0, WAD)."""
    payload = ":".join(
        str(value)
        for value in (
            event.index,
            event.timestamp_seconds,
            event.direction,
            event.notional_wad,
            event.execution_price_wad,
            event.reference_price_wad,
            int(event.is_toxic),
        )
    ).encode("ascii")
    digest = hashlib.sha256(payload).digest()
    return int.from_bytes(digest[:16], "big") * WAD // (1 << 128)


@dataclass(frozen=True)
class Recommendation:
    sequence: int
    fees: dict[int, int]
    generated_step: int
    valid_until_step: int
    source_event_index: int


class OriginFeeState:
    def __init__(self, base_fee_pips: int) -> None:
        self.base_fee_pips = base_fee_pips
        self.fees = {-1: base_fee_pips, 1: base_fee_pips}
        self.valid_until_step = -1
        self.last_sequence = 0

    def current_fee(self, direction: int, step: int) -> int:
        if step >= self.valid_until_step:
            return self.base_fee_pips
        return self.fees[direction]

    def apply(self, recommendation: Recommendation, step: int) -> bool:
        if recommendation.sequence <= self.last_sequence or step >= recommendation.valid_until_step:
            return False
        self.last_sequence = recommendation.sequence
        self.fees = dict(recommendation.fees)
        self.valid_until_step = recommendation.valid_until_step
        return True


@dataclass
class DeliveryStats:
    applied_callbacks: int = 0
    missing_callbacks: int = 0
    rejected_callbacks: int = 0
    callback_latencies: list[int] | None = None

    def __post_init__(self) -> None:
        if self.callback_latencies is None:
            self.callback_latencies = []


class DeliveryCoordinator:
    def __init__(self, mode: str, origin: OriginFeeState) -> None:
        self.mode = mode
        self.origin = origin
        self.queue: dict[int, list[Recommendation]] = {}
        self.held: Recommendation | None = None
        self.stats = DeliveryStats()

    def schedule(self, step: int, recommendation: Recommendation) -> None:
        self.queue.setdefault(step, []).append(recommendation)

    def process(self, step: int) -> None:
        for recommendation in self.queue.pop(step, []):
            if self.mode == "missing" and recommendation.sequence % 2 == 1:
                self.stats.missing_callbacks += 1
                continue
            if self.mode == "out_of_order":
                if self.held is None:
                    self.held = recommendation
                    continue
                self._apply(recommendation, step)
                self._apply(self.held, step)
                self.held = None
                continue

            self._apply(recommendation, step)
            if self.mode == "replay":
                self._apply(recommendation, step)

    def finish(self, step: int) -> None:
        if self.held is not None:
            self.stats.missing_callbacks += 1
            self.held = None
        for delivery_step in sorted(self.queue):
            if delivery_step >= step:
                self.process(delivery_step)

    def _apply(self, recommendation: Recommendation, step: int) -> None:
        if self.origin.apply(recommendation, step):
            self.stats.applied_callbacks += 1
            assert self.stats.callback_latencies is not None
            self.stats.callback_latencies.append(step - recommendation.source_event_index)
        else:
            self.stats.rejected_callbacks += 1


def simulate_policy(
    policy_name: str,
    events: tuple[TradeEvent, ...],
    config: ResearchConfig,
    gain_fee_pips: int,
    operational_mode: str,
    hook_gas_per_swap: int,
    elasticity: FlowElasticityConfig | None = None,
) -> dict[str, int | str | None | list[int]]:
    if not events:
        raise ValueError("simulation requires at least one event")

    policy = build_policy(policy_name, config, gain_fee_pips)
    origin = OriginFeeState(config.base_fee_pips)
    delivery = DeliveryCoordinator(operational_mode, origin)
    observations_due: dict[int, list[TradeEvent]] = {}
    recommendation_sequence = 0

    initial_inventory_base_wad = 1_000 * WAD
    inventory_base_wad = initial_inventory_base_wad
    initial_price_wad = events[0].execution_price_wad
    initial_cash_wad = initial_inventory_base_wad * initial_price_wad // WAD
    cash_without_fees_wad = initial_cash_wad

    fee_revenue_wad = 0
    benign_trader_fees_wad = 0
    toxic_trader_fees_wad = 0
    adverse_markout_wad = 0
    benign_count = 0
    toxic_count = 0
    false_positive_count = 0
    false_negative_count = 0
    toxic_notional_wad = 0
    toxic_notional_with_premium_wad = 0
    premium_event_count = 0
    directionally_correct_count = 0
    toxic_buy_fees: list[int] = []
    toxic_sell_fees: list[int] = []
    first_toxic_step: dict[int, int] = {}
    first_detection_step: dict[int, int] = {}
    expired_reference_count = 0
    previous_side_fees = {-1: config.base_fee_pips, 1: config.base_fee_pips}
    fee_oscillation_pips = 0
    applied_fee_series: list[int] = []
    requested_notional_wad = 0
    executed_notional_wad = 0
    benign_requested_notional_wad = 0
    benign_executed_notional_wad = 0
    toxic_requested_notional_wad = 0
    toxic_executed_notional_wad = 0
    retained_event_count = 0

    observation_delay_steps = config.markout_delay_steps + config.markout_horizon_steps - 1
    flush_steps = observation_delay_steps + config.callback_delay_steps + config.epoch_observation_count + 2
    for step in range(len(events) + flush_steps):
        for matured in observations_due.pop(step, []):
            if not matured.reference_available:
                expired_reference_count += 1
                continue
            if policy.observe(matured):
                recommendation_sequence += 1
                recommendation = Recommendation(
                    sequence=recommendation_sequence,
                    fees=dict(policy.calculated_fees),
                    generated_step=step,
                    valid_until_step=step + config.recommendation_ttl_steps,
                    source_event_index=matured.index,
                )
                delivery.schedule(step + config.callback_delay_steps, recommendation)
        delivery.process(step)

        current_side_fees = {
            direction: origin.current_fee(direction, step)
            for direction in (-1, 1)
        }
        fee_oscillation_pips += sum(
            abs(current_side_fees[direction] - previous_side_fees[direction])
            for direction in (-1, 1)
        )
        previous_side_fees = current_side_fees

        if step >= len(events):
            continue
        event = events[step]
        fee_pips = current_side_fees[event.direction]
        other_fee_pips = current_side_fees[-event.direction]
        requested_notional_wad += event.notional_wad
        if event.is_toxic:
            toxic_requested_notional_wad += event.notional_wad
        else:
            benign_requested_notional_wad += event.notional_wad
        if elasticity is not None:
            beta_wad = elasticity.toxic_beta_wad if event.is_toxic else elasticity.benign_beta_wad
            probability_wad = retention_probability_wad(fee_pips, config.base_fee_pips, beta_wad)
            if deterministic_flow_draw_wad(event) >= probability_wad:
                continue

        retained_event_count += 1
        executed_notional_wad += event.notional_wad
        if event.is_toxic:
            toxic_executed_notional_wad += event.notional_wad
        else:
            benign_executed_notional_wad += event.notional_wad
        applied_fee_series.append(fee_pips)
        premium = fee_pips > config.base_fee_pips
        premium_event_count += int(premium)

        fee_paid_wad = event.notional_wad * fee_pips // FEE_PIPS
        fee_revenue_wad += fee_paid_wad
        base_quantity_wad = event.notional_wad * WAD // event.execution_price_wad
        if event.direction == 1:
            inventory_base_wad -= base_quantity_wad
            cash_without_fees_wad += event.notional_wad
        else:
            inventory_base_wad += base_quantity_wad
            cash_without_fees_wad -= event.notional_wad

        markout_wad = directional_markout(
            event.execution_price_wad,
            event.reference_price_wad,
            event.direction,
        )
        adverse_markout_wad += max(markout_wad, 0) * event.notional_wad // WAD

        if event.is_toxic:
            toxic_count += 1
            toxic_trader_fees_wad += fee_paid_wad
            toxic_notional_wad += event.notional_wad
            toxic_notional_with_premium_wad += event.notional_wad if premium else 0
            false_negative_count += int(not premium)
            directionally_correct_count += int(fee_pips > other_fee_pips)
            (toxic_buy_fees if event.direction == 1 else toxic_sell_fees).append(fee_pips)
            first_toxic_step.setdefault(event.direction, step)
        else:
            benign_count += 1
            benign_trader_fees_wad += fee_paid_wad
            false_positive_count += int(premium)

        for direction, toxic_step in first_toxic_step.items():
            if direction not in first_detection_step and current_side_fees[direction] > config.base_fee_pips:
                first_detection_step[direction] = step - toxic_step

        if policy_name != "fixed_fee":
            observation = replace(
                _event_at_horizon(events, event, config.markout_horizon_steps),
                applied_fee_pips=fee_pips,
            )
            observations_due.setdefault(step + observation_delay_steps, []).append(
                observation
            )

    delivery.finish(len(events) + flush_steps)

    terminal_price_wad = events[-1].reference_price_wad
    final_portfolio_without_fees_wad = (
        cash_without_fees_wad + inventory_base_wad * terminal_price_wad // WAD
    )
    buy_and_hold_value_wad = initial_cash_wad + initial_inventory_base_wad * terminal_price_wad // WAD
    inventory_pnl_wad = final_portfolio_without_fees_wad - buy_and_hold_value_wad
    lp_net_pnl_wad = inventory_pnl_wad + fee_revenue_wad
    detection_values = list(first_detection_step.values())
    assert delivery.stats.callback_latencies is not None

    return {
        "policy": policy_name,
        "event_count": len(events),
        "gain_fee_pips": gain_fee_pips,
        "mean_applied_fee_pips": (
            sum(applied_fee_series) // len(applied_fee_series)
            if applied_fee_series
            else config.base_fee_pips
        ),
        "lp_fee_revenue_quote_wad": fee_revenue_wad,
        "inventory_pnl_quote_wad": inventory_pnl_wad,
        "lp_net_pnl_quote_wad": lp_net_pnl_wad,
        "realized_adverse_markout_quote_wad": adverse_markout_wad,
        "benign_trader_fees_quote_wad": benign_trader_fees_wad,
        "toxic_trader_fees_quote_wad": toxic_trader_fees_wad,
        "false_positive_rate_wad": false_positive_count * WAD // benign_count if benign_count else None,
        "false_negative_rate_wad": false_negative_count * WAD // toxic_count if toxic_count else None,
        "detection_latency_steps": sum(detection_values) // len(detection_values) if detection_values else None,
        "toxic_notional_premium_rate_wad": (
            toxic_notional_with_premium_wad * WAD // toxic_notional_wad if toxic_notional_wad else None
        ),
        "time_above_baseline_rate_wad": premium_event_count * WAD // len(events),
        "fee_oscillation_pips": fee_oscillation_pips,
        "directionally_correct_toxic_rate_wad": (
            directionally_correct_count * WAD // toxic_count if toxic_count else None
        ),
        "toxic_buy_mean_fee_pips": sum(toxic_buy_fees) // len(toxic_buy_fees) if toxic_buy_fees else None,
        "toxic_sell_mean_fee_pips": sum(toxic_sell_fees) // len(toxic_sell_fees) if toxic_sell_fees else None,
        "hook_gas_per_swap": hook_gas_per_swap,
        "reactive_callback_latency_steps": (
            sum(delivery.stats.callback_latencies) // len(delivery.stats.callback_latencies)
            if delivery.stats.callback_latencies
            else None
        ),
        "applied_callbacks": delivery.stats.applied_callbacks,
        "missing_callbacks": delivery.stats.missing_callbacks,
        "rejected_callbacks": delivery.stats.rejected_callbacks,
        "expired_reference_count": expired_reference_count,
        "requested_notional_quote_wad": requested_notional_wad,
        "executed_notional_quote_wad": executed_notional_wad,
        "volume_lost_quote_wad": requested_notional_wad - executed_notional_wad,
        "volume_retained_rate_wad": (
            executed_notional_wad * WAD // requested_notional_wad if requested_notional_wad else WAD
        ),
        "benign_volume_retained_rate_wad": (
            benign_executed_notional_wad * WAD // benign_requested_notional_wad
            if benign_requested_notional_wad
            else WAD
        ),
        "toxic_volume_retained_rate_wad": (
            toxic_executed_notional_wad * WAD // toxic_requested_notional_wad
            if toxic_requested_notional_wad
            else WAD
        ),
        "retained_event_count": retained_event_count,
        "coverage_eligible_epochs": sum(int(entry.eligible) for entry in policy.coverage_history),
        "coverage_deficit_epochs": sum(
            int(entry.eligible and entry.coverage_deficit_wad > 0)
            for entry in policy.coverage_history
        ),
        "latest_coverage_ratio_wad": (
            policy.coverage_history[-1].coverage_ratio_wad if policy.coverage_history else None
        ),
        "applied_fee_series": applied_fee_series,
    }


def correlation_wad(left: list[int], right: list[int]) -> int:
    if len(left) != len(right) or not left:
        raise ValueError("correlation inputs must have equal non-zero lengths")
    left_mean = sum(left) // len(left)
    right_mean = sum(right) // len(right)
    covariance = sum((x - left_mean) * (y - right_mean) for x, y in zip(left, right, strict=True))
    left_variance = sum((x - left_mean) ** 2 for x in left)
    right_variance = sum((y - right_mean) ** 2 for y in right)
    denominator = isqrt(left_variance * right_variance)
    if denominator == 0:
        return WAD if left == right else 0
    magnitude = abs(covariance) * WAD // denominator
    return -magnitude if covariance < 0 else magnitude


def _event_at_horizon(
    events: tuple[TradeEvent, ...],
    event: TradeEvent,
    horizon_steps: int,
) -> TradeEvent:
    if horizon_steps <= 0:
        raise ValueError("markout horizon must be positive")
    reference_index = min(event.index + horizon_steps - 1, len(events) - 1)
    reference_event = events[reference_index]
    maximum_dispersion_wad = max(
        candidate.reference_dispersion_wad
        for candidate in events[event.index : reference_index + 1]
    )
    return replace(
        event,
        reference_price_wad=reference_event.reference_price_wad,
        reference_dispersion_wad=maximum_dispersion_wad,
        reference_available=reference_event.reference_available,
    )


def mean_optional(values: list[int | None]) -> int | None:
    present = [value for value in values if value is not None]
    return int(mean(present)) if present else None
