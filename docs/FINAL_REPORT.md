# ThetaShield Final Research Report

## Executive summary

ThetaShield is a directional adaptive-fee Uniswap v4 hook. It observes swaps,
waits for delayed price evidence, computes signed markout against strictly
trailing volatility, requires persistent evidence, and returns separate fees
for the two directions.

The active cross-chain implementation uses Circle CCTP V2 generic messages
between Unichain Sepolia and an Ethereum Sepolia processor. Circle authenticates
transport; a permissionless keeper relays attestations and advances bounded
work. Reactive/Lasna is retired from the deployable path.

A complete live testnet deployment and Circle acceptance lifecycle is recorded
from source revision `7dcaadad351b238a64133f053f195e11d9a2ef71`. The hook,
transport, controller, demo pool, and tokens run on Unichain Sepolia; the demo
feed and bounded processor run on Ethereum Sepolia. Finalized observations and
a sequenced recommendation crossed both directions, and a later PoolManager
swap matched the controller's expected fee. The hook has not been submitted.

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

There are 38 Python research tests. Solidity unit, fuzz, invariant, gas,
deployment, and integration suites verify the current Circle implementation.
Exact discovered/pass/skip counts should be taken from the current `make verify`
receipt rather than copied into a submission.

`notional × signed markout` is a controlled risk proxy. It is not exact LP loss,
LVR, profit, or evidence of live user behavior.

## Security and release boundary

Missing or invalid recommendations return the baseline. Circle recipients
authenticate the local transmitter, source domain, sealed peer, and finalized
threshold before processing. Replay, expiry, future time, cooldown, fee, risk,
confidence, queue, history, source, and processing bounds constrain state.

The remaining blockers for anything beyond a testnet demo are an external
oracle adapter, independent audits, monitored redundant keepers, hardware-backed
or multisig ownership, and incident response. The public two-chain acceptance
trace itself is complete and linked from `docs/PHASE8D_HANDOFF.md`.

## Reproduce

```sh
git clone --recurse-submodules git@github.com:RudraBhaskar9439/ThetaShield.git
cd ThetaShield
make verify
```

See `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`,
`docs/DEPLOYMENT_RUNBOOK.md`, `docs/CIRCLE_MIGRATION.md`, and
`docs/PHASE8D_HANDOFF.md`.
