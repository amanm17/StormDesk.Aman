"""Unit tests for the scoring engine. Run: python -m unittest discover tests"""
import unittest

import numpy as np
import pandas as pd

from pipeline.common import weather_label
from pipeline.registry import Indicator
from pipeline.scoring import combine, components, global_score

UP = Indicator("t_up", "test", "fred", "X", "credit", "up", "diff", "%")
DOWN = Indicator("t_dn", "test", "fred", "X", "equities", "down", "pct", "index")
ABS = Indicator("t_abs", "test", "fred", "X", "bonds", "abs", "diff", "%")


def series(values):
    return pd.Series(values, index=pd.bdate_range("2018-01-01", periods=len(values)), dtype=float)


class WeatherBands(unittest.TestCase):
    def test_primer_bands(self):
        cases = {0: "Clear", 20: "Clear", 21: "Cloudy", 40: "Cloudy", 41: "Rain", 60: "Rain", 61: "Storm Watch",
                 75: "Storm Watch", 76: "Severe Storm", 90: "Severe Storm", 91: "Hurricane", 100: "Hurricane"}
        for score, label in cases.items():
            self.assertEqual(weather_label(score), label, score)
        self.assertEqual(weather_label(None), "No data")


class Components(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(7)
        self.calm = rng.normal(0, 0.02, 1200).cumsum() + 4

    def test_spike_up_is_high_stress_for_up_indicator(self):
        v = self.calm.copy()
        v[-20:] += np.linspace(0, 3, 20)      # spreads blow out
        c = components(series(v), UP).iloc[-1]
        self.assertGreater(c["P"], 95)
        self.assertGreater(c["M"], 95)

    def test_same_spike_is_low_stress_for_down_indicator(self):
        v = 100 + self.calm.copy() * 10
        v[-20:] += np.linspace(0, 30, 20)     # equity rally
        c = components(series(v), DOWN).iloc[-1]
        self.assertLess(c["P"], 10)
        self.assertLess(c["M"], 10)

    def test_abs_indicator_scores_large_moves_either_way(self):
        up, dn = self.calm.copy(), self.calm.copy()
        up[-20:] += np.linspace(0, 1.5, 20)
        dn[-20:] -= np.linspace(0, 1.5, 20)
        cu, cd = components(series(up), ABS).iloc[-1], components(series(dn), ABS).iloc[-1]
        self.assertGreater(cu["M"], 90)
        self.assertGreater(cd["M"], 90)
        self.assertAlmostEqual(cu["P"], cd["P"], delta=5)

    def test_short_history_gives_no_score(self):
        c = components(series(self.calm[:50]), UP)
        self.assertTrue(c["P"].isna().all())


class Combine(unittest.TestCase):
    def test_weights_and_renormalisation(self):
        one = lambda x: pd.Series([x])  # noqa: E731
        full = combine({"P": one(100), "M": one(0), "V": one(0), "C": one(0), "N": one(0)})
        self.assertAlmostEqual(full.iloc[0], 40.0)
        partial = combine({"P": one(100), "M": one(0), "V": pd.Series([np.nan]), "C": one(0), "N": None})
        self.assertAlmostEqual(partial.iloc[0], 100 * 0.40 / 0.75)

    def test_context_alone_is_not_a_score(self):
        nan = pd.Series([np.nan])
        out = combine({"P": nan, "M": nan, "V": nan, "C": pd.Series([90.0]), "N": pd.Series([90.0])})
        self.assertTrue(out.isna().iloc[0])


class Global(unittest.TestCase):
    def test_contagion_raises_global(self):
        cls = pd.DataFrame({"bonds": [70.0], "credit": [70.0], "equities": [70.0], "liquidity": [70.0],
                            "fx": [70.0], "commodities": [70.0], "crypto": [70.0], "news": [70.0]})
        low = global_score(cls, pd.Series([50.0]))["global"].iloc[0]
        high = global_score(cls, pd.Series([100.0]))["global"].iloc[0]
        self.assertGreater(high, low)
        self.assertLessEqual(high, 100)


if __name__ == "__main__":
    unittest.main()
