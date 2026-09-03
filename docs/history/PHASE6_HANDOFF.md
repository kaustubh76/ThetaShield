# Phase 6 Verification Handoff

## Scope completed

Phase 6 delivers the sensitivity analysis and explicit H1-H6 evaluation on top
of the verified Phase 5 shared-stream harness.

Delivered:

- a declared decision protocol with explicit pass and fail rules for H1-H6;
- 42 deterministic configurations covering all 11 required parameter families;
- 15 scenarios, five repeated seeds, and 3,150 raw ThetaShield sweep runs;
- paired comparisons against the fairly calibrated Phase 5 baselines;
- descriptive repeated-seed intervals for hypothesis evidence;
- a three-objective Pareto analysis of benign false positives, effective
  detection latency, and LP net improvement over fixed fees;
- a future-price-aware markout-horizon sweep;
- raw and summarized CSV files, summary and manifest JSON, a generated Markdown
  report, and three generated SVG charts; and
- exact in-memory artifact regeneration through `make phase6-check`.

## Sensitivity grid

The Phase 5 default is evaluated once. Each other case changes one parameter
family while keeping the same scenario streams, seeds, accounting, fee bounds
unless that bound is the swept parameter, and operational failure modes.

The grid covers:

1. dead-band `k`;
2. trailing-window and matching cold-start length;
3. markout horizon;
4. epoch observation count and matching target count;
5. persistence `n-of-k`;
6. EWMA alpha;
7. confidence threshold;
8. toxicity threshold;
9. fee gain;
10. maximum fee; and
11. coupled fee step-up and step-down limits.

This is a one-at-a-time sensitivity design except for parameters that are
mechanically coupled. It does not claim to cover the full interaction space.

## Hypothesis outcomes

The generated controlled-simulation decisions are:

| Hypothesis | Outcome | Main evidence |
|---|---|---|
| H1 — LP protection | Pass | paired LP net improvement of 1.2254 quote, interval 1.0347 to 1.4160 |
| H2 — Benign-flow fairness | Pass | 0% mean fee excess and 0% false positives in benign noise |
| H3 — Noise robustness | Pass | raw markout has 23.88 percentage points more false positives |
| H4 — Detection trade-off | Fail | zero false-positive span and rank correlation 0.000 in the relevant sweep |
| H5 — Manipulation resistance | Fail | only 3.55% of raw-markout toxic-premium coverage is retained |
| H6 — Directional discrimination | Pass | 44.33-point directional advantage and 0.253 fee correlation |

H1 is strictly relative. Both fixed-fee and ThetaShield mean LP net results are
negative in the persistent synthetic regimes; the pass means ThetaShield is
less negative by the declared paired criterion, not that the strategy is
profitable.

H4 remains failed because the dead-band and persistence cases all produce zero
false positives on the two benign streams. Detection latency changes, but the
required two-axis trade-off is not measurable when one axis has no span.

H5 remains failed even though false positives and oscillation fall. The
coverage safeguard prevents a policy from receiving a manipulation-resistance
pass simply by declining to charge most toxic flow.

## Generated artifacts

`make phase6-report` regenerates:

- `research/datasets/phase6_sweep_manifest.json`;
- `research/reports/phase6_sensitivity_results.csv`;
- `research/reports/phase6_sweep_summary.csv`;
- `research/reports/phase6_summary.json`;
- `research/reports/PHASE6_HYPOTHESES.md`;
- `research/reports/charts/phase6_pareto.svg`;
- `research/reports/charts/phase6_hypotheses.svg`; and
- `research/reports/charts/phase6_directionality.svg`.

`make phase6-check` regenerates these outputs in memory and compares every byte
with the committed artifacts. No chart reads a manually edited intermediate
file.

## Verification

The focused Phase 6 checks are:

```sh
python3 -m unittest research.tests.test_phase6_sensitivity -v
make phase5-check
make phase6-check
```

The final phase commit is gated by:

```sh
FOUNDRY_PROFILE=ci make verify
```

The completed local gate passed 75 Solidity tests and 31 Python research tests
with zero failures. Formatting, linting, compilation, golden-vector checks,
Phase 1 and Phase 5 artifact checks, and exact Phase 6 regeneration also
passed.

## Explicit limitations

- Results are controlled synthetic evidence, not live-market inference.
- Exogenous trades do not change in response to fees.
- Inventory accounting is not a concentrated-liquidity tick replay.
- The normal intervals describe seed dispersion rather than a sampled live
  market population.
- The one-at-a-time design does not measure broad parameter interactions.
- The markout-horizon path uses synthetic future prices and a terminal reference
  at the right edge.
- Gas remains an isolated local hook measurement from Phase 5.
- No deployment, paid transaction, external token, or private key is used.
