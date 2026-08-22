from __future__ import annotations

import unittest
from dataclasses import replace

from research.experiments.phase6_sensitivity import (
    render_directionality_chart,
    render_hypothesis_chart,
    render_pareto_chart,
    render_report,
    run_sensitivity,
)
from research.thetashield.policies import ResearchConfig
from research.thetashield.scenarios import generate_scenario
from research.thetashield.sensitivity import HYPOTHESIS_RULES, build_sweep_cases
from research.thetashield.simulator import _event_at_horizon, simulate_policy


class Phase6GridTest(unittest.TestCase):
    def test_grid_covers_all_required_parameter_families_once_at_a_time(self) -> None:
        cases = build_sweep_cases()
        dimensions = {case.dimension for case in cases if case.dimension != "default"}
        self.assertEqual(len(cases), 42)
        self.assertEqual(len({case.case_id for case in cases}), len(cases))
        self.assertEqual(
            dimensions,
            {
                "dead_band_k",
                "trailing_window",
                "markout_horizon",
                "epoch_duration",
                "persistence_n_of_k",
                "ewma_alpha",
                "confidence_threshold",
                "toxicity_threshold",
                "fee_gain",
                "maximum_fee",
                "fee_step_limits",
            },
        )

    def test_all_hypotheses_have_fixed_pass_and_fail_rules(self) -> None:
        self.assertEqual(set(HYPOTHESIS_RULES), {"H1", "H2", "H3", "H4", "H5", "H6"})
        for rule in HYPOTHESIS_RULES.values():
            self.assertTrue(rule["pass_rule"])
            self.assertTrue(rule["fail_rule"])

    def test_markout_horizon_changes_the_price_path_not_only_callback_delay(self) -> None:
        events = generate_scenario("persistent_informed_buying", 101)
        default = simulate_policy(
            "thetashield",
            events,
            ResearchConfig(),
            500_000,
            "normal",
            80_097,
        )
        long_horizon = simulate_policy(
            "thetashield",
            events,
            replace(ResearchConfig(), markout_horizon_steps=4),
            500_000,
            "normal",
            80_097,
        )
        horizon_event = _event_at_horizon(events, events[0], 4)
        self.assertNotEqual(
            events[0].reference_price_wad,
            horizon_event.reference_price_wad,
        )
        self.assertEqual(horizon_event.reference_price_wad, events[3].reference_price_wad)
        self.assertNotEqual(default["mean_applied_fee_pips"], long_horizon["mean_applied_fee_pips"])


class Phase6ExperimentTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.rows, cls.case_summaries, cls.summary, cls.manifest = run_sensitivity(
            {
                "before_swap_gas": 33_000,
                "after_swap_warm_gas": 47_097,
                "hook_gas_per_swap": 80_097,
            }
        )

    def test_raw_sweep_shape_and_manifest_are_complete(self) -> None:
        self.assertEqual(len(self.rows), 42 * 15 * 5)
        self.assertEqual(len(self.case_summaries), 42)
        self.assertEqual(self.summary["sweep_dimension_count"], 11)
        self.assertEqual(self.manifest["decision_protocol_id"], "thetashield-phase6-v1")

    def test_hypothesis_labels_are_explicit_and_unfavorable_results_remain(self) -> None:
        statuses = {
            decision["id"]: decision["status"]
            for decision in self.summary["hypotheses"]
        }
        self.assertEqual(
            statuses,
            {
                "H1": "pass",
                "H2": "pass",
                "H3": "pass",
                "H4": "fail",
                "H5": "fail",
                "H6": "pass",
            },
        )
        self.assertEqual(self.summary["hypothesis_status_counts"], {"fail": 2, "pass": 4})

    def test_h5_cannot_pass_by_suppressing_all_detection(self) -> None:
        decision = next(item for item in self.summary["hypotheses"] if item["id"] == "H5")
        retained = decision["evidence"]["retained_coverage_ratio_wad"]
        failure_floor = HYPOTHESIS_RULES["H5"]["failure_coverage_ratio_wad"]
        self.assertLess(retained, failure_floor)
        self.assertEqual(decision["status"], "fail")

    def test_report_and_charts_include_failed_results_without_invalid_geometry(self) -> None:
        report = render_report(self.summary)
        self.assertIn("H4 — Detection trade-off | **FAIL**", report)
        self.assertIn("H5 — Manipulation resistance | **FAIL**", report)
        for chart in (
            render_pareto_chart(self.summary),
            render_hypothesis_chart(self.summary),
            render_directionality_chart(self.summary),
        ):
            self.assertTrue(chart.startswith("<svg"))
            self.assertNotIn('height="-', chart)

    def test_default_and_parameter_cases_have_pareto_evidence(self) -> None:
        by_case = self.summary["by_case"]
        self.assertIn("default", by_case)
        self.assertGreaterEqual(len(self.summary["pareto_case_ids"]), 2)
        self.assertNotEqual(
            by_case["default"]["persistent_lp_improvement_quote_wad"],
            by_case["markout_horizon__4"]["persistent_lp_improvement_quote_wad"],
        )


if __name__ == "__main__":
    unittest.main()
