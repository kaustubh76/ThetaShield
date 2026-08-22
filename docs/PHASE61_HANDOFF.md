# Phase 6.1 H4/H5 Remediation Handoff

## Scope completed

Phase 6.1 fixes the two weaknesses exposed by Phase 6 without overwriting the
original failed results. It adds a versioned train/holdout protocol, harder
benign challenge streams, a multi-factor frontier, and a configurable bounded
fast-response path in both the Python reference policy and Reactive scheduler.

The Phase 6 v1 H4 and H5 labels remain failed in their original report. Phase
6.1 is separate evidence showing that the revised design passes both criteria
on five reserved seeds that were not used by the selection function.

## Root causes and fixes

H4 failed because the original benign streams generated zero false positives
for every relevant dead-band and persistence case. Latency moved, but a
false-positive/latency trade-off cannot be measured when one axis is constant.
Phase 6.1 adds three explicitly benign stress streams: near-threshold
directional clusters, heteroskedastic noise, and reversal bursts. It evaluates
40 dead-band, persistence, and fast-path combinations on both training and
reserved seeds.

H5 failed because the default 3-of-5 persistence path reacted too slowly and
retained only 3.55% of raw-markout toxic-premium coverage. The remediation adds
a second activation path that requires all of the following:

- cold start has completed;
- the epoch meets the minimum notional;
- confidence meets a separate fast-path floor; and
- confidence-weighted instantaneous risk exceeds the fast-path threshold.

The original persistence path remains intact. The selected research setting
uses a shorter 16-observation trailing warm-up, four observations per epoch,
dead-band k of 1.0, 3-of-5 persistence, a 50% fast-path confidence floor, a
7.5-bp fast threshold, and +500/-100-pip fee step limits. All new settings are
constructor configuration; no deployment default is silently changed.

## Leakage control

The deterministic selection function evaluates 90 multi-factor candidates on
the five Phase 5 seeds. Candidates must clear stricter training guardrails than
the final H5 rule. Tie-breaking is fixed in the manifest. Five disjoint seeds
are then evaluated once as holdout; holdout values are not inputs to selection.

The selected case is:

`h5__k_1__p_3_of_5__up_500__down_100`

## Reserved holdout outcome

The generated report is authoritative for exact values. At this handoff:

- H4 passes with rank correlation -0.727, six distinct Pareto points, a 22.75-percentage-
  point false-positive span, and a 29-step latency span.
- H5 passes with 59.70% retained toxic-premium coverage.
- Raw-minus-remediated false-positive reduction has a 13.43-percentage-point
  lower interval bound.
- Raw-minus-remediated oscillation reduction has an 809-pip lower interval
  bound.
- The unchanged Phase 6 v1 controller retains only 3.87% coverage on the same
  reserved streams.

These are controlled synthetic outcomes, not live-market, profitability,
security-audit, or production-readiness claims.

## Generated artifacts

`make phase61-report` regenerates:

- `research/datasets/phase61_remediation_manifest.json`;
- `research/reports/phase61_h4_frontier.csv`;
- `research/reports/phase61_h5_results.csv`;
- `research/reports/phase61_summary.json`;
- `research/reports/PHASE61_REMEDIATION.md`; and
- two Phase 6.1 SVG charts under `research/reports/charts/`.

`make phase61-check` regenerates every output in memory and compares it byte for
byte with the committed artifacts.

## Verification

Focused checks:

```sh
forge test --force --match-contract ThetaShieldReactiveTest -vv
python3 -m unittest research.tests.test_phase61_remediation -v
make phase61-check
```

The authoritative repository gate remains:

```sh
FOUNDRY_PROFILE=ci make verify
```

No deployment, paid transaction, external token, or private key is used.
