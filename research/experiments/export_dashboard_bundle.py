"""Export the deterministic, evidence-bound dashboard data bundle for G7."""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import asdict, replace
from pathlib import Path
from typing import Any

from research.thetashield.model import WAD, dead_band_filter, directional_markout, population_sigma
from research.thetashield.policies import ResearchConfig, ThetaShieldPolicy
from research.thetashield.scenarios import SCENARIO_BY_NAME, TradeEvent, generate_scenario
from research.thetashield.simulator import DeliveryCoordinator, OriginFeeState, Recommendation

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = REPO_ROOT / "research/reports/dashboard_bundle.json"
DASHBOARD_OUTPUT_PATH = REPO_ROOT / "dashboard/data/dashboard_bundle.json"
REPRESENTATIVE_SCENARIOS = (
    "benign_noise",
    "persistent_informed_buying",
    "conflicting_references",
    "missing_callbacks",
)
TRACE_SEED = 101
SOURCE_PATHS = (
    "research/datasets/phase5_scenarios.json",
    "research/reports/phase5_summary.json",
    "research/reports/phase6_summary.json",
    "research/reports/phase61_summary.json",
    "research/reports/gap_g1_summary.json",
    "research/thetashield/model.py",
    "research/thetashield/policies.py",
    "research/thetashield/scenarios.py",
    "research/thetashield/simulator.py",
    "research/experiments/export_dashboard_bundle.py",
)


class TracingThetaShieldPolicy(ThetaShieldPolicy):
    """Expose the exact intermediate values already consumed by the policy."""

    def __init__(self, config: ResearchConfig, gain_fee_pips: int) -> None:
        super().__init__(config, gain_fee_pips)
        self.last_score: dict[str, int | bool] | None = None
        self.last_completed_epoch: Any = None
        self.last_decision: dict[str, Any] | None = None

    def _score(self, event: TradeEvent):  # type: ignore[no-untyped-def]
        history = self._markout_history[event.direction]
        trailing = history[-self.config.trailing_window :]
        sigma_wad = population_sigma(trailing)
        raw_markout_wad = directional_markout(
            event.execution_price_wad,
            event.reference_price_wad,
            event.direction,
        )
        dead_band_wad = sigma_wad * self.config.dead_band_k_wad // WAD
        scored = super()._score(event)
        self.last_score = {
            "raw_markout_wad": raw_markout_wad,
            "sigma_wad": sigma_wad,
            "dead_band_wad": dead_band_wad,
            "filtered_markout_wad": dead_band_filter(
                raw_markout_wad,
                sigma_wad,
                self.config.dead_band_k_wad,
            ),
            "reference_dispersion_wad": event.reference_dispersion_wad,
            "cold_start": len(trailing) < self.config.minimum_trailing_observations,
        }
        return scored

    def _append(self, direction: int, observation):  # type: ignore[no-untyped-def]
        completed = super()._append(direction, observation)
        self.last_completed_epoch = completed
        return completed

    def observe(self, event: TradeEvent) -> bool:
        previous_fee_pips = self.calculated_fees[event.direction]
        self.last_completed_epoch = None
        recommendation_generated = super().observe(event)
        completed = self.last_completed_epoch
        bitmap = self._persistence[event.direction]
        self.last_decision = {
            **(self.last_score or {}),
            "source_event_index": event.index,
            "direction": event.direction,
            "epoch_complete": completed is not None,
            "aggregate_markout_wad": (
                completed.aggregate_markout_wad if completed is not None else None
            ),
            "confidence_wad": completed.confidence_wad if completed is not None else None,
            "meets_minimum_epoch_notional": (
                completed.meets_minimum_epoch_notional if completed is not None else None
            ),
            "persistence_bitmap": bitmap,
            "persistence_active": (
                bitmap.bit_count() >= self.config.required_toxic_epochs
            ),
            "previous_fee_pips": previous_fee_pips,
            "calculated_fee_pips": self.calculated_fees[event.direction],
            "recommendation_generated": recommendation_generated,
        }
        return recommendation_generated


