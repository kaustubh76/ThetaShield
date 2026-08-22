# Phase 2 Verification Handoff

## Scope completed

Phase 2 implements the latency-sensitive origin-chain boundary without deploying
or sending any paid transaction.

Delivered:

- `ThetaShieldController`, with immutable callback-proxy and RVM authentication;
- separate fee and signed-risk values for both swap directions;
- strictly increasing per-pool callback sequences that survive reconfiguration;
- future, stale, malformed, overlong, out-of-fee-range, out-of-risk-range, and
  insufficient-confidence premium rejection;
- global and per-pool pause with baseline fallback;
- two-step administration with no accidental renounce path;
- `ThetaShieldHook`, with only `beforeSwap` and `afterSwap` permission bits;
- per-swap directional dynamic-fee overrides;
- compact, monotonic `SwapObserved` records with the raw information needed for
  later execution-price normalization; and
- local integration against the official Uniswap v4 core `PoolManager`.

The public account `0xd1DcAAFf9356d5a42f2eE6F90179C4509386a83f` is recorded as
the intended owner/deployer in `.env.example`. No private key is present or
required for local verification.

## Trust and safety rules

The controller accepts a recommendation only when all of these conditions hold:

1. `msg.sender` is the immutable callback proxy.
2. The first callback argument matches the immutable expected RVM ID. This first
   argument remains reserved for Reactive callback delivery.
3. The pool was explicitly configured by the owner.
4. The sequence is greater than every previously accepted sequence for the pool.
5. `validAfter <= block.timestamp < validUntil`, and the window is positive and
   no longer than the configured maximum lifetime.
6. Confidence, both fees, and both signed risks are within their configured or
   hard safety bounds.
7. A fee above baseline has positive risk for that same direction.
8. A recommendation below the confidence floor cannot request a premium.

The hook's fee lookup returns the baseline when the system or pool is paused, no
recommendation exists, the validity window is inactive, or confidence is below
the configured floor. Unsupported pools revert rather than silently acquiring a
configuration from another pool.

## Observation contract

Each eligible swap emits:

- pool ID, per-pool observation ID, and swap direction as indexed fields;
- signed token-0 and token-1 deltas;
- post-swap `sqrtPriceX96`;
- applied LP fee and whether it came from fallback; and
- origin-chain timestamp.

The hook does not estimate volatility, markout, persistence, confidence, or risk
on the swap path. Phase 3 must normalize token units and calculate delayed
markout using the already-verified Phase 1 libraries.

## Dependency integrity

Uniswap v4 core is a recursive Git submodule pinned to the official `v4.0.0`
tag at commit `e50237c43811bd9b526eff40f26772152a42daba`. ThetaShield uses
core interfaces and libraries directly. Its small base-hook dispatcher is
adapted from the official MIT-licensed Uniswap hook base and keeps only the
dependency surface needed for this phase.

## Verification evidence

The CI-profile whole-repository gate passes with:

- Solidity format and warning-denied lint: pass;
- Solidity `0.8.26` Cancun build and contract-size check: pass;
- Foundry tests: 59 passed, 0 failed;
- controller security and boundary tests: 15 passed;
- local PoolManager integration tests: 6 passed;
- both fee directions executed with `2,500` and `900` fee pips respectively;
- stale fallback executed with the configured `500` fee pips;
- Phase 1 fuzz properties: 6 properties at 2,000 runs each; and
- Python, golden-vector, and deterministic experiment checks: pass.

Reproduce with:

```sh
FOUNDRY_PROFILE=ci make verify
```

## Explicit limitations

- Contracts are unaudited research code and have not been deployed.
- The Reactive scheduler, live callback proxy wiring, reference-price adapters,
  and full callback lifecycle begin in later phases.
- The placeholder infrastructure values in `.env.example` must be checked
  against current official deployment records before any live use.
- Raw token deltas require token-decimal and reference-price normalization in
  Phase 3 before they can be compared across pools.
