# Phase 6.1 H4/H5 Remediation Report

## Outcome

The reserved holdout result is **PASS**: H4 is **PASS** and H5 is **PASS**.
The original Phase 6 v1 H4/H5 failures remain preserved; this report is a new versioned
experiment and does not rewrite unfavorable historical evidence.

## Why v1 failed and what changed

- H4 failed because its benign streams were too easy: every relevant candidate had 0% false
  positives, so no two-axis false-positive/latency frontier could be measured. Phase 6.1 adds
  near-threshold clusters, heteroskedastic noise, and reversal bursts, all explicitly benign.
- H5 failed because the 3-of-5 persistence gate reacted too late, retaining only a small share
  of raw toxic-premium coverage. Phase 6.1 adds a confidence-gated instantaneous fast path
  after cold start, keeps the original persistence path, shortens the evidence window, and
  uses asymmetric fee steps so protection rises faster than it relaxes.

## Locked configuration

Training selected `h5__k_1__p_3_of_5__up_500__down_100` from 90 cases.
The settings are dead-band k 1.00, 3-of-5 persistence, 4 observations per epoch, 16 trailing observations, +500/-100 pips per update, and a fast threshold of 7.50 bps at 50% confidence.

## Reserved holdout evidence

- H4 rank correlation: -0.727; 6 Pareto points; false-positive span 22.75 percentage points; latency span 29 steps.
- H5 retained toxic-premium coverage: 59.70% (v1 legacy on the same holdout: 3.87%).
- H5 raw-minus-remediated FPR reduction: 20.79 pp with 95% interval [13.43, 28.15].
- H5 raw-minus-remediated oscillation reduction: 2216 pips with 95% interval [809, 3623].

## Reproduction

```sh
make phase61-report
make phase61-check
```

## Interpretation boundary

Controlled deterministic synthetic evidence only; this is not live-market, profitability, deployment, or security-audit evidence.
The holdout seeds are disjoint from training and are not used by the selection function.
No deployment, paid transaction, external token, or private key is used.
