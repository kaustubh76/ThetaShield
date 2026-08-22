"""Reproduce the Phase 5 five-policy datasets, summaries, report, and SVG charts."""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import subprocess
from collections import defaultdict
from html import escape
from math import isqrt
from pathlib import Path
from typing import Any, Iterable

from research.thetashield.model import WAD
from research.thetashield.policies import POLICY_NAMES, ResearchConfig
from research.thetashield.scenarios import (
    REPEATED_SEEDS,
    SCENARIOS,
    generate_scenario,
    scenario_manifest,
)
from research.thetashield.simulator import correlation_wad, simulate_policy

REPO_ROOT = Path(__file__).resolve().parents[2]
THETASHIELD_GAIN_FEE_PIPS = 500_000
GAIN_CANDIDATES = (10_000, 25_000, 50_000, 100_000, 200_000, 350_000, 500_000, 750_000, 1_000_000, 2_000_000)
POLICY_CHART_LABELS = {
    "fixed_fee": "fixed",
    "volatility_only": "volatility",
    "raw_positive_markout": "raw markout",
    "dead_band_no_persistence": "dead-band",
    "thetashield": "ThetaShield",
}
RESULT_COLUMNS = (
    "scenario",
    "seed",
    "policy",
    "event_count",
    "gain_fee_pips",
    "mean_applied_fee_pips",
    "lp_fee_revenue_quote_wad",
    "inventory_pnl_quote_wad",
    "lp_net_pnl_quote_wad",
    "realized_adverse_markout_quote_wad",
    "benign_trader_fees_quote_wad",
    "toxic_trader_fees_quote_wad",
    "false_positive_rate_wad",
    "false_negative_rate_wad",
    "detection_latency_steps",
    "toxic_notional_premium_rate_wad",
    "time_above_baseline_rate_wad",
    "fee_oscillation_pips",
    "directionally_correct_toxic_rate_wad",
    "toxic_buy_mean_fee_pips",
    "toxic_sell_mean_fee_pips",
    "correlation_with_volatility_only_wad",
    "hook_gas_per_swap",
    "reactive_callback_latency_steps",
    "applied_callbacks",
    "missing_callbacks",
    "rejected_callbacks",
    "expired_reference_count",
)
SUMMARY_METRICS = tuple(column for column in RESULT_COLUMNS[5:] if column not in {"seed"})


def measure_hook_gas(repo_root: Path = REPO_ROOT) -> dict[str, int]:
    command = ["forge", "test", "--match-contract", "ThetaShieldHookGasTest", "-vv"]
    environment = dict(os.environ)
    result = subprocess.run(command, cwd=repo_root, env=environment, text=True, capture_output=True, check=False)
    output = result.stdout + result.stderr
    patterns = {
        "before_swap_gas": r"PHASE5_BEFORE_SWAP_GAS:\s*(\d+)",
        "after_swap_warm_gas": r"PHASE5_AFTER_SWAP_WARM_GAS:\s*(\d+)",
        "hook_gas_per_swap": r"PHASE5_HOOK_GAS_PER_SWAP:\s*(\d+)",
    }
    measured = _extract_gas(output, patterns)
    if result.returncode == 0 and measured is not None:
        return measured

    retry = subprocess.run(
        ["forge", "test", "--force", "--match-contract", "ThetaShieldHookGasTest", "-vv"],
        cwd=repo_root,
        env=environment,
        text=True,
        capture_output=True,
        check=False,
    )
    retry_output = retry.stdout + retry.stderr
    measured = _extract_gas(retry_output, patterns)
    if retry.returncode != 0 or measured is None:
        raise RuntimeError(f"hook gas measurement failed\n{output}\n{retry_output}")
    return measured


def _extract_gas(output: str, patterns: dict[str, str]) -> dict[str, int] | None:
    measured: dict[str, int] = {}
    for name, pattern in patterns.items():
        match = re.search(pattern, output)
        if match is None:
            return None
        measured[name] = int(match.group(1))
    return measured


