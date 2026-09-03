# ThetaShield Final Research Report

## Executive summary

ThetaShield is a directional adaptive-fee Uniswap v4 hook. It observes swaps,
waits for delayed price evidence, computes signed markout against strictly
trailing volatility, requires persistent evidence, and returns separate fees
for the two directions.

The active cross-chain implementation uses Circle CCTP V2 generic messages
between Unichain Sepolia and an Ethereum Sepolia processor. Circle authenticates
transport; permissionless relayers deliver attestations. The live G10 release uses
Reactive Legacy Lasna as the event-driven scheduler for bounded Ethereum
processor work, with an independent keeper fallback. The failed Omni direct
callback path remains retired.

A complete live testnet deployment and G10 lifecycle is recorded from source revision
`4b3aff6247349a581275839f280d9902de3ceccd`. That revision predates a rebase of
`main` and is preserved on the `backup-pre-rebase` branch. The hook, transport, controller,
and origin Lens run on Unichain Sepolia; the three-pool sampler, bounded
processor, processor Lens, and callback executor run on Ethereum Sepolia; and
the event-driven scheduler runs on Reactive Legacy Lasna. Finalized Circle
messages crossed both directions, Reactive produced both authenticated delayed
callbacks, and a later PoolManager swap matched the controller's expected fee.
The hook has not been submitted.

## Delivered implementation

- real Uniswap v4 dynamic-fee hook with fail-open observation transport;
- Circle origin transport and one-time sealed peer;
- bounded delayed processor with fixed queues, histories, epochs, sources, and
  work per permissionless call;
- Circle-authenticated controller with domain/peer/finality, replay, time,
  confidence, fee, and risk checks;
- real local PoolManager → Circle observation → delayed processor → Circle
  recommendation → later PoolManager fee lifecycle;
- Circle-specific preflight, deployment, attestation fetch, relay, peer sealing,
  fork checks, and bounded acceptance tools;
- pinned Reactive Legacy infrastructure, funded deploy paths, read-only
  preflight, deployed authenticated scheduler/executor contracts, public
  callback receipts, and lifecycle tests;
- Python reference model, shared golden vectors, deterministic experiments,
  dashboard, threat model, and draft submission; and
- pinned dependencies, secret checks, fuzzing, invariants, gas ceilings, and
  reproducibility gates.

## Research evidence

The Phase 5/6/6.1 research compares fixed, volatility-only, raw markout,
dead-band, and full ThetaShield policies on shared synthetic streams. The
original Phase 6 result passed H1, H2, H3, and H6 and failed H4/H5. The failures
remain recorded. A separate versioned train/holdout remediation passes the
declared H4 criterion with rank correlation `-0.727` and six Pareto points, and
passes H5 with `59.70%` retained toxic coverage plus a `20.79` percentage-point
false-positive reduction.

There are 48 Python tests. Solidity unit, fuzz, invariant, gas,
deployment, and integration suites verify the current Circle implementation.
The Legacy automation suite uses the official release CRON topic and rejects a
mixed Omni/Legacy deployment configuration.
Exact discovered/pass/skip counts should be taken from the current `make verify`
receipt rather than copied into a submission.

`notional × signed markout` is a controlled risk proxy. It is not exact LP loss,
LVR, profit, or evidence of live user behavior.

The live reference market is not independent evidence either. Its three sources
are three fee tiers of one project-issued pair on Ethereum Sepolia; the
protected pool is a different pair on Unichain Sepolia, with no bridge and no
arbitrage path between them, and all three tiers are moved together by our own
acceptance script. Live markout therefore demonstrates the mechanism rather
than measuring adverse selection.

## Security and release boundary

Missing or invalid recommendations return the baseline. Circle recipients
authenticate the local transmitter, source domain, sealed peer, and finalized
threshold before processing. Replay, expiry, future time, cooldown, fee, risk,
confidence, queue, history, source, and processing bounds constrain state.
Reactive callbacks authenticate both the official destination proxy and the
deployer-derived ReactVM identity; their executor cannot forge Circle evidence
or install controller state.

The remaining blockers for anything beyond a testnet demo are a production
oracle adapter, independent audits, monitored redundant keepers, hardware-backed
or multisig ownership, and incident response. The public Phase 8D Circle trace
remains historical evidence. The G10 Circle + Reactive Legacy trace is complete
and linked from the live deployment manifest; its idle Cron credit must be
monitored and replenished as an operational liveness requirement.

## Reproduce

```sh
git clone --recurse-submodules git@github.com:kaustubh76/ThetaShield.git
cd ThetaShield
make verify
```

See `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`,
`docs/DEPLOYMENT_RUNBOOK.md`, `docs/CIRCLE_MIGRATION.md`, and
`docs/REACTIVE_LEGACY_MIGRATION.md`.
