# Phase 4 Verification Handoff

## Scope completed

Phase 4 connects the real local origin-chain components to the Phase 3 Reactive
simulator and proves that the result changes the fee of a later real pool swap.
No contract was deployed to a public network and no paid transaction occurred.

The connected path is:

1. `PoolSwapTest` sends an exact-input swap to a real local Uniswap v4
   `PoolManager`.
2. `ThetaShieldHook.beforeSwap` obtains the current directional fee from
   `ThetaShieldController`.
3. The PoolManager executes the swap and `ThetaShieldHook.afterSwap` emits the
   real token deltas, post-swap price, applied fee, fallback status, timestamp,
   direction, pool ID, and monotonic observation ID.
4. The official Reactive local simulator matches the hook subscription and
   delivers that event to `ThetaShieldReactive` as the Reactive system service.
5. The test waits for the configured markout horizon, derives an adverse
   reference from the scheduler's recorded execution price, and publishes it
   through the explicitly centralized mock normalized feed.
6. An official Lasna `Cron1` log settles the observation into a directional
   epoch. The first epoch remains at baseline under cold-start protection.
7. A second real swap and delayed adverse reference produce a non-cold-start
   toxic epoch and one callback.
8. The mock callback proxy overwrites the reserved first callback argument with
   the RVM ID and successfully calls the authenticated controller.
9. A third real pool swap uses the resulting directional premium; both the
   PoolManager `Swap` event and hook observation report the same applied fee.

## Failure-path evidence

The same connected setup verifies:

- **Expired recommendation:** at `validUntil`, the controller lookup falls back
  to 500 fee pips and a real PoolManager swap plus hook event both report that
  baseline.
- **Replayed callback:** delivering the newest successful callback payload a
  second time fails with `RecommendationReplay`.
- **Out-of-order callback:** delivering the first callback after the second has
  succeeded also fails with `RecommendationReplay`.
- **State preservation:** both failed deliveries leave sequence 2 and its
  directional premium unchanged.

These checks exercise the callback payloads produced by the scheduler, not
hand-written controller updates.

## Test configuration versus research configuration

The acceptance test deliberately accelerates activation so it remains small and
deterministic: one trailing observation ends cold start, persistence is 1-of-1,
the epoch target is one observation, and the single mock source may reach full
test confidence. Those are test values, not production or research conclusions.
The Phase 1 documented starting point and future Phase 5 experiments retain the
larger trailing window, 3-of-5 persistence, and single-source confidence limit.

The feed remains `MockNormalizedReferencePriceFeed`, an owner-published local
component. This phase proves integration behavior only; it does not establish
oracle decentralization, public-network delivery, economic robustness, or live
callback liveness.

## Verification evidence

The focused Phase 4 suite passes with:

- real swap-to-callback-to-later-swap lifecycle: pass;
- expired recommendation baseline fallback on a real pool: pass;
- replayed and out-of-order callback rejection: pass;
- Phase 4 integration tests: 3 passed, 0 failed.

The CI-profile whole-repository gate completed with 74 Foundry tests and 15
Python tests passing, including six Solidity properties at 2,000 fuzz runs
each, contract-size checks, shared golden vectors, and the deterministic
benign-noise check.

The final phase commit is gated by:

```sh
FOUNDRY_PROFILE=ci make verify
```

## Explicit limitations

- Contracts remain unaudited research code.
- The Reactive system, callback proxy, RVM identity, and reference feed are
  local simulator components.
- No production feed adapter has been selected.
- No live chain, fork, deployed address, private key, or paid transaction is
  used in this phase.
- Research baselines, scenarios, datasets, and outcome metrics begin in Phase 5.
