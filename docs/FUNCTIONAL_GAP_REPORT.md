> **Superseded by [SECOND_PASS_REVIEW.md](SECOND_PASS_REVIEW.md).** Every gap below was closed by the G0-G10 programme.

# ThetaShield — Functional Gap Report & Immersion Plan

> Scope: functionality only. Build, toolchain, and documentation-hygiene items are
> deliberately excluded. Reviewed against `main` at commit `7dcaada`
> ("feat: complete Circle release hardening"). Every figure is sourced from
> `research/reports/phase5_summary.json` or a named source file.

## Context

The project brief describes a **closed-loop risk controller**: fee revenue measured
against estimated LVR each epoch, a `CoverageRatio` driving a
`CoverageDeficitPremium`, a three-pool median reference sampler, a read-only lens
feeding a dashboard, and Reactive Network as the control plane.

The code implements an **open-loop directional markout filter**. It is well built —
2,961 lines of Solidity, a real bounded processor, a real Uniswap v4 end-to-end
lifecycle test, no TODOs and no stubbed reverts. But five functional pieces of the
pitch were never built, and one shipped inverted. This report covers only those,
plus the interface work needed to make the research legible and the diagrams live.

---

## F1 — The closed loop does not exist (highest impact)

A grep across all of `src/` returns **zero** hits for `coverage`, `lvr`,
`feeRevenue`, `revenue`, `inventory`, and `volatilityPremium`. (The word "coverage"
in [`research/thetashield/sensitivity.py:55`](../research/thetashield/sensitivity.py)
means *detection recall* — an unrelated metric.)

