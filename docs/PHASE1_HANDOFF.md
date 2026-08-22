# Phase 1 Verification Handoff

## Scope completed

Phase 1 contains no hook, callback receiver, scheduler, deployment, or paid
transaction. It establishes the pure controller mathematics before any protocol
integration.

Delivered:

- formal units, signs, half-open trailing windows, rounding, bounds, and cold-start
  behavior;
- full-precision unsigned and signed fixed-point helpers;
- directional delayed markout;
- bounded trailing population volatility that excludes the current observation;
- signed soft-threshold dead-band filtering;
- minimum/capped-notional epoch aggregation;
- bounded `n-of-k` persistence bitmap;
- normalized weighted reference-price dispersion around a weighted median;
- mechanical count, agreement, and dispersion confidence;
- direction-preserving magnitude smoothing;
- bounded, confidence-gated, persistence-gated, rate-limited fee curves;
- an independent integer Python model;
- shared JSON golden vectors consumed by both implementations; and
- a deterministic symmetric benign-noise experiment and honest limitations report.

## Verification evidence

The CI profile gate (`FOUNDRY_PROFILE=ci make verify`) passes with:

- Solidity formatting: pass;
- Solidity lint with warnings denied: pass;
- Solidity `0.8.26` build: pass;
- Foundry tests: 38 passed, 0 failed;
- Foundry fuzz properties: 6 properties at 2,000 runs each;
- cross-language golden tests: 9 passed;
- Python tests: 15 passed, including 9,500 deterministic randomized property cases;
- golden-vector regeneration check: byte-for-byte match; and
- benign-noise report regeneration check: byte-for-byte match.

The required gate assertions are explicit:

1. Symmetric benign input has exactly zero raw signed sum and a filtered mean of
   `-0.00498 bp`, within the `0.2 bp` Phase 1 tolerance.
2. Changing the current observation cannot change the sigma used to score it.
3. A negative outside-band markout remains negative.
4. A neutral epoch between toxic epochs does not erase a 3-of-5 history.
5. Solidity and Python agree across markout, sigma, dead band, epoch aggregation,
   reference dispersion, confidence, persistence, smoothing, and fee vectors.

## Initial experiment outcome

The deterministic benign-noise scenario produced 0 active premium epochs across
508 scored epochs. This is a controlled symmetry check, not an estimate of a
universal false-positive rate and not evidence of production LP profitability.
The complete assumptions and limitations are in
[`research/reports/PHASE1_BENIGN_NOISE.md`](../research/reports/PHASE1_BENIGN_NOISE.md).

## Reproduce

```sh
FOUNDRY_PROFILE=ci make verify
```

Phase 2 may consume these pure libraries but must not silently change Phase 1
sign, rounding, or confidence semantics. Any such change requires updated formal
definitions, Python parity, regenerated vectors, and a new passing gate.
