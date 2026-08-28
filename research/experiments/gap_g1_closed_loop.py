"""Reproduce the G1 coverage-feedback and fee-elastic-flow experiment."""

from __future__ import annotations

import argparse
import csv
import io
import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from research.experiments.phase5_baselines import measure_hook_gas
from research.thetashield.model import WAD
from research.thetashield.policies import (
    COVERAGE_GAIN_FEE_PIPS,
    MINIMUM_ESTIMATED_LOSS_WAD,
    TARGET_COVERAGE_WAD,
    ResearchConfig,
)
from research.thetashield.scenarios import REPEATED_SEEDS, SCENARIOS, generate_scenario
from research.thetashield.simulator import FlowElasticityConfig, simulate_policy

REPO_ROOT = Path(__file__).resolve().parents[2]
BASELINE_POLICY = "thetashield"
COVERAGE_POLICY = "coverage_thetashield"
BASELINE_TOXIC_GAIN_FEE_PIPS = 500_000
COVERAGE_TOXIC_GAIN_FEE_PIPS = 450_000
MODES = ("inelastic", "elastic")
RESULT_COLUMNS = (
    "mode",
    "scenario",
    "seed",
    "policy",
    "gain_fee_pips",
    "mean_applied_fee_pips",
    "lp_fee_revenue_quote_wad",
    "lp_net_pnl_quote_wad",
    "realized_adverse_markout_quote_wad",
    "false_positive_rate_wad",
    "false_negative_rate_wad",
    "requested_notional_quote_wad",
    "executed_notional_quote_wad",
    "volume_lost_quote_wad",
    "volume_retained_rate_wad",
    "benign_volume_retained_rate_wad",
    "toxic_volume_retained_rate_wad",
    "retained_event_count",
    "coverage_eligible_epochs",
    "coverage_deficit_epochs",
    "latest_coverage_ratio_wad",
)
SUMMARY_METRICS = RESULT_COLUMNS[5:]


