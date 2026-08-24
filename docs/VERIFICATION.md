# Verification

## Standard local gate

Run the complete local gate from the repository root:

```sh
make verify
```

This checks Solidity formatting and lint diagnostics, compiles all contracts
with the pinned compiler configuration, runs the Foundry test suite, compiles
the Python model, runs its unit and randomized property tests, checks shared
golden vectors, reproduces every committed research artifact, and installs and
verifies the dashboard from its lockfile.

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

## Phase 5 gate

Regenerate every research artifact and then verify exact reproducibility with:

```sh
make research-report
make phase5-check
```

The Phase 5 gate requires:

- all five required policies on identical scenario-seed event streams;
- all 15 required market and delivery scenarios with five repeated seeds;
- deterministic gain calibration for approximately equal dynamic fee budgets;
- LP fee revenue, buy-and-hold-relative inventory PnL, LP net PnL, realized
  adverse markout, benign and toxic fees, classification, detection, toxic-
  notional coverage, fee duration and oscillation, directionality,
  volatility-correlation, gas, and callback-latency metrics;
- raw CSV rows, aggregate JSON with descriptive intervals, a scenario manifest,
  a generated Markdown report, and three generated SVG charts;
- actual isolated local gas measurement for `beforeSwap` and warm `afterSwap`;
- a check that fails on any stale or manually modified generated artifact; and
- explicit deferral of all H1-H6 labels until Phase 6 sensitivity analysis.

The authoritative whole-repository gate remains:

```sh
FOUNDRY_PROFILE=ci make verify
```

## Phase 6 gate

Regenerate and verify the sensitivity and hypothesis artifacts with:

```sh
make phase6-report
make phase6-check
```

The Phase 6 gate requires:

- a declared pass/fail/inconclusive protocol for every H1-H6 hypothesis;
- 42 configurations covering all 11 required parameter families;
- all 15 scenarios and five repeated seeds for every configuration;
- a markout-horizon sweep that changes the future reference path as well as
  observation latency;
- paired baseline comparisons for LP outcome, false positives, manipulation
  response, and directional discrimination;
- a Pareto analysis of benign false positives, effective detection latency,
  and LP net improvement;
- raw and summarized CSV outputs, summary JSON, criteria manifest, generated
  Markdown report, and three generated SVG charts;
- explicit retention of failed and inconclusive hypotheses; and
- exact artifact regeneration without manually edited chart inputs.

The authoritative whole-repository gate remains:

```sh
FOUNDRY_PROFILE=ci make verify
```

## Phase 6.1 remediation gate

Regenerate and verify the versioned H4/H5 remediation with:

```sh
make phase61-report
make phase61-check
```

The Phase 6.1 gate requires:

- the original Phase 6 v1 H4/H5 failures remain visible and unchanged;
- 90 training-only multi-factor candidates and fixed selection guardrails;
- five holdout seeds disjoint from the five training seeds;
- three explicitly benign challenge families and a 40-case H4 frontier;
- a configurable fast path gated by cold-start completion, epoch notional,
  confidence, and instantaneous confidence-weighted risk;
- a Solidity integration test proving fast protection can activate before the
  slower persistence threshold;
- H4 and H5 pass their original final criteria on the reserved holdout; and
- exact regeneration of the manifest, CSVs, JSON, Markdown, and SVG evidence.

The authoritative whole-repository gate remains:

```sh
FOUNDRY_PROFILE=ci make verify
```

## Phase 7 security and release gate

Run the focused release-hardening gate with:

```sh
make phase7-check
```

The Phase 7 gate requires:

- the dependency lock and tracked-secret scan pass;
- controller boundary fuzzing covers fee, lifetime, and cooldown edges;
- stateful invariants preserve fee bounds, auth/replay rejection, sequence
  synchronization, premium-risk rules, and pause fallback;
- cold/warm controller and hook gas snapshots remain below hard ceilings;
- configured origin and Reactive forks have the expected chain IDs and
  infrastructure bytecode, or are explicitly reported as skipped when local RPC
  inputs are absent;
- deployment validation fails on wrong chains, missing bytecode, invalid
  identifiers, wrong Reactive system address, and invalid callback gas;
- the deployment manifest schema parses successfully; and
- the real local Uniswap-to-Reactive-to-controller dry-run passes without a
  broadcast.

For a Phase 8 release candidate, skipped fork tests are failures. Supply reviewed
RPC/infrastructure values and rerun `make fork-check`, both read-only preflights,
then the authoritative whole-repository gate:

```sh
FOUNDRY_PROFILE=ci make verify
```

## Phase 9 dashboard and submission gate

Run the complete Phase 9 gate with:

```sh
make phase9-check
```

The Phase 9 gate requires:

- exact dashboard dependency installation from `package-lock.json`;
- lint and a production build;
- server-rendered content assertions for the mechanism, evidence, limitations,
  and release boundary;
- zero high-severity production dependency advisories;
- removal of disposable starter preview code and identity;
- an interactive dashboard that labels illustrative scenarios as simulated;
- a valid project-owned social preview image and request-host-derived metadata;
- a final report, demo script, draft submission, and Phase 9 handoff; and
- explicit preservation of the open Phase 8 live-deployment boundary.

The submission file is draft content only. This gate does not send, publish, or
submit the hook to any external service.
