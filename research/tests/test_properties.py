from __future__ import annotations

import random
import unittest

from research.thetashield.model import (
    WAD,
    calculate_confidence,
    dead_band_filter,
    directional_markout,
    trailing_sigma,
)


class RandomizedPropertiesTest(unittest.TestCase):
    def test_directional_markout_is_antisymmetric(self) -> None:
        random_source = random.Random(7)
        for _ in range(2_000):
            execution = random_source.randint(WAD, 100_000 * WAD)
            reference = random_source.randint(WAD, 100_000 * WAD)
            buy = directional_markout(execution, reference, 1)
            sell = directional_markout(execution, reference, -1)
            self.assertEqual(buy, -sell)

    def test_dead_band_never_flips_sign_or_increases_magnitude(self) -> None:
        random_source = random.Random(11)
        for _ in range(5_000):
            markout = random_source.randint(-(10 * WAD), 10 * WAD)
            sigma = random_source.randint(0, 2 * WAD)
            k_wad = random_source.randint(0, 3 * WAD)
            filtered = dead_band_filter(markout, sigma, k_wad)
            self.assertLessEqual(abs(filtered), abs(markout))
            if filtered:
                self.assertEqual(filtered > 0, markout > 0)

    def test_current_value_is_never_read_by_trailing_sigma(self) -> None:
        random_source = random.Random(19)
        for _ in range(500):
            history = [random_source.randint(-(WAD // 10), WAD // 10) for _ in range(32)]
            first = history + [-(9 * WAD)]
            second = history + [9 * WAD]
            self.assertEqual(trailing_sigma(first, 32, 32), trailing_sigma(second, 32, 32))

    def test_confidence_is_bounded_by_cap(self) -> None:
        random_source = random.Random(23)
        for _ in range(2_000):
            total = random_source.randint(1, 10_000) * WAD
            agreeing = random_source.randint(0, total)
            maximum_dispersion = random_source.randint(1, WAD)
            dispersion = random_source.randint(0, 2 * maximum_dispersion)
            cap = random_source.randint(0, WAD)
            confidence = calculate_confidence(
                random_source.randint(0, 100),
                random_source.randint(1, 100),
                agreeing,
                total,
                dispersion,
                maximum_dispersion,
                cap,
            )
            self.assertGreaterEqual(confidence.confidence_wad, 0)
            self.assertLessEqual(confidence.confidence_wad, cap)


if __name__ == "__main__":
    unittest.main()
