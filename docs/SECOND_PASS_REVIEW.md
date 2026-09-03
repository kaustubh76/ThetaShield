# ThetaShield — Second-Pass Review

> [!NOTE]
> **Status: partly superseded. Read this as dated working history, not as current state.**
>
> The measurements below were taken on 2026-08-29 and the headings that call the
> processor plane "stalled" and the automation plane "out of funds" describe that
> morning. As of 2026-09-03 the deployment reads: **3 observations queued, 2 scored,
> 1 expired, 0 pending, 7 automation cycles**, with the run console armed on the
> live dashboard so the loop can be driven from the page rather than by hand.
>
> Two findings here were acted on rather than merely noted: the relay is no longer
> manual, and an idle machine no longer reads as a dead one. The open decisions in
> "Open decisions" at the end remain open.
>
> Current state is always the live read at <https://thetashield.vercel.app/#execution-log>,
> which lists every observation and cycle from the contracts' own events.

> Scope: functionality and live-system state. Reviewed at `4b3aff6`.
> Every claim about the deployed system below was verified by direct read-only RPC
> calls to Unichain Sepolia, Ethereum Sepolia, and Reactive Lasna — not read from
> the deployment manifests.
>
> Supersedes `FUNCTIONAL_GAP_REPORT.md`, whose findings were closed by the G0–G10
> programme recorded in `FUNCTIONAL_GAP_IMPLEMENTATION.md`.

**Verdict.** The protocol is sound, the test suite genuinely proves the mechanism at
`RESEARCH_V1` parameters, and the G0–G10 programme closed every gap from the first
review. Two things remain: the deployed system is currently dormant, and the reference
evidence feeding it is operator-driven by construction.

---

## Part 0 — Live state, measured 2026-08-29 05:35 UTC

### Unichain Sepolia — origin plane: alive, at baseline

| Read | Value |
|---|---|
| `hook` / `controller` / `lens` / `transport` code | 9,299 / 15,943 / 18,287 / 4,879 bytes — all present |
| `controller.circlePeerSealed()` | `true` |
| `controller.globallyPaused()` | `false` |
| `controller.lastSequence(poolId)` | `1` |
| `controller.feeForSwap(poolId, true)` | `(500, usedBaseline=true)` |
| `controller.feeForSwap(poolId, false)` | `(500, usedBaseline=true)` |
| `hook.observationCount(poolId)` | `6` |

`currentRecommendation` decodes to fees `500/500`, both `riskWad = 0`,
**`confidenceBps = 0`**, `validAfter = 1787884824` (2026-08-28 02:40:24Z),
`validUntil = 1787888424` (03:40:24Z), `sequence = 1`. Lifetime is exactly 3600 s,
confirming `RESEARCH_V1` on-chain.

**The only recommendation expired 25 hours before measurement.** The public "Live
testnet proof" is serving an expired recommendation with correct baseline fallback.
Right safety behaviour; not a live demonstration.

### Ethereum Sepolia — processor plane: stalled

| Read | Value |
|---|---|
| `pendingCount` | `0` |
| `settledObservationCount` | `2` |
| **`expiredObservationCount`** | **`3`** |
| `droppedObservationCount` | `0` |
| `lastObservationId` | `5` |
| `recommendationSequence` | `1` |
| `referenceSourceCount` | `3` |
| `effectiveFee(true/false)` | `500 / 500` |
| `sampler.poolCount()` | `3` |
| `executor.cycleCount()` | `2` |

Three of five observations that reached the processor **expired unsettled** — a 60%
loss rate, because `process()` was not called in time. And `hook.observationCount = 6`
against `processor.lastObservationId = 5`: observation 6 was emitted on Unichain and
never relayed. Relay is manual and nobody is running it.

### Reactive Lasna — automation plane: subscribed but out of funds

