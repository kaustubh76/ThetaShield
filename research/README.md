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
