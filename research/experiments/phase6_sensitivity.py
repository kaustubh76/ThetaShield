"""Reproduce Phase 6 parameter sweeps, hypothesis decisions, and charts."""

from __future__ import annotations

import argparse
import csv
import io
import json
from collections import Counter
from html import escape
from math import isqrt
from pathlib import Path
from typing import Any, Iterable

from research.experiments.phase5_baselines import RESULT_COLUMNS, measure_hook_gas, run_experiment
from research.thetashield.model import WAD
from research.thetashield.policies import ResearchConfig
from research.thetashield.scenarios import EVENT_COUNT, REPEATED_SEEDS, SCENARIOS, SCENARIO_BY_NAME, generate_scenario
from research.thetashield.sensitivity import (
    BENIGN_SCENARIOS,
    DIRECTIONAL_SCENARIOS,
    HYPOTHESIS_RULES,
    MANIPULATION_SCENARIOS,
    PERSISTENT_SCENARIOS,
    SweepCase,
    build_sweep_cases,
)
from research.thetashield.simulator import correlation_wad, simulate_policy

REPO_ROOT = Path(__file__).resolve().parents[2]
SWEEP_RESULT_COLUMNS = ("case_id", "dimension", "value_label", *RESULT_COLUMNS)
SWEEP_SUMMARY_COLUMNS = (
    "case_id",
    "dimension",
    "value_label",
    "benign_false_positive_rate_wad",
    "persistent_effective_detection_latency_steps",
    "persistent_detection_success_rate_wad",
    "persistent_lp_improvement_quote_wad",
    "overall_false_positive_rate_wad",
    "overall_false_negative_rate_wad",
    "directionally_correct_toxic_rate_wad",
    "correlation_with_volatility_only_wad",
    "fee_oscillation_pips",
    "pareto_optimal",
)


