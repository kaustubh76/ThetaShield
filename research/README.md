# Research

This directory contains the independent integer reference implementation,
synthetic experiments, reproducible datasets, reports, and research tests.

Generated results must be reproducible from committed inputs and configuration.
Charts must not depend on manually edited intermediate data.

## Phase 1 commands

```sh
python3 -m unittest discover -s research/tests -p 'test_*.py'
python3 -m research.experiments.generate_golden_vectors --check
python3 -m research.experiments.benign_noise --check
```

Regenerate the committed benign-noise result with `make experiment-report`.
The Solidity integration suite reads the same `datasets/golden_vectors.json`
file used by the Python model tests.

## Phase 5 commands

```sh
make research-report
make phase5-check
```

`research-report` regenerates the 15-scenario manifest, 375 raw policy-run rows,
aggregate summary, Markdown report, and all three SVG charts. The generator also
runs the isolated Foundry hook-operation gas measurement. `phase5-check`
recreates every artifact in memory and fails if a committed file was manually
edited or is stale.

The five policies receive identical generated trade and price streams. Dynamic
baseline gains are selected by a deterministic calibration grid to approximate
ThetaShield's calibration mean-fee budget while preserving the same fee bounds,
rate limits, and evaluation period.

## Phase 6 commands

```sh
make phase6-report
make phase6-check
```

`phase6-report` regenerates the declared decision protocol, 3,150 raw sweep
rows, 42-case summary, H1-H6 decisions, Markdown report, and three SVG charts.
The sweep covers all 11 required parameter families around the Phase 5 default.
`phase6-check` rebuilds the same outputs in memory and rejects stale or manually
edited artifacts.

The generated report retains failed hypotheses. Current controlled synthetic
results pass H1, H2, H3, and H6, while H4 and H5 fail their declared criteria.
These labels are not live-market or production-readiness claims.

## Phase 6.1 commands

```sh
make phase61-report
make phase61-check
```

Phase 6.1 preserves the original H4/H5 failures and evaluates a versioned
remediation. Ninety candidates are selected using training streams only. A
40-case detection frontier and the locked candidate are then evaluated on five
disjoint holdout seeds. The generated holdout result passes H4 and H5 under the
unchanged final criteria; it remains controlled synthetic evidence.

## Functional gap G1 commands

```sh
make gap-g1-report
make gap-g1-check
make phase5-check
```

G1 adds a sixth, coverage-aware research policy without changing the immutable
five-policy Phase 5 evidence. It measures fee coverage against estimated
positive markout loss and composes the deficit premium with directional risk
before applying the existing fee bounds and rate limit. A deterministic
elastic-flow mode models benign and toxic retention separately and discloses
retained volume, false-positive/negative rates, and fee-revenue changes.

## Functional gap G7 commands

```sh
make dashboard-bundle
make gap-g7-check
```

G7 exports a single content-addressed JSON boundary for the interface. It
contains Phase 5 policy/scenario evidence, the original H1-H6 outcomes, the
Phase 6.1 holdout remediation, G1 closed-loop gates, and four deterministic
mechanism traces. The trace transport events are simulator outcomes rather than
live-chain receipts, and the bundle states that boundary directly.
