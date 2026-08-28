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
| G7 | Deterministic dashboard bundle | Complete |
| G8 | Evidence-driven dashboard and lens integration | Complete |
| G9 | Animated mechanism and LP simulator | Complete |
| G9.1 | Reactive Legacy Lasna release hardening | Complete |
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

## G9.1 Reactive Legacy release hardening

The G10 automation route is explicitly pinned to Legacy Lasna after Reactive
Network support advised using Legacy instead of Omni. `ReactiveLegacy` owns the
official chain, system contract/runtime hash, Ethereum Sepolia callback proxy,
and CRON topics. The release cadence is the official `Cron10`; the test suite no
longer relies on the third-party simulator's placeholder CRON constants.

Both deploy scripts now fail closed on a mixed Omni/Legacy environment, wrong
chain or callback proxy, wrong system bytecode, wrong CRON topic, or zero
initial callback funding. The executor accepts its reviewed Sepolia reserve in
the constructor and exposes the authenticated callback proxy and ReactVM ID for
post-deployment verification. A read-only two-network preflight, migration
record, manifest fields, and acceptance procedure make one real Legacy callback
receipt mandatory before the automation lane can be marked publicly proven.
Reproduce with `make reactive-legacy-check`.

## G7 deterministic dashboard bundle

`research/reports/dashboard_bundle.json` is the dashboard's checked evidence
boundary. It content-addresses its source artifacts and exports the complete
Phase 5 pooled metrics and per-scenario LP outcomes, the unchanged H1-H6
decisions, the Phase 6.1 H4/H5 training and holdout table, and the G1
closed-loop gates. Four deterministic scenario traces expose directional fees,
delayed markout evidence, sigma dead bands, persistence, confidence, and
simulated delivery events at every step.

The bundle carries an explicit synthetic-evidence boundary: its transport trace
is not presented as a Circle attestation or Reactive callback receipt. Generation
is byte-for-byte deterministic, source hashes are verified, and stale output
fails both `make gap-g7-check` and the repository-wide `make verify` gate.

## G8 evidence-driven dashboard and lens integration

The dashboard imports a byte-identical, generator-checked in-root mirror of the
G7 bundle on the server and passes only a compact view to the interactive client.
This preserves Vercel project-root isolation without creating a second editable
data source. Scenario cards, policy means, H1-H6 decisions,
H4/H5 holdout figures, calibration spread, research scope, and controller
parameters no longer live in hand-maintained UI arrays. The original H4/H5
failures remain visible beside the disjoint holdout passes. A three-band trust
surface separates executable local proof, controlled simulation, and the
historical public demo boundary.

The live API supports paired origin/processor `ThetaShieldLens` addresses and
fails closed if only one is configured. Because the public Phase 8D contracts
predate G4, the current UI explicitly labels its direct-getter fallback instead
of claiming a lens read. An owner-approved G10 V2 deployment can switch both
chains to stateless lens aggregation through environment configuration without
changing the page. Dashboard source checks reject the deleted hardcoded research
arrays and the production gate exercises both server-rendered evidence and the
lens-aware API boundary.

## G9 animated mechanism and LP-benefit simulator

The dashboard now animates the complete delayed control loop from the Uniswap
v4 swap through Circle dispatch and attestation, the bounded Ethereum
processor, Reactive Network event/cron automation, delayed reference evidence,
signed markout, trailing dead band, epoch persistence, fee calculation, Circle
return, controller validation, and the later directional fee. A shared failure
selector exposes the safe result of a CCTP outage, stale reference,
out-of-order recommendation, and full queue. The UI names the otherwise easy
to-miss `ObservationTransportFailed`, `DropReason.Capacity`, and
`DropReason.EpochCapacity` surfaces.

The LP-benefit replay console covers all 15 Phase 5 scenarios and five policies.
It renders compact deterministic directional-fee traces, benign-versus-toxic
fees, precision/recall, inventory PnL at its true scale, a paired policy zoom,
simulated transport delivery, and the G1 volume-retention result. Dead-band,
persistence, EWMA alpha, and maximum-fee selectors map only to exact Phase 6
one-factor cases; the interface explicitly refuses to present untested parameter
combinations as measured evidence. The generator checks both bundle copies,
and the dashboard regression gate verifies the full G9 surface.

## Release boundary

The existing Phase 8D contracts and receipts remain evidence for the original
single-source Circle demo profile. They are not modified in place. G10's code
path now deploys a new origin Lens and a nonce-consistent Ethereum stack with a
self-contained three-tier v4 reference market, sampler, processor, processor
Lens, and Legacy callback executor. `make gap-g10-check` verifies those release
components locally. New V2 addresses, the Legacy RSC, a fresh manifest, and the
public acceptance trace remain paid owner-gated actions; the repository does
not claim they exist before their receipts are recorded.