def run_sensitivity(
    hook_gas: dict[str, int],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    baseline_rows, baseline_summary, _ = run_experiment(hook_gas)
    baseline_lookup = {
        (str(row["scenario"]), int(row["seed"]), str(row["policy"])): row
        for row in baseline_rows
    }
    cases = build_sweep_cases()
    streams = {
        (scenario.name, seed): generate_scenario(scenario.name, seed)
        for scenario in SCENARIOS
        for seed in REPEATED_SEEDS
    }
    volatility_gain = int(baseline_summary["selected_gain_fee_pips"]["volatility_only"])
    volatility_series: dict[tuple[str, int], list[int]] = {}
    for (scenario_name, seed), events in streams.items():
        result = simulate_policy(
            "volatility_only",
            events,
            ResearchConfig(),
            volatility_gain,
            SCENARIO_BY_NAME[scenario_name].operational_mode,
            hook_gas["hook_gas_per_swap"],
        )
        series = result["applied_fee_series"]
        assert isinstance(series, list)
        volatility_series[(scenario_name, seed)] = series

    rows: list[dict[str, Any]] = []
    for case in cases:
        for scenario in SCENARIOS:
            for seed in REPEATED_SEEDS:
                events = streams[(scenario.name, seed)]
                result = simulate_policy(
                    "thetashield",
                    events,
                    case.config,
                    case.gain_fee_pips,
                    scenario.operational_mode,
                    hook_gas["hook_gas_per_swap"],
                )
                policy_series = result.pop("applied_fee_series")
                assert isinstance(policy_series, list)
                result.update(
                    {
                        "scenario": scenario.name,
                        "seed": seed,
                        "correlation_with_volatility_only_wad": correlation_wad(
                            policy_series,
                            volatility_series[(scenario.name, seed)],
                        ),
                    }
                )
                rows.append(
                    {
                        "case_id": case.case_id,
                        "dimension": case.dimension,
                        "value_label": case.value_label,
                        **{column: result.get(column) for column in RESULT_COLUMNS},
                    }
                )

    case_summaries = _summarize_cases(rows, baseline_lookup, cases)
    hypotheses, directionality = _evaluate_hypotheses(
        rows,
        baseline_rows,
        case_summaries,
    )
    status_counts = Counter(decision["status"] for decision in hypotheses)
    pareto_ids = [entry["case_id"] for entry in case_summaries if entry["pareto_optimal"]]
    summary = {
        "schema_version": 1,
        "experiment": "phase6_sensitivity_and_hypotheses",
        "raw_run_count": len(rows),
        "sweep_case_count": len(cases),
        "scenario_count": len(SCENARIOS),
        "seed_count": len(REPEATED_SEEDS),
        "sweep_dimension_count": len({case.dimension for case in cases if case.dimension != "default"}),
        "hook_gas_measurement": hook_gas,
        "interval_note": "paired or unpaired descriptive 95% normal intervals across deterministic scenario seeds; not live-market inference",
        "hypotheses": hypotheses,
        "hypothesis_status_counts": dict(sorted(status_counts.items())),
        "pareto_case_ids": pareto_ids,
        "directionality_by_scenario": directionality,
        "by_case": {entry["case_id"]: entry for entry in case_summaries},
    }
    manifest = {
        "schema_version": 1,
        "decision_protocol_id": "thetashield-phase6-v1",
        "method": "deterministic one-at-a-time sweep around the committed Phase 5 default",
        "hypothesis_rules": HYPOTHESIS_RULES,
        "scenario_groups": {
            "benign": list(BENIGN_SCENARIOS),
            "persistent": list(PERSISTENT_SCENARIOS),
            "directional": list(DIRECTIONAL_SCENARIOS),
            "manipulation": list(MANIPULATION_SCENARIOS),
        },
        "repeated_seeds": list(REPEATED_SEEDS),
        "event_count_per_run": EVENT_COUNT,
        "sweep_cases": [case.to_dict() for case in cases],
        "raw_result_columns": list(SWEEP_RESULT_COLUMNS),
        "missing_detection_semantics": f"effective latency is {EVENT_COUNT + 1} steps when no premium is detected",
    }
    return rows, case_summaries, summary, manifest


def _summarize_cases(
    rows: list[dict[str, Any]],
    baseline_lookup: dict[tuple[str, int, str], dict[str, Any]],
    cases: tuple[SweepCase, ...],
) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for case in cases:
        selected = [row for row in rows if row["case_id"] == case.case_id]
        benign = [row for row in selected if row["scenario"] in BENIGN_SCENARIOS]
        persistent = [row for row in selected if row["scenario"] in PERSISTENT_SCENARIOS]
        directional = [row for row in selected if row["scenario"] in DIRECTIONAL_SCENARIOS]
        persistent_lp_differences = [
            int(row["lp_net_pnl_quote_wad"])
            - int(baseline_lookup[(str(row["scenario"]), int(row["seed"]), "fixed_fee")]["lp_net_pnl_quote_wad"])
            for row in persistent
        ]
        detected = [row for row in persistent if row["detection_latency_steps"] is not None]
        summary = {
            "case_id": case.case_id,
            "dimension": case.dimension,
            "value_label": case.value_label,
            "gain_fee_pips": case.gain_fee_pips,
            "benign_false_positive_rate_wad": _mean(benign, "false_positive_rate_wad"),
            "persistent_effective_detection_latency_steps": _mean_values(
                [_effective_latency(row) for row in persistent]
            ),
            "persistent_detection_success_rate_wad": len(detected) * WAD // len(persistent),
            "persistent_lp_improvement_quote_wad": _mean_values(persistent_lp_differences),
            "overall_false_positive_rate_wad": _mean(selected, "false_positive_rate_wad"),
            "overall_false_negative_rate_wad": _mean(selected, "false_negative_rate_wad"),
            "directionally_correct_toxic_rate_wad": _mean(
                directional,
                "directionally_correct_toxic_rate_wad",
            ),
            "correlation_with_volatility_only_wad": _mean(
                selected,
                "correlation_with_volatility_only_wad",
            ),
            "fee_oscillation_pips": _mean(selected, "fee_oscillation_pips"),
            "pareto_optimal": False,
        }
        summaries.append(summary)

    for case_id in _pareto_case_ids(summaries):
        next(entry for entry in summaries if entry["case_id"] == case_id)["pareto_optimal"] = True
    return summaries


def _evaluate_hypotheses(
    sweep_rows: list[dict[str, Any]],
    baseline_rows: list[dict[str, Any]],
    case_summaries: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, int | None]]]:
    default_rows = [row for row in sweep_rows if row["case_id"] == "default"]
    decisions: list[dict[str, Any]] = []

    h1_differences = _paired_differences(
        default_rows,
        baseline_rows,
        "lp_net_pnl_quote_wad",
        PERSISTENT_SCENARIOS,
        "fixed_fee",
    )
    h1_interval = _mean_and_interval(h1_differences)
    h1_status = _positive_interval_status(h1_interval, zero_is_failure=False)
    theta_persistent = _scenario_rows(default_rows, PERSISTENT_SCENARIOS)
    fixed_persistent = _policy_rows(baseline_rows, "fixed_fee", PERSISTENT_SCENARIOS)
    decisions.append(
        _decision(
            "H1",
            h1_status,
            {
                "paired_lp_net_improvement_quote_wad": h1_interval,
                "pair_count": len(h1_differences),
                "thetashield_mean_lp_net_pnl_quote_wad": _mean(
                    theta_persistent,
                    "lp_net_pnl_quote_wad",
                ),
                "fixed_mean_lp_net_pnl_quote_wad": _mean(
                    fixed_persistent,
                    "lp_net_pnl_quote_wad",
                ),
            },
            "Persistent-flow LP net PnL is compared pairwise against the fixed-fee result on identical streams.",
        )
    )

    h2_rows = [row for row in default_rows if row["scenario"] == "benign_noise"]
    fee_excess = [
        (int(row["mean_applied_fee_pips"]) - ResearchConfig().base_fee_pips)
        * WAD
        // ResearchConfig().base_fee_pips
        for row in h2_rows
    ]
    h2_fee_interval = _mean_and_interval(fee_excess)
    h2_fpr_interval = _mean_and_interval(
        [int(row["false_positive_rate_wad"]) for row in h2_rows]
    )
    h2_rule = HYPOTHESIS_RULES["H2"]
    fee_limit = int(h2_rule["maximum_fee_excess_rate_wad"])
    fpr_limit = int(h2_rule["maximum_false_positive_rate_wad"])
    if int(h2_fee_interval["ci95_high"]) <= fee_limit and int(h2_fpr_interval["ci95_high"]) <= fpr_limit:
        h2_status = "pass"
    elif int(h2_fee_interval["ci95_low"]) > fee_limit or int(h2_fpr_interval["ci95_low"]) > fpr_limit:
        h2_status = "fail"
    else:
        h2_status = "inconclusive"
    decisions.append(
        _decision(
            "H2",
            h2_status,
            {
                "fee_excess_rate_wad": h2_fee_interval,
                "false_positive_rate_wad": h2_fpr_interval,
                "fee_excess_limit_wad": fee_limit,
                "false_positive_limit_wad": fpr_limit,
            },
            "The benign-noise upper intervals are checked against fixed limits declared in the sweep manifest.",
        )
    )

    h3_differences = _paired_differences(
        baseline_rows,
        default_rows,
        "false_positive_rate_wad",
        BENIGN_SCENARIOS,
        "thetashield",
        left_policy="raw_positive_markout",
    )
    h3_interval = _mean_and_interval(h3_differences)
    decisions.append(
        _decision(
            "H3",
            _positive_interval_status(h3_interval, zero_is_failure=True),
            {
                "raw_minus_thetashield_false_positive_rate_wad": h3_interval,
                "pair_count": len(h3_differences),
            },
            "Positive values mean the full controller produced fewer false-positive premiums than raw markout.",
        )
    )

    h4_points = [
        entry
        for entry in case_summaries
        if entry["dimension"] in {"default", *HYPOTHESIS_RULES["H4"]["dimensions"]}
    ]
    h4_pareto_ids = _pareto_case_ids(h4_points)
    fpr_values = [int(entry["benign_false_positive_rate_wad"]) for entry in h4_points]
    latency_values = [int(entry["persistent_effective_detection_latency_steps"]) for entry in h4_points]
    rank_correlation = _rank_correlation_wad(fpr_values, latency_values)
    fpr_span = max(fpr_values) - min(fpr_values)
    latency_span = max(latency_values) - min(latency_values)
    h4_rule = HYPOTHESIS_RULES["H4"]
    if (
        rank_correlation <= int(h4_rule["maximum_rank_correlation_wad"])
        and len(h4_pareto_ids) >= int(h4_rule["minimum_pareto_points"])
        and fpr_span >= int(h4_rule["minimum_false_positive_span_wad"])
        and latency_span >= int(h4_rule["minimum_latency_span_steps"])
    ):
        h4_status = "pass"
    elif rank_correlation >= 0 or len(h4_pareto_ids) < 2:
        h4_status = "fail"
    else:
        h4_status = "inconclusive"
    decisions.append(
        _decision(
            "H4",
            h4_status,
            {
                "rank_correlation_wad": rank_correlation,
                "pareto_case_ids": h4_pareto_ids,
                "pareto_point_count": len(h4_pareto_ids),
                "false_positive_span_wad": fpr_span,
                "latency_span_steps": latency_span,
            },
            "Lower false-positive rates are expected to accompany longer effective detection latency.",
        )
    )

    h5_fpr_reduction = _paired_differences(
        baseline_rows,
        default_rows,
        "false_positive_rate_wad",
        MANIPULATION_SCENARIOS,
        "thetashield",
        left_policy="raw_positive_markout",
    )
    h5_oscillation_reduction = _paired_differences(
        baseline_rows,
        default_rows,
        "fee_oscillation_pips",
        MANIPULATION_SCENARIOS,
        "thetashield",
        left_policy="raw_positive_markout",
    )
    raw_manipulation = _policy_rows(baseline_rows, "raw_positive_markout", MANIPULATION_SCENARIOS)
    theta_manipulation = _scenario_rows(default_rows, MANIPULATION_SCENARIOS)
    raw_coverage = _mean(raw_manipulation, "toxic_notional_premium_rate_wad")
    theta_coverage = _mean(theta_manipulation, "toxic_notional_premium_rate_wad")
    coverage_ratio = theta_coverage * WAD // raw_coverage if raw_coverage else 0
    fpr_reduction_interval = _mean_and_interval(h5_fpr_reduction)
    oscillation_reduction_interval = _mean_and_interval(h5_oscillation_reduction)
    h5_rule = HYPOTHESIS_RULES["H5"]
    if (
        int(fpr_reduction_interval["ci95_low"]) > 0
        and int(oscillation_reduction_interval["ci95_low"]) > 0
        and coverage_ratio >= int(h5_rule["minimum_pass_coverage_ratio_wad"])
    ):
        h5_status = "pass"
    elif (
        int(fpr_reduction_interval["ci95_high"]) <= 0
        or int(oscillation_reduction_interval["ci95_high"]) <= 0
        or coverage_ratio < int(h5_rule["failure_coverage_ratio_wad"])
    ):
        h5_status = "fail"
    else:
        h5_status = "inconclusive"
    decisions.append(
        _decision(
            "H5",
            h5_status,
            {
                "raw_minus_thetashield_false_positive_rate_wad": fpr_reduction_interval,
                "raw_minus_thetashield_fee_oscillation_pips": oscillation_reduction_interval,
                "raw_toxic_premium_coverage_wad": raw_coverage,
                "thetashield_toxic_premium_coverage_wad": theta_coverage,
                "retained_coverage_ratio_wad": coverage_ratio,
            },
            "The coverage floor prevents a controller that simply never reacts from being labeled manipulation-resistant.",
        )
    )

    h6_advantage = _paired_differences(
        default_rows,
        baseline_rows,
        "directionally_correct_toxic_rate_wad",
        DIRECTIONAL_SCENARIOS,
        "volatility_only",
    )
    h6_interval = _mean_and_interval(h6_advantage)
    theta_directional = _scenario_rows(default_rows, DIRECTIONAL_SCENARIOS)
    mean_correlation = _mean(theta_directional, "correlation_with_volatility_only_wad")
    h6_rule = HYPOTHESIS_RULES["H6"]
    if (
        int(h6_interval["ci95_low"]) >= int(h6_rule["minimum_directional_advantage_wad"])
        and mean_correlation <= int(h6_rule["maximum_pass_correlation_wad"])
    ):
        h6_status = "pass"
    elif int(h6_interval["ci95_high"]) <= 0 or mean_correlation >= int(h6_rule["failure_correlation_wad"]):
        h6_status = "fail"
    else:
        h6_status = "inconclusive"
    directionality: dict[str, dict[str, int | None]] = {}
    for scenario in DIRECTIONAL_SCENARIOS:
        theta_rows = [row for row in default_rows if row["scenario"] == scenario]
        volatility_rows = _policy_rows(baseline_rows, "volatility_only", (scenario,))
        directionality[scenario] = {
            "thetashield_correct_direction_rate_wad": _mean(
                theta_rows,
                "directionally_correct_toxic_rate_wad",
            ),
            "volatility_only_correct_direction_rate_wad": _mean(
                volatility_rows,
                "directionally_correct_toxic_rate_wad",
            ),
            "thetashield_correlation_with_volatility_only_wad": _mean(
                theta_rows,
                "correlation_with_volatility_only_wad",
            ),
        }
    decisions.append(
        _decision(
            "H6",
            h6_status,
            {
                "thetashield_minus_volatility_directional_rate_wad": h6_interval,
                "mean_correlation_with_volatility_only_wad": mean_correlation,
                "pair_count": len(h6_advantage),
            },
            "The volatility-only policy applies symmetric side fees, while this test requires a repeated-seed directional advantage.",
        )
    )
    return decisions, directionality