def run_experiment(
    hook_gas: dict[str, int],
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    config = ResearchConfig()
    elasticity = FlowElasticityConfig()
    rows: list[dict[str, Any]] = []
    policies = (
        (BASELINE_POLICY, BASELINE_TOXIC_GAIN_FEE_PIPS),
        (COVERAGE_POLICY, COVERAGE_TOXIC_GAIN_FEE_PIPS),
    )

    for mode in MODES:
        for scenario in SCENARIOS:
            for seed in REPEATED_SEEDS:
                events = generate_scenario(scenario.name, seed)
                for policy, gain in policies:
                    result = simulate_policy(
                        policy,
                        events,
                        config,
                        gain,
                        scenario.operational_mode,
                        hook_gas["hook_gas_per_swap"],
                        elasticity if mode == "elastic" else None,
                    )
                    result.pop("applied_fee_series")
                    result.update(mode=mode, scenario=scenario.name, seed=seed)
                    rows.append({column: result.get(column) for column in RESULT_COLUMNS})

    aggregates = _aggregate(rows)
    inelastic_baseline = aggregates["inelastic"][BASELINE_POLICY]
    inelastic_coverage = aggregates["inelastic"][COVERAGE_POLICY]
    elastic_baseline = aggregates["elastic"][BASELINE_POLICY]
    elastic_coverage = aggregates["elastic"][COVERAGE_POLICY]
    gates = {
        "precision_preserved": {
            "status": _status(
                inelastic_coverage["false_positive_rate_wad"]
                <= inelastic_baseline["false_positive_rate_wad"]
            ),
            "rule": "coverage policy inelastic mean FPR <= historical ThetaShield mean FPR",
        },
        "feedback_is_exercised": {
            "status": _status(
                inelastic_coverage["coverage_eligible_epochs"] > 0
                and inelastic_coverage["coverage_deficit_epochs"] > 0
            ),
            "rule": "coverage policy must observe both eligible and deficit epochs",
        },
        "benign_flow_noninferiority": {
            "status": _status(
                elastic_coverage["benign_volume_retained_rate_wad"]
                >= elastic_baseline["benign_volume_retained_rate_wad"]
            ),
            "rule": "elastic benign retained-volume rate >= historical ThetaShield",
        },
        "total_flow_noninferiority": {
            "status": _status(
                elastic_coverage["volume_retained_rate_wad"]
                >= elastic_baseline["volume_retained_rate_wad"]
            ),
            "rule": "elastic total retained-volume rate >= historical ThetaShield",
        },
    }
    overall_status = "pass" if all(gate["status"] == "pass" for gate in gates.values()) else "fail"
    summary = {
        "schema_version": 1,
        "experiment": "gap_g1_closed_loop",
        "overall_status": overall_status,
        "run_count": len(rows),
        "scenario_count": len(SCENARIOS),
        "seed_count": len(REPEATED_SEEDS),
        "hook_gas_measurement": hook_gas,
        "aggregates": aggregates,
        "gates": gates,
        "elastic_fee_revenue_delta_quote_wad": (
            elastic_coverage["lp_fee_revenue_quote_wad"]
            - elastic_baseline["lp_fee_revenue_quote_wad"]
        ),
        "interpretation": (
            "The selected controller shifts part of the toxic-risk gain into bounded coverage feedback. "
            "It preserves the declared precision and retained-flow gates, but does not improve mean fee "
            "revenue in this deterministic synthetic experiment."
        ),
        "interpretation_boundary": (
            "Controlled deterministic synthetic evidence only; this is not live-market, profitability, "
            "deployment, or security-audit evidence."
        ),
    }
    manifest = {
        "schema_version": 1,
        "decision_protocol_id": "thetashield-gap-g1-v1",
        "historical_phase5_artifacts_mutated": False,
        "policies": {
            BASELINE_POLICY: {"toxic_gain_fee_pips": BASELINE_TOXIC_GAIN_FEE_PIPS},
            COVERAGE_POLICY: {
                "toxic_gain_fee_pips": COVERAGE_TOXIC_GAIN_FEE_PIPS,
                "coverage_gain_fee_pips": COVERAGE_GAIN_FEE_PIPS,
                "target_coverage_wad": TARGET_COVERAGE_WAD,
                "minimum_estimated_loss_wad": MINIMUM_ESTIMATED_LOSS_WAD,
            },
        },
        "research_config": asdict(config),
        "elasticity_config": asdict(elasticity),
        "modes": list(MODES),
        "scenarios": [scenario.name for scenario in SCENARIOS],
        "seeds": list(REPEATED_SEEDS),
        "gates": {name: gate["rule"] for name, gate in gates.items()},
        "selection_note": (
            "Coverage gain 50 and toxic gain 450000 were selected as a conservative closed-loop "
            "composition that exercises coverage feedback without increasing aggregate inelastic FPR."
        ),
    }
    return rows, summary, manifest


def _aggregate(rows: list[dict[str, Any]]) -> dict[str, dict[str, dict[str, int | None]]]:
    result: dict[str, dict[str, dict[str, int | None]]] = {}
    for mode in MODES:
        result[mode] = {}
        for policy in (BASELINE_POLICY, COVERAGE_POLICY):
            selected = [row for row in rows if row["mode"] == mode and row["policy"] == policy]
            result[mode][policy] = {
                metric: _mean_optional([row[metric] for row in selected])
                for metric in SUMMARY_METRICS
            }
    return result


def _mean_optional(values: list[Any]) -> int | None:
    present = [int(value) for value in values if value is not None]
    return sum(present) // len(present) if present else None


def _status(condition: bool) -> str:
    return "pass" if condition else "fail"


def serialize_json(value: Any) -> str:
    return json.dumps(value, indent=2, sort_keys=True) + "\n"


def serialize_csv(rows: list[dict[str, Any]]) -> str:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=RESULT_COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


def _percent(value_wad: int | None) -> str:
    return "n/a" if value_wad is None else f"{value_wad * 100 / WAD:.3f}%"


def render_report(summary: dict[str, Any]) -> str:
    elastic = summary["aggregates"]["elastic"]
    baseline = elastic[BASELINE_POLICY]
    coverage = elastic[COVERAGE_POLICY]
    gate_lines = [
        f"- `{name}`: **{gate['status'].upper()}** — {gate['rule']}."
        for name, gate in summary["gates"].items()
    ]
    return "\n".join(
        [
            "# G1 Coverage Feedback and Elastic-Flow Report",
            "",
            "## Outcome",
            "",
            f"The locked G1 decision is **{summary['overall_status'].upper()}** across "
            f"{summary['run_count']} deterministic policy runs.",
            "The controller now observes realized fee coverage against estimated positive markout loss,",
            "then composes a bounded coverage premium with the existing directional toxic-flow premium.",
            "",
            "## Declared gates",
            "",
            *gate_lines,
            "",
            "## Elastic-flow comparison",
            "",
            "| Metric | Historical ThetaShield | Coverage ThetaShield |",
            "|---|---:|---:|",
            f"| Benign volume retained | {_percent(baseline['benign_volume_retained_rate_wad'])} | {_percent(coverage['benign_volume_retained_rate_wad'])} |",
            f"| Toxic volume retained | {_percent(baseline['toxic_volume_retained_rate_wad'])} | {_percent(coverage['toxic_volume_retained_rate_wad'])} |",
            f"| Total volume retained | {_percent(baseline['volume_retained_rate_wad'])} | {_percent(coverage['volume_retained_rate_wad'])} |",
            f"| False-positive rate | {_percent(baseline['false_positive_rate_wad'])} | {_percent(coverage['false_positive_rate_wad'])} |",
            f"| False-negative rate | {_percent(baseline['false_negative_rate_wad'])} | {_percent(coverage['false_negative_rate_wad'])} |",
            f"| Mean fee revenue (quote WAD) | {baseline['lp_fee_revenue_quote_wad']} | {coverage['lp_fee_revenue_quote_wad']} |",
            "",
            "Fee revenue is disclosed, not used as a pass gate. Its coverage-policy delta is",
            f"`{summary['elastic_fee_revenue_delta_quote_wad']}` quote WAD in this experiment.",
            "",
            "## Reproduction",
            "",
            "```sh",
            "make gap-g1-report",
            "make gap-g1-check",
            "make phase5-check",
            "```",
            "",
            "## Interpretation boundary",
            "",
            summary["interpretation"],
            summary["interpretation_boundary"],
            "",
        ]
    )


def build_outputs(repo_root: Path = REPO_ROOT) -> dict[Path, str]:
    rows, summary, manifest = run_experiment(measure_hook_gas(repo_root))
    return {
        repo_root / "research/datasets/gap_g1_manifest.json": serialize_json(manifest),
        repo_root / "research/reports/gap_g1_results.csv": serialize_csv(rows),
        repo_root / "research/reports/gap_g1_summary.json": serialize_json(summary),
        repo_root / "research/reports/GAP_G1_CLOSED_LOOP.md": render_report(summary),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    outputs = build_outputs()
    if args.check:
        stale = [
            path
            for path, content in outputs.items()
            if not path.exists() or path.read_text(encoding="utf-8") != content
        ]
        if stale:
            joined = "\n".join(str(path.relative_to(REPO_ROOT)) for path in stale)
            raise SystemExit(f"G1 artifacts are stale; run make gap-g1-report:\n{joined}")
        return
    for path, content in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()
