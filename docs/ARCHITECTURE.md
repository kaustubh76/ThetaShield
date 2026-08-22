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
