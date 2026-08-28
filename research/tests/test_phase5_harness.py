from __future__ import annotations

import unittest

from research.experiments.phase5_baselines import RESULT_COLUMNS, render_policy_scorecard, run_experiment
from research.thetashield.model import WAD
from research.thetashield.policies import POLICY_NAMES, ResearchConfig
from research.thetashield.scenarios import EVENT_COUNT, SCENARIOS, generate_scenario, scenario_manifest
from research.thetashield.simulator import (
    FlowElasticityConfig,
    correlation_wad,
    retention_probability_wad,
    simulate_policy,
)


class Phase5ScenarioTest(unittest.TestCase):
    def test_all_required_scenarios_are_unique_and_manifested(self) -> None:
        names = [scenario.name for scenario in SCENARIOS]
        self.assertEqual(len(names), 15)
        self.assertEqual(len(set(names)), 15)
        manifest = scenario_manifest()
        self.assertEqual([entry["name"] for entry in manifest["scenarios"]], names)

    def test_generation_is_deterministic_and_bounded(self) -> None:
        first = generate_scenario("alternating_toxicity", 101)
        second = generate_scenario("alternating_toxicity", 101)
        self.assertEqual(first, second)
        self.assertEqual(len(first), EVENT_COUNT)
        self.assertTrue(all(event.execution_price_wad > 0 for event in first))
        self.assertTrue(all(event.reference_price_wad > 0 for event in first))
        self.assertTrue(all(event.direction in (-1, 1) for event in first))


class Phase5PolicyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.config = ResearchConfig()

    def _simulate(self, policy: str, scenario: str, mode: str = "normal") -> dict[str, object]:
        return simulate_policy(
            policy,
            generate_scenario(scenario, 101),
            self.config,
            500_000,
            mode,
            80_097,
        )

    def test_exactly_five_required_policies_are_exposed(self) -> None:
        self.assertEqual(
            POLICY_NAMES,
            (
                "fixed_fee",
                "volatility_only",
                "raw_positive_markout",
                "dead_band_no_persistence",
                "thetashield",
            ),
        )

    def test_fixed_policy_stays_at_baseline_and_preserves_economic_identity(self) -> None:
        result = self._simulate("fixed_fee", "persistent_informed_buying")
        self.assertEqual(result["mean_applied_fee_pips"], self.config.base_fee_pips)
        self.assertEqual(result["time_above_baseline_rate_wad"], 0)
        self.assertEqual(result["expired_reference_count"], 0)
        self.assertEqual(
            result["lp_net_pnl_quote_wad"],
            result["inventory_pnl_quote_wad"] + result["lp_fee_revenue_quote_wad"],
        )

    def test_operational_scenarios_record_fail_closed_behavior(self) -> None:
        stale = self._simulate("thetashield", "stale_references")
        missing = self._simulate("thetashield", "missing_callbacks", "missing")
        replay = self._simulate("thetashield", "replayed_callbacks", "replay")
        out_of_order = self._simulate("thetashield", "out_of_order_callbacks", "out_of_order")
        self.assertGreater(stale["expired_reference_count"], 0)
        self.assertGreater(missing["missing_callbacks"], 0)
        self.assertGreater(replay["rejected_callbacks"], 0)
        self.assertGreater(out_of_order["rejected_callbacks"], 0)

    def test_required_metrics_are_present(self) -> None:
        result = self._simulate("thetashield", "persistent_informed_buying")
        self.assertTrue(set(RESULT_COLUMNS[5:]).issubset(set(result) | {"correlation_with_volatility_only_wad"}))
        self.assertEqual(result["hook_gas_per_swap"], 80_097)
        self.assertIsNotNone(result["reactive_callback_latency_steps"])

    def test_volatility_correlation_is_exact_for_identical_series(self) -> None:
        result = self._simulate("volatility_only", "high_volatility_uninformed")
        series = result["applied_fee_series"]
        self.assertIsInstance(series, list)
        self.assertEqual(correlation_wad(series, series), WAD)

    def test_elastic_flow_is_deterministic_and_less_sensitive_for_toxic_flow(self) -> None:
        elasticity = FlowElasticityConfig()
        benign_probability = retention_probability_wad(
            1_500,
            self.config.base_fee_pips,
            elasticity.benign_beta_wad,
        )
        toxic_probability = retention_probability_wad(
            1_500,
            self.config.base_fee_pips,
            elasticity.toxic_beta_wad,
        )
        self.assertLess(benign_probability, toxic_probability)
        events = generate_scenario("persistent_informed_buying", 101)
        first = simulate_policy(
            "coverage_thetashield", events, self.config, 500_000, "normal", 80_097, elasticity
        )
        second = simulate_policy(
            "coverage_thetashield", events, self.config, 500_000, "normal", 80_097, elasticity
        )
        self.assertEqual(first, second)
        self.assertGreater(int(first["coverage_eligible_epochs"]), 0)
        self.assertLessEqual(int(first["executed_notional_quote_wad"]), int(first["requested_notional_quote_wad"]))


class Phase5ExperimentTest(unittest.TestCase):
    def test_repeated_run_is_deterministic_and_calibration_is_close(self) -> None:
        gas = {"before_swap_gas": 33_000, "after_swap_warm_gas": 47_097, "hook_gas_per_swap": 80_097}
        rows_a, summary_a, manifest_a = run_experiment(gas)
        rows_b, summary_b, manifest_b = run_experiment(gas)
        self.assertEqual(rows_a, rows_b)
        self.assertEqual(summary_a, summary_b)
        self.assertEqual(manifest_a, manifest_b)
        self.assertEqual(len(rows_a), 15 * 5 * 5)
        self.assertLessEqual(summary_a["dynamic_calibration_fee_spread_pips"], 75)
        self.assertEqual(summary_a["hypothesis_status"], "not_evaluated_until_phase_6")

        scorecard = render_policy_scorecard(summary_a)
        self.assertNotIn('height="-', scorecard)
        self.assertIn('class="value">n/a</text>', scorecard)


if __name__ == "__main__":
    unittest.main()