def _decision(
    hypothesis_id: str,
    status: str,
    evidence: dict[str, Any],
    interpretation: str,
) -> dict[str, Any]:
    rule = HYPOTHESIS_RULES[hypothesis_id]
    return {
        "id": hypothesis_id,
        "title": rule["title"],
        "status": status,
        "pass_rule": rule["pass_rule"],
        "fail_rule": rule["fail_rule"],
        "evidence": evidence,
        "interpretation": interpretation,
    }


def _positive_interval_status(interval: dict[str, int | None], zero_is_failure: bool) -> str:
    low = int(interval["ci95_low"])
    high = int(interval["ci95_high"])
    if low > 0:
        return "pass"
    if high < 0 or (zero_is_failure and high == 0):
        return "fail"
    return "inconclusive"


def _paired_differences(
    left_rows: list[dict[str, Any]],
    right_rows: list[dict[str, Any]],
    metric: str,
    scenarios: tuple[str, ...],
    right_policy: str,
    left_policy: str | None = None,
) -> list[int]:
    if left_policy is None:
        left = {
            (str(row["scenario"]), int(row["seed"])): row
            for row in left_rows
            if row["scenario"] in scenarios
        }
    else:
        left = {
            (str(row["scenario"]), int(row["seed"])): row
            for row in left_rows
            if row["scenario"] in scenarios and row.get("policy") == left_policy
        }
    right = {
        (str(row["scenario"]), int(row["seed"])): row
        for row in right_rows
        if row["scenario"] in scenarios and row.get("policy", "thetashield") == right_policy
    }
    if left.keys() != right.keys():
        raise AssertionError(f"paired rows do not match for {metric}")
    differences = []
    for key in sorted(left):
        left_value = left[key][metric]
        right_value = right[key][metric]
        if left_value is not None and right_value is not None:
            differences.append(int(left_value) - int(right_value))
    if not differences:
        raise AssertionError(f"paired metric {metric} has no values")
    return differences


