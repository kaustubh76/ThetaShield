# Changelog

All notable changes to ThetaShield. Versions follow [semantic versioning](https://semver.org).

## [v1.0.0-uhi10] — 2026-09-03

The Uniswap Hook Incubator cohort 10 submission, entered for the Circle and
Reactive Network tracks. Deployed and driveable on public testnets; unaudited
research software, testnet only.

### The mechanism

- A Uniswap v4 hook that separates persistent directional adverse selection from
  ordinary volatility, and raises only the fee direction that delayed evidence
  supports. `RESEARCH_V1` parameters, 5.00 bps baseline.
- Evidence travels over Circle CCTP V2 and is scored on a second chain, so the
  fee decision is made against outcomes the origin chain cannot yet see. Circle
  authenticates the message; it does not compute the fee.
- A Reactive Network RSC schedules the work at on-chain maturity and wakes a
  bounded executor through an authenticated callback. It decides *when* eligible
  work runs; it cannot forge evidence or compute a fee. A permissionless keeper
  remains available as a recovery path.
- The risk metric is a directional adverse-selection proxy. It is not LVR and it
  is not a measurement of LP loss.

### Proven on testnet

- Live across Unichain Sepolia, Ethereum Sepolia, and Reactive Legacy Lasna,
  with a six-transaction acceptance trail whose intervals are read back from the
  blocks themselves: 43m 12s end to end, Circle out 23m 54s, the scheduler's own
  wake 36s.
- Both automation callbacks authenticated through the official Reactive Legacy
  callback proxy; neither used the keeper fallback.
- The first live recommendation correctly held the safe baseline, because one
  sample carries zero cold-start confidence. The non-baseline directional
  transition is proven in the lifecycle test suite, not yet in a second public
  live cycle.

### Dashboard

- A live proof page reading deployed contracts on every refresh, with an
  execution log listing every observation the processor has queued and every
  automation cycle it has run, rebuilt from the contracts' own events.
- A run console that drives the loop from the browser against the live testnets,
  bounded by chain-derived guards: fixed swap arguments, one run in flight,
  cooldowns, a fee ceiling, and balance floors the endpoint refuses to spend
  below.
- Cross-plane authentication checked rather than asserted: five terms compared
  in both directions, including the processor the scheduler names and the cron
  topic it subscribes to, read inside the ReactiveVM.

### Verification

- 127 Solidity tests including five invariants; `make verify` runs 19 gates
  covering formatting, lint, research-artifact hashes, dependency pinning,
  secret scanning, deployment-manifest schema and mirroring, and the dashboard
  suite.
- Deployment manifest mirrored byte-identically into the dashboard and
  gate-checked, so the page cannot describe a deployment that is not the one
  recorded.

### Known boundaries

- Contracts are not explorer-source-verified (`verified: false` throughout);
  on-chain runtime and configuration checks are documented instead.
- The hook is not submitted to any registry.
- Open design decisions are recorded at the end of `docs/SECOND_PASS_REVIEW.md`.
