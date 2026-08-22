"""Reproduce the versioned Phase 6.1 H4/H5 remediation and holdout audit."""

from __future__ import annotations

import argparse
import csv
import io
import json
from dataclasses import asdict
from html import escape
from pathlib import Path
from typing import Any, Iterable

from research.experiments.phase5_baselines import measure_hook_gas
from research.experiments.phase6_sensitivity import (
    _mean_and_interval,
    _pareto_case_ids,
    _rank_correlation_wad,
)
from research.thetashield.model import WAD
from research.thetashield.policies import ResearchConfig
from research.thetashield.remediation import (
    BENIGN_CHALLENGE_SCENARIOS,
    HOLDOUT_SEEDS,
    PERSISTENT_CHALLENGE_SCENARIOS,
    RAW_COMPARATOR_GAIN_FEE_PIPS,
    REMEDIATION_GAIN_FEE_PIPS,
    TRAINING_SEEDS,
    RemediationCase,
    build_h4_frontier_cases,
    build_h5_training_cases,
    generate_benign_challenge,
)
from research.thetashield.scenarios import SCENARIO_BY_NAME, generate_scenario
from research.thetashield.sensitivity import HYPOTHESIS_RULES, MANIPULATION_SCENARIOS
from research.thetashield.simulator import simulate_policy

REPO_ROOT = Path(__file__).resolve().parents[2]
H5_TRAINING_GUARDRAILS = {
    "minimum_retained_coverage_ratio_wad": 6 * WAD // 10,
    "minimum_fpr_reduction_ci95_low_wad": WAD // 20,
    "minimum_oscillation_reduction_ci95_low_pips": 500,
    "maximum_challenge_benign_fpr_wad": WAD // 20,
}
H4_COLUMNS = (
    "split",
    "case_id",
    "dead_band_k_wad",
    "required_toxic_epochs",
    "persistence_window",
    "fast_path_enabled",
    "benign_false_positive_rate_wad",
    "persistent_effective_detection_latency_steps",
    "persistent_lp_improvement_quote_wad",
    "pareto_optimal",
)
H5_COLUMNS = (
    "split",
    "case_id",
    "dead_band_k_wad",
    "required_toxic_epochs",
    "persistence_window",
    "maximum_increase_pips",
    "maximum_decrease_pips",
    "challenge_benign_false_positive_rate_wad",
    "fpr_reduction_mean_wad",
    "fpr_reduction_ci95_low_wad",
    "fpr_reduction_ci95_high_wad",
    "oscillation_reduction_mean_pips",
    "oscillation_reduction_ci95_low_pips",
    "oscillation_reduction_ci95_high_pips",
    "raw_toxic_premium_coverage_wad",
    "thetashield_toxic_premium_coverage_wad",
    "retained_coverage_ratio_wad",
    "h5_status",
    "training_guardrails_met",
)


