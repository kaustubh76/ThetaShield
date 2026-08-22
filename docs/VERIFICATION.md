# Verification

## Standard local gate

Run the complete local gate from the repository root:

```sh
make verify
```

This checks Solidity formatting and lint diagnostics, compiles all contracts
with the pinned compiler configuration, runs the Foundry test suite, compiles
the Python model, runs its unit and randomized property tests, checks shared
golden vectors, and reproduces the committed benign-noise result.

## Dependency integrity

Dependencies are Git submodules pinned by the parent repository. Initialize them
after cloning:

```sh
git submodule update --init --recursive
git submodule status --recursive
```

A status line beginning with a space means the dependency is checked out at the
recorded commit.

## Phase 0 clean-clone gate

1. Clone the private repository into a new temporary directory with submodules.
2. Run `make verify` in the clone.
3. Confirm the default branch is `main` and the GitHub visibility is `PRIVATE`.
4. Confirm `git status --short` is empty in the source repository.

## Phase 1 gate

Run individual evidence checks when diagnosing a failure:

```sh
forge test --match-path 'test/math/*' -vv
forge test --match-path 'test/fuzz/*' -vv
forge test --match-path 'test/integration/GoldenVectors.t.sol' -vv
python3 -m unittest discover -s research/tests -p 'test_*.py' -v
python3 -m research.experiments.generate_golden_vectors --check
python3 -m research.experiments.benign_noise --check
```

The Phase 1 gate requires:

- symmetric benign input has zero raw mean and a filtered mean within 0.2 bp;
- the current observation cannot affect its own trailing sigma;
- negative filtered markout remains negative;
- one neutral epoch does not erase a 3-of-5 persistence history;
- Solidity and Python produce identical golden outputs; and
- all lint, unit, fuzz, property, and experiment checks pass.

Later phases will append their reproducibility commands and expected outputs.
