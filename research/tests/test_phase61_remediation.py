from __future__ import annotations

import unittest

from research.experiments.phase61_remediation import (
    render_h4_chart,
    render_h5_chart,
    render_report,
    run_remediation,
)
from research.thetashield.remediation import (
    BENIGN_CHALLENGE_SCENARIOS,
    HOLDOUT_SEEDS,
    TRAINING_SEEDS,
    build_h4_frontier_cases,
    build_h5_training_cases,
    generate_benign_challenge,
    remediation_base_config,
)


class Phase61DesignTest(unittest.TestCase):
    def test_training_and_holdout_seeds_are_disjoint(self) -> None:
        self.assertTrue(set(TRAINING_SEEDS).isdisjoint(HOLDOUT_SEEDS))

    def test_benign_challenges_are_deterministic_and_explicitly_benign(self) -> None:
        for scenario in BENIGN_CHALLENGE_SCENARIOS:
            first = generate_benign_challenge(scenario, TRAINING_SEEDS[0])
            second = generate_benign_challenge(scenario, TRAINING_SEEDS[0])
            self.assertEqual(first, second)
            self.assertEqual(len(first), 240)
            self.assertFalse(any(event.is_toxic for event in first))

    def test_declared_grids_are_unique_and_multi_factor(self) -> None:
        h5_cases = build_h5_training_cases()
        h4_cases = build_h4_frontier_cases(remediation_base_config())
        self.assertEqual(len(h5_cases), 90)
        self.assertEqual(len(h4_cases), 40)
        self.assertEqual(len({case.case_id for case in h5_cases}), len(h5_cases))
        self.assertEqual(len({case.case_id for case in h4_cases}), len(h4_cases))


class Phase61ExperimentTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.h4_rows, cls.h5_rows, cls.summary, cls.manifest = run_remediation(
            {
                "before_swap_gas": 33_000,
                "after_swap_warm_gas": 47_097,
                "hook_gas_per_swap": 80_097,
            }
        )

    def test_selection_is_training_only_and_expected_case_is_locked(self) -> None:
        self.assertFalse(self.summary["selection_used_holdout"])
        self.assertFalse(self.manifest["holdout_used_for_selection"])
        self.assertEqual(
            self.summary["selected_case_id"],
            "h5__k_1__p_3_of_5__up_500__down_100",
        )
        self.assertGreater(self.summary["training"]["eligible_h5_case_count"], 0)

    def test_reserved_holdout_passes_h4_and_h5_without_rewriting_v1(self) -> None:
        self.assertEqual(self.summary["historical_phase6_v1"]["H4"], "fail")
        self.assertEqual(self.summary["historical_phase6_v1"]["H5"], "fail")
        self.assertEqual(self.summary["holdout"]["H4"]["status"], "pass")
        self.assertEqual(self.summary["holdout"]["H5"]["h5_status"], "pass")
        self.assertEqual(self.summary["holdout"]["overall_status"], "pass")

    def test_h4_frontier_and_h5_coverage_guards_have_margin(self) -> None:
        h4 = self.summary["holdout"]["H4"]
        h5 = self.summary["holdout"]["H5"]
        self.assertLessEqual(h4["rank_correlation_wad"], -35 * 10**16)
        self.assertGreaterEqual(h4["pareto_point_count"], 3)
        self.assertGreaterEqual(h4["false_positive_span_wad"], 5 * 10**16)
        self.assertGreaterEqual(h4["latency_span_steps"], 5)
        self.assertGreaterEqual(h5["retained_coverage_ratio_wad"], 5 * 10**17)
        self.assertGreater(h5["fpr_reduction_ci95_low_wad"], 0)
        self.assertGreater(h5["oscillation_reduction_ci95_low_pips"], 0)

    def test_generated_report_and_charts_expose_versioned_evidence(self) -> None:
        report = render_report(self.summary)
        self.assertIn("original Phase 6 v1 H4/H5 failures remain preserved", report)
        self.assertIn("H4 is **PASS** and H5 is **PASS**", report)
        self.assertTrue(render_h4_chart(self.h4_rows, self.summary).startswith("<svg"))
        self.assertTrue(render_h5_chart(self.summary).startswith("<svg"))


if __name__ == "__main__":
    unittest.main()