def run_remediation(
    hook_gas: dict[str, int],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    hook_gas_per_swap = hook_gas["hook_gas_per_swap"]
    training_cases = build_h5_training_cases()
    h5_training = [
        _evaluate_h5_case(case, TRAINING_SEEDS, "training", hook_gas_per_swap)
        for case in training_cases
    ]
    eligible = [entry for entry in h5_training if entry["training_guardrails_met"]]
    if not eligible:
        raise AssertionError("no Phase 6.1 training case meets the declared guardrails")
    selected_training = min(eligible, key=_selection_key)
    selected_case = next(case for case in training_cases if case.case_id == selected_training["case_id"])

    legacy_case = RemediationCase("phase6_v1_legacy", ResearchConfig())
    h5_holdout = _evaluate_h5_case(selected_case, HOLDOUT_SEEDS, "holdout", hook_gas_per_swap)
    legacy_holdout = _evaluate_h5_case(legacy_case, HOLDOUT_SEEDS, "holdout", hook_gas_per_swap)
    h5_rows = [*h5_training, legacy_holdout, h5_holdout]

    h4_cases = build_h4_frontier_cases(selected_case.config)
    h4_training = _evaluate_h4_frontier(h4_cases, TRAINING_SEEDS, "training", hook_gas_per_swap)
    h4_holdout = _evaluate_h4_frontier(h4_cases, HOLDOUT_SEEDS, "holdout", hook_gas_per_swap)
    h4_training_decision = _h4_decision(h4_training)
    h4_holdout_decision = _h4_decision(h4_holdout)

    holdout_pass = h4_holdout_decision["status"] == "pass" and h5_holdout["h5_status"] == "pass"
    summary = {
        "schema_version": 1,
        "experiment": "phase61_h4_h5_remediation",
        "historical_phase6_v1": {
            "immutable": True,
            "H4": "fail",
            "H5": "fail",
        },
        "selection_used_holdout": False,
        "training_case_count": len(training_cases),
        "frontier_case_count": len(h4_cases),
        "training_seed_count": len(TRAINING_SEEDS),
        "holdout_seed_count": len(HOLDOUT_SEEDS),
        "hook_gas_measurement": hook_gas,
        "selected_case_id": selected_case.case_id,
        "selected_gain_fee_pips": selected_case.gain_fee_pips,
        "selected_research_config": asdict(selected_case.config),
        "training": {
            "H4": h4_training_decision,
            "H5": selected_training,
            "eligible_h5_case_count": len(eligible),
        },
        "holdout": {
            "H4": h4_holdout_decision,
            "H5": h5_holdout,
            "legacy_H5": legacy_holdout,
            "overall_status": "pass" if holdout_pass else "fail",
        },
        "interpretation_boundary": (
            "Controlled deterministic synthetic evidence only; this is not live-market, profitability, "
            "deployment, or security-audit evidence."
        ),
    }
    manifest = {
        "schema_version": 1,
        "decision_protocol_id": "thetashield-phase61-remediation-v1",
        "historical_protocol_preserved": "thetashield-phase6-v1",
        "selection_order": (
            "H5 candidates are filtered by training guardrails, then ordered by smallest dead-band "
            "distance from 1.0, preference for 3-of-5 persistence, fastest permitted relaxation, "
            "smallest step-up, and case id. Holdout is evaluated once and never used for selection."
        ),
        "training_guardrails": H5_TRAINING_GUARDRAILS,
        "final_h4_rule": HYPOTHESIS_RULES["H4"],
        "final_h5_rule": HYPOTHESIS_RULES["H5"],
        "training_seeds": list(TRAINING_SEEDS),
        "holdout_seeds": list(HOLDOUT_SEEDS),
        "benign_challenge_scenarios": list(BENIGN_CHALLENGE_SCENARIOS),
        "persistent_challenge_scenarios": list(PERSISTENT_CHALLENGE_SCENARIOS),
        "manipulation_scenarios": list(MANIPULATION_SCENARIOS),
        "raw_comparator_gain_fee_pips": RAW_COMPARATOR_GAIN_FEE_PIPS,
        "remediation_gain_fee_pips": REMEDIATION_GAIN_FEE_PIPS,
        "h5_training_cases": [case.to_dict() for case in training_cases],
        "h4_frontier_cases": [case.to_dict() for case in h4_cases],
        "selected_case_id": selected_case.case_id,
        "holdout_used_for_selection": False,
    }
    return [*h4_training, *h4_holdout], h5_rows, summary, manifest


def _evaluate_h5_case(
    case: RemediationCase,
    seeds: tuple[int, ...],
    split: str,
    hook_gas_per_swap: int,
) -> dict[str, Any]:
    raw_config = ResearchConfig()
    fpr_reductions: list[int] = []
    oscillation_reductions: list[int] = []
    raw_coverage: list[int] = []
    theta_coverage: list[int] = []
    for scenario in MANIPULATION_SCENARIOS:
        for seed in seeds:
            events = generate_scenario(scenario, seed)
            mode = SCENARIO_BY_NAME[scenario].operational_mode
            raw = simulate_policy(
                "raw_positive_markout",
                events,
                raw_config,
                RAW_COMPARATOR_GAIN_FEE_PIPS,
                mode,
                hook_gas_per_swap,
            )
            theta = simulate_policy(
                "thetashield",
                events,
                case.config,
                case.gain_fee_pips,
                mode,
                hook_gas_per_swap,
            )
            fpr_reductions.append(
                int(raw["false_positive_rate_wad"]) - int(theta["false_positive_rate_wad"])
            )
            oscillation_reductions.append(
                int(raw["fee_oscillation_pips"]) - int(theta["fee_oscillation_pips"])
            )
            raw_coverage.append(int(raw["toxic_notional_premium_rate_wad"]))
            theta_coverage.append(int(theta["toxic_notional_premium_rate_wad"]))

    challenge_fprs = []
    for scenario in BENIGN_CHALLENGE_SCENARIOS:
        for seed in seeds:
            result = simulate_policy(
                "thetashield",
                generate_benign_challenge(scenario, seed),
                case.config,
                case.gain_fee_pips,
                "normal",
                hook_gas_per_swap,
            )
            challenge_fprs.append(int(result["false_positive_rate_wad"]))

    fpr_interval = _mean_and_interval(fpr_reductions)
    oscillation_interval = _mean_and_interval(oscillation_reductions)
    raw_coverage_mean = _mean(raw_coverage)
    theta_coverage_mean = _mean(theta_coverage)
    coverage_ratio = theta_coverage_mean * WAD // raw_coverage_mean if raw_coverage_mean else 0
    h5_rule = HYPOTHESIS_RULES["H5"]
    passed = (
        int(fpr_interval["ci95_low"]) > 0
        and int(oscillation_interval["ci95_low"]) > 0
        and coverage_ratio >= int(h5_rule["minimum_pass_coverage_ratio_wad"])
    )
    failed = (
        int(fpr_interval["ci95_high"]) <= 0
        or int(oscillation_interval["ci95_high"]) <= 0
        or coverage_ratio < int(h5_rule["failure_coverage_ratio_wad"])
    )
    challenge_fpr = _mean(challenge_fprs)
    guardrails_met = split == "training" and (
        coverage_ratio >= H5_TRAINING_GUARDRAILS["minimum_retained_coverage_ratio_wad"]
        and int(fpr_interval["ci95_low"])
        >= H5_TRAINING_GUARDRAILS["minimum_fpr_reduction_ci95_low_wad"]
        and int(oscillation_interval["ci95_low"])
        >= H5_TRAINING_GUARDRAILS["minimum_oscillation_reduction_ci95_low_pips"]
        and challenge_fpr <= H5_TRAINING_GUARDRAILS["maximum_challenge_benign_fpr_wad"]
    )
    return {
        "split": split,
        "case_id": case.case_id,
        "dead_band_k_wad": case.config.dead_band_k_wad,
        "required_toxic_epochs": case.config.required_toxic_epochs,
        "persistence_window": case.config.persistence_window,
        "maximum_increase_pips": case.config.maximum_increase_pips,
        "maximum_decrease_pips": case.config.maximum_decrease_pips,
        "challenge_benign_false_positive_rate_wad": challenge_fpr,
        "fpr_reduction_mean_wad": fpr_interval["mean"],
        "fpr_reduction_ci95_low_wad": fpr_interval["ci95_low"],
        "fpr_reduction_ci95_high_wad": fpr_interval["ci95_high"],
        "oscillation_reduction_mean_pips": oscillation_interval["mean"],
        "oscillation_reduction_ci95_low_pips": oscillation_interval["ci95_low"],
        "oscillation_reduction_ci95_high_pips": oscillation_interval["ci95_high"],
        "raw_toxic_premium_coverage_wad": raw_coverage_mean,
        "thetashield_toxic_premium_coverage_wad": theta_coverage_mean,
        "retained_coverage_ratio_wad": coverage_ratio,
        "h5_status": "pass" if passed else ("fail" if failed else "inconclusive"),
        "training_guardrails_met": guardrails_met,
    }


def _selection_key(entry: dict[str, Any]) -> tuple[int, bool, int, int, str]:
    return (
        abs(int(entry["dead_band_k_wad"]) - WAD),
        (int(entry["required_toxic_epochs"]), int(entry["persistence_window"])) != (3, 5),
        -int(entry["maximum_decrease_pips"]),
        int(entry["maximum_increase_pips"]),
        str(entry["case_id"]),
    )


def _evaluate_h4_frontier(
    cases: tuple[RemediationCase, ...],
    seeds: tuple[int, ...],
    split: str,
    hook_gas_per_swap: int,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    fixed_lp: dict[tuple[str, int], int] = {}
    for scenario in PERSISTENT_CHALLENGE_SCENARIOS:
        for seed in seeds:
            result = simulate_policy(
                "fixed_fee",
                generate_scenario(scenario, seed),
                ResearchConfig(),
                0,
                "normal",
                hook_gas_per_swap,
            )
            fixed_lp[(scenario, seed)] = int(result["lp_net_pnl_quote_wad"])

    for case in cases:
        benign_fprs: list[int] = []
        latencies: list[int] = []
        lp_improvements: list[int] = []
        for scenario in BENIGN_CHALLENGE_SCENARIOS:
            for seed in seeds:
                result = simulate_policy(
                    "thetashield",
                    generate_benign_challenge(scenario, seed),
                    case.config,
                    case.gain_fee_pips,
                    "normal",
                    hook_gas_per_swap,
                )
                benign_fprs.append(int(result["false_positive_rate_wad"]))
        for scenario in PERSISTENT_CHALLENGE_SCENARIOS:
            for seed in seeds:
                result = simulate_policy(
                    "thetashield",
                    generate_scenario(scenario, seed),
                    case.config,
                    case.gain_fee_pips,
                    "normal",
                    hook_gas_per_swap,
                )
                latency = result["detection_latency_steps"]
                latencies.append(241 if latency is None else int(latency))
                lp_improvements.append(
                    int(result["lp_net_pnl_quote_wad"]) - fixed_lp[(scenario, seed)]
                )
        rows.append(
            {
                "split": split,
                "case_id": case.case_id,
                "dead_band_k_wad": case.config.dead_band_k_wad,
                "required_toxic_epochs": case.config.required_toxic_epochs,
                "persistence_window": case.config.persistence_window,
                "fast_path_enabled": case.config.fast_path_enabled,
                "benign_false_positive_rate_wad": _mean(benign_fprs),
                "persistent_effective_detection_latency_steps": _mean(latencies),
                "persistent_lp_improvement_quote_wad": _mean(lp_improvements),
                "pareto_optimal": False,
            }
        )
    for case_id in _pareto_case_ids(rows):
        next(row for row in rows if row["case_id"] == case_id)["pareto_optimal"] = True
    return rows


def _h4_decision(rows: list[dict[str, Any]]) -> dict[str, Any]:
    fpr_values = [int(row["benign_false_positive_rate_wad"]) for row in rows]
    latency_values = [int(row["persistent_effective_detection_latency_steps"]) for row in rows]
    pareto_rows = [row for row in rows if row["pareto_optimal"]]
    pareto_ids = [str(row["case_id"]) for row in pareto_rows]
    pareto_points = {
        (
            int(row["benign_false_positive_rate_wad"]),
            int(row["persistent_effective_detection_latency_steps"]),
            int(row["persistent_lp_improvement_quote_wad"]),
        )
        for row in pareto_rows
    }
    rank_correlation = _rank_correlation_wad(fpr_values, latency_values)
    fpr_span = max(fpr_values) - min(fpr_values)
    latency_span = max(latency_values) - min(latency_values)
    rule = HYPOTHESIS_RULES["H4"]
    passed = (
        rank_correlation <= int(rule["maximum_rank_correlation_wad"])
        and len(pareto_points) >= int(rule["minimum_pareto_points"])
        and fpr_span >= int(rule["minimum_false_positive_span_wad"])
        and latency_span >= int(rule["minimum_latency_span_steps"])
    )
    failed = rank_correlation >= 0 or len(pareto_points) < 2
    return {
        "status": "pass" if passed else ("fail" if failed else "inconclusive"),
        "rank_correlation_wad": rank_correlation,
        "pareto_point_count": len(pareto_points),
        "pareto_case_count": len(pareto_ids),
        "pareto_case_ids": pareto_ids,
        "false_positive_span_wad": fpr_span,
        "latency_span_steps": latency_span,
    }


def _mean(values: Iterable[int]) -> int:
    present = [int(value) for value in values]
    if not present:
        raise AssertionError("mean requires at least one value")
    return sum(present) // len(present)


def serialize_csv(rows: list[dict[str, Any]], columns: tuple[str, ...]) -> str:
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    writer.writerows({column: row.get(column) for column in columns} for row in rows)
    return buffer.getvalue()


def serialize_json(value: Any) -> str:
    return json.dumps(value, indent=2, sort_keys=True) + "\n"


def render_report(summary: dict[str, Any]) -> str:
    holdout_h4 = summary["holdout"]["H4"]
    holdout_h5 = summary["holdout"]["H5"]
    legacy_h5 = summary["holdout"]["legacy_H5"]
    config = summary["selected_research_config"]
    return "\n".join(
        [
            "# Phase 6.1 H4/H5 Remediation Report",
            "",
            "## Outcome",
            "",
            f"The reserved holdout result is **{summary['holdout']['overall_status'].upper()}**: "
            f"H4 is **{holdout_h4['status'].upper()}** and H5 is **{holdout_h5['h5_status'].upper()}**.",
            "The original Phase 6 v1 H4/H5 failures remain preserved; this report is a new versioned",
            "experiment and does not rewrite unfavorable historical evidence.",
            "",
            "## Why v1 failed and what changed",
            "",
            "- H4 failed because its benign streams were too easy: every relevant candidate had 0% false",
            "  positives, so no two-axis false-positive/latency frontier could be measured. Phase 6.1 adds",
            "  near-threshold clusters, heteroskedastic noise, and reversal bursts, all explicitly benign.",
            "- H5 failed because the 3-of-5 persistence gate reacted too late, retaining only a small share",
            "  of raw toxic-premium coverage. Phase 6.1 adds a confidence-gated instantaneous fast path",
            "  after cold start, keeps the original persistence path, shortens the evidence window, and",
            "  uses asymmetric fee steps so protection rises faster than it relaxes.",
            "",
            "## Locked configuration",
            "",
            f"Training selected `{summary['selected_case_id']}` from {summary['training_case_count']} cases.",
            f"The settings are dead-band k {config['dead_band_k_wad'] / WAD:.2f}, "
            f"{config['required_toxic_epochs']}-of-{config['persistence_window']} persistence, "
            f"{config['epoch_observation_count']} observations per epoch, "
            f"{config['trailing_window']} trailing observations, +{config['maximum_increase_pips']}/"
            f"-{config['maximum_decrease_pips']} pips per update, and a fast threshold of "
            f"{config['fast_path_toxic_threshold_wad'] * 10_000 / WAD:.2f} bps at "
            f"{config['fast_path_confidence_floor_wad'] * 100 / WAD:.0f}% confidence.",
            "",
            "## Reserved holdout evidence",
            "",
            f"- H4 rank correlation: {holdout_h4['rank_correlation_wad'] / WAD:.3f}; "
            f"{holdout_h4['pareto_point_count']} Pareto points; "
            f"false-positive span {holdout_h4['false_positive_span_wad'] * 100 / WAD:.2f} percentage points; "
            f"latency span {holdout_h4['latency_span_steps']} steps.",
            f"- H5 retained toxic-premium coverage: {holdout_h5['retained_coverage_ratio_wad'] * 100 / WAD:.2f}% "
            f"(v1 legacy on the same holdout: {legacy_h5['retained_coverage_ratio_wad'] * 100 / WAD:.2f}%).",
            f"- H5 raw-minus-remediated FPR reduction: {holdout_h5['fpr_reduction_mean_wad'] * 100 / WAD:.2f} pp "
            f"with 95% interval [{holdout_h5['fpr_reduction_ci95_low_wad'] * 100 / WAD:.2f}, "
            f"{holdout_h5['fpr_reduction_ci95_high_wad'] * 100 / WAD:.2f}].",
            f"- H5 raw-minus-remediated oscillation reduction: {holdout_h5['oscillation_reduction_mean_pips']} pips "
            f"with 95% interval [{holdout_h5['oscillation_reduction_ci95_low_pips']}, "
            f"{holdout_h5['oscillation_reduction_ci95_high_pips']}].",
            "",
            "## Reproduction",
            "",
            "```sh",
            "make phase61-report",
            "make phase61-check",
            "```",
            "",
            "## Interpretation boundary",
            "",
            summary["interpretation_boundary"],
            "The holdout seeds are disjoint from training and are not used by the selection function.",
            "No deployment, paid transaction, external token, or private key is used.",
            "",
        ]
    )


def render_h4_chart(rows: list[dict[str, Any]], summary: dict[str, Any]) -> str:
    selected = [row for row in rows if row["split"] == "holdout"]
    width, height = 1_050, 680
    left, top, plot_width, plot_height = 100, 100, 780, 480
    maximum_fpr = max(int(row["benign_false_positive_rate_wad"]) for row in selected) or 1
    maximum_latency = max(int(row["persistent_effective_detection_latency_steps"]) for row in selected) or 1
    parts = _svg_header(width, height, "Phase 6.1 holdout detection frontier")
    parts.extend(
        [
            f'<line x1="{left}" y1="{top + plot_height}" x2="{left + plot_width}" y2="{top + plot_height}" class="axis"/>',
            f'<line x1="{left}" y1="{top}" x2="{left}" y2="{top + plot_height}" class="axis"/>',
            '<text x="490" y="635" text-anchor="middle" class="label">Benign false-positive rate → lower is better</text>',
            '<text x="25" y="340" transform="rotate(-90 25 340)" text-anchor="middle" class="label">Effective latency → lower is better</text>',
        ]
    )
    for row in selected:
        x = left + int(row["benign_false_positive_rate_wad"]) * plot_width / maximum_fpr
        y = top + int(row["persistent_effective_detection_latency_steps"]) * plot_height / maximum_latency
        color = "#22c55e" if row["pareto_optimal"] else "#64748b"
        radius = 7 if row["pareto_optimal"] else 5
        parts.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{radius}" fill="{color}" opacity="0.85"/>')
    evidence = summary["holdout"]["H4"]
    parts.append(
        f'<text x="930" y="145" class="note">rank r = {evidence["rank_correlation_wad"] / WAD:.3f}</text>'
    )
    parts.append(f'<text x="930" y="172" class="note">Pareto = {evidence["pareto_point_count"]}</text>')
    return "".join(parts) + "</svg>\n"


def render_h5_chart(summary: dict[str, Any]) -> str:
    width, height = 900, 560
    legacy = summary["holdout"]["legacy_H5"]
    remediated = summary["holdout"]["H5"]
    bars = (
        ("raw comparator", int(remediated["raw_toxic_premium_coverage_wad"]), "#8b5cf6"),
        ("Phase 6 v1", int(legacy["thetashield_toxic_premium_coverage_wad"]), "#ef4444"),
        ("Phase 6.1", int(remediated["thetashield_toxic_premium_coverage_wad"]), "#22c55e"),
    )
    parts = _svg_header(width, height, "Phase 6.1 holdout toxic-premium coverage")
    for index, (label, value, color) in enumerate(bars):
        x = 140 + index * 235
        bar_height = value * 350 / WAD
        y = 445 - bar_height
        parts.append(f'<rect x="{x}" y="{y:.2f}" width="120" height="{bar_height:.2f}" rx="6" fill="{color}"/>')
        parts.append(f'<text x="{x + 60}" y="{y - 12:.2f}" text-anchor="middle" class="value">{value * 100 / WAD:.2f}%</text>')
        parts.append(f'<text x="{x + 60}" y="480" text-anchor="middle" class="label">{escape(label)}</text>')
    parts.append('<text x="450" y="525" text-anchor="middle" class="note">Reserved seeds only; the 50% retained-coverage floor is applied against the raw comparator.</text>')
    return "".join(parts) + "</svg>\n"


def _svg_header(width: int, height: int, title: str) -> list[str]:
    return [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        "<style>text{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;fill:#e2e8f0}.title{font-size:24px;font-weight:700}.axis{stroke:#94a3b8;stroke-width:1.5}.label{font-size:13px;font-weight:600}.value{font-size:13px}.note{font-size:12px;fill:#94a3b8}</style>",
        '<rect width="100%" height="100%" fill="#0f172a"/>',
        f'<text x="45" y="52" class="title">{escape(title)}</text>',
    ]


def build_outputs(repo_root: Path = REPO_ROOT) -> dict[Path, str]:
    h4_rows, h5_rows, summary, manifest = run_remediation(measure_hook_gas(repo_root))
    return {
        repo_root / "research/datasets/phase61_remediation_manifest.json": serialize_json(manifest),
        repo_root / "research/reports/phase61_h4_frontier.csv": serialize_csv(h4_rows, H4_COLUMNS),
        repo_root / "research/reports/phase61_h5_results.csv": serialize_csv(h5_rows, H5_COLUMNS),
        repo_root / "research/reports/phase61_summary.json": serialize_json(summary),
        repo_root / "research/reports/PHASE61_REMEDIATION.md": render_report(summary),
        repo_root / "research/reports/charts/phase61_h4_frontier.svg": render_h4_chart(h4_rows, summary),
        repo_root / "research/reports/charts/phase61_h5_coverage.svg": render_h5_chart(summary),
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
            raise SystemExit(f"Phase 6.1 artifacts are stale; run make phase61-report:\n{joined}")
        return
    for path, content in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()
