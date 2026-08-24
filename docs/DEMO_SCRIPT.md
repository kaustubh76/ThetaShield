# ThetaShield Demo Script

Target length: 3–4 minutes. The demo uses the dashboard and local evidence. It
does not represent simulated cards as live chain state.

## 0:00–0:30 — Problem

Open the dashboard hero.

“Most dynamic fees react to volatility. But volatility is not always toxic,
and toxicity is often directional. ThetaShield asks whether delayed signed
markout can protect LPs from persistent adverse selection without taxing
ordinary noise.”

Point to the four distinctions: trailing, persistent, directional, autonomous.

## 0:30–1:10 — Mechanism

Scroll to “One swap. Delayed truth.”

“The Uniswap v4 hook applies the current directional fee and emits an
observation. Reactive waits for delayed reference evidence. The controller
filters the signed markout through a trailing dead band that excludes the
current sample, then requires persistence and mechanical confidence before it
changes either directional fee.”

Emphasize that stale or invalid recommendations fall back to baseline.

## 1:10–2:05 — Interactive signal lab

Open each scenario in order:

1. Benign noise: both fees remain at 5 bps.
2. Mixed volatility: movement is large but direction is inconsistent, so the
   signal is rejected.
3. Informed buying: the buy-base side rises to 10 bps while the opposite side
   remains at baseline.
4. Informed selling: the premium rotates to the sell-base side.

Say explicitly: “These cards are illustrative simulations using the protocol's
documented units and direction rules, not live chain telemetry.”

## 2:05–2:50 — Evidence and honest failures

Scroll to H1–H6 and the green holdout panel.

“The first sensitivity study passed H1, H2, H3, and H6, but failed H4 and H5.
We kept those failures. A versioned remediation added harder benign challenges
and a bounded confidence-gated fast path, selected on training streams only.
On five disjoint holdout seeds, H4 reached a -0.727 trade-off correlation with
six Pareto points, and H5 retained 59.70% toxic coverage while reducing false
positives by 20.79 percentage points.”

Add: “This is deterministic synthetic evidence, not a profitability claim.”

## 2:50–3:25 — System and release boundary

Scroll to the autonomous system and release boundary.

“The local lifecycle is complete: PoolManager, hook observation, delayed
Reactive processing, authenticated callback, and later fee application. The
release gate passes 99 Solidity and 38 Python tests, plus fuzzing, invariants,
gas ceilings, dependency checks, and reproducible research artifacts.”

“The contracts remain unaudited and the live Phase 8 acceptance is still open.
We will not call deployment complete until the origin and callback transaction
hashes are confirmed and recorded.”

## Optional terminal proof

```sh
FOUNDRY_PROFILE=ci make verify
```

For a shorter proof, use:

```sh
make phase9-check
```
