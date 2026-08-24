# Phase 5 Baseline Harness Report

## Scope and interpretation

This report is generated directly from the committed Phase 5 scenario seeds and simulator. It compares
the five required policies on identical trade and price streams. Values are descriptive engineering
outputs, not profitability claims, production forecasts, or Phase 6 hypothesis decisions.

## Reproduction

```sh
make research-report
```

This one command regenerates the scenario manifest, raw CSV, summary JSON, this report, and every SVG
chart. `make phase5-check` regenerates in memory and rejects stale or manually edited artifacts.

## Fair baseline calibration

Every policy uses the same event streams, base fee, fee bounds, rate limits, and evaluation period.
ThetaShield keeps its documented gain starting point; each dynamic baseline selects a gain from a
committed grid that minimizes its calibration mean-fee distance from ThetaShield.

| Policy | Selected gain | Calibration mean fee (pips) |
|---|---:|---:|
| `fixed_fee` | 0 | 500 |
| `volatility_only` | 200,000 | 756 |
| `raw_positive_markout` | 100,000 | 730 |
| `dead_band_no_persistence` | 350,000 | 707 |
| `thetashield` | 500,000 | 727 |

Dynamic-policy calibration spread: **49 fee pips**.

## Aggregate descriptive scorecard

The interval is a descriptive 95% normal interval across the 75 scenario-seed runs per policy; it is
not an inferential confidence claim about live markets.

| Policy | Mean fee | LP net PnL (quote) | FPR | FNR | Detection steps | Correct-direction toxic rate |
|---|---:|---:|---:|---:|---:|---:|
| `fixed_fee` | 500 | -729.2425 | 0.00% | 100.00% | n/a | 0.00% |
| `volatility_only` | 816 | -728.1056 | 60.54% | 9.40% | 8 | 0.00% |
| `raw_positive_markout` | 733 | -728.4022 | 33.85% | 11.69% | 5 | 84.20% |
| `dead_band_no_persistence` | 644 | -728.7180 | 13.19% | 48.09% | 39 | 50.98% |
| `thetashield` | 628 | -728.7809 | 7.70% | 69.66% | 77 | 30.34% |

## Measured local hook gas

- `beforeSwap`: 33,192 gas
- warm `afterSwap`: 166,781 gas
- measured hook operations per swap: 199,973 gas

These are isolated local EVM call measurements under the pinned compiler profile. They exclude the
PoolManager/router transaction and are not a live-chain cost quote.

## Generated charts

- `charts/phase5_policy_scorecard.svg`
- `charts/phase5_fee_budget.svg`
- `charts/phase5_scenario_lp_outcomes.svg`

## Limitations carried into Phase 6

- Synthetic streams cannot establish live LP profitability or trader behavior.
- Inventory and cash are tracked separately, but the simulator is a controlled quote-value accounting
  model rather than a full concentrated-liquidity replay.
- Oracle delivery, callbacks, replay, and ordering are modeled deterministically; live liveness is not
  inferred.
- No H1-H6 result is assigned here. Phase 6 owns sensitivity sweeps and explicit pass/fail/inconclusive
  labels.
