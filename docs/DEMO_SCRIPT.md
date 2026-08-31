# ThetaShield Demo Script

Target: 3–4 minutes. Dashboard scenario cards are simulated, not live telemetry.

## Problem and mechanism

“Volatility is not always toxic, and toxicity is often directional. ThetaShield
uses delayed signed markout to distinguish persistent adverse selection from
ordinary noise.”

Show the two directional fees and explain trailing volatility, signed soft
thresholding, confidence, and `n-of-k` persistence. Stale or invalid state falls
back to the baseline.

## Circle lifecycle

“The Unichain v4 hook applies the fee and sends a compact observation through
finalized Circle CCTP. A permissionless keeper relays it to an Ethereum Sepolia
processor. After delayed reference evidence matures, the processor sends a
sequenced recommendation back through Circle. The Unichain controller accepts
only the configured transmitter, domain, sealed processor, and bounded data.”

Clarify that Circle authenticates transport but does not schedule delayed work.

## Reactive automation

“Reactive Network is the scheduling plane. Its RSC watches the authenticated
processor queue and a cron topic, waits for the markout horizon, and issues
bounded wake-ups; the official callback proxy delivers them to our executor on
Ethereum Sepolia. Both G10 wakes produced public authenticated callbacks.”

State the boundary: Reactive schedules, Circle authenticates, neither computes a
fee. Independent keepers can call the same bounded executor, so a Reactive
outage degrades automation without stopping swaps or forging a recommendation.

The dashboard reads the RSC's own counters from the deployer's ReactiveVM, so
the wake and cycle counts on the page are the RSC's state, not a chain-side copy.

## Signal lab

Show benign noise, mixed volatility, informed buying, and informed selling.
State: “These cards are illustrative simulations using documented protocol
units and direction rules, not live chain telemetry.”

## Honest evidence

The original study passed H1/H2/H3/H6 and failed H4/H5. The versioned,
train/holdout remediation reached H4 correlation `-0.727` and retained `59.70%`
toxic coverage for H5 while reducing false positives by `20.79` percentage
points. These are deterministic synthetic results, not profit claims.

## Release boundary

"The real public-testnet PoolManager-to-Circle-to-processor-to-Circle-to-
controller lifecycle passes, including a later swap whose PoolManager fee
matched the controller. The contracts are unaudited and the hook has not been
submitted. The RESEARCH_V1 release path reads a permissionless, liquidity-filtered
three-pool median sampler — but that reference market is a self-contained
project-issued pair moved by the operator, so live markout demonstrates the
mechanism rather than measuring real adverse selection."

Optional proof:

```sh
make verify
```
