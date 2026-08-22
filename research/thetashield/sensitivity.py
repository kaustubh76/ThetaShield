"""Declared Phase 6 sensitivity grid and hypothesis decision rules."""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from typing import Any

from research.thetashield.model import WAD
from research.thetashield.policies import ResearchConfig

DEFAULT_GAIN_FEE_PIPS = 500_000
BENIGN_SCENARIOS = ("benign_noise", "high_volatility_uninformed")
PERSISTENT_SCENARIOS = ("persistent_informed_buying", "persistent_informed_selling")
DIRECTIONAL_SCENARIOS = (*PERSISTENT_SCENARIOS, "alternating_toxicity")
MANIPULATION_SCENARIOS = (
    "toxic_volatility_burst",
    "microtrade_spam",
    "oversized_observation",
    "conflicting_references",
)

HYPOTHESIS_RULES: dict[str, dict[str, Any]] = {
    "H1": {
        "title": "LP protection",
        "pass_rule": "paired 95% interval for ThetaShield minus fixed-fee LP net PnL is above zero",
        "fail_rule": "the paired interval is below zero; overlap with zero is inconclusive",
        "scenarios": list(PERSISTENT_SCENARIOS),
    },
    "H2": {
        "title": "Benign-flow fairness",
        "pass_rule": "upper intervals stay within 10% of baseline mean fee and 5% false positives",
        "fail_rule": "a lower interval exceeds either limit; boundary overlap is inconclusive",
        "scenarios": ["benign_noise"],
        "maximum_fee_excess_rate_wad": WAD // 10,
        "maximum_false_positive_rate_wad": WAD // 20,
    },
    "H3": {
        "title": "Noise robustness",
        "pass_rule": "paired 95% interval for raw-markout minus ThetaShield false-positive rate is above zero",
        "fail_rule": "the paired interval is non-positive; overlap with zero is inconclusive",
        "scenarios": list(BENIGN_SCENARIOS),
    },
    "H4": {
        "title": "Detection trade-off",
        "pass_rule": "rank correlation is at most -0.35 with at least three Pareto points spanning 5 percentage points and 5 steps",
        "fail_rule": "rank correlation is non-negative or fewer than two Pareto points exist; other results are inconclusive",
        "dimensions": ["dead_band_k", "persistence_n_of_k"],
        "maximum_rank_correlation_wad": -(35 * WAD // 100),
        "minimum_pareto_points": 3,
        "minimum_false_positive_span_wad": WAD // 20,
        "minimum_latency_span_steps": 5,
    },
    "H5": {
        "title": "Manipulation resistance",
        "pass_rule": "ThetaShield reduces raw-markout false positives and oscillation with lower intervals above zero while retaining at least 50% toxic-premium coverage",
        "fail_rule": "either reduction is non-positive or retained coverage is below 25%; intermediate evidence is inconclusive",
        "scenarios": list(MANIPULATION_SCENARIOS),
        "minimum_pass_coverage_ratio_wad": WAD // 2,
        "failure_coverage_ratio_wad": WAD // 4,
    },
    "H6": {
        "title": "Directional discrimination",
        "pass_rule": "ThetaShield's paired correct-direction advantage is at least 20 percentage points and mean volatility-fee correlation is at most 0.80",
        "fail_rule": "the advantage is non-positive or correlation is at least 0.95; intermediate evidence is inconclusive",
        "scenarios": list(DIRECTIONAL_SCENARIOS),
        "minimum_directional_advantage_wad": WAD // 5,
        "maximum_pass_correlation_wad": 8 * WAD // 10,
        "failure_correlation_wad": 95 * WAD // 100,
    },
}


@dataclass(frozen=True)
class SweepCase:
    case_id: str
    dimension: str
    value_label: str
    value: Any
    config: ResearchConfig
    gain_fee_pips: int = DEFAULT_GAIN_FEE_PIPS

    def to_dict(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "dimension": self.dimension,
            "value_label": self.value_label,
            "value": self.value,
            "gain_fee_pips": self.gain_fee_pips,
            "research_config": asdict(self.config),
        }


def build_sweep_cases() -> tuple[SweepCase, ...]:
    """Return the default plus deterministic one-at-a-time sensitivity cases."""
    default = ResearchConfig()
    cases = [SweepCase("default", "default", "default", "default", default)]

    def add(
        dimension: str,
        identifier: str,
        label: str,
        value: Any,
        config: ResearchConfig,
        gain_fee_pips: int = DEFAULT_GAIN_FEE_PIPS,
    ) -> None:
        if config == default and gain_fee_pips == DEFAULT_GAIN_FEE_PIPS:
            return
        cases.append(
            SweepCase(
                case_id=f"{dimension}__{identifier}",
                dimension=dimension,
                value_label=label,
                value=value,
                config=config,
                gain_fee_pips=gain_fee_pips,
            )
        )

    for label, value in (("0.5", 5 * 10**17), ("1.0", WAD), ("1.5", 15 * 10**17), ("2.0", 2 * WAD), ("3.0", 3 * WAD)):
        add("dead_band_k", label.replace(".", "p"), label, value, replace(default, dead_band_k_wad=value))

    for value in (16, 24, 32, 48, 64):
        add(
            "trailing_window",
            str(value),
            str(value),
            value,
            replace(default, trailing_window=value, minimum_trailing_observations=value),
        )

    for value in (1, 2, 4, 8):
        add(
            "markout_horizon",
            str(value),
            f"{value} steps",
            value,
            replace(default, markout_horizon_steps=value),
        )

    for value in (4, 8, 12, 16):
        add(
            "epoch_duration",
            str(value),
            f"{value} observations",
            value,
            replace(default, epoch_observation_count=value, target_observation_count=value),
        )

    for required, window in ((1, 3), (2, 3), (2, 5), (3, 5), (4, 5), (4, 7), (5, 7)):
        label = f"{required}-of-{window}"
        add(
            "persistence_n_of_k",
            label,
            label,
            [required, window],
            replace(default, required_toxic_epochs=required, persistence_window=window),
        )

    for label, value in (("0.10", WAD // 10), ("0.25", WAD // 4), ("0.50", WAD // 2), ("0.75", 3 * WAD // 4)):
        add("ewma_alpha", label.replace(".", "p"), label, value, replace(default, alpha_wad=value))

    for label, value in (("0.30", 3 * WAD // 10), ("0.40", 4 * WAD // 10), ("0.50", WAD // 2), ("0.60", 6 * WAD // 10)):
        add(
            "confidence_threshold",
            label.replace(".", "p"),
            label,
            value,
            replace(default, confidence_floor_wad=value),
        )

    for label, value in (("2.5 bps", 25 * 10**13), ("5.0 bps", 50 * 10**13), ("7.5 bps", 75 * 10**13), ("15.0 bps", 150 * 10**13)):
        add(
            "toxicity_threshold",
            label.replace(".", "p").replace(" ", "_"),
            label,
            value,
            replace(default, toxic_threshold_wad=value),
        )

    for value in (100_000, 250_000, 500_000, 750_000, 1_000_000):
        add("fee_gain", str(value), f"{value:,}", value, default, value)

    for value in (3_000, 5_000, 10_000, 20_000):
        add("maximum_fee", str(value), f"{value:,} pips", value, replace(default, maximum_fee_pips=value))

    for increase, decrease in (
        (250, 250),
        (500, 250),
        (1_000, 500),
        (2_000, 500),
        (1_000, 1_000),
        (2_000, 1_000),
    ):
        label = f"+{increase}/-{decrease}"
        add(
            "fee_step_limits",
            f"up_{increase}__down_{decrease}",
            label,
            [increase, decrease],
            replace(default, maximum_increase_pips=increase, maximum_decrease_pips=decrease),
        )

    return tuple(cases)
