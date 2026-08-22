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
