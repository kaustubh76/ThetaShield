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
libraries independently for both directions. Phase 6.1 also permits a
confidence-gated fast path after cold start when the current confidence-weighted
epoch risk exceeds its separate threshold. It bypasses the persistence wait
only; all fee bounds and rate limits remain active. Missing epochs decay to
neutral; very large gaps reset risk state conservatively.

At most one recommendation callback is emitted by a Cron reaction. The first
callback argument is an empty address in the encoded payload because Reactive's
callback proxy replaces it with the RVM ID before calling the Phase 2
controller. A premium is suppressed to the baseline unless risk is positive,
either persistence or the bounded fast path is active, and confidence meets
the fee floor.

The normalized feed included in Phase 3 is an owner-published development mock.
The interface and decimal normalizer define the adapter boundary, but selecting
and validating a decentralized production source remains future work.

## Phase 4 verified local lifecycle

The local acceptance harness connects every implemented component rather than
replacing the swap side with an event emitter:

```text
PoolSwapTest -> PoolManager -> ThetaShieldHook -> SwapObserved
                                              |
                                              v
Mock Reactive system -> ThetaShieldReactive <- normalized mock reference
                              |
                              v
                     mock callback proxy
                              |
                              v
                   ThetaShieldController
                              |
                              v
             later PoolManager swap uses new fee
```

The delayed reference price is derived from the execution price recorded by the
scheduler from the real hook event. The first epoch remains at baseline because
it is cold-start data; a second adverse epoch activates the accelerated test
persistence configuration and schedules a directional premium. A later real
swap proves that the PoolManager's applied fee equals the controller's new fee.

The same connected harness verifies recommendation expiry, replay of the latest
callback, and delivery of an older callback after a newer one. Expiry selects
the baseline at the hook, while both invalid callback deliveries fail at the
controller and leave the newest recommendation unchanged.

## Phase 5 research pipeline

The research harness keeps scenario generation, policy logic, delivery
simulation, economic accounting, and artifact rendering separate:

```text
committed seeds + scenario definitions
                  |
                  v
       one shared event stream
                  |
      +-----------+-----------+-----------+-----------+
      v           v           v           v           v
    fixed    volatility     raw       dead-band   ThetaShield
      |           |        markout    no persist      full
      +-----------+-----------+-----------+-----------+
                  |
                  v
     cash + inventory + classification + delivery metrics
                  |
                  v
       CSV + JSON + Markdown + generated SVG charts
```

All five policies see identical directions, notionals, execution prices,
future references, toxicity labels, and operational failures for a given
scenario and seed. Fees do not alter the exogenous stream, which isolates policy
responses but does not model fee-sensitive order flow. Inventory and cash are
tracked separately and compared with a buy-and-hold inventory benchmark; fee
revenue is then added to form the reported LP net result.

Dynamic baseline gains are chosen by a deterministic committed grid to minimize
their calibration mean-fee distance from ThetaShield. This controls the fee
budget without manually editing results. Phase 5 reports descriptive repeated-
seed intervals only and intentionally leaves H1-H6 decisions to Phase 6.

## Phase 6 sensitivity and decision pipeline

Phase 6 holds the Phase 5 event streams fixed and changes one controller
parameter family at a time:

```text
Phase 5 default + declared decision protocol
                       |
                       v
       42 configurations x 15 scenarios x 5 seeds
                       |
          +------------+-------------+
          |            |             |
          v            v             v
    raw sweep CSV   case summary   paired baseline evidence
          |            |             |
          +------------+-------------+
                       |
                       v
       Pareto map + H1-H6 pass/fail/inconclusive
```

The 11 swept families are dead-band width, trailing window, markout horizon,
epoch duration, persistence `n-of-k`, EWMA alpha, confidence threshold,
toxicity threshold, fee gain, maximum fee, and coupled step-up/step-down limits.
Coupled fields such as trailing-window and cold-start length move together so a
case remains internally meaningful. All other controller parameters stay at the
committed Phase 5 default.

Markout-horizon cases select later prices from the same committed future-price
path and delay policy observation accordingly. The Phase 5 default remains a
one-step synthetic reference, so its generated economic results are unchanged.

The Pareto analysis minimizes benign false-positive rate and effective
detection latency while maximizing paired LP net improvement over fixed fees.
A missed detection receives a conservative latency of 241 steps. H1-H6 rules
are encoded in the generated decision manifest, and failed outcomes remain in
the report rather than triggering parameter retuning.