def calibrate_gains(config: ResearchConfig, hook_gas_per_swap: int) -> tuple[dict[str, int], dict[str, int]]:
    calibration_streams = (
        generate_scenario("persistent_informed_buying", 9_001),
        generate_scenario("persistent_informed_selling", 9_002),
        generate_scenario("benign_noise", 9_003),
    )

    def average_fee(policy: str, gain: int) -> int:
        values = [
            int(
                simulate_policy(
                    policy,
                    stream,
                    config,
                    gain,
                    "normal",
                    hook_gas_per_swap,
                )["mean_applied_fee_pips"]
            )
            for stream in calibration_streams
        ]
        return sum(values) // len(values)

    gains = {"fixed_fee": 0, "thetashield": THETASHIELD_GAIN_FEE_PIPS}
    calibration_fees = {
        "fixed_fee": config.base_fee_pips,
        "thetashield": average_fee("thetashield", THETASHIELD_GAIN_FEE_PIPS),
    }
    target_fee = calibration_fees["thetashield"]
    for policy in POLICY_NAMES:
        if policy in gains:
            continue
        candidates = []
        for gain in GAIN_CANDIDATES:
            candidate_fee = average_fee(policy, gain)
            candidates.append((abs(candidate_fee - target_fee), gain, candidate_fee))
        _, selected_gain, selected_fee = min(candidates)
        gains[policy] = selected_gain
        calibration_fees[policy] = selected_fee
    return gains, calibration_fees


def run_experiment(hook_gas: dict[str, int]) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    config = ResearchConfig()
    gains, calibration_fees = calibrate_gains(config, hook_gas["hook_gas_per_swap"])
    rows: list[dict[str, Any]] = []

    for scenario in SCENARIOS:
        for seed in REPEATED_SEEDS:
            events = generate_scenario(scenario.name, seed)
            run_results: dict[str, dict[str, Any]] = {}
            for policy in POLICY_NAMES:
                result = simulate_policy(
                    policy,
                    events,
                    config,
                    gains[policy],
                    scenario.operational_mode,
                    hook_gas["hook_gas_per_swap"],
                )
                run_results[policy] = result

            volatility_series = run_results["volatility_only"]["applied_fee_series"]
            assert isinstance(volatility_series, list)
            for policy in POLICY_NAMES:
                result = run_results[policy]
                policy_series = result.pop("applied_fee_series")
                assert isinstance(policy_series, list)
                result["scenario"] = scenario.name
                result["seed"] = seed
                result["correlation_with_volatility_only_wad"] = correlation_wad(
                    policy_series,
                    volatility_series,
                )
                rows.append({column: result.get(column) for column in RESULT_COLUMNS})

    summary = _build_summary(rows, gains, calibration_fees, hook_gas, config)
    manifest = scenario_manifest()
    manifest.update(
        {
            "policy_names": list(POLICY_NAMES),
            "required_metrics": list(RESULT_COLUMNS[5:]),
            "fairness_method": "deterministic gain grid matched to ThetaShield calibration mean fee",
            "selected_gain_fee_pips": gains,
            "calibration_mean_fee_pips": calibration_fees,
            "research_config": config.__dict__,
            "hook_gas_measurement": hook_gas,
        }
    )
    return rows, summary, manifest


