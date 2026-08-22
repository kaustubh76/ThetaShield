# Phase 1 Benign-Noise Experiment

## Question

Does the signed trailing-dead-band pipeline create a positive bias when the
underlying delayed markout is symmetric and zero mean?

## Setup

- Deterministic seed: `1337`
- Observations: `4,096`
- Integer-only discrete-uniform half-range: `0.003464101615137754 WAD`
- Nominal input standard deviation: approximately `0.002 WAD` (20 bps)
- Antithetic construction: every sampled markout has an equal negative partner
- Trailing window: `32`, strictly excluding the current observation
- Cold start: the first 32 observations cannot activate protection
- Dead-band width: `k = 1.5`
- Epoch size: `8`
- Persistence: `3-of-5`
- Single-reference confidence cap: `0.60`

## Result

| Metric | Result |
|---|---:|
| Raw signed mean | `0 WAD` |
| Filtered signed mean | `-497,670,101,036 WAD` (`-0.00498 bp`) |
| Nonzero filtered observations | `606 / 4,064 scored` |
| Positive / negative nonzero observations | `304 / 302` |
| Toxic epochs | `0 / 508` |
| Active premium epochs | `0 / 508` |
| False-positive active rate | `0%` |
| Burst sigma with current excluded | `0 WAD` |
| Burst sigma in self-inclusion control | `8,570,991,287,109,666 WAD` |

The integer-only generator avoids platform-dependent floating-point sampling so
the report is byte-reproducible on macOS and Linux. The filtered aggregate
remains close to zero and does not exhibit the positive
bias caused by clipping negative markouts. The burst control also demonstrates
the circularity failure: including the current burst would widen its own sigma,
while the implemented half-open trailing window remains zero.

## Interpretation and limits

This is an initial deterministic synthetic check, not evidence of production LP
performance. The antithetic input guarantees an exactly zero raw mean and tests
pipeline symmetry under a controlled distribution. Later phases must repeat the
analysis across seeds, non-Gaussian flow, alternating toxicity, volatility-only
regimes, manipulation scenarios, and inventory-aware LP simulation. A zero false
positive count here does not establish a universal false-positive rate.

The machine-readable result is committed as
[`phase1_benign_noise.json`](phase1_benign_noise.json) and is regenerated and
compared byte-for-byte during `make verify`.
