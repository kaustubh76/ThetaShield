from __future__ import annotations

import unittest

from research.experiments.gap_g1_closed_loop import (
    BASELINE_POLICY,
    COVERAGE_POLICY,
    run_experiment,
)


class GapG1ClosedLoopTest(unittest.TestCase):
    def test_declared_feedback_and_flow_gates_pass(self) -> None:
        hook_gas = {
            "before_swap_gas": 33_000,
            "after_swap_warm_gas": 47_097,
            "hook_gas_per_swap": 80_097,
        }
        rows, summary, manifest = run_experiment(hook_gas)

        self.assertEqual(len(rows), 15 * 5 * 2 * 2)
        self.assertEqual(summary["overall_status"], "pass")
        self.assertTrue(all(gate["status"] == "pass" for gate in summary["gates"].values()))
        self.assertFalse(manifest["historical_phase5_artifacts_mutated"])

        inelastic = summary["aggregates"]["inelastic"]
        self.assertLessEqual(
            inelastic[COVERAGE_POLICY]["false_positive_rate_wad"],
            inelastic[BASELINE_POLICY]["false_positive_rate_wad"],
        )
        self.assertGreater(inelastic[COVERAGE_POLICY]["coverage_deficit_epochs"], 0)


if __name__ == "__main__":
    unittest.main()
