"""Acceptance tests for the deterministic G7 dashboard bundle."""

from __future__ import annotations

import hashlib
import json
import unittest

from research.experiments.export_dashboard_bundle import (
    DASHBOARD_OUTPUT_PATH,
    OUTPUT_PATH,
    REPRESENTATIVE_SCENARIOS,
    REPO_ROOT,
    build_bundle,
    serialize_bundle,
)


class DashboardBundleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.bundle = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))

    def test_committed_bundle_is_current_and_deterministic(self) -> None:
        first = serialize_bundle(build_bundle())
        second = serialize_bundle(build_bundle())
        self.assertEqual(first, second)
        self.assertEqual(OUTPUT_PATH.read_text(encoding="utf-8"), first)
        self.assertEqual(DASHBOARD_OUTPUT_PATH.read_text(encoding="utf-8"), first)

    def test_sources_are_content_addressed(self) -> None:
        for source in self.bundle["source_artifacts"]:
            digest = hashlib.sha256((REPO_ROOT / source["path"]).read_bytes()).hexdigest()
            self.assertEqual(source["sha256"], digest)

    def test_complete_phase5_and_hypothesis_evidence_is_exported(self) -> None:
        self.assertEqual(len(self.bundle["policy_metrics"]), 5)
        self.assertEqual(len(self.bundle["scenario_lp_outcomes"]), 15)
        self.assertTrue(
            all(len(policies) == 5 for policies in self.bundle["scenario_lp_outcomes"].values())
        )
        hypotheses = {entry["id"]: entry for entry in self.bundle["hypotheses"]}
        self.assertEqual(set(hypotheses), {"H1", "H2", "H3", "H4", "H5", "H6"})
        self.assertEqual(hypotheses["H4"]["status"], "fail")
        self.assertEqual(hypotheses["H5"]["status"], "fail")
        self.assertEqual(
            {entry["holdout_status"] for entry in self.bundle["holdout_table"]},
            {"pass"},
        )

    def test_closed_loop_gates_are_disclosed(self) -> None:
        closed_loop = self.bundle["closed_loop"]
        self.assertEqual(closed_loop["overall_status"], "pass")
        self.assertEqual(len(closed_loop["gates"]), 4)
        self.assertTrue(all(gate["status"] == "pass" for gate in closed_loop["gates"].values()))

    def test_representative_traces_contain_required_mechanism_fields(self) -> None:
        traces = self.bundle["representative_traces"]
        self.assertEqual(set(traces), set(REPRESENTATIVE_SCENARIOS))
        for trace in traces.values():
            self.assertGreaterEqual(trace["event_count"], 200)
            self.assertGreater(len(trace["steps"]), trace["event_count"])
            self.assertTrue(all("fee_by_direction_pips" in step for step in trace["steps"]))

        all_evidence = [
            evidence
            for trace in traces.values()
            for step in trace["steps"]
            for evidence in step["evidence"]
            if evidence.get("status") != "reference_unavailable"
        ]
        self.assertTrue(all("raw_markout_wad" in evidence for evidence in all_evidence))
        self.assertTrue(all("sigma_wad" in evidence for evidence in all_evidence))
        self.assertTrue(all("dead_band_wad" in evidence for evidence in all_evidence))
        self.assertTrue(any(evidence.get("confidence_wad") for evidence in all_evidence))
        self.assertTrue(any(evidence.get("persistence_bitmap") for evidence in all_evidence))
        self.assertGreater(
            traces["missing_callbacks"]["final_transport"]["callbacks_missing"],
            0,
        )


if __name__ == "__main__":
    unittest.main()
