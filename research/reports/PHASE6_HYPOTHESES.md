# Phase 6 Sensitivity and Hypothesis Report

## Interpretation boundary

This generated report applies the criteria encoded in the Phase 6 sweep manifest to controlled
synthetic streams. Pass, fail, and inconclusive labels describe this simulator only; they do not
establish live profitability, security, or production readiness.

## Hypothesis decisions

| Hypothesis | Decision | Key evidence |
|---|---|---|
| H1 — LP protection | **PASS** | paired LP improvement 1.2254 [1.0347, 1.4160] |
| H2 — Benign-flow fairness | **PASS** | fee excess 0.00%; FPR 0.00% |
| H3 — Noise robustness | **PASS** | raw-minus-full FPR 23.88 pp |
| H4 — Detection trade-off | **FAIL** | rank correlation 0.000; 2 dead-band/persistence Pareto points |
| H5 — Manipulation resistance | **FAIL** | retained toxic coverage 3.55%; FPR reduction 34.69 pp |
| H6 — Directional discrimination | **PASS** | directional advantage 44.33 pp; fee correlation 0.253 |

Failed and inconclusive hypotheses remain visible by design; parameters are not retuned to
change a label after evaluation.

H1 is a relative result: both fixed-fee and ThetaShield mean LP net outcomes remain negative
in the persistent synthetic regimes. Its PASS label means only that ThetaShield's paired result
is less negative by the declared criterion.

## Decision protocol and evidence

### H1 — LP protection: PASS

- Pass rule: paired 95% interval for ThetaShield minus fixed-fee LP net PnL is above zero.
- Fail rule: the paired interval is below zero; overlap with zero is inconclusive.
- Evidence: paired LP improvement 1.2254 [1.0347, 1.4160].
- Interpretation: Persistent-flow LP net PnL is compared pairwise against the fixed-fee result on identical streams.

### H2 — Benign-flow fairness: PASS

- Pass rule: upper intervals stay within 10% of baseline mean fee and 5% false positives.
- Fail rule: a lower interval exceeds either limit; boundary overlap is inconclusive.
- Evidence: fee excess 0.00%; FPR 0.00%.
- Interpretation: The benign-noise upper intervals are checked against fixed limits declared in the sweep manifest.

### H3 — Noise robustness: PASS

- Pass rule: paired 95% interval for raw-markout minus ThetaShield false-positive rate is above zero.
- Fail rule: the paired interval is non-positive; overlap with zero is inconclusive.
- Evidence: raw-minus-full FPR 23.88 pp.
- Interpretation: Positive values mean the full controller produced fewer false-positive premiums than raw markout.

### H4 — Detection trade-off: FAIL

- Pass rule: rank correlation is at most -0.35 with at least three Pareto points spanning 5 percentage points and 5 steps.
- Fail rule: rank correlation is non-negative or fewer than two Pareto points exist; other results are inconclusive.
- Evidence: rank correlation 0.000; 2 dead-band/persistence Pareto points.
- Interpretation: Lower false-positive rates are expected to accompany longer effective detection latency.

### H5 — Manipulation resistance: FAIL

- Pass rule: ThetaShield reduces raw-markout false positives and oscillation with lower intervals above zero while retaining at least 50% toxic-premium coverage.
- Fail rule: either reduction is non-positive or retained coverage is below 25%; intermediate evidence is inconclusive.
- Evidence: retained toxic coverage 3.55%; FPR reduction 34.69 pp.
- Interpretation: The coverage floor prevents a controller that simply never reacts from being labeled manipulation-resistant.

### H6 — Directional discrimination: PASS

- Pass rule: ThetaShield's paired correct-direction advantage is at least 20 percentage points and mean volatility-fee correlation is at most 0.80.
- Fail rule: the advantage is non-positive or correlation is at least 0.95; intermediate evidence is inconclusive.
- Evidence: directional advantage 44.33 pp; fee correlation 0.253.
- Interpretation: The volatility-only policy applies symmetric side fees, while this test requires a repeated-seed directional advantage.

## Sensitivity design

The harness evaluates 42 configurations across 15 scenarios and 5 seeds, producing 3,150 raw ThetaShield runs. Each non-default case changes one of 11 required parameter families from the Phase 5 default.

The headline Pareto analysis minimizes benign false positives and effective persistent-flow
detection latency while maximizing paired LP net improvement over fixed fees. A missed
detection is conservatively assigned 241 steps.

## Global Pareto configurations

| Configuration | Dimension | Value | Benign FPR | Effective latency | LP improvement (quote) |
|---|---|---:|---:|---:|---:|
| `dead_band_k__0p5` | `dead_band_k` | 0.5 | 0.00% | 47 | 2.2845 |
| `markout_horizon__4` | `markout_horizon` | 4 steps | 0.00% | 50 | 6.7897 |
| `markout_horizon__8` | `markout_horizon` | 8 steps | 0.00% | 54 | 13.1147 |
| `persistence_n_of_k__1-of-3` | `persistence_n_of_k` | 1-of-3 | 0.00% | 46 | 1.3484 |

## Reproduction

```sh
make phase6-report
make phase6-check
```

The report, two CSV files, summary JSON, sweep manifest, and all SVG charts are generated
directly from the scenario definitions and policy model. No chart reads a manually edited
intermediate file.

## Limitations

- The order stream is exogenous and does not respond to fees.
- Descriptive seed intervals are not claims about a live-market population.
- The simulator tracks inventory and cash but is not a concentrated-liquidity tick replay.
- Parameter sweeps are one-at-a-time except the coupled n-of-k and fee-step families; broad
  interaction effects remain unmeasured.
- Markout-horizon sweeps use the committed synthetic future-price path and right-edge terminal
  reference, not an external oracle history.
- No deployment, paid transaction, or external service is used.