def _build_summary(
    rows: list[dict[str, Any]],
    gains: dict[str, int],
    calibration_fees: dict[str, int],
    hook_gas: dict[str, int],
    config: ResearchConfig,
) -> dict[str, Any]:
    by_policy: dict[str, dict[str, Any]] = {}
    for policy in POLICY_NAMES:
        policy_rows = [row for row in rows if row["policy"] == policy]
        by_policy[policy] = {
            metric: _mean_and_interval([row[metric] for row in policy_rows])
            for metric in SUMMARY_METRICS
        }

    by_scenario: dict[str, dict[str, dict[str, Any]]] = {}
    for scenario in SCENARIOS:
        by_scenario[scenario.name] = {}
        for policy in POLICY_NAMES:
            selected = [
                row
                for row in rows
                if row["scenario"] == scenario.name and row["policy"] == policy
            ]
            by_scenario[scenario.name][policy] = {
                "lp_net_pnl_quote_wad": _mean_and_interval(
                    [row["lp_net_pnl_quote_wad"] for row in selected]
                ),
                "false_positive_rate_wad": _mean_and_interval(
                    [row["false_positive_rate_wad"] for row in selected]
                ),
                "false_negative_rate_wad": _mean_and_interval(
                    [row["false_negative_rate_wad"] for row in selected]
                ),
                "detection_latency_steps": _mean_and_interval(
                    [row["detection_latency_steps"] for row in selected]
                ),
                "rejected_callbacks": sum(int(row["rejected_callbacks"]) for row in selected),
                "missing_callbacks": sum(int(row["missing_callbacks"]) for row in selected),
                "expired_reference_count": sum(int(row["expired_reference_count"]) for row in selected),
            }

    dynamic_fees = [calibration_fees[policy] for policy in POLICY_NAMES if policy != "fixed_fee"]
    return {
        "schema_version": 1,
        "experiment": "phase5_five_policy_baselines",
        "run_count": len(rows),
        "scenario_count": len(SCENARIOS),
        "seed_count": len(REPEATED_SEEDS),
        "policy_count": len(POLICY_NAMES),
        "selected_gain_fee_pips": gains,
        "calibration_mean_fee_pips": calibration_fees,
        "dynamic_calibration_fee_spread_pips": max(dynamic_fees) - min(dynamic_fees),
        "hook_gas_measurement": hook_gas,
        "research_config": config.__dict__,
        "interval_note": "mean and descriptive 95% normal interval across scenario-seed runs; not an inferential claim",
        "hypothesis_status": "not_evaluated_until_phase_6",
        "by_policy": by_policy,
        "by_scenario": by_scenario,
    }


