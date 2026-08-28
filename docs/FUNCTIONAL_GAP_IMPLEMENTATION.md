# ThetaShield Functional Gap Programme

This programme closes the research, protocol, automation, and interface gaps
identified after the Phase 8D Circle release. It starts from revision
`e68c2aca6a31c9ae761cdf6061fa6de603fe642d` and preserves the existing live
deployment as an immutable historical acceptance trace.

## Locked architecture decisions

1. Build a coverage-ratio feedback loop before describing the controller as
   closed loop.
2. Circle CCTP V2 remains the authenticated observation and recommendation
   rail.
3. Reactive Network is the event-driven automation and resilience plane. It
   may invoke bounded permissionless work, but it cannot install or forge a
   recommendation.
4. `RESEARCH_V1` is the default deployment profile. `DEMO_V1` requires explicit
   opt-in.
5. A multi-source reference sampler is the release target. The owner-published
   mock remains a deterministic test and demo fixture.
6. Volatility and inventory premiums must pass research gates before they are
   enabled. Unsupported premium language is not a substitute for code.
7. Gap phases G0-G9 are local implementation phases. Public-chain spending is
   reserved for a separately approved G10 deployment.
8. The hook remains owner-submission gated.

## Phase gates

| Phase | Deliverable | Status |
|---|---|---|
| G0 | Verified baseline and locked decisions | Complete |
| G1 | Coverage and flow-elasticity research | Complete |
| G2 | Solidity coverage feedback loop | Complete |
| G3 | Research/demo profiles and regression gates | Complete |
| G4 | Stateless protocol lens | Complete |
| G5 | Multi-source reference sampler | Complete |
| G6 | Reactive automation contracts | Complete |
| G7 | Deterministic dashboard bundle | Pending |
| G8 | Evidence-driven dashboard and lens integration | Pending |
| G9 | Animated mechanism and LP simulator | Pending |
| G10 | V2 deployment and public acceptance | Owner-gated |

Each phase must pass its focused checks and the relevant repository regression
suite before it is committed and pushed. A later phase cannot silently weaken
an earlier phase's acceptance criteria.

## G0 baseline

The baseline was verified on 2026-08-27 with `make verify`:

- Solidity: 94 passed, 0 failed, 2 environment-gated fork tests skipped;
- research: 38 passed, 0 failed;
- deterministic Phase 1, Phase 5, Phase 6, and Phase 6.1 checks passed;
- dependency lock and secret scan passed;
- deployment manifest schema validation passed;
- dashboard lint, build, rendered-HTML tests, and production dependency audit
  passed; and
- `script/check_phase9.py` passed.

The machine-readable artifact hashes and benchmark metrics are recorded in
`research/reports/gap_g0_baseline.json`.

## G1 research gate

The sixth `coverage_thetashield` policy measures realized fee revenue against
positive directional markout loss and applies deterministic fee-elastic flow.
Its declared precision and retained-volume gates pass across 300 policy runs.
The historical Phase 5 five-policy artifacts remain unchanged. Reproduce with
`make gap-g1-check` and `make phase5-check`.

## G2 Solidity feedback loop

The Circle processor now accounts for eligible per-side epoch fee revenue and
estimated positive markout loss. `FeeCurve.calculateClosedLoop` derives a 1.25x
coverage target, ignores zero-loss, below-threshold, below-notional, and
cold-start epochs, and composes the researched coverage premium with the toxic
premium before one shared cap and rate limit. The latest accounting, ratio,
deficit, eligibility, and premium split are readable in `SideState` and emitted
by `EpochFinalized`.

The cross-language golden vectors include the closed-loop calculation. Focused
math, fuzz, processor-lifecycle, and Python↔Solidity parity checks run with
`make gap-g2-check`.

## G3 deployment profiles

`ThetaShieldProfiles` is now the single source for both processor and origin
configuration. `RESEARCH_V1` is the deployment default and carries the locked
Phase 6.1 dead band, 3-of-5 persistence, smoothing, fast path, asymmetric fee
steps, and G1/G2 coverage settings. `DEMO_V1` preserves the accelerated demo
behavior, requires explicit opt-in, and prints a warning. Both deployment
events emit the chosen profile ID, and new deployment manifests have a typed
profile field.

The processor scheduler is readable after deployment. `ConfigMirrorTest`
prevents fee bounds, confidence units, recommendation lifetime, and cadence
from drifting across chains. A real-v4 research-profile regression runs seven
epochs: benign noise never leaves baseline, while persistent informed flow
activates the confidence-gated fast path and 3-of-5 persistence only for the
affected swap direction. Reproduce with `make gap-g3-check`.

## G4 stateless protocol lens

`ThetaShieldLens` provides three permissionless, structured reads without
holding protocol state or receiving administrative authority:

- the origin pool snapshot combines both directional effective fees, fallback
  flags, recommendation sequence and validity, confidence, global/pool pauses,
  hook observation count, and the configured baseline;
- the processor snapshot combines queue and settlement counters, both side
  states (including closed-loop coverage), both effective fees, source count,
  and the complete scheduler and fee-curve configurations; and
- the reference-source snapshot exposes source registration, replay sequence,
  ring-buffer position, and its bounded reference history.

Focused tests cover active and paused origin fees, validity countdown,
observation count, processor configuration mirroring, cold-start coverage, and
reference history. Reproduce with `make gap-g4-check`.

## G5 multi-source reference sampler

`PoolMedianReferenceSampler` is a permissionless, ownerless adapter over a
bounded set of Uniswap v4 pool IDs. Every sampling call reads `sqrtPriceX96` and
active liquidity through `StateLibrary`, rejects pools below their individual
liquidity floors, normalizes quote-per-base prices across token decimals and
orientation, and publishes a distinct monotonic reading per source. The Circle
processor remains unchanged: its existing per-source histories, robust median,
dispersion rejection, and confidence calculation consume the readings.

`RESEARCH_V1` now requires three sources and permits full confidence only after
multi-source agreement. Its deployment path creates a three-pool sampler;
`DEMO_V1` alone retains the owner-published mock. The acceptance script has
separate research entry points that sample and sync all three sources. Focused
tests cover permissionless publication, liquidity rejection, normalization,
duplicate protection, and direct three-source processor consumption. Reproduce
with `make gap-g5-check`.

## G6 Reactive automation and resilience plane

`ThetaShieldAutomationRSC` subscribes to processor observation-queue events,
authenticated automation-cycle receipts, and Reactive Network CRON. It arms
work at the on-chain maturity timestamp, requests one bounded callback, follows
with epoch finalization, and applies a capped retry policy when references or
processing are not ready. It never calculates or transports a recommendation.

`ThetaShieldAutomationExecutor` is the processor-chain callback target. One
cycle samples the sealed three-pool feed, syncs the configured sources, and
calls the existing bounded processor. Reactive callbacks authenticate the
callback proxy and injected RVM identity. The same cycle remains permissionless
for independent keepers, so automation failure degrades liveness rather than
fee safety. Circle alone remains able to authenticate observations and returned
recommendations.

The official Reactive libraries and simulator are pinned. Full-lifecycle tests
cover exact subscriptions, maturity suppression, RVM-authenticated callbacks,
three-source settlement, epoch finalization, permissionless fallback, and
bounded retry. Reproduce with `make gap-g6-check`.

## Release boundary

The existing Phase 8D contracts and receipts remain evidence for the original
single-source Circle demo profile. They are not modified in place. Any contract
whose configuration or sealed peer changes will receive a new V2 address and a
new manifest during G10.