| Read | Value |
|---|---|
| `rnk_getSubscribers(<deployer RVM id>)` | **13 active subscriptions** (a later read-only re-query of the deployer RVM id `0x33189c64…` returns **3**; the earlier `13` was not reproducible) |
| RSC balance | **`0.0020584 lREACT`** (reserve was `2.0`) |
| Deployer balance on Lasna | `28.94 lREACT` |
| System contract codehash | `0x29fce405…a67465` — **matches the pin** |

> **Correction.** An earlier revision of this document reported zero subscriptions and called the
> automation plane "dead". That was a query error on my part: `rnk_getSubscribers` takes the
> **RVM ID (the deployer address)**, not the RSC contract address, and returns `[]` for any contract
> address. Queried correctly, the subscriptions are all intact. The funding finding below is
> unaffected and remains the real issue.

The subscriptions are live, but **99.9% of the 2.0 lREACT reserve burned in ~27 hours**.
[the live manifest](../deployments/unichain-sepolia-ethereum-sepolia-reactive-legacy-kaustubh76-live.json) predicted the drain ("Legacy `Cron10` execution consumes RSC
credit even while no work is armed"); the measured rate means the automation plane dies
roughly one day after every top-up. Funding is available on the deployer; it was simply
not replenished.

*Method note:* the RSC's `phase`, `dueAt`, and `wakeRequestCount` read as constructor
defaults over standard `eth_call`, because runtime state lives in the ReactVM rather
than at the Lasna chain layer. No claim is made here about the state machine. The
subscription list and the balance are chain-level facts.

*Positive result:* the pinned Lasna system codehash still matches, so
`ReactiveLegacyValidation`'s anti-Omni guard is valid today.

### Action

Before the dashboard is shown to anyone: re-fund the RSC, relay observation 6, run a
cycle, and obtain a fresh unexpired recommendation. Then surface liveness in the UI —
`LiveProofPanel` already computes `recommendationExpired`, so render "last cycle N hours
ago" rather than letting a dormant system read as a live one. Longer term the ~1-day
burn makes an unattended `Cron10` RSC untenable; either scope it to demo windows or drop
the cron heartbeat for event-only subscriptions.

---

## Part 1 — Closed since the first review (verified)

| Was | Now |
|---|---|
| No closed loop *(see R2 — the loop exists but is close to inert)* | `FeeCurve.calculateClosedLoop`, coverage accounting in `SideState`, 1.25x target, G1 research gate |
| Deploy shipped filters off | `RESEARCH_V1` is the default; `DEMO_V1` warns; `ConfigMirrorTest` pins both |
| `schedulerConfig` unreadable | `schedulerConfiguration()` getter |
| No lens | `src/lens/ThetaShieldLens.sol`, stateless, deployed and responding on both chains |
| Single owner-published feed | `PoolMedianReferenceSampler` — permissionless, ownerless, 3 sources, live |
| Reactive deleted | Restored as an automation plane with no fee authority; the executor can only call functions that are already permissionless |
| Dashboard hardcoded | Bundle-driven; `check_phase9.py` now fails if the old arrays return |
| Mechanism unproven at research params | `ThetaShieldResearchProfileTest`: benign noise never leaves baseline across 7 epochs; informed flow lifts only its direction at epoch 4; fee decoded from the real PoolManager `Swap` event |
| 94 tests | 127 across 24 contracts |

G1 held its line: the inelastic false-positive rate is bit-identical at
`77029361498289863` (7.7029%) with coverage enabled.

---

## R1 — Live reference evidence is operator-driven by construction

**The protected pool and the reference market are different token pairs on different
chains.**

- Protected pool, Unichain Sepolia: `tsALPHA`/`tsBETA` — `script/DeployCircleOrigin.s.sol:96-99`
- Reference market, Ethereum Sepolia: `tsrALPHA`/`tsrBETA` — `script/DeployCircleProcessor.s.sol:181-184`

Four ERC-20s, two chains, no bridge, no arbitrage path. Markout is
`m = direction x (reference - execution) / execution`, where `execution` is a
`tsALPHA/tsBETA` price on Unichain and `reference` is a `tsrALPHA/tsrBETA` price on
Ethereum. The two have no economic relationship.

**The three sources are moved together by one operator transaction.**
`script/CircleAcceptance.s.sol:104` — `runMoveReferences()` loops all three reference
pools and issues the same `zeroForOne`, the same `amountSpecified`, from the deployer,
in a single broadcast.

Live readings:

| Source | `priceWad` | `confidenceWad` | `observedAt` |
|---|---|---|---|
| 0 (0.05%) | `0.998003993011731029` | `1e18` | 1787884884 |
| 1 (0.30%) | `0.998008978067826473` | `1e18` | 1787884884 |
| 2 (1.00%) | `0.998022936423601280` | `1e18` | 1787884884 |

They are not identical — they differ in the sixth decimal. But the spread is `1.9e-5`
(about 0.0019%) against `maximumDispersionWad = 0.02e18` (2%), three orders of magnitude
below the rejection threshold. That residual is fee-tier microstructure from one
identical swap, not independent price discovery. Dispersion rejection cannot fire and
agreement scoring is always maximal — which is what `RESEARCH_V1` raised
`confidenceCapWad` from `0.6e18` to `1e18` on the strength of.

Two supporting mechanics:

- `PoolMedianReferenceSampler` hardcodes `confidenceWad = ThetaShieldUnits.WAD` on every
  reading, with no attenuation for depth, spread, or age.
- It stamps `observedAt = uint64(block.timestamp)` at sample time. A v4 `slot0` carries
  no timestamp, so an untraded pool publishes a stale price with a fresh stamp. All three
  live readings carry an identical 27-hour-old `observedAt`.

> **Resolved for disclosure, 2026-09-03.** The sentence this section asks for is now in
> `README.md`, `docs/WINNING_PITCH_SCRIPT.md`, `docs/ARCHITECTURE.md`,
> `docs/SUBMISSION.md`, `docs/FINAL_REPORT.md` and the dashboard trust surface.
> The architectural fix below — co-located reference tiers — remains open.

**This was not disclosed in the front-door documents when this review was written.** `README.md` says "permissionless,
liquidity-filtered three-pool sampler. Neither is a production oracle" — which reads as
*not production-grade*, not *the reference tracks a different asset and is moved by us*.
"Self-contained" appears only in `DEPLOYMENT_RUNBOOK.md` and
`FUNCTIONAL_GAP_IMPLEMENTATION.md`.

**Consequence for the stated next milestone.** `WINNING_PITCH_SCRIPT.md` names it: "a
second mature cycle showing a non-baseline directional fee." With this topology the only
way to produce that premium is `runMoveReferences()`. The resulting fee change would be a
scripted demonstration.

### Fix

**Now.** One sentence in `README.md`, `WINNING_PITCH_SCRIPT.md`, and the dashboard trust
surface: the `RESEARCH_V1` reference market is self-contained in separate tokens and moved
by the acceptance script, so live markout demonstrates the mechanism rather than measuring
adverse selection. Place the "non-baseline directional fee" milestone in the simulated
trust band.

**Next.** Co-locate the reference tiers with the protected pair: three additional fee tiers
of `tsALPHA`/`tsBETA` on Unichain, sampler alongside them, readings delivered to the
Ethereum processor over the Circle rail that already exists — `CircleMessages` has a `kind`
byte and room for a third type beside `Observation` and `Recommendation`. Cross-tier
divergence within one real pair is genuine, arbitrageable evidence, and it is what the
original brief specified. Requires the processor to accept pushed references (a branch in
`handleReceiveFinalizedMessage`) alongside the `syncReference` pull.

---

## R2 — The closed loop cannot close, and the rate limiter erases it

`FeeCurve.calculateClosedLoop` nests the coverage premium inside the toxicity gate:

```solidity
if (persistenceActive && confidenceWad >= confidenceFloorWad && signedRiskWad > 0) {
    toxicPremium    = |signedRisk| * gainFeePips / WAD;
    coveragePremium = coverageEligible ? deficit * coverageGainFeePips / WAD : 0;
}
```

A coverage deficit alone can never move the fee. It is an amplifier on an already-triggered
toxic state, not a feedback channel.

The `coverage_fee` golden vector in `research/datasets/golden_vectors.json` settles the
magnitude:

```
toxic premium    1800 pips
coverage premium   37 pips     <- 2% of the premium
total premium    1837 pips
target fee       2337 pips
next fee         1500 pips     <- maximum_increase_pips clips to base + 1000
```

The rate limiter discards 837 pips, 23x the entire coverage contribution. That vector uses
`maximum_increase_pips: 1000`; `RESEARCH_V1` ships `500`, so production clipping is twice as
aggressive. At shipped values (`coverageGainFeePips: 50` against `gainFeePips: 450_000`) a
full `1.25e18` deficit is worth 62 pips of a 9500-pip range;
`ThetaShieldCircleProcessor.t.sol` records `latestCoveragePremiumPips == 61`.

G1 confirms it does not pay for itself: `elastic_fee_revenue_delta_quote_wad =
-11031533333333334`. The artifact states it plainly: "does not improve mean fee revenue in
this deterministic synthetic experiment."

Three secondary issues:

- **The premium split does not reconcile.** Each premium is individually clamped to
  `maximumFeePips - baseFeePips`, then the sum is clamped again, so
  `toxicPremiumPips + coveragePremiumPips` can exceed `premiumPips`. Consumers reading the
  split from `EpochFinalized` must not assume the parts sum to the whole.
- **Coverage accounting is asymmetric to risk accounting.** Loss uses raw markout and
  uncapped notional; risk uses dead-band-filtered markout and notional capped at
  `maximumTradeNotionalWad`. Every sub-dead-band noise event counts as loss with no matching
  revenue inflation, biasing the ratio down and the premium up. Undocumented.
- **The epoch-accumulation path has no cross-language vector.** `coverage_fee` pins
  `calculateClosedLoop` arithmetic only; the Python/Solidity agreement on summing
  `feeRevenueWad` and `estimatedLossWad` across observations is untested. Python's
  `CoverageThetaShieldPolicy` also adds `meets_minimum_epoch_notional` to the toxic gate,
  which `ThetaShieldPolicy` does not; nothing pins that difference.

**Decision:** raise `coverageGainFeePips` (and/or relax `maximumIncreasePips`) and re-run the
G1 gates until the loop earns its place, or keep it at 50 and describe it as coverage
telemetry with a bounded nudge rather than a closed-loop controller. Either way, G1's
`RESULT_COLUMNS` omits `benign_trader_fees_quote_wad`, `toxic_trader_fees_quote_wad`, and
`detection_latency_steps`, so the coverage policy's effect on who pays and how fast it reacts
is currently unmeasurable from committed artifacts.

---

## R3 — The acceptance "pass" is not machine-checked

`script/CircleAcceptance.s.sol` contains no fee assertion. Grepping `fee` across the file
yields an import, a `MockNormalizedReferencePriceFeed` handle, and
`LPFeeLibrary.DYNAMIC_FEE_FLAG`. Its custom errors are all pool/market/router identity checks.

So `"expected_fee_pips": 500, "observed_fee_pips": 500, "passed": true` in both live manifests
is hand-recorded, not produced by the acceptance tooling. Add an entry point that reads
`controller.feeForSwap` before and after and reverts on mismatch.

Related, all cheap:

- **`preflight_fingerprints: []` in the G10 manifest.** `docs/VERIFICATION.md` calls the two
  live read-only `ReactiveLegacyPreflight` calls "mandatory for G10". The older Phase 8D
  manifest records two; G10 records none.
  **RESOLVED** — the current live manifest records four preflight fingerprints.
- **Nothing validates manifests against the schema.** `deployment-schema-check` runs
  `python -m json.tool deployments/manifest.schema.json` — it pretty-prints the schema and
  never opens a manifest. The schema is well-built and entirely unenforced; roughly 15 lines
  of `jsonschema` in `check_phase9.py` closes it.
  **RESOLVED** — `deployment-schema-check` now also runs `script/check_deployment_manifests.py`,
  which validates every non-archive manifest against the schema.
- **All 14 components are `verified: false`.** Acknowledged in `deployments/README.md`, but
  the README links "Live testnet proof" and the dashboard links every address.
  `EXPLORER_API_KEY` already exists in `.env.example`.

---

## R4 — Automation robustness

`ThetaShieldAutomationRSC._handleCron` sets `phase = AwaitCycle`, and only
`_handleAutomationCycle` can leave it. If the callback never executes, or a permissionless
keeper front-runs the cycle so `AutomationCycleCompleted` carries `reactiveTrigger == false`
(subscription 2 filters on `topic_3 == 1`), there is no timeout, no reset, and no admin escape
on the contract. Blast radius is liveness only — Circle authentication, controller expiry,
baseline fallback, and permissionless `execute()` all hold — but recovery needs a redeploy,
which G10 already did twice.

This is a code-reading finding, not a confirmed live fault; ReactVM state is not readable via
`eth_call`. The confirmed live fault is funding.

**Fix:** a staleness escape in `_handleCron` — if `phase == AwaitCycle` and
`block.timestamp > dueAt + cycleTimeout`, emit `GuardianHalted` and reset to `AwaitMaturity`.
About ten lines, and it makes the "liveness guardian" label in the architecture diagram true.

Lower severity: `OBSERVATION_QUEUED_TOPIC` and `AUTOMATION_CYCLE_TOPIC` are `keccak256` of
hand-written signature strings. Edit either event and the RSC silently stops matching with no
compile error — and `EpochFinalized` just went from 13 to 20 parameters in this release, which
is also an ABI break for any indexer keyed on the old topic0.

---

## R5 — Claim surface

- **The closed loop is invisible where it counts.** Grepping `closed[- ]loop|coverage ratio`
  across `README.md`, `docs/SUBMISSION.md`, `docs/WINNING_PITCH_SCRIPT.md`, and
  `docs/ARCHITECTURE.md` returns zero hits. The only "coverage" in the README is
  `H5 retained toxic coverage 59.70%`, an unrelated recall metric. The dashboard does surface
  it. Given R2, the fix is one honest paragraph, not a headline.
- **H4 and H5 still formally fail**, passing only on the Phase 6.1 holdout. The bundle's
  `holdout_table` exposes both and the dashboard says "The failures stayed in the record."
  Handled well; keep as is.
- **`next.config.ts` is empty — no CSP or security headers** on a public Vercel deployment that
  proxies public RPC through `app/api/live/route.ts`. The route is read-only with an 8s abort,
  so risk is low. All 14 hand-written selectors in that route were verified correct against
  `cast sig`.
- **`ReferencePriceNormalizer` reuse in the sampler is an identity no-op** —
  `toWad(answer, 18)` is `mulDivDown(answer, 1e18, 1e18)`. The real decimal handling is four
  hand-written branches in `_priceWad`.
- **`reactive-lib` and `reactive-test-lib` are un-vendored submodules.** `vmOnly`,
  `authorizedSenderOnly`, `rvmIdOnly`, `Callback`, and whatever `AbstractPayer` exposes are the
  authentication surface of the entire automation plane and sit outside the reviewed diff.
  Worth naming in `THREAT_MODEL.md` as an external audit boundary.

---

---

## R6 — The research artifact chain is pinned to one Foundry build, ungated

Found by running the suite rather than reading it.

`research/experiments/phase5_baselines.py:71` measures hook gas by shelling out to
`forge test --match-contract ThetaShieldHookGasTest`, and that measurement calibrates
every downstream fee budget. The committed artifacts pin
`after_swap_warm_gas: 166781`, `hook_gas_per_swap: 199973`, measured under the CI-pinned
Foundry `v1.7.1`.

On Foundry `1.1.0-dev` the same unmodified contracts measure `after_swap_warm_gas:
169281` (+2500). Consequences, all observed:

- `phase5-check`, `phase6-check`, `phase61-check`, and `gap-g1-check` all fail with
  "artifacts are stale", naming files the developer never touched.
- `snapshots/ThetaShieldHookGasTest.json` — a tracked file — is silently rewritten,
  because the gas tests use `vm.startSnapshotGas`. Running the documented `make test`
  is enough to dirty the working tree.
- `check_dependencies.py` passed anyway: it verified that `.github/workflows/ci.yml`
  pins `v1.7.1`, but never checked the local `forge --version`.

CI is unaffected because it installs the pinned build. The cost falls entirely on
contributors following `README.md`'s instruction to run `make verify`.

**Fixed in this pass.** `check_dependencies.py` now compares the local Foundry version
against `toolchains.foundry_ci` and fails closed with an explanatory message naming the
consequence and the `foundryup --install v1.7.1` remedy. This replaces four unexplained
downstream failures with one clear upstream one; it changes no outcome that was
previously passing.

Solidity suite on the pinned contracts: **124 passed, 0 failed, 3 skipped (127 total)**.
Python: **48 passed**.

## Suggested order

1. Revive the deployment — fund the RSC, relay observation 6, run a cycle, obtain an unexpired
   recommendation, add a liveness indicator to the dashboard. **Requires owner-approved spend.**
2. R1 disclosure — one sentence in three places. The only correctness-of-claim issue.
3. R3 quick wins — fee assertion in `CircleAcceptance`, capture the two preflight fingerprints,
   verify the 14 contracts on Blockscout. (Manifest schema validation and the R6 Foundry gate
   are already implemented.)
4. R4 staleness escape in the RSC, with a test that strands and recovers it.
5. R2 decision — raise the coverage gain and re-run `make gap-g1-check`, or rename the feature.
   Add the three missing G1 metric columns and an epoch-accumulation golden vector either way.
6. R5 docs — coverage paragraph, CSP headers, external-audit-boundary note.
7. R1 architecture — co-located reference tiers delivered over Circle.

## Verification

```sh
make verify                    # 127 Solidity, 48 Python, bundle freshness, reactive-legacy
make gap-g1-check              # after any coverage-parameter change
make gap-g3-check              # ConfigMirror + ThetaShieldResearchProfile at RESEARCH_V1
make reactive-legacy-check     # after the RSC staleness escape
python3 script/check_phase9.py # after doc or dashboard edits
```

Live re-verification (read-only), after reviving the deployment:

```sh
cast call 0x23ae3E1A306824F0CBA0b6561cB7E5502f63dFb7 'feeForSwap(bytes32,bool)(uint24,bool)' \
  0x98cea44f9f7d6a1432b12a8a56e022758ffe447a9f2e529da7557eb788cdc2a5 true \
  --rpc-url https://sepolia.unichain.org           # expect usedBaseline=false after a mature cycle

curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"rnk_getSubscribers","params":["0x33189c643774ED2713EbFf5A6923e5fa42b96eE8"]}' \
  https://lasna-rpc.rnk.dev/                       # returns 3 subscriptions
```

Definition of done for Part 0: `usedBaseline == false` on at least one direction, the RSC holds a
non-trivial lREACT balance, and `expiredObservationCount` stops climbing.

## Open decisions

1. R1 fix depth — disclosure only, or disclosure now plus co-located reference tiers next?
2. R2 — make the coverage loop economically real, or rename it to match what it does?
3. Second live cycle — stage it via `runMoveReferences()` and label it a demo, or hold until
   R1's architecture lands so the premium is genuine?
4. Reactive lane — accept the roughly one-day lREACT burn as demo-only, or drop the `Cron10`
   heartbeat for event-only subscriptions?
