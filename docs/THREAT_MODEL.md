# Threat Model

## Scope and safety objective

This review covers the origin-chain hook and controller, Reactive scheduler,
reference-event ingestion, callback path, deployment configuration, and pinned
build inputs. The safety objective is deliberately narrow: an invalid,
untrusted, stale, or unavailable recommendation must not cause an unbounded fee.
The safe response is rejection or the configured baseline fee.

ThetaShield is still unaudited research software. This document does not assert
production safety.

## Assets and trust boundaries

- LP execution quality and the per-pool fee bounds are the primary assets.
- The Uniswap v4 `PoolManager` is trusted to invoke hook callbacks and report
  pool state correctly.
- The origin callback proxy is trusted only as a transport. The controller also
  requires the configured RVM identifier and monotonic sequence.
- Reactive Network's system contract and event-delivery semantics are an
  infrastructure trust boundary.
- Every configured reference publisher is trusted to report its own source
  honestly. Multiple sources, confidence weighting, and dispersion reduce but
  do not eliminate coordinated oracle manipulation.
- The two-step owner can configure pools and pause the controller. Compromise of
  that key can change safety parameters inside their hard protocol bounds.
- RPC providers, deployer credentials, explorer APIs, CI actions, and Git
  dependencies are release-process trust boundaries.

## Threats and controls

| Threat | Control | Verification |
|---|---|---|
| Direct hook spoofing | Base hook accepts calls only from its immutable `PoolManager`; only dynamic-fee pools are supported. | Hook integration and end-to-end tests |
| Callback sender spoofing | Controller requires the immutable callback proxy. | Controller unit and invariant tests |
| Wrong RVM or target | Controller requires an immutable RVM ID; preflight requires nonzero, distinct, code-bearing infrastructure addresses. | Controller and deployment-validation tests |
| Replay or out-of-order delivery | Hook observations, reference sources, and controller callbacks each use monotonic sequences. | Unit, integration, invariant, and end-to-end replay tests |
| Future, stale, or malformed timestamps | Reactive input permits only bounded future skew; settlement uses a fixed eligibility window; controller rejects future, expired, malformed, and overlong recommendations. | Scheduler and controller tests |
| Fee or risk manipulation | Per-pool minimum, baseline, and maximum fees; global one-million-pip ceiling; absolute risk cap; premium requires positive directional risk and enough confidence. | Boundary fuzz, unit, and invariant tests |
| Update spam or gas griefing | Per-pool configurable recommendation cooldown, bounded pending queue, bounded reference history, bounded epoch size, and bounded work per Cron call. Full queues drop with an event instead of growing storage. | Cooldown fuzz/unit tests, bounded-processing integration tests, gas snapshots |
| Tiny or malformed swaps | Zero-sided and same-sign deltas are rejected or ignored; conversion inputs and markout magnitude are bounded. | Scheduler integration and math fuzz tests |
| Oversized event payloads | Exact topic and ABI data lengths, packed-type bounds, configured emitter, chain, pool, market, and source checks. | Reactive invalid-log tests |
| Oracle staleness | References must fall inside the observation-specific maturity/selection interval and cannot be from the future; observations expire without an eligible reference. | Reactive maturity and expiry tests |
| Oracle disagreement | A confidence-weighted median is used and normalized dispersion reduces confidence. Source count and history are bounded. | Math vectors and Reactive multi-source tests |
| Cold-start overreaction | A configured cold-start sigma and minimum trailing sample count suppress premature premium; the optional fast path has explicit confidence/notional/risk gates and a bounded hold. | Phase 6.1 tests and holdout evidence |
| Missing or low-confidence recommendation | Hook/controller select the baseline on missing, paused, expired, not-yet-valid, or low-confidence state. | Controller, hook, and end-to-end tests |
| Wrong-chain deployment | Read-only preflight compares the actual and expected chain IDs and checks infrastructure bytecode. Reactive system address is pinned. | Deployment-validation and opt-in fork tests |
| Dependency substitution | Git submodule commits, compiler, CI toolchains, and Actions SHAs are recorded and mechanically checked. | `make dependency-check` |
| Secret disclosure | Credential-like tracked files and common token/private-key patterns fail the repository gate. | `make secret-check` |

## Failure behavior

The origin fee path fails closed to baseline for missing, paused, expired,
not-yet-valid, or insufficient-confidence state. Auth, bounds, replay, cooldown,
and malformed-message failures revert without advancing the accepted sequence.
The Reactive scheduler expires or explicitly drops observations when it cannot
process them safely. A full callback outage therefore freezes recommendations
until they expire, after which swaps use the baseline.

## Residual risk and release blockers

- `MockNormalizedReferencePriceFeed` is owner-published and explicitly not a
  production oracle. A reviewed production adapter and publisher policy are
  mandatory before a valuable deployment.
- There has been no independent smart-contract, economic, or infrastructure
  audit. Local tests cannot prove absence of vulnerabilities.
- Reactive Network behavior and official addresses must be revalidated on live
  RPC endpoints immediately before deployment.
- Multi-source aggregation does not protect against coordinated publishers or a
  compromised feed contract.
- A controller owner can pause or reconfigure pools. Production ownership needs
  a hardware-backed or multisig policy plus an incident procedure.
- Gas snapshots are local estimates, not guarantees of live callback execution.
- The project has no live monitoring, alerting, or automated incident response
  yet; those remain Phase 8/9 work.