def _mean_and_interval(values: Iterable[int | None]) -> dict[str, int | None]:
    present = [int(value) for value in values if value is not None]
    if not present:
        return {"count": 0, "mean": None, "ci95_low": None, "ci95_high": None}
    average = sum(present) // len(present)
    if len(present) == 1:
        radius = 0
    else:
        sample_variance = sum((value - average) ** 2 for value in present) // (len(present) - 1)
        standard_error = isqrt(sample_variance // len(present))
        radius = standard_error * 196 // 100
    return {
        "count": len(present),
        "mean": average,
        "ci95_low": average - radius,
        "ci95_high": average + radius,
    }


def serialize_csv(rows: list[dict[str, Any]]) -> str:
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=RESULT_COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()


def serialize_json(value: Any) -> str:
    return json.dumps(value, indent=2, sort_keys=True) + "\n"


def render_report(summary: dict[str, Any]) -> str:
    lines = [
        "# Phase 5 Baseline Harness Report",
        "",
        "## Scope and interpretation",
        "",
        "This report is generated directly from the committed Phase 5 scenario seeds and simulator. It compares",
        "the five required policies on identical trade and price streams. Values are descriptive engineering",
        "outputs, not profitability claims, production forecasts, or Phase 6 hypothesis decisions.",
        "",
        "## Reproduction",
        "",
        "```sh",
        "make research-report",
        "```",
        "",
        "This one command regenerates the scenario manifest, raw CSV, summary JSON, this report, and every SVG",
        "chart. `make phase5-check` regenerates in memory and rejects stale or manually edited artifacts.",
        "",
        "## Fair baseline calibration",
        "",
        "Every policy uses the same event streams, base fee, fee bounds, rate limits, and evaluation period.",
        "ThetaShield keeps its documented gain starting point; each dynamic baseline selects a gain from a",
        "committed grid that minimizes its calibration mean-fee distance from ThetaShield.",
        "",
        "| Policy | Selected gain | Calibration mean fee (pips) |",
        "|---|---:|---:|",
    ]
    for policy in POLICY_NAMES:
        lines.append(
            f"| `{policy}` | {summary['selected_gain_fee_pips'][policy]:,} | "
            f"{summary['calibration_mean_fee_pips'][policy]:,} |"
        )
    lines.extend(
        [
            "",
            f"Dynamic-policy calibration spread: **{summary['dynamic_calibration_fee_spread_pips']} fee pips**.",
            "",
            "## Aggregate descriptive scorecard",
            "",
            "The interval is a descriptive 95% normal interval across the 75 scenario-seed runs per policy; it is",
            "not an inferential confidence claim about live markets.",
            "",
            "| Policy | Mean fee | LP net PnL (quote) | FPR | FNR | Detection steps | Correct-direction toxic rate |",
            "|---|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for policy in POLICY_NAMES:
        metrics = summary["by_policy"][policy]
        lines.append(
            "| `{}` | {} | {} | {} | {} | {} | {} |".format(
                policy,
                _format_optional(metrics["mean_applied_fee_pips"]["mean"]),
                _format_wad(metrics["lp_net_pnl_quote_wad"]["mean"]),
                _format_percent(metrics["false_positive_rate_wad"]["mean"]),
                _format_percent(metrics["false_negative_rate_wad"]["mean"]),
                _format_optional(metrics["detection_latency_steps"]["mean"]),
                _format_percent(metrics["directionally_correct_toxic_rate_wad"]["mean"]),
            )
        )
    hook_gas = summary["hook_gas_measurement"]
    lines.extend(
        [
            "",
            "## Measured local hook gas",
            "",
            f"- `beforeSwap`: {hook_gas['before_swap_gas']:,} gas",
            f"- warm `afterSwap`: {hook_gas['after_swap_warm_gas']:,} gas",
            f"- measured hook operations per swap: {hook_gas['hook_gas_per_swap']:,} gas",
            "",
            "These are isolated local EVM call measurements under the pinned compiler profile. They exclude the",
            "PoolManager/router transaction and are not a live-chain cost quote.",
            "",
            "## Generated charts",
            "",
            "- `charts/phase5_policy_scorecard.svg`",
            "- `charts/phase5_fee_budget.svg`",
            "- `charts/phase5_scenario_lp_outcomes.svg`",
            "",
            "## Limitations carried into Phase 6",
            "",
            "- Synthetic streams cannot establish live LP profitability or trader behavior.",
            "- Inventory and cash are tracked separately, but the simulator is a controlled quote-value accounting",
            "  model rather than a full concentrated-liquidity replay.",
            "- Oracle delivery, callbacks, replay, and ordering are modeled deterministically; live liveness is not",
            "  inferred.",
            "- No H1-H6 result is assigned here. Phase 6 owns sensitivity sweeps and explicit pass/fail/inconclusive",
            "  labels.",
            "",
        ]
    )
    return "\n".join(lines)


def _format_optional(value: int | None) -> str:
    return "n/a" if value is None else f"{value:,}"


def _format_wad(value: int | None) -> str:
    return "n/a" if value is None else f"{value / WAD:,.4f}"


def _format_percent(value: int | None) -> str:
    return "n/a" if value is None else f"{value * 100 / WAD:.2f}%"


def render_policy_scorecard(summary: dict[str, Any]) -> str:
    panels = (
        ("LP net PnL (quote)", "lp_net_pnl_quote_wad", WAD),
        ("False-positive rate (%)", "false_positive_rate_wad", WAD // 100),
        ("False-negative rate (%)", "false_negative_rate_wad", WAD // 100),
        ("Detection latency (steps)", "detection_latency_steps", 1),
    )
    width, height = 1_200, 760
    parts = _svg_header(width, height, "Phase 5 policy scorecard")
    colors = ("#64748b", "#8b5cf6", "#f97316", "#06b6d4", "#22c55e")
    for panel_index, (title, metric, divisor) in enumerate(panels):
        panel_x = 60 + (panel_index % 2) * 580
        panel_y = 95 + (panel_index // 2) * 325
        values = [summary["by_policy"][policy][metric]["mean"] for policy in POLICY_NAMES]
        scaled = [None if value is None else value / divisor for value in values]
        present = [value for value in scaled if value is not None]
        minimum = min(present, default=0)
        maximum = max(present, default=0)
        plot_top = panel_y + 35
        plot_bottom = panel_y + 245
        if minimum >= 0:
            zero_y = plot_bottom
            units_to_pixels = 210 / max(maximum, 1)
        elif maximum <= 0:
            zero_y = plot_top
            units_to_pixels = 210 / max(abs(minimum), 1)
        else:
            units_to_pixels = 210 / (maximum - minimum)
            zero_y = plot_top + maximum * units_to_pixels
        parts.append(f'<text x="{panel_x}" y="{panel_y}" class="panel">{escape(title)}</text>')
        for index, (policy, value, color) in enumerate(zip(POLICY_NAMES, scaled, colors, strict=True)):
            x = panel_x + 25 + index * 105
            if value is None:
                parts.append(
                    f'<text x="{x + 34}" y="{plot_bottom - 7:.2f}" '
                    'text-anchor="middle" class="value">n/a</text>'
                )
            else:
                bar_height = abs(value) * units_to_pixels
                y = zero_y - bar_height if value >= 0 else zero_y
                value_y = max(plot_top + 14, y - 7) if value >= 0 else min(plot_bottom - 7, y + bar_height - 7)
                parts.append(
                    f'<rect x="{x}" y="{y:.2f}" width="68" height="{bar_height:.2f}" '
                    f'fill="{color}" rx="4"/>'
                )
                parts.append(
                    f'<text x="{x + 34}" y="{value_y:.2f}" text-anchor="middle" '
                    f'class="value">{value:.2f}</text>'
                )
            label = POLICY_CHART_LABELS[policy]
            parts.append(f'<text x="{x + 34}" y="{panel_y + 268}" text-anchor="middle" class="label">{escape(label)}</text>')
    return "".join(parts) + "</svg>\n"


def render_fee_budget(summary: dict[str, Any]) -> str:
    width, height = 900, 520
    parts = _svg_header(width, height, "Phase 5 calibrated mean-fee budget")
    values = [summary["calibration_mean_fee_pips"][policy] for policy in POLICY_NAMES]
    maximum = max(values) * 1.15
    colors = ("#64748b", "#8b5cf6", "#f97316", "#06b6d4", "#22c55e")
    for index, (policy, value, color) in enumerate(zip(POLICY_NAMES, values, colors, strict=True)):
        x = 90 + index * 150
        bar_height = 300 * value / maximum
        y = 410 - bar_height
        parts.append(f'<rect x="{x}" y="{y:.2f}" width="90" height="{bar_height:.2f}" fill="{color}" rx="5"/>')
        parts.append(f'<text x="{x + 45}" y="{y - 10:.2f}" text-anchor="middle" class="value">{value}</text>')
        parts.append(
            f'<text x="{x + 45}" y="438" text-anchor="middle" '
            f'class="label">{escape(POLICY_CHART_LABELS[policy])}</text>'
        )
    parts.append(
        f'<text x="450" y="480" text-anchor="middle" class="note">Dynamic spread: {summary["dynamic_calibration_fee_spread_pips"]} fee pips</text>'
    )
    return "".join(parts) + "</svg>\n"


def render_scenario_heatmap(summary: dict[str, Any]) -> str:
    cell_width, cell_height = 145, 38
    width = 360 + len(POLICY_NAMES) * cell_width
    height = 125 + len(SCENARIOS) * cell_height
    parts = _svg_header(width, height, "Phase 5 LP net PnL by scenario and policy")
    values = [
        summary["by_scenario"][scenario.name][policy]["lp_net_pnl_quote_wad"]["mean"] or 0
        for scenario in SCENARIOS
        for policy in POLICY_NAMES
    ]
    scale = max(max(abs(value) for value in values), 1)
    for policy_index, policy in enumerate(POLICY_NAMES):
        x = 350 + policy_index * cell_width + cell_width / 2
        parts.append(
            f'<text x="{x}" y="92" text-anchor="middle" '
            f'class="label">{escape(POLICY_CHART_LABELS[policy])}</text>'
        )
    for scenario_index, scenario in enumerate(SCENARIOS):
        y = 108 + scenario_index * cell_height
        parts.append(f'<text x="335" y="{y + 25}" text-anchor="end" class="rowlabel">{escape(scenario.name.replace("_", " "))}</text>')
        for policy_index, policy in enumerate(POLICY_NAMES):
            value = summary["by_scenario"][scenario.name][policy]["lp_net_pnl_quote_wad"]["mean"] or 0
            intensity = min(abs(value) / scale, 1)
            color = _heat_color(value, intensity)
            x = 350 + policy_index * cell_width
            parts.append(f'<rect x="{x}" y="{y}" width="{cell_width - 4}" height="{cell_height - 4}" fill="{color}" rx="3"/>')
            parts.append(f'<text x="{x + (cell_width - 4) / 2}" y="{y + 23}" text-anchor="middle" class="heatvalue">{value / WAD:.2f}</text>')
    return "".join(parts) + "</svg>\n"


def _heat_color(value: int, intensity: float) -> str:
    base = int(245 - 125 * intensity)
    if value >= 0:
        return f"rgb({base},{230},{base})"
    return f"rgb({235},{base},{base})"


def _svg_header(width: int, height: int, title: str) -> list[str]:
    return [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        "<style>",
        "text{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;fill:#e2e8f0}",
        ".title{font-size:24px;font-weight:700}.panel{font-size:17px;font-weight:650}",
        ".value{font-size:12px}.label{font-size:10px}.rowlabel{font-size:11px}.heatvalue{font-size:10px;fill:#0f172a}",
        ".note{font-size:13px;fill:#94a3b8}",
        "</style>",
        '<rect width="100%" height="100%" fill="#0f172a"/>',
        f'<text x="40" y="48" class="title">{escape(title)}</text>',
    ]


def build_outputs(repo_root: Path = REPO_ROOT) -> dict[Path, str]:
    hook_gas = measure_hook_gas(repo_root)
    rows, summary, manifest = run_experiment(hook_gas)
    return {
        repo_root / "research/datasets/phase5_scenarios.json": serialize_json(manifest),
        repo_root / "research/reports/phase5_results.csv": serialize_csv(rows),
        repo_root / "research/reports/phase5_summary.json": serialize_json(summary),
        repo_root / "research/reports/PHASE5_BASELINES.md": render_report(summary),
        repo_root / "research/reports/charts/phase5_policy_scorecard.svg": render_policy_scorecard(summary),
        repo_root / "research/reports/charts/phase5_fee_budget.svg": render_fee_budget(summary),
        repo_root / "research/reports/charts/phase5_scenario_lp_outcomes.svg": render_scenario_heatmap(summary),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    outputs = build_outputs()
    if args.check:
        stale = [path for path, content in outputs.items() if not path.exists() or path.read_text(encoding="utf-8") != content]
        if stale:
            joined = "\n".join(str(path.relative_to(REPO_ROOT)) for path in stale)
            raise SystemExit(f"Phase 5 artifacts are stale; run make research-report:\n{joined}")
        return

    for path, content in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()
