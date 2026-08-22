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

## Phase 2 gate

Run the focused origin-controller and local Uniswap v4 checks with:

```sh
forge test --match-contract ThetaShieldControllerTest -vv
forge test --match-contract ThetaShieldHookIntegrationTest -vv
```

The Phase 2 gate requires:

- the configured public account is the initial two-step owner;
- only the callback proxy with the expected RVM ID can update a pool;
- replayed, out-of-order, stale, future, malformed, overlong, low-confidence
  premium, fee-bound, and risk-bound recommendations revert;
- pause, missing, low-confidence baseline, and expiry paths select the baseline;
- a real local v4 `PoolManager` initializes a dynamic-fee pool;
- swaps execute in both directions with different fees;
- the `PoolManager.Swap` fee equals the hook's selected override;
- observations include both raw deltas, post-swap price, applied fee, fallback
  status, timestamp, direction, and a monotonic ID; and
- direct non-manager hook calls and static-fee pools revert.

The authoritative whole-repository gate remains:

```sh
FOUNDRY_PROFILE=ci make verify
```

## Phase 3 gate

Run the focused scheduler and normalization checks with:

```sh
forge test --match-contract ThetaShieldReactiveTest -vv
forge test --match-contract ReferencePriceNormalizerTest -vv
```

The Phase 3 gate requires:

- exact pool, market, and official Lasna `Cron1` subscriptions;
- Reactive-system-only event delivery plus chain, emitter, source, sequence,
  and future-time validation;
- no settlement before the configured markout horizon;
- deterministic settlement with the earliest eligible reference per source;
- explicit expiry when no eligible reference arrives;
- fixed pending capacity and fixed maximum processing per Cron call;
- strictly trailing volatility and cold-start premium suppression;
- independent directional epoch, persistence, risk, confidence, and fee state;
- at most one callback per Cron reaction; and
- successful RVM-ID injection and authenticated update of the Phase 2 controller.

The authoritative whole-repository gate remains:

```sh
FOUNDRY_PROFILE=ci make verify
```

## Phase 4 gate

Run the connected local lifecycle with:

```sh
forge test --force --match-contract ThetaShieldEndToEndTest -vv
```

The Phase 4 gate requires:

- a real local Uniswap v4 `PoolManager`, dynamic-fee pool, router, and
  `ThetaShieldHook` rather than a mock swap emitter;
- delivery of the hook's real `SwapObserved` event to `ThetaShieldReactive`;
- delayed reference publication based on the scheduler's recorded execution
  price;
- cold-start baseline output followed by a directional premium after another
  adverse epoch;
- successful callback-proxy RVM-ID injection into the authenticated controller;
- a later real swap whose PoolManager fee equals the new controller fee;
- baseline fallback on recommendation expiry; and
- failed replay and older-after-newer callback deliveries without state change.

The authoritative whole-repository gate remains:

```sh
FOUNDRY_PROFILE=ci make verify
```
