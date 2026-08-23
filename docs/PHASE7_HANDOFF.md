# Phase 7 Handoff — Security and Release Hardening

## Delivered

- A documented threat model with trust boundaries, explicit failure behavior,
  required attack classes, and unresolved production risks.
- Controller update-spam protection through a per-pool configurable cooldown,
  preserving replay state across pool reconfiguration.
- Stateful controller invariants covering bounded fees, replay/auth rejection,
  sequence synchronization, directional premium requirements, and pause
  fallback.
- Boundary fuzzing for closed fee limits, out-of-range rejection,
  recommendation lifetime, and cooldown behavior.
- Gas snapshots and hard ceilings for cold/warm controller updates, fee reads,
  and the existing hook callback path.
- Opt-in origin and Reactive infrastructure fork checks with explicit skips when
  RPC configuration is absent.
- Fail-closed, non-broadcasting deployment validation for chain IDs, bytecode,
  nonzero/distinct addresses and identifiers, the pinned Reactive system
  address, and callback gas bounds.
- A versioned deployment-manifest schema and a deployment/incident runbook.
- A dependency lock/checker and a tracked-secret scanner integrated into the
  standard verification gate.

## Verification commands

```sh
make phase7-check
FOUNDRY_PROFILE=ci make verify
```

`make phase7-check` runs dependency and secret checks, stateful invariants, all
gas tests, opt-in infrastructure forks, manifest JSON validation, fail-closed
deployment tests, and the real local end-to-end lifecycle. The full CI-profile
gate increases fuzzing to 2,000 runs and invariants to 512 runs at depth 128.

Final local evidence on 2026-08-18:

- 93 Solidity tests passed and 2 infrastructure-fork tests explicitly skipped
  because RPC inputs were absent;
- all 38 Python tests passed;
- each boundary property completed 2,000 fuzz runs;
- each of 5 controller invariants completed 512 runs and 65,536 calls with zero
  handler reverts;
- controller gas measured 129,451 cold apply, 12,601 warm apply, and 5,626 warm
  fee-read gas; and
- hook operations measured 33,052 `beforeSwap` plus 47,201 warm `afterSwap`, or
  80,253 gas under the pinned local compiler profile.

The hook-gas change was regenerated through the Phase 5, Phase 6, and Phase 6.1
artifacts. It did not change the Phase 6 hypothesis decisions or the Phase 6.1
H4/H5 holdout result.

## Deployment status

No contract was deployed and no transaction was broadcast. The preflight script
is intentionally read-only. Live deployment remains Phase 8 because it requires
current infrastructure verification, production oracle selection, non-skipped
fork evidence, an exact cost estimate, and explicit approval.

## Remaining blockers before valuable use

- Independent contract/economic/infrastructure audit.
- Reviewed production reference adapter and publisher/heartbeat policy.
- Resolution of third-party licensing ambiguity described in the dependency
  review.
- Hardware-backed or multisig owner/deployer procedure.
- Live RPC fork checks and official infrastructure/address reconfirmation.
- Monitoring, alerting, callback funding policy, and incident ownership.