Brief §7.5 specifies five premium terms.
[`FeeCurve.calculate`](../src/libraries/FeeCurve.sol#L44-L54) has one:

```
premium = |signedRisk| * gainFeePips / WAD
target  = clamp(baseFee + premium, min, max)
next    = rateLimit(previous, target)
```

| Brief §7.5 term | Built? |
| --- | --- |
| Base fee | Yes — `baseFeePips` |
| Volatility premium | **No** — σ sizes the dead band only; it never raises the fee |
| Toxic-flow premium (directional EWMA) | Yes — this is the `gain × risk` term |
| Coverage-deficit premium | **No** |
| Inventory premium | **No** |

The controller reacts to markout but never learns whether the fee it charged was
*sufficient*. That feedback is the entire answer to "isn't this just another
dynamic-fee hook?" (brief §6, §20).

### What to build

The processor already carries everything required — each `Observation` has
`notionalWad` and `appliedFeePips`, and `_settleObservation` computes `markoutWad`.
Add to `SideState`:

```solidity
uint128 epochFeeRevenueWad;    // += notionalWad * appliedFeePips / FEE_PIPS
uint128 epochEstimatedLossWad; // += notionalWad * max(markoutWad, 0) / WAD
```

Accumulate in
[`_settleObservation`](../src/circle/ThetaShieldCircleProcessor.sol#L492) and read in
[`_finalizeSide`](../src/circle/ThetaShieldCircleProcessor.sol#L654):

```
coverageRatioWad = feeRevenue * WAD / max(estimatedLoss, EPSILON)
deficitWad       = max(targetCoverageWad - coverageRatioWad, 0)
coveragePremium  = deficitWad * coverageGainFeePips / WAD
```

Add `coverageGainFeePips` and `targetCoverageWad` (brief suggests 125%) to
`FeeCurve.Config`, and carry `coverageRatioWad` into `EpochFinalized` so the
dashboard can plot it.

**Gate this on research first.** The current false-positive rate of **0.0770** is the
project's strongest result. A coverage term that fires during benign epochs — when
`estimatedLoss ≈ 0` and the ratio explodes — would destroy it. The
`max(estimatedLoss, EPSILON)` floor and a `meetsMinimumEpochNotional` guard are
load-bearing, not defensive. Model it in
[`research/thetashield/policies.py`](../research/thetashield/policies.py) as a sixth
policy and confirm the false-positive rate holds before touching Solidity.

**If it is not built, retire the language.** "Closed-loop controller" in the pitch
against an open-loop implementation is the one claim a reviewer can falsify in
thirty seconds.

---

## F2 — Reference price: one owner-published mock, not a three-source median

Brief §7.2 and §9.4 specify `MedianReferenceSampler.sol` reading three fee-tier
pools with liquidity floors, dispersion rejection, and confidence derived from
dispersion.

What exists:

- [`MockNormalizedReferencePriceFeed`](../src/feeds/MockNormalizedReferencePriceFeed.sol)
  is an **owner-published** feed; `publish()` is `onlyOwner`. Its own natspec reads
  *"not decentralized or production-safe."*
- It is deployed by the **real** deployment script
  ([`DeployCircleProcessor.s.sol:32`](../script/DeployCircleProcessor.s.sol)) and baked
  into the processor's **immutable** `NetworkConfig`. There is no setter, so
  replacing the feed requires redeploying the processor.
- The same script configures **one** source, with `minimumReferenceSources: 1`.
- `MedianReferenceSampler.sol` was never written. `src/feeds/adapters/` holds only a
  `.gitkeep`. [`IReferencePriceAdapter`](../src/interfaces/IReferencePriceAdapter.sol)
  has zero implementers. [`ReferencePriceNormalizer`](../src/libraries/ReferencePriceNormalizer.sol)
  (decimal handling) is referenced only by its own unit test.

The consequence is functional rather than cosmetic. `ReferencePriceDispersion`
supports 16 sources and computes a weighted median plus weighted MAD, but with one
source the median *is* that source, dispersion is zero, and agreement scoring is
degenerate. `confidenceCapWad: 0.6e18` *(shipped `RESEARCH_V1` now sets `1e18`)* correctly prevents a single source from
reaching full confidence — but it also means **confidence can never exceed 60%**,
against a `confidenceFloorWad` of `0.5e18`. The system runs permanently inside a
ten-point confidence band with no headroom.

### What to build

`src/feeds/PoolMedianReferenceSampler.sol` implementing
`INormalizedReferencePriceFeed`:

- Read `sqrtPriceX96` from N configured pools for the same pair via `StateLibrary`
  (already imported by the hook).
- Normalize to quote-per-base WAD using the existing `ReferencePriceNormalizer.toWad`
  — this is what that library was written for.
- Reject any pool below a configured liquidity floor.
- Emit one `ReferencePricePublished` per source with a distinct `sourceId`, so the
  processor's existing multi-source path lights up unchanged.

The processor needs **no changes**: it already iterates `_referenceSources`, keeps a
per-source ring buffer, and selects the earliest post-maturity reading per source.
Then raise `minimumReferenceSources` to 2–3 and raise `confidenceCapWad`.

Keep the mock feed for local tests and the demo profile. The point is that a real
option exists and the deployment can choose it.

---

## F3 — The deployment ships with the thesis switched off

[`DeployCircleProcessor.s.sol:78-110`](../script/DeployCircleProcessor.s.sol) is step 3
of the live-deployment runbook. Its `_schedulerConfig()`:

| Parameter | Deploy script | Phase 5 research | Phase 6.1 selected | Functional effect |
| --- | --- | --- | --- | --- |
| `deadBandKWad` | **0** | 1.5e18 | 1.0e18 | **noise filter off** |
| `requiredToxicEpochs` / `persistenceWindow` | **1 / 1** | 3 / 5 | 3 / 5 | **persistence off** |
| `alphaWad` | **1e18** | 0.25e18 | 0.25e18 | **EWMA smoothing off** |
| `fastPathEnabled` | **false** | false | **true** | 6.1 remediation off |
| `minimumTrailingObservations` | 1 | 32 | 16 | no warm-up |
| `minimumEpochNotionalWad` | **1 wei** | 8e18 | 8e18 | notional gate off |
| `maximumIncrease/DecreasePips` | 2000 / 2000 | 1000 / 500 | 500 / 100 | 4× the researched step |

With `deadBandKWad: 0`, `DeadBandFilter.filter` returns the raw markout unchanged.
With `persistenceWindow: 1`, `PersistenceWindow.isActive` is true after a single
toxic epoch. With `alphaWad: 1e18`, the EWMA reduces to `|current|`. **One adverse
swap raises the fee** — which is precisely the behaviour of the
`raw_positive_markout` baseline the research programme exists to beat (false-positive
rate 0.3385 against ThetaShield's 0.0770).

The configuration is tagged
`DEMO_PROFILE_ID = keccak256("THETASHIELD_CIRCLE_SINGLE_SOURCE_TESTNET_DEMO_V1")` and
emitted in an event, but that constant appears **nowhere** in `docs/`, `README.md`,
or `script/README.md`. Meanwhile `dashboard/app/page.tsx` renders a persistence
bitmap of `[1,0,1,1,0]` and the copy "3 / 5 toxic epochs".

### What to build

`script/profiles/ThetaShieldProfiles.sol` exporting two named profiles:

- **`RESEARCH_V1`** — Phase 6.1 selected: trailing 16, `deadBandKWad` 1.0e18,
  3-of-5 persistence, `fastPathEnabled: true` with a 0.5e18 floor and 7.5 bp
  threshold, `alphaWad` 0.25e18, +500/−100 fee steps.
- **`DEMO_V1`** — the current values, for a testnet demo that genuinely cannot wait
  five epochs.

Selected by `THETASHIELD_PROFILE`, **defaulting to `RESEARCH_V1`**, with `DEMO_V1`
requiring explicit opt-in and logging a warning. Record the profile id in the
deployment manifest — `schema_version` 3 already has room.

Two functional prerequisites:

- **`schedulerConfig` is `private` with no getter**
  ([`ThetaShieldCircleProcessor.sol:158`](../src/circle/ThetaShieldCircleProcessor.sol#L158)).
  Once deployed, **nobody can read which profile is running** — not the dashboard,
  not an auditor. Add a getter.
- **The origin/processor configuration coupling is unenforced.** Six values must
  match across two chains: fee `min`/`base`/`max`,
  `confidenceFloorBps × 1e14 == confidenceFloorWad`,
  `recommendationLifetime ≤ maximumRecommendationLifetime`, and the dispatch cadence
  against `minimumRecommendationInterval`. They currently do match
  (500/500/10000; 5000 bps ≡ 0.5e18; 3600 ≤ 7200) — by hand, with no test. A mismatch
  makes `_applyRecommendation` revert on **every** message forever, leaving the pool
  silently at baseline with only revert events on the destination chain. Add
  `test/integration/ConfigMirror.t.sol` asserting the coupling from the shared
  profile library.

---

## F4 — No lens: protocol state is not readable

Brief §9.6 specifies `ThetaShieldLens.sol` and states that *"the dashboard should
read from this lens rather than reconstructing protocol state independently."* It was
never built — which is exactly why `dashboard/app/page.tsx` consists of three
hardcoded arrays.

### What to build

`src/lens/ThetaShieldLens.sol` — pure view, no state, no owner, freely redeployable.

Origin side (Unichain), one call:

```
poolId → { zeroForOneFee, oneForZeroFee, usedBaseline, sequence,
           validAfter, validUntil, secondsUntilExpiry, confidenceBps,
           globallyPaused, poolPaused, observationCount, baselineFeePips }
```

composed from `controller.feeForSwap` (both directions), `currentRecommendation`,
`poolConfig`, and `hook.observationCount`.

Processor side (Sepolia), one call:

```
{ pendingCount, settled/expired/dropped counts, recommendationSequence,
  sideState(true), sideState(false), effectiveFee(true), effectiveFee(false),
  referenceHistoryState per source, schedulerConfig, feeCurveConfig }
```

Add `coverageRatioWad` per side once F1 lands. This contract is what makes the live
panel in F7.5 possible at all.

---

## F5 — What the research actually shows, and what the UI claims

Pooled means across 15 scenarios × 5 seeds
([`research/reports/phase5_summary.json`](../research/reports/phase5_summary.json), quote WAD):

| Metric | fixed_fee | volatility_only | raw_markout | deadband_no_persist | **thetashield** |
| --- | --- | --- | --- | --- | --- |
| LP net PnL | −729.24 | **−728.11** | −728.40 | −728.72 | −728.78 |
| LP fee revenue | 1.7691 | 2.9061 | 2.6094 | 2.2936 | 2.2308 |
| Benign trader fees | 0.8386 | 1.2339 | 0.9683 | 0.9125 | **0.8966** |
| Toxic trader fees | 0.9305 | 1.6722 | 1.6412 | 1.3811 | 1.3342 |
| Mean applied fee (pips) | 500 | 816 | 733 | 644 | **628** |
| False-positive rate | 0 | 0.6054 | 0.3385 | 0.1319 | **0.0770** |
| False-negative rate | 1.0000 | 0.0940 | 0.1169 | 0.4809 | **0.6966** |
| Detection latency (steps) | — | 8 | 5 | 39 | **77** |
| Fee oscillation (pips) | 0 | 6924 | 5075 | 3928 | **2849** |
| Time above baseline | 0 | 0.7789 | 0.5970 | 0.3221 | **0.2025** |

Three facts that must drive the interface:

1. **On pooled LP net PnL, ThetaShield ranks fourth of five.** It beats only the
   fixed fee; `volatility_only` wins. H1 in
   [`PHASE6_HANDOFF.md`](history/PHASE6_HANDOFF.md) is a *paired* test against the fixed fee
   in *persistent* regimes only — legitimate, but far narrower than "LPs earn more",
   and the document says so outright.
2. **Inventory PnL is −731.01 for every policy** — identical, because order flow is
   exogenous. Fee revenue is roughly 2 WAD against a ~731 WAD hole. **Fees move 0.3%
   of LP outcome in this model.**
3. **What ThetaShield wins is precision.** A 7.7% false-positive rate against 60.5%.
   Benign flow pays 0.8966 — **27% below a volatility fee, and only 7% above a flat
   5 bp pool.** It spends 20% of the time above baseline against 78%, with 2.4× lower
   oscillation. The price is recall (it misses 70% of toxic trades) and latency
   (77 steps).

**The claim the data supports:** *ThetaShield is the only adaptive policy that raises
the toxic-direction fee without taxing benign flow.* Every other adaptive policy pays
for its detection by over-charging ordinary traders.

### F5.1 — The missing model: flow elasticity

That claim's value rests on benign traders *staying*, and the simulator cannot
measure it. [`scenarios.py`](../research/thetashield/scenarios.py) generates trades
independently of fee, and [`PHASE5_HANDOFF.md`](history/PHASE5_HANDOFF.md) states
*"Exogenous order flow does not react to policy fee changes."* Brief §15 lists
"Estimated volume lost due to higher fees" as a required metric; it is not
implemented.

Add a demand model — a logit `P(trade | fee) = exp(−β·fee)` with benign flow more
elastic than informed flow is sufficient — and re-run Phase 5. This:

- delivers the missing brief §15 metric;
- converts "benign flow pays 27% less" into a **fee-revenue** claim rather than a
  fairness claim;
- and is the only honest route to an LP-benefit argument, given inventory PnL
  dominates net outcome by roughly 300×.

Report it as H7 with a declared pass rule, following the Phase 6 discipline, and
publish the inelastic results alongside.

### F5.2 — Re-verify the fast path

[`PHASE61_HANDOFF.md`](history/PHASE61_HANDOFF.md) instructs
`forge test --match-contract ThetaShieldReactiveTest`; that contract was deleted in
`3d2cd7e`. The logic **was** ported correctly — `_updateFastPath` at
[`ThetaShieldCircleProcessor.sol:700`](../src/circle/ThetaShieldCircleProcessor.sol#L700)
— but no test exercises `fastPathEnabled: true` at Phase 6.1 parameters. Since the
fast path is what turned H4 and H5 from **fail** to pass, it is currently the
least-verified load-bearing mechanism in the project.

### F5.3 — Export a UI data bundle

`research/experiments/export_dashboard_bundle.py` → `research/reports/dashboard_bundle.json`,
containing per-policy pooled metrics, per-scenario LP outcomes, the H1–H6 plus
holdout table, and a step-by-step trace for three or four representative scenarios
(fee by direction, markout, sigma band, persistence bitmap, confidence, transport
events). Add a `--check` mode, like every other experiment. **The dashboard reads
this file and stops hardcoding.**

---

## F6 — Reactive Network: the code moved, the pitch and diagram did not

`src/reactive/` holds a single `.gitkeep`. Commit `7dcaada` removed both reactive
submodules; `3d2cd7e` deleted `script/DeployReactive.s.sol` and the 440-line
`ThetaShieldReactive.t.sol`. The word "reactive" appears in **zero** `.sol` files.
`RiskStateReceiver.sol` (brief §9.3) has no equivalent — its job is now
`ThetaShieldController.handleReceiveFinalizedMessage`, authenticating the Circle
transmitter, source domain, sealed peer, and finality threshold in place of a
callback proxy and ReactVM identity.

`THETASHIELD_ARCHITECTURE4.drawio` still renders a full **REACTIVE NETWORK** column
(`THETASHIELD RSC`, `MATURITY SCHEDULER + LIVENESS GUARDIAN`,
`CALLBACK & RECOVERY PROXY`) and a `REACTIVE • AUTOMATION & RESILIENCE` pill. None of
it exists. The scheduler role is now an **off-chain permissionless keeper**
(`script/fetch_circle_attestation.py`, `script/RelayCircleMessage.s.sol`, and anyone
calling `processor.process()`). Circle authenticates transport and provides no
scheduling.

**The Reactive semantics survive in Python, which is what makes the requested
simulation buildable.** [`simulator.py`](../research/thetashield/simulator.py) has a
`TransportSimulator` with `schedule`/`process`/`finish` and configurable latency;
`phase5_results.csv` carries `reactive_callback_latency_steps`, `applied_callbacks`,
`missing_callbacks`, `rejected_callbacks`, and `expired_reference_count`; and the
scenarios `missing_callbacks`, `out_of_order_callbacks`, `replayed_callbacks`, and
`stale_references` already model transport failure end to end. That is the simulation
to drive the interface — relabelled from "Reactive callback" to "CCTP relay" to match
the shipped contracts.

**Decision required:** restore Reactive as a second transport, or commit to Circle
plus a keeper and update the brief and diagram. The code has already chosen; the
pitch has not.

---

## F7 — Dashboard: dynamic diagrams and the LP-benefit simulator

`dashboard/app/page.tsx` is 364 lines containing three literal arrays (`scenarios`,
`hypotheses`, `policyRows`), with no viem/ethers/wagmi, no `fetch`, and no contract
address. The eight rendered charts in `research/reports/charts/*.svg` are **not used
by the dashboard at all**. The existing structure — hero, thesis strip, mechanism
flow, signal lab, evidence — is good and should be kept.

### F7.1 Data layer

Import `dashboard_bundle.json` (F5.3) at build time. Every displayed number must
trace to a bundle key; delete the literal arrays. Extend
[`check_phase9.py`](../script/check_phase9.py) — which already hard-requires the
honesty strings — to also assert that no numeric literals remain in `page.tsx`.

### F7.2 Animated architecture diagram (replaces the static drawio)

Inline SVG driven by a step timeline rather than a picture, following one observation
as a moving token:

```
swap → beforeSwap (fee chosen) → afterSwap (evidence emitted)
     → transport → CCTP attestation (keeper) → processor queue
     → maturity wait → reference sync → markout → dead band
     → epoch → persistence → fee curve → CCTP return
     → controller validation ladder → next swap's fee
```

What makes it worth building rather than decorative:

- **Real timing.** Maturity is 60 s and relay is minutes. Show the clock — *delay is
  the mechanism*, not an inconvenience. It is the hardest thing to explain in prose
  and the easiest to show.
- **Failure toggles wired to real code paths.** `CCTP outage` → the hook's
  `try/catch` emitting `ObservationTransportFailed`; `stale reference` →
  `feeForSwap` returning baseline; `out-of-order message` → `RecommendationReplay`;
  `queue full` → `DropReason.Capacity`. All four already have scenarios in the
  harness.
- **Show the fail-open boundary explicitly.** With CCTP toggled off, the swap
  animation must keep completing while the message dies. That single interaction
  communicates more than the entire `THREAT_MODEL.md` table.
- **Show the three silent-loss points** (hook `try/catch`, `DropReason.Capacity`,
  `DropReason.EpochCapacity`) as visible drop markers. They are by design — a full
  queue must not brick a CCTP delivery — but hiding them would misrepresent the
  system.

### F7.3 LP-benefit simulator (centrepiece)

An interactive panel where the visitor drives the comparison. Controls: scenario
(15 available), policy (5), dead-band *k*, persistence *n*-of-*K*, alpha, fee cap.
Panels:

1. **Fee by direction over time** — the two lines diverging *is* the product; nothing
   else conveys directionality.
2. **Benign versus toxic effective fee** — the honest win: 0.8966 / 1.3342 against
   volatility-only's 1.2339 / 1.6722.
3. **Precision/recall frontier** — all five policies plotted on (false-positive rate,
   detection latency). ThetaShield at (0.077, 77) against volatility-only at
   (0.605, 8) makes the trade-off self-evident and pre-empts the obvious reviewer
   question.
4. **LP net outcome, with the inventory-PnL bar drawn to scale.** Fee revenue 2.23
   against −731.01 inventory. Show the true scale first, then zoom to the paired
   difference. Hiding the scale is the one choice that would make this dishonest;
   showing it and still making the precision argument is what makes it credible.
5. **Transport health** — applied, missing, rejected, and expired counts, sharing the
   failure toggles with F7.2.
6. **(after F5.1) Volume retained versus fee charged** — the actual LP-benefit story.

### F7.4 Trust-surface infographic

Three concentric bands, with every card in the interface carrying a badge sourced
from a single map so that a new card cannot ship unbadged:

- **Proven** — math libraries, Python↔Solidity golden-vector parity, controller
  invariants (5 stateful, `fail_on_revert = true`), local v4 end-to-end lifecycle.
- **Simulated** — every research number, all scenario cards, all policy comparisons.
- **Mocked or absent** — owner-published reference feed; one source rather than
  three; no `MedianReferenceSampler`; no lens; empty `src/feeds/adapters/`;
  `IReferencePriceAdapter` and `ReferencePriceNormalizer` unused; no deployment
  (`deployments/` holds only a schema and two archived Lasna dry-runs, with every
  `.env.example` address slot blank); no audit; the end-to-end test proving plumbing
  at accelerated parameters rather than statistical behaviour at research parameters.

This turns the weakest part of the project into a credibility asset. The repository
already does this in prose; the interface should do it visually.

### F7.5 Live-chain panel — stays gated

Once F4 lands and a deployment exists, add a read-only viem client against the lens
over public RPC, with no wallet. Until then the section stays as it is:
*"Local system proven. Live acceptance pending."*

---

## Build order

1. **F5.1 flow elasticity**, plus modelling F1's coverage term as a sixth Python
   policy — confirms the false-positive rate survives before any Solidity change.
2. **F1 coverage ratio** in the processor and `FeeCurve.Config`, gated on step 1.
3. **F3 profiles**, the `schedulerConfig` getter, and `ConfigMirror.t.sol`.
4. **F4 lens** — unblocks the interface.
5. **F2 median sampler** — the processor needs no changes; raise
   `minimumReferenceSources` and `confidenceCapWad`.
6. **F5.2 fast-path test** at Phase 6.1 parameters.
7. **F5.3 bundle export**, then **F7** in the order 7.1 → 7.4 → 7.2 → 7.3.

## Definition of done

- `ThetaShieldCircleEndToEndTest` passes at **`RESEARCH_V1`** parameters, not only
  demo ones. This is the proof that the mechanism works as pitched, and it does not
  exist today.
- A dead-band / persistence / smoothing regression test: feed benign noise at
  research parameters and assert the fee **never leaves baseline**; feed persistent
  informed flow and assert it rises only on that side.
- The config-mirror test is green.
- Every dashboard number resolves to a `dashboard_bundle.json` key, and `--check`
  mode passes.
- If the coverage ratio is built, the false-positive rate holds at ≤ 0.0770 in the
  Python harness.

## Open decisions

1. **Closed loop** — build F1, or retire "closed-loop controller" from the pitch?
   Affects the fee curve, the pitch, and F7.3.
2. **Reactive Network** — restore it, or commit to Circle plus a keeper and update
   the brief and diagram?
3. **Deploy profile default** — `RESEARCH_V1` (recommended) or `DEMO_V1`?
4. **Reference sampler** — build F2 now, or ship with the single mock source and mark
   it clearly on the trust surface?
