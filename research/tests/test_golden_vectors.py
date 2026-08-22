from __future__ import annotations

import json
import unittest
from pathlib import Path

from research.experiments.generate_golden_vectors import build_vectors


class GoldenVectorTest(unittest.TestCase):
    def test_committed_vectors_match_reference_model(self) -> None:
        path = Path("research/datasets/golden_vectors.json")
        committed = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(committed, build_vectors())


if __name__ == "__main__":
    unittest.main()
