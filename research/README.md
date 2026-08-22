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
