# Architecture

ThetaShield separates latency-sensitive fee consumption from delayed statistical
processing.

```text
Origin-chain swap
      |
      v
ThetaShieldHook -- emits compact observation --> Reactive scheduler
      |                                         |
      | reads directional fee                   | waits for markout horizon
      v                                         | consumes reference price
ThetaShieldController <--- authenticated callback
```

## Component boundaries

- **Hook:** selects the fee for the current direction, emits observations, and
  falls back to the baseline when recommendations are stale.
- **Origin controller:** authenticates callbacks and stores bounded, sequenced,
  directional recommendations.
- **Reactive scheduler:** matures observations, processes reference prices,
  aggregates bounded epochs, applies persistence, and generates callbacks.
- **Reference adapters:** normalize price, time, source, and confidence metadata.
- **Math libraries:** provide pure, reusable fixed-point operations with explicit
  rounding.
- **Research model:** independently implements the controller and produces
  cross-language golden vectors and falsifiable experiments.

The hook must not perform the full statistical pipeline inside `beforeSwap`.

## Phase 2 origin-chain flow

1. `ThetaShieldHook.beforeSwap` confirms the pool uses Uniswap's dynamic-fee
   flag and asks the controller for the current swap direction's fee.
2. The hook returns the fee with Uniswap's override flag. The controller returns
   the configured baseline if the recommendation is missing, paused, not yet
   valid, expired, or below the confidence floor.
3. `ThetaShieldHook.afterSwap` emits raw token deltas, the post-swap square-root
   price, applied fee, fallback status, timestamp, and a monotonic per-pool
   observation ID. These fields are sufficient for a later bounded scheduler to
   derive normalized execution data without adding statistical work to the swap
   path.
4. The configured callback proxy is the only account that may submit a
   recommendation. The controller also checks the RVM ID, pool registration,
   sequence, validity window, lifetime, confidence, fee bounds, risk bound, and
   positive-risk requirement for any premium above baseline.

Administrative control uses two-step ownership and deliberately has no renounce
path. Reconfiguration invalidates the active recommendation but preserves the
last accepted sequence, preventing a configuration change from reopening old
callback payloads for replay.

## Phase 3 Reactive flow

Each `ThetaShieldReactive` deployment serves exactly one pool and one reference
market. Its constructor registers three exact subscriptions: the pool's
`SwapObserved` topic, the normalized market's `ReferencePricePublished` topic,
and Lasna's `Cron1` topic. The contract accepts logs only from the Reactive
system service and then revalidates chain, emitter, indexed identifiers, data,
sequence, and timestamp before changing state.

Swap observations enter a fixed-size slot pool. A Cron call inspects no more
than the configured per-call bound; observations cannot settle before the
markout horizon and expire if an eligible reference never arrives. For each
allowed source, the scheduler selects the earliest sample in the configured
post-maturity window, then derives a confidence-weighted median and normalized
dispersion. Reference sources are explicit constructor inputs, sequences are
monotonic per source, and each source has a bounded ring history.

Settled observations are scored against strictly trailing volatility, then
added to bounded directional epochs. Cold-start observations can contribute to
state but cannot activate toxic persistence. Epoch finalization applies the
Phase 1 aggregation, confidence, persistence, smoothing, and fee-curve
libraries independently for both directions. Missing epochs decay to neutral;
very large gaps reset risk state conservatively.

At most one recommendation callback is emitted by a Cron reaction. The first
callback argument is an empty address in the encoded payload because Reactive's
callback proxy replaces it with the RVM ID before calling the Phase 2
controller. A premium is suppressed to the baseline unless risk is positive,
persistence is active, and confidence meets the fee floor.

The normalized feed included in Phase 3 is an owner-published development mock.
The interface and decimal normalizer define the adapter boundary, but selecting
and validating a decentralized production source remains future work.