def _load_json(relative_path: str) -> dict[str, Any]:
    return json.loads((REPO_ROOT / relative_path).read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _source_artifacts() -> list[dict[str, str]]:
    return [
        {"path": relative_path, "sha256": _sha256(REPO_ROOT / relative_path)}
        for relative_path in SOURCE_PATHS
    ]


def _observation_at_horizon(
    events: tuple[TradeEvent, ...],
    event: TradeEvent,
    horizon_steps: int,
) -> TradeEvent:
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


def _transport_snapshot(delivery: DeliveryCoordinator) -> dict[str, int]:
    return {
        "callbacks_applied": delivery.stats.applied_callbacks,
        "callbacks_missing": delivery.stats.missing_callbacks,
        "callbacks_rejected": delivery.stats.rejected_callbacks,
    }


def _transport_delta(before: dict[str, int], delivery: DeliveryCoordinator) -> dict[str, int]:
    current = _transport_snapshot(delivery)
    return {name: current[name] - value for name, value in before.items()}


def _control_trace(
    scenario_name: str,
    config: ResearchConfig,
    gain_fee_pips: int,
) -> dict[str, Any]:
    scenario = SCENARIO_BY_NAME[scenario_name]
    events = generate_scenario(scenario_name, TRACE_SEED)
    policy = TracingThetaShieldPolicy(config, gain_fee_pips)
    origin = OriginFeeState(config.base_fee_pips)
    delivery = DeliveryCoordinator(scenario.operational_mode, origin)
    observations_due: dict[int, list[TradeEvent]] = {}
    recommendation_sequence = 0
    expired_references = 0
    steps: list[dict[str, Any]] = []

    observation_delay_steps = config.markout_delay_steps + config.markout_horizon_steps - 1
    flush_steps = observation_delay_steps + config.callback_delay_steps + config.epoch_observation_count + 2
    for step in range(len(events) + flush_steps):
        evidence_events: list[dict[str, Any]] = []
        transport_events: list[dict[str, Any]] = []
        for matured in observations_due.pop(step, []):
            if not matured.reference_available:
                expired_references += 1
                evidence_events.append(
                    {
                        "source_event_index": matured.index,
                        "status": "reference_unavailable",
                    }
                )
                continue

            recommendation_generated = policy.observe(matured)
            decision = dict(policy.last_decision or {})
            decision["status"] = (
                "epoch_complete" if decision.get("epoch_complete") else "epoch_accumulating"
            )
            evidence_events.append(decision)
            if recommendation_generated:
                recommendation_sequence += 1
                delivery_step = step + config.callback_delay_steps
                recommendation = Recommendation(
                    sequence=recommendation_sequence,
                    fees=dict(policy.calculated_fees),
                    generated_step=step,
                    valid_until_step=step + config.recommendation_ttl_steps,
                    source_event_index=matured.index,
                )
                delivery.schedule(delivery_step, recommendation)
                transport_events.append(
                    {
                        "type": "recommendation_scheduled",
                        "sequence": recommendation_sequence,
                        "delivery_step": delivery_step,
                    }
                )

        before = _transport_snapshot(delivery)
        delivery.process(step)
        delta = _transport_delta(before, delivery)
        for event_type, count in (
            ("callback_applied", delta["callbacks_applied"]),
            ("callback_missing", delta["callbacks_missing"]),
            ("callback_rejected", delta["callbacks_rejected"]),
        ):
            if count:
                transport_events.append({"type": event_type, "count": count})

        current_side_fees = {
            direction: origin.current_fee(direction, step)
            for direction in (-1, 1)
        }
        trade: dict[str, Any] | None = None
        if step < len(events):
            event = events[step]
            observation = replace(
                _observation_at_horizon(events, event, config.markout_horizon_steps),
                applied_fee_pips=current_side_fees[event.direction],
            )
            evidence_due_step = step + observation_delay_steps
            observations_due.setdefault(evidence_due_step, []).append(observation)
            trade = {
                "event_index": event.index,
                "direction": "buy" if event.direction == 1 else "sell",
                "notional_quote_wad": event.notional_wad,
                "execution_price_wad": event.execution_price_wad,
                "reference_price_wad": observation.reference_price_wad,
                "reference_dispersion_wad": observation.reference_dispersion_wad,
                "reference_available": observation.reference_available,
                "directional_markout_wad": directional_markout(
                    observation.execution_price_wad,
                    observation.reference_price_wad,
                    observation.direction,
                ),
                "toxic_label": event.is_toxic,
                "applied_fee_pips": current_side_fees[event.direction],
                "evidence_due_step": evidence_due_step,
            }

        steps.append(
            {
                "step": step,
                "trade": trade,
                "evidence": evidence_events,
                "fee_by_direction_pips": {
                    "buy": current_side_fees[1],
                    "sell": current_side_fees[-1],
                },
                "active_recommendation": {
                    "sequence": origin.last_sequence,
                    "valid_until_step": origin.valid_until_step,
                },
                "transport": {
                    "events": transport_events,
                    "cumulative": _transport_snapshot(delivery),
                },
            }
        )

    before_finish = _transport_snapshot(delivery)
    delivery.finish(len(events) + flush_steps)
    return {
        "scenario": scenario_name,
        "description": scenario.description,
        "seed": TRACE_SEED,
        "policy": "thetashield",
        "gain_fee_pips": gain_fee_pips,
        "operational_mode": scenario.operational_mode,
        "event_count": len(events),
        "step_seconds": events[1].timestamp_seconds - events[0].timestamp_seconds,
        "interpretation": (
            "Deterministic research-simulator control trace; transport events are simulated "
            "delivery outcomes, not live Circle or Reactive Network receipts."
        ),
        "steps": steps,
        "final_transport": {
            **_transport_snapshot(delivery),
            "finish_delta": _transport_delta(before_finish, delivery),
            "expired_references": expired_references,
        },
    }


def _scenario_lp_outcomes(phase5: dict[str, Any]) -> dict[str, Any]:
    return {
        scenario: {
            policy: values["lp_net_pnl_quote_wad"]
            for policy, values in sorted(policies.items())
        }
        for scenario, policies in sorted(phase5["by_scenario"].items())
    }


def _holdout_table(phase6: dict[str, Any], phase61: dict[str, Any]) -> list[dict[str, Any]]:
    historical = {entry["id"]: entry for entry in phase6["hypotheses"]}
    return [
        {
            "id": hypothesis_id,
            "historical_status": historical[hypothesis_id]["status"],
            "training_status": (
                phase61["training"][hypothesis_id].get("status")
                or phase61["training"][hypothesis_id].get("h5_status")
            ),
            "holdout_status": (
                phase61["holdout"][hypothesis_id].get("status")
                or phase61["holdout"][hypothesis_id].get("h5_status")
            ),
            "training_evidence": phase61["training"][hypothesis_id],
            "holdout_evidence": phase61["holdout"][hypothesis_id],
        }
        for hypothesis_id in ("H4", "H5")
    ]


def build_bundle() -> dict[str, Any]:
    phase5 = _load_json("research/reports/phase5_summary.json")
    phase6 = _load_json("research/reports/phase6_summary.json")
    phase61 = _load_json("research/reports/phase61_summary.json")
    gap_g1 = _load_json("research/reports/gap_g1_summary.json")
    config = ResearchConfig(**phase5["research_config"])
    gain_fee_pips = int(phase5["selected_gain_fee_pips"]["thetashield"])

    return {
        "schema_version": 1,
        "bundle_id": "thetashield-dashboard-g7-v1",
        "evidence_kind": "controlled_deterministic_synthetic_research",
        "interpretation_boundary": (
            "This bundle is not live-market, profitability, deployment, security-audit, "
            "Circle-attestation, or Reactive-callback evidence."
        ),
        "source_artifacts": _source_artifacts(),
        "experiment_dimensions": {
            "phase5_scenarios": phase5["scenario_count"],
            "phase5_seeds": phase5["seed_count"],
            "phase5_policies": phase5["policy_count"],
            "phase5_runs": phase5["run_count"],
        },
        "research_scale": {
            "phase6_raw_runs": phase6["raw_run_count"],
            "phase6_sweep_cases": phase6["sweep_case_count"],
            "phase61_training_cases": phase61["training_case_count"],
            "phase61_holdout_cases": phase61["frontier_case_count"],
            "hook_gas_per_swap": phase5["hook_gas_measurement"]["hook_gas_per_swap"],
        },
        "calibration": {
            "mean_fee_pips": phase5["calibration_mean_fee_pips"],
            "dynamic_fee_spread_pips": phase5["dynamic_calibration_fee_spread_pips"],
            "selected_gain_fee_pips": phase5["selected_gain_fee_pips"],
        },
        "policy_metrics": phase5["by_policy"],
        "scenario_lp_outcomes": _scenario_lp_outcomes(phase5),
        "hypotheses": phase6["hypotheses"],
        "hypothesis_status_counts": phase6["hypothesis_status_counts"],
        "holdout_table": _holdout_table(phase6, phase61),
        "selected_research_config": phase61["selected_research_config"],
        "closed_loop": {
            "overall_status": gap_g1["overall_status"],
            "gates": gap_g1["gates"],
            "aggregates": gap_g1["aggregates"],
            "elastic_fee_revenue_delta_quote_wad": gap_g1[
                "elastic_fee_revenue_delta_quote_wad"
            ],
            "interpretation": gap_g1["interpretation"],
            "interpretation_boundary": gap_g1["interpretation_boundary"],
        },
        "trace_configuration": {
            "research_config": asdict(config),
            "policy": "thetashield",
            "gain_fee_pips": gain_fee_pips,
            "seed": TRACE_SEED,
        },
        "representative_traces": {
            scenario_name: _control_trace(scenario_name, config, gain_fee_pips)
            for scenario_name in REPRESENTATIVE_SCENARIOS
        },
    }


def serialize_bundle(bundle: dict[str, Any]) -> str:
    return json.dumps(bundle, indent=2, sort_keys=True) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = serialize_bundle(build_bundle())
    if args.check:
        stale = [
            path
            for path in (OUTPUT_PATH, DASHBOARD_OUTPUT_PATH)
            if not path.exists() or path.read_text(encoding="utf-8") != expected
        ]
        if stale:
            raise SystemExit(
                "dashboard bundle is stale; run: python3 -m "
                "research.experiments.export_dashboard_bundle\n"
                + "\n".join(str(path.relative_to(REPO_ROOT)) for path in stale)
            )
        return
    for path in (OUTPUT_PATH, DASHBOARD_OUTPUT_PATH):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(expected, encoding="utf-8")


if __name__ == "__main__":
    main()