def _policy_rows(
    rows: list[dict[str, Any]],
    policy: str,
    scenarios: tuple[str, ...],
) -> list[dict[str, Any]]:
    return [row for row in rows if row["policy"] == policy and row["scenario"] in scenarios]


def _scenario_rows(
    rows: list[dict[str, Any]],
    scenarios: tuple[str, ...],
) -> list[dict[str, Any]]:
    return [row for row in rows if row["scenario"] in scenarios]


def _effective_latency(row: dict[str, Any]) -> int:
    value = row["detection_latency_steps"]
    return EVENT_COUNT + 1 if value is None else int(value)


def _mean(rows: list[dict[str, Any]], metric: str) -> int:
    values = [int(row[metric]) for row in rows if row[metric] is not None]
    if not values:
        raise AssertionError(f"metric {metric} has no values")
    return sum(values) // len(values)


def _mean_values(values: list[int]) -> int:
    if not values:
        raise AssertionError("mean requires at least one value")
    return sum(values) // len(values)


def _mean_and_interval(values: Iterable[int]) -> dict[str, int]:
    present = [int(value) for value in values]
    if not present:
        raise AssertionError("interval requires at least one value")
    average = sum(present) // len(present)
    if len(present) == 1:
        radius = 0
    else:
        variance = sum((value - average) ** 2 for value in present) // (len(present) - 1)
        radius = isqrt(variance // len(present)) * 196 // 100
    return {
        "count": len(present),
        "mean": average,
        "ci95_low": average - radius,
        "ci95_high": average + radius,
    }


def _pareto_case_ids(entries: list[dict[str, Any]]) -> list[str]:
    pareto: list[str] = []
    for candidate in entries:
        dominated = False
        for challenger in entries:
            if challenger is candidate:
                continue
            no_worse = (
                int(challenger["benign_false_positive_rate_wad"])
                <= int(candidate["benign_false_positive_rate_wad"])
                and int(challenger["persistent_effective_detection_latency_steps"])
                <= int(candidate["persistent_effective_detection_latency_steps"])
                and int(challenger["persistent_lp_improvement_quote_wad"])
                >= int(candidate["persistent_lp_improvement_quote_wad"])
            )
            strictly_better = (
                int(challenger["benign_false_positive_rate_wad"])
                < int(candidate["benign_false_positive_rate_wad"])
                or int(challenger["persistent_effective_detection_latency_steps"])
                < int(candidate["persistent_effective_detection_latency_steps"])
                or int(challenger["persistent_lp_improvement_quote_wad"])
                > int(candidate["persistent_lp_improvement_quote_wad"])
            )
            if no_worse and strictly_better:
                dominated = True
                break
        if not dominated:
            pareto.append(str(candidate["case_id"]))
    return pareto


def _rank_correlation_wad(left: list[int], right: list[int]) -> int:
    return correlation_wad(_ranks_times_two(left), _ranks_times_two(right))


def _ranks_times_two(values: list[int]) -> list[int]:
    ranks = [0] * len(values)
    ordered = sorted(range(len(values)), key=values.__getitem__)
    start = 0
    while start < len(ordered):
        end = start
        while end + 1 < len(ordered) and values[ordered[end + 1]] == values[ordered[start]]:
            end += 1
        doubled_average_rank = (start + 1) + (end + 1)
        for position in range(start, end + 1):
            ranks[ordered[position]] = doubled_average_rank
        start = end + 1
    return ranks


def serialize_csv(rows: list[dict[str, Any]], columns: tuple[str, ...]) -> str:
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    writer.writerows({column: row.get(column) for column in columns} for row in rows)
    return buffer.getvalue()


def serialize_json(value: Any) -> str:
    return json.dumps(value, indent=2, sort_keys=True) + "\n"


def render_report(summary: dict[str, Any]) -> str:
    lines = [
        "# Phase 6 Sensitivity and Hypothesis Report",
        "",
        "## Interpretation boundary",
        "",
        "This generated report applies the criteria encoded in the Phase 6 sweep manifest to controlled",
        "synthetic streams. Pass, fail, and inconclusive labels describe this simulator only; they do not",
        "establish live profitability, security, or production readiness.",
        "",
        "## Hypothesis decisions",
        "",
        "| Hypothesis | Decision | Key evidence |",
        "|---|---|---|",
    ]
    for decision in summary["hypotheses"]:
        lines.append(
            f"| {decision['id']} — {decision['title']} | **{str(decision['status']).upper()}** | "
            f"{_hypothesis_evidence_text(decision)} |"
        )
    lines.extend(
        [
            "",
            "Failed and inconclusive hypotheses remain visible by design; parameters are not retuned to",
            "change a label after evaluation.",
            "",
            "H1 is a relative result: both fixed-fee and ThetaShield mean LP net outcomes remain negative",
            "in the persistent synthetic regimes. Its PASS label means only that ThetaShield's paired result",
            "is less negative by the declared criterion.",
            "",
            "## Decision protocol and evidence",
            "",
        ]
    )
    for decision in summary["hypotheses"]:
        lines.extend(
            [
                f"### {decision['id']} — {decision['title']}: {str(decision['status']).upper()}",
                "",
                f"- Pass rule: {decision['pass_rule']}.",
                f"- Fail rule: {decision['fail_rule']}.",
                f"- Evidence: {_hypothesis_evidence_text(decision)}.",
                f"- Interpretation: {decision['interpretation']}",
                "",
            ]
        )
    lines.extend(
        [
            "## Sensitivity design",
            "",
            f"The harness evaluates {summary['sweep_case_count']} configurations across "
            f"{summary['scenario_count']} scenarios and {summary['seed_count']} seeds, producing "
            f"{summary['raw_run_count']:,} raw ThetaShield runs. Each non-default case changes one of "
            f"{summary['sweep_dimension_count']} required parameter families from the Phase 5 default.",
            "",
            "The headline Pareto analysis minimizes benign false positives and effective persistent-flow",
            "detection latency while maximizing paired LP net improvement over fixed fees. A missed",
            f"detection is conservatively assigned {EVENT_COUNT + 1} steps.",
            "",
            "## Global Pareto configurations",
            "",
            "| Configuration | Dimension | Value | Benign FPR | Effective latency | LP improvement (quote) |",
            "|---|---|---:|---:|---:|---:|",
        ]
    )
    for case_id in summary["pareto_case_ids"]:
        entry = summary["by_case"][case_id]
        lines.append(
            f"| `{case_id}` | `{entry['dimension']}` | {entry['value_label']} | "
            f"{_format_percent(entry['benign_false_positive_rate_wad'])} | "
            f"{entry['persistent_effective_detection_latency_steps']} | "
            f"{_format_wad(entry['persistent_lp_improvement_quote_wad'])} |"
        )
    lines.extend(
        [
            "",
            "## Reproduction",
            "",
            "```sh",
            "make phase6-report",
            "make phase6-check",
            "```",
            "",
            "The report, two CSV files, summary JSON, sweep manifest, and all SVG charts are generated",
            "directly from the scenario definitions and policy model. No chart reads a manually edited",
            "intermediate file.",
            "",
            "## Limitations",
            "",
            "- The order stream is exogenous and does not respond to fees.",
            "- Descriptive seed intervals are not claims about a live-market population.",
            "- The simulator tracks inventory and cash but is not a concentrated-liquidity tick replay.",
            "- Parameter sweeps are one-at-a-time except the coupled n-of-k and fee-step families; broad",
            "  interaction effects remain unmeasured.",
            "- Markout-horizon sweeps use the committed synthetic future-price path and right-edge terminal",
            "  reference, not an external oracle history.",
            "- No deployment, paid transaction, or external service is used.",
            "",
        ]
    )
    return "\n".join(lines)


def _hypothesis_evidence_text(decision: dict[str, Any]) -> str:
    evidence = decision["evidence"]
    hypothesis_id = decision["id"]
    if hypothesis_id == "H1":
        interval = evidence["paired_lp_net_improvement_quote_wad"]
        return f"paired LP improvement {_format_wad(interval['mean'])} [{_format_wad(interval['ci95_low'])}, {_format_wad(interval['ci95_high'])}]"
    if hypothesis_id == "H2":
        return (
            f"fee excess {_format_percent(evidence['fee_excess_rate_wad']['mean'])}; "
            f"FPR {_format_percent(evidence['false_positive_rate_wad']['mean'])}"
        )
    if hypothesis_id == "H3":
        interval = evidence["raw_minus_thetashield_false_positive_rate_wad"]
        return f"raw-minus-full FPR {_format_percentage_points(interval['mean'])} pp"
    if hypothesis_id == "H4":
        return (
            f"rank correlation {_format_ratio(evidence['rank_correlation_wad'])}; "
            f"{evidence['pareto_point_count']} dead-band/persistence Pareto points"
        )
    if hypothesis_id == "H5":
        return (
            f"retained toxic coverage {_format_percent(evidence['retained_coverage_ratio_wad'])}; "
            f"FPR reduction {_format_percentage_points(evidence['raw_minus_thetashield_false_positive_rate_wad']['mean'])} pp"
        )
    interval = evidence["thetashield_minus_volatility_directional_rate_wad"]
    return (
        f"directional advantage {_format_percentage_points(interval['mean'])} pp; "
        f"fee correlation {_format_ratio(evidence['mean_correlation_with_volatility_only_wad'])}"
    )


def render_pareto_chart(summary: dict[str, Any]) -> str:
    width, height = 1_320, 780
    left, top, plot_width, plot_height = 110, 110, 900, 530
    entries = list(summary["by_case"].values())
    observed_maximum_fpr = max(int(entry["benign_false_positive_rate_wad"]) for entry in entries)
    maximum_fpr = observed_maximum_fpr or WAD // 20
    maximum_latency = max(int(entry["persistent_effective_detection_latency_steps"]) for entry in entries) or 1
    lp_values = [int(entry["persistent_lp_improvement_quote_wad"]) for entry in entries]
    minimum_lp, maximum_lp = min(lp_values), max(lp_values)
    parts = _svg_header(width, height, "Phase 6 Pareto map: false positives, latency, and LP outcome")
    parts.extend(
        [
            f'<line x1="{left}" y1="{top + plot_height}" x2="{left + plot_width}" y2="{top + plot_height}" class="axis"/>',
            f'<line x1="{left}" y1="{top}" x2="{left}" y2="{top + plot_height}" class="axis"/>',
            f'<text x="{left + plot_width / 2}" y="710" text-anchor="middle" class="axislabel">Benign false-positive rate (%) → lower is better</text>',
            f'<text x="30" y="{top + plot_height / 2}" transform="rotate(-90 30 {top + plot_height / 2})" text-anchor="middle" class="axislabel">Effective detection latency (steps) → lower is better</text>',
        ]
    )
    for index in range(6):
        x = left + plot_width * index / 5
        fpr_label = maximum_fpr * index * 100 / WAD / 5
        parts.append(f'<line x1="{x:.2f}" y1="{top}" x2="{x:.2f}" y2="{top + plot_height}" class="grid"/>')
        parts.append(f'<text x="{x:.2f}" y="665" text-anchor="middle" class="tick">{fpr_label:.1f}</text>')
        y = top + plot_height * index / 5
        latency_label = maximum_latency * index / 5
        parts.append(f'<line x1="{left}" y1="{y:.2f}" x2="{left + plot_width}" y2="{y:.2f}" class="grid"/>')
        parts.append(f'<text x="95" y="{y + 4:.2f}" text-anchor="end" class="tick">{latency_label:.0f}</text>')
    draw_order = sorted(
        entries,
        key=lambda entry: (bool(entry["pareto_optimal"]), entry["case_id"] == "default"),
    )
    for entry in draw_order:
        x = left + int(entry["benign_false_positive_rate_wad"]) * plot_width / maximum_fpr
        y = top + int(entry["persistent_effective_detection_latency_steps"]) * plot_height / maximum_latency
        color = _outcome_color(int(entry["persistent_lp_improvement_quote_wad"]), minimum_lp, maximum_lp)
        pareto = bool(entry["pareto_optimal"])
        radius = 8 if entry["case_id"] == "default" else 6
        stroke = "#f8fafc" if pareto else "#334155"
        stroke_width = 3 if pareto else 1
        parts.append(
            f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{radius}" fill="{color}" '
            f'stroke="{stroke}" stroke-width="{stroke_width}" opacity="0.88"/>'
        )
        if entry["case_id"] == "default":
            parts.append(f'<text x="{x + 12:.2f}" y="{y - 10:.2f}" class="annotation">default</text>')
    parts.extend(
        [
            '<circle cx="1050" cy="145" r="7" fill="#22c55e"/><text x="1065" y="149" class="legend">higher LP improvement</text>',
            '<circle cx="1050" cy="175" r="7" fill="#ef4444"/><text x="1065" y="179" class="legend">lower LP improvement</text>',
            '<circle cx="1050" cy="205" r="7" fill="#64748b" stroke="#f8fafc" stroke-width="3"/><text x="1065" y="209" class="legend">Pareto optimal</text>',
            '<text x="1050" y="255" class="axislabel">Pareto configurations</text>',
        ]
    )
    for index, case_id in enumerate(summary["pareto_case_ids"]):
        entry = summary["by_case"][case_id]
        parts.append(
            f'<text x="1050" y="{282 + index * 24}" class="legend">'
            f'{escape(str(entry["dimension"]).replace("_", " "))}: '
            f'{escape(str(entry["value_label"]))}</text>'
        )
    no_span_note = " All configurations have 0% benign FPR." if observed_maximum_fpr == 0 else ""
    parts.append(
        f'<text x="660" y="750" text-anchor="middle" class="note">Missed detections are assigned 241 steps; color encodes paired LP improvement.{no_span_note}</text>'
    )
    return "".join(parts) + "</svg>\n"


def render_hypothesis_chart(summary: dict[str, Any]) -> str:
    width, height = 1_100, 650
    colors = {"pass": "#22c55e", "fail": "#ef4444", "inconclusive": "#f59e0b"}
    parts = _svg_header(width, height, "Phase 6 fixed-criteria hypothesis decisions")
    for index, decision in enumerate(summary["hypotheses"]):
        y = 105 + index * 82
        color = colors[str(decision["status"])]
        parts.append(f'<rect x="55" y="{y}" width="990" height="62" rx="8" fill="#1e293b"/>')
        parts.append(f'<circle cx="90" cy="{y + 31}" r="14" fill="{color}"/>')
        parts.append(f'<text x="120" y="{y + 27}" class="decision">{decision["id"]} — {escape(str(decision["title"]))}</text>')
        parts.append(f'<text x="120" y="{y + 48}" class="evidence">{escape(_hypothesis_evidence_text(decision))}</text>')
        parts.append(f'<text x="1015" y="{y + 36}" text-anchor="end" class="status" style="fill:{color}">{str(decision["status"]).upper()}</text>')
    parts.append(
        '<text x="550" y="625" text-anchor="middle" class="note">Labels apply only to the committed synthetic experiment and are retained even when unfavorable.</text>'
    )
    return "".join(parts) + "</svg>\n"


def render_directionality_chart(summary: dict[str, Any]) -> str:
    width, height = 1_050, 620
    parts = _svg_header(width, height, "Phase 6 directional discrimination")
    scenarios = list(DIRECTIONAL_SCENARIOS)
    for index, scenario in enumerate(scenarios):
        group_x = 145 + index * 300
        evidence = summary["directionality_by_scenario"][scenario]
        values = (
            int(evidence["volatility_only_correct_direction_rate_wad"]),
            int(evidence["thetashield_correct_direction_rate_wad"]),
        )
        for policy_index, (value, color, label) in enumerate(
            zip(values, ("#8b5cf6", "#22c55e"), ("volatility", "ThetaShield"), strict=True)
        ):
            x = group_x + policy_index * 90
            bar_height = value * 330 / WAD
            y = 455 - bar_height
            parts.append(f'<rect x="{x}" y="{y:.2f}" width="65" height="{bar_height:.2f}" fill="{color}" rx="5"/>')
            parts.append(f'<text x="{x + 32.5}" y="{max(y - 8, 112):.2f}" text-anchor="middle" class="value">{value * 100 / WAD:.1f}%</text>')
            parts.append(f'<text x="{x + 32.5}" y="485" text-anchor="middle" class="label">{label}</text>')
        parts.append(f'<text x="{group_x + 77}" y="530" text-anchor="middle" class="scenario">{escape(_scenario_label(scenario))}</text>')
    h6 = next(decision for decision in summary["hypotheses"] if decision["id"] == "H6")
    correlation = h6["evidence"]["mean_correlation_with_volatility_only_wad"]
    parts.append(f'<text x="525" y="580" text-anchor="middle" class="note">Mean ThetaShield fee correlation with volatility-only: {_format_ratio(correlation)}</text>')
    return "".join(parts) + "</svg>\n"


def _scenario_label(scenario: str) -> str:
    labels = {
        "persistent_informed_buying": "persistent buying",
        "persistent_informed_selling": "persistent selling",
        "alternating_toxicity": "alternating toxicity",
    }
    return labels[scenario]


def _outcome_color(value: int, minimum: int, maximum: int) -> str:
    if maximum == minimum:
        return "#64748b"
    position = (value - minimum) / (maximum - minimum)
    red = int(239 - 205 * position)
    green = int(68 + 129 * position)
    blue = int(68 + 26 * position)
    return f"rgb({red},{green},{blue})"


def _svg_header(width: int, height: int, title: str) -> list[str]:
    return [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        "<style>",
        "text{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;fill:#e2e8f0}",
        ".title{font-size:25px;font-weight:700}.axis{stroke:#94a3b8;stroke-width:1.5}",
        ".grid{stroke:#334155;stroke-width:1}.axislabel{font-size:14px;font-weight:600}.tick{font-size:11px}",
        ".annotation,.legend,.label{font-size:11px}.note{font-size:12px;fill:#94a3b8}",
        ".decision{font-size:16px;font-weight:650}.evidence{font-size:12px;fill:#94a3b8}.status{font-size:14px;font-weight:750}",
        ".value{font-size:12px}.scenario{font-size:13px;font-weight:600}",
        "</style>",
        '<rect width="100%" height="100%" fill="#0f172a"/>',
        f'<text x="45" y="52" class="title">{escape(title)}</text>',
    ]


def _format_wad(value: int) -> str:
    return f"{value / WAD:,.4f}"


def _format_percent(value: int) -> str:
    return f"{value * 100 / WAD:.2f}%"


def _format_percentage_points(value: int) -> str:
    return f"{value * 100 / WAD:.2f}"


def _format_ratio(value: int) -> str:
    return f"{value / WAD:.3f}"


def build_outputs(repo_root: Path = REPO_ROOT) -> dict[Path, str]:
    hook_gas = measure_hook_gas(repo_root)
    rows, case_summaries, summary, manifest = run_sensitivity(hook_gas)
    return {
        repo_root / "research/datasets/phase6_sweep_manifest.json": serialize_json(manifest),
        repo_root / "research/reports/phase6_sensitivity_results.csv": serialize_csv(rows, SWEEP_RESULT_COLUMNS),
        repo_root / "research/reports/phase6_sweep_summary.csv": serialize_csv(
            case_summaries,
            SWEEP_SUMMARY_COLUMNS,
        ),
        repo_root / "research/reports/phase6_summary.json": serialize_json(summary),
        repo_root / "research/reports/PHASE6_HYPOTHESES.md": render_report(summary),
        repo_root / "research/reports/charts/phase6_pareto.svg": render_pareto_chart(summary),
        repo_root / "research/reports/charts/phase6_hypotheses.svg": render_hypothesis_chart(summary),
        repo_root / "research/reports/charts/phase6_directionality.svg": render_directionality_chart(summary),
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
            raise SystemExit(f"Phase 6 artifacts are stale; run make phase6-report:\n{joined}")
        return
    for path, content in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()
