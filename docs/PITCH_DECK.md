# ThetaShield — Pitch Deck

**Audience:** UHI10 judges, plus the Circle and Reactive Network tracks.
**Length:** 21 core slides ≈ 12 minutes spoken, or 8 slides ≈ 5 minutes (see
*Cut-down*). The appendix is not presented — it is Q&A ammunition.
**Companions:** [`docs/VIDEO_SCRIPT_5MIN.md`](VIDEO_SCRIPT_5MIN.md) is the
recorded-demo cut of this same story;
[`docs/THETASHIELD_FLOW.excalidraw`](THETASHIELD_FLOW.excalidraw) is the canvas
slides 7–13 are cropped from.

Every number on a core slide is either read live on
<https://thetashield.vercel.app> or opens to a public transaction. Where a
number is synthetic research, the slide says so on the slide, not in the notes.

**Before you present, read [§A9 What not to say](#a9--what-not-to-say).** Six of
those lines are the difference between an honest slide and an overclaim a judge
will catch.

---

## Act I — The problem is not volatility

### Slide 1 · Title

> # Protect LPs from *signal,* not noise.
> ### Directional memory for a Uniswap v4 pool.
>
> Unichain Sepolia · Circle CCTP V2 · Ethereum Sepolia · Reactive Lasna
> **Live. Unaudited. Testnet only.**
>
> `thetashield.vercel.app` · `github.com/kaustubh76/ThetaShield`

**Notes.** Say the subtitle, not the title. "ThetaShield gives a Uniswap v4 pool
memory. It measures what past flow actually did to the LPs who funded it, and
raises the fee only for the direction that repeatedly hurt them." Do not open
with Circle, Reactive, chains or contracts — open with the LP.

---

### Slide 2 · The loss nobody sees at execution

> A trader buys at **100**.
> One minute later the market is at **101**.
>
> The swap succeeded. The router was happy. The trader was happy.
> **The LP sold an asset one minute before it was worth more.**
>
> A pool has to price a swap *before* it can know whether that swap was fair.

**Notes.** This is the whole problem in one line and it should take fifteen
seconds. Nobody was defrauded. No rule was broken. The pool simply had no way to
know, at execution time, what it would know sixty seconds later. That gap is
where LP returns quietly go.

---

### Slide 3 · What the existing answers do

| Policy | Mean fee | False-positive rate | Detection latency |
|---|---:|---:|---:|
| Fixed 5 bps | 5.00 bps | 0.00% | never detects |
| Volatility-only | 8.16 bps | **60.54%** | 8 steps |
| Raw markout | 7.33 bps | 33.85% | 5 steps |
| Dead-band only | 6.44 bps | 13.19% | 39 steps |
| **ThetaShield** | **6.28 bps** | **7.70%** | 77 steps |

> Deterministic synthetic study · 5 policies × 15 scenarios × 5 seeds = 375 runs
> · fee budgets calibrated within **0.49 bps** of each other so the comparison is
> about *selectivity,* not about who charges more.

**Notes.** The row to point at is volatility-only. A fee that reacts to
unsigned volatility charges a premium in **60.54%** of the benign cases — it
taxes ordinary two-sided noise, which is most of the time. ThetaShield reaches
7.70% for a *lower* mean fee. Say plainly: these are synthetic streams, not live
market data. Say also that ThetaShield is the **slowest** to react — 77 steps —
and that this is a deliberate trade, not an oversight. Slowness is what buys the
false-positive rate.

---

### Slide 4 · The question nobody was asking

> Not: *"is the market moving?"*
> Not: *"is this wallet suspicious?"*
>
> ### "Which **direction** of flow was repeatedly followed by an adverse move?"
>
> Buying and selling get **separate state and separate fees.**
> Toxicity is directional. A fee that isn't, cannot express it.

**Notes.** This is the intellectual claim of the project and the one thing to
land if everything else is forgotten. Volatility is a scalar; adverse selection
has a sign. Collapsing the sign is what makes every unsigned design punish the
benign side of the book along with the harmful one.

---

### Slide 5 · The thesis

> **Record the execution. Wait for the evidence. Subtract the noise.
> Charge only the direction that keeps being wrong.**
>
> ```
> m = d × (P_ref − P_exec) / P_exec        signed delayed markout
> e = sign(m) × max(|m| − k·σ, 0)          minus strictly trailing noise
> active = popcount(last 5 toxic bits) ≥ 3 persistence, not one bad minute
> ```
>
> If buying repeatedly harms LPs, only the **buy-side** fee rises.
> The sell side stays at the **5 bps** baseline.

**Notes.** Three lines, sixty seconds, don't derive anything. The one detail
worth saying aloud: σ is computed over a **half-open** window that excludes the
observation being scored. A trade cannot widen the band used to judge it. That
is a structural property of the API — the Solidity function takes the series
plus a `currentIndex` and reads only below it — not a caller convention someone
has to remember.

---

### Slide 6 · What ThetaShield is not

> ✗ Not a wallet blacklist ✗ Not an identity or reputation score
> ✗ Not an MEV auction ✗ Not a delay, queue or commit-reveal
> ✗ Never custody of the swap ✗ Never able to block a trade
>
> **It prices measured outcomes. It never judges a trader.**

**Notes.** Pre-empt the question every judge has already half-formed. There is
no address in the mechanism anywhere — the processor never sees `msg.sender`.
The only inputs are direction, price, notional and time.

---

## Act II — The machine

*(Slides 7–13 crop directly from `docs/THETASHIELD_FLOW.excalidraw`. Colour is
the plane: pink = Unichain execution, blue = Circle transport, green = Ethereum
delayed intelligence, purple = Reactive scheduling, red = every refusal.)*

### Slide 7 · The swap path — and nothing else

> `Trader → PoolManager → beforeSwap → Controller → swap → afterSwap → Transport → Circle`
>
> **Everything the trader waits for is on this one line, on one chain.**
> Two storage reads and an event: **33,192** gas in `beforeSwap`,
> **166,781** in a warm `afterSwap`.
>
> No second chain is ever in the critical path of a swap.

**Notes.** *Crop: band 1.* Thirty seconds, no more. The point of the band is
what is **absent** from it: Circle, Ethereum, Reactive. Those update *later*
swaps. State the gas caveat once — isolated local EVM calls under a pinned
compiler profile, excluding the PoolManager and router, so it is a mechanism
cost, not a live quote.

---

### Slide 8 · The boundary that makes it safe to be slow

> The Circle dispatch is wrapped in `try/catch`.
>
> Circle down → hook emits `ObservationTransportFailed` → **swap completes.**
>
> **Fail-open for evidence. Fail-closed for fees.**

**Notes.** One sentence, but it is the sentence that makes the whole
architecture legitimate. A learning system that can brick a swap is not
shippable. This one is structurally incapable of it: the only thing a transport
outage costs is that the pool learns less.

---

### Slide 9 · Circle carries the evidence

> **Circle CCTP V2 · domain 10 → 0 · finality threshold 2000**
>
> Relaying is permissionless. Authentication is not:
> the recipient checks the **local transmitter**, the **source domain**, the
> **one-time-sealed peer**, and rejects anything unfinalized.
>
> A relayer can delay or duplicate a message. It cannot forge one.

**Notes.** Circle's role is exactly one thing and it is worth being precise:
Circle decides **what is authentic**. It does not schedule, does not compute,
does not hold the fee. Peers are sealed once after deployment and cannot be
re-pointed.

---

### Slide 10 · Reactive decides *when*

> The evidence is worthless until the markout horizon has passed.
> Somebody has to come back **60 seconds later.**
>
> `ThetaShieldAutomationRSC` on Reactive Lasna subscribes to
> `ObservationQueued`, to `AutomationCycleCompleted` (authenticated cycles
> only), and to the official `Cron10` topic — then calls the bounded executor
> through the official proxy.
>
> **`rvmIdOnly` + `authorizedSenderOnly`, both readable on-chain right now.**
> A permissionless keeper can call the same cycle. Reactive supplies liveness,
> never authority.

**Notes.** *Crop: band 2, top row.* This is the Reactive track's slide and it
deserves its own beat. The separation to state: **Circle decides what is
authentic; Reactive decides when eligible work runs; neither computes a fee.**
The executor Reactive calls is permissionless and cannot install controller
state, so a compromised or dead scheduler degrades automation without touching
the pool. And we can show the authentication rather than assert it — the
executor's `reactiveRvmId()` and `reactiveCallbackProxy()` are immutable public
getters, and the proven callback transaction carries both values in its own
calldata.

---

### Slide 11 · Ten libraries, in call order

> ```
> ReferencePriceNormalizer → ReferencePriceDispersion → DirectionalMarkoutMath
>   → TrailingVolatility → DeadBandFilter → EpochAggregation
>   → ConfidenceWeight → DirectionalRiskSmoother → PersistenceWindow → FeeCurve
> ```
>
> Robust **weighted median** centre, not a mean.
> **Strictly trailing** σ that excludes the sample being scored.
> Smoothing on **magnitude only** — direction always comes from the current
> signed aggregate.
> Buy and sell **never share a bucket.**

**Notes.** *Crop: band 2, lower rows.* Do not narrate ten boxes. Pick two: the
strictly-trailing σ (a trade cannot hide its own signal) and the
magnitude-only EWMA (a smoother can never invent a direction). Then move on.

---

### Slide 12 · The fee can only move one way, slowly, and within bounds

> ```
> eligible = (persistence OR fast path) AND confidence ≥ 0.5
> premium  = gain × max(signedRisk, 0)          negative risk cannot raise a fee
> target   = clamp(500 + premium, 500, 10000)   5 bps floor, 100 bps ceiling
> next     = rateLimit(previous, target, +500, −100)
> ```
>
> Rises fast, relaxes slowly — **+500 pips up, −100 pips down** per step.
> Favourable flow can never be charged for.

**Notes.** `max(signedRisk, 0)` is the line to point at: evidence that the pool
*gained* produces exactly zero premium, never a discount and never a punishment
of the other side. The asymmetric rate limit is deliberate — protection should
arrive faster than it leaves.

---

### Slide 13 · Ten checks before a fee is allowed to change

> local transmitter · source domain · sealed processor peer · finalized
> threshold · correct pool · monotonic sequence · `validAfter` · `validUntil` ·
> cooldown · confidence floor · fee bounds · risk bounds
>
> ### Fail any one → **5.00 bps.**
>
> Recommendations expire after **3,600 s**. If Circle stops, if Reactive stops,
> if the keeper stops, if the processor is wrong — the premium decays and the
> pool returns to baseline **on its own.**

**Notes.** *Crop: band 3.* The failure mode is "cheap", never "stuck" and never
"unbounded". Nothing has to be noticed by an operator for the safe thing to
happen. That is the property that makes a delayed, cross-chain fee mechanism
defensible at all.

---

## Act III — The proof

### Slide 14 · The proven run

> ### 43m 12s, end to end. Six public transactions.
>
> | # | | Chain | Gap |
> |---|---|---|---:|
> | 1 | Swap observed | Unichain Sepolia | — |
> | 2 | Circle delivers the observation | Ethereum Sepolia | **23m 54s** |
> | 3 | Reactive wakes the work | Ethereum Sepolia | **36s** |
> | 4 | Processor dispatches recommendation 1 | Ethereum Sepolia | **2m 12s** |
> | 5 | Circle brings it back, controller installs | Unichain Sepolia | **15m 29s** |
> | 6 | A later swap is charged the expected fee | Unichain Sepolia | **1m 01s** |
>
> Measured **2026-08-29** from the block timestamps of those six transactions.
> Expected fee **500 pips**, observed fee **500 pips**, acceptance `passed`.

**Notes.** This is the slide. Do not read hashes aloud — put them on screen and
say "every row opens to a public explorer." The claim in one sentence: *a real
Uniswap v4 swap on one chain changed the fee logic governing a later real
Uniswap v4 swap on that chain, with authenticated Circle transport in both
directions and a Reactive-scheduled, proxy-authenticated callback in the
middle.* The dashboard reads these back from the chains on every cold start —
they are not stored numbers.

---

### Slide 15 · Where the time actually goes

> **39m 23s** of the 43m 12s is Circle's finality-2000 transport, both legs.
> **36s** is Reactive's wake.
> **2m 12s** is the processor's own work.
>
> Cross-chain finality dominates the wall clock —
> and **none of it is on the path of a swap.**

**Notes.** This is the honest engineering slide and judges reward it. We are not
claiming to be fast. We are claiming that being slow is free, because the slow
part was moved off the critical path in slide 7. If a judge asks how this
survives on mainnet: the same architecture with a co-located processor removes
both Circle legs from the loop without changing a line of the mechanism.

---

### Slide 16 · Why the live fee is still 5.00 bps

> `minimumTrailingObservations` = **16 per side.**
> This pool has settled **2** observations across both sides in its life.
>
> Confidence is **structurally zero.** No premium is reachable.
>
> ### The first live safety decision this system made was refusing to move.

**Notes.** Get to this before a judge frames it as a failure. A mechanism that
repriced a pool from a single observation would demo better and be trivial to
manipulate. Be precise about the logic: `settledCount` is a lifetime total
across both sides, so being under the threshold proves *no side* can qualify —
the converse would not follow. The non-baseline directional transition is proven
in the Solidity lifecycle suite; it has not yet been shown in a second public
live cycle, and that is the next evidence milestone.

---

### Slide 17 · The failure we left on the page

> **Observation 4 arrived, was never scored, and expired.**
>
> `referenceSelectionWindowSeconds` is **3,600** — not the 7,200 s lifetime.
> Past that window no reference sample can fall inside the scoring range, so no
> keeper can rescue it. The scheduler did not wake. The observation died.
>
> It is on the dashboard, labelled `EXPIRED UNSCORED`, with its receipt.
> Live counters: **5** observations · **2** settled · **1** expired · **0** dropped.

**Notes.** Volunteer this. It is the single most credible thing in the deck: the
exact failure mode the Reactive scheduler exists to prevent, happening for real,
recorded rather than hidden, with the permissionless keeper as the stated
mitigation. It also explains why the counters do not read 5/5/0/0, which a judge
reading the page will notice anyway.

---

### Slide 18 · The research, including what failed

> Original study: **H1 ✓ H2 ✓ H3 ✓ H4 ✗ H5 ✗ H6 ✓** — and the failures are
> still in the repository, versioned and immutable.
>
> | | Original | Reserved holdout |
> |---|---:|---:|
> | H4 rank correlation (need ≤ −0.35) | 0.000 **FAIL** | **−0.727** |
> | H4 Pareto points (need ≥ 3) | 2 | **6** |
> | H5 retained toxic coverage (need ≥ 50%) | 3.55% **FAIL** | **59.70%** |
> | H5 false-positive reduction | — | **20.79 pp** (95% CI 13.43–28.15) |
>
> 3,150 runs · 42 configurations × 15 scenarios × 5 seeds.
> 90 training cases, 40 holdout cases, **disjoint seeds**, selection never
> touched the holdout.

**Notes.** Two things carry this slide: the failures were kept, and the fix was
scored **once** on data the selection never saw. Say the caveat before you are
asked — this is a deterministic synthetic study, not live-market evidence and
not a profitability claim.

---

### Slide 19 · What "H1 passed" actually means

> H1 paired LP improvement: **+1.2254** (95% CI +1.0347 … +1.4160), 10 pairs.
>
> **But both policies stay negative in the persistent-adverse regimes.**
> H1 means "less negative," not "profitable."
>
> `notional × signed markout` is an **adverse-selection proxy** —
> not LVR, not individual LP loss, not profit.

**Notes.** Nobody makes you show this slide. Show it anyway. It is the fastest
way to establish that every other number in the deck has been read the same way,
and it defuses the sharpest question in the room before it is asked.

---

### Slide 20 · The boundary, stated plainly

> **What is real:** deployed contracts on three networks · authenticated Circle
> messages both ways · two public authenticated Reactive callbacks · a
> PoolManager swap charged the fee the controller expected · 48 Python tests and
> a Solidity suite of 127 test functions (124 passing, 3 opt-in fork), with fuzz,
> invariant and gas coverage · every research artifact reproducible under
> `make verify`.
>
> **What is not:** unaudited · testnet only · the hook has not been submitted ·
> the three reference pools are three fee tiers of **one project-issued pair, on
> a different chain from the protected pair, with no arbitrage path between
> them**, moved together by our own script — so their agreement is structural,
> not evidential, and live markout demonstrates the mechanism rather than
> measuring real adverse selection.
>
> **Before mainnet:** an independent oracle adapter · audits · monitored
> redundant keepers · multisig or hardware-backed ownership · incident response.

**Notes.** Read the middle block at the same pace as the first. A judge who
hears the limits stated in the presenter's own voice trusts the rest of it.

---

### Slide 21 · Close

> A pool that charges everyone more when the market gets noisy
> is a pool that has learned nothing.
>
> ThetaShield does not guess who is toxic.
> It measures **which direction of flow was harmful,**
> protects future liquidity with **bounded** fees,
> and **fails safe** when the evidence disappears.
>
> ### The pool remembers — without making the trader wait.

**Notes.** Stop on the last line. Do not add a thank-you slide, a team slide, or
a roadmap. Take questions from the appendix.

---

## Cut-down — the 5-minute version

Slides **1, 2 (with 4 folded in), 5, 7 + 8, 10, 14, 16, 21**. Drop Act II's
internals and the research act entirely; keep the live run and keep slide 16.
The narration for this cut is written out beat-by-beat in
[`docs/VIDEO_SCRIPT_5MIN.md`](VIDEO_SCRIPT_5MIN.md).

For the Circle track, add slide 9. For the Reactive track, slide 10 is
mandatory and slide 17 is the strongest thing you can show them.

---

# Appendix — not presented

## A1 · Deployment inventory

Source revision `4b3aff6247349a581275839f280d9902de3ceccd`, manifest schema 3,
profile `RESEARCH_V1` (`0x849fd0a1…707c`), pool
`0x98cea44f9f7d6a1432b12a8a56e022758ffe447a9f2e529da7557eb788cdc2a5`.

| Contract | Address | Network |
|---|---|---|
| `ThetaShieldHook` | `0x7f5d1beB9957d94c7fc0c8FC4D8DA4A0A0b8c0c0` | Unichain Sepolia · 1301 · domain 10 |
| `ThetaShieldController` | `0x23ae3E1A306824F0CBA0b6561cB7E5502f63dFb7` | Unichain Sepolia |
| `ThetaShieldCircleTransport` | `0x4f00e3BDd224F4c4b4958D54cD774E84B9092609` | Unichain Sepolia |
| `ThetaShieldLens` | `0xEF9C630C6977d16Dac5107fe590FB184CB593D5d` | Unichain Sepolia |
| `ThetaShieldCircleProcessor` | `0x7bdF95029fd614e5FCB5C7B2D63e263a8Ca4BBF2` | Ethereum Sepolia · 11155111 · domain 0 |
| `PoolMedianReferenceSampler` | `0xEF9C630C6977d16Dac5107fe590FB184CB593D5d` | Ethereum Sepolia |
| `ThetaShieldProcessorLens` | `0x4a1B453f4Ba183D7BecD7E81bFfD8FB0682F1EaB` | Ethereum Sepolia |
| `ThetaShieldAutomationExecutor` | `0x1A3a275dF6658ab96151480d920d58CeA5ab9707` | Ethereum Sepolia |
| `ThetaShieldAutomationRSC` | `0x4f00e3BDd224F4c4b4958D54cD774E84B9092609` | Reactive Lasna · 5318007 |

Reactive: callback proxy `0xc9f36411C9897e7F959D99ffca2a0Ba7ee0D7bDA`, deployer
RVM id `0x33189c643774ED2713EbFf5A6923e5fa42b96eE8`, cron `Cron10`
(`0x04463f7c…b687`), proven callback
`0x302af17e45e9c6e0e92f3cd5a2a8c09ef7e049a2fc5e9e928653b79d736a96a8`.
`MessageTransmitterV2` is `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` on both
Circle domains.

> **Do not collapse these in a diagram.** `0x4f00…2609` is the transport on
> Unichain *and* the RSC on Lasna; `0xEF9C…3D5d` is the origin lens on Unichain
> *and* the sampler on Ethereum. Same address, different chains, different
> contracts.

`verified: false` on the explorers is an empty `EXPLORER_API_KEY`, not a
verification failure.

## A2 · Authentication, by hop

| Hop | What is checked |
|---|---|
| PoolManager → hook | `onlyPoolManager`; permission bits validated in the constructor against the mined hook address; `StaticFeePoolNotSupported` unless the pool is dynamic-fee |
| hook → transport | `OnlyHook`; peers sealed once (`PeersAlreadySealed`); always sends at threshold 2000 |
| Circle → processor | local transmitter · source domain 10 · sealed transport peer · `UnfinalizedMessageRejected` · `ObservationReplay` · `EventFromFuture` |
| RSC → executor | `authorizedSenderOnly` (official proxy) + `rvmIdOnly` (injected ReactVM id), both immutable public getters; `ReentrantExecution`; `CycleOverflow` |
| keeper → executor | deliberately permissionless; identical bounded cycle; cannot install controller state |
| Circle → controller | local transmitter · source domain 0 · sealed processor peer · finalized · `PoolNotConfigured` · `RecommendationReplay` · `FutureRecommendation` · `StaleRecommendation` · `RecommendationTooSoon` · `InsufficientConfidence` · `FeeOutOfBounds` · `RiskOutOfBounds` · `FeeRiskMismatch` |

`FeeRiskMismatch` is worth knowing: a fee above baseline is rejected unless it
arrives with a positive risk figure, so a well-formed message still cannot
install an unjustified premium.

Ownership is `OwnedTwoStep` with **no renounce path**. Circle peers seal once
and cannot be re-pointed.

## A3 · Shipped `RESEARCH_V1` parameters

| | | | |
|---|---:|---|---:|
| markout horizon | 60 s | base / min fee | 500 pips (5 bps) |
| epoch duration | 60 s | maximum fee | 10,000 pips (100 bps) |
| reference selection window | 3,600 s | gain | 450,000 pips |
| observation lifetime | 7,200 s | rate limit | +500 / −100 pips |
| recommendation lifetime | 3,600 s | confidence floor | 0.5 |
| trailing window | 16 | confidence cap | 1.0 |
| minimum trailing observations | 16 | dead-band `k` | 1.0σ |
| target observation count | 4 | maximum dispersion | 0.02 |
| persistence | 3 of 5 | toxic threshold | 0.00075 |
| EWMA alpha | 0.25 | minimum reference sources | 3 |

Read from `script/profiles/ThetaShieldProfiles.sol :: researchV1()`, and
answered identically by the deployed processor on `/api/live` — which is itself
a checkable claim.

**Two shipped values deliberately diverge from the research artifacts:**
`gainFeePips` ships **450,000** where `phase61_summary.json` selected 500,000,
and `confidenceCapWad` ships **1e18** where the research config used 0.6e18. The
Phase 5/6 headline metrics were produced under the harness values, so a fee
magnitude reproduced from those reports will not match the deployed curve
exactly. This is written down in `docs/MATHEMATICAL_SPECIFICATION.md` §12; cite
it rather than smoothing over it. The dashboard labels both sides with their
provenance (`RESEARCH BUNDLE` vs `DEPLOYED · READ LIVE`) rather than presenting
either as the other.

## A4 · Measured gas

| | |
|---|---:|
| `beforeSwap` | 33,192 |
| `afterSwap` (warm) | 166,781 |
| **hook total per swap** | **199,973** |
| `applyRecommendation` (cold / warm) | 142,543 / 15,175 |
| `feeForSwap` read (warm) | 3,771 |

Enforced ceilings in `test/gas/`: `beforeSwap` < 100,000, warm `afterSwap` <
220,000, cold apply < 200,000, warm apply < 100,000, `feeForSwap` < 30,000.
Isolated local EVM calls under a pinned compiler profile, excluding the
PoolManager and router transaction — a mechanism cost, not a live-chain quote.

## A5 · Verification

```sh
make verify     # 20 gates: format, lint, build, Solidity tests, Python tests,
                # golden vectors, reproducible research, pinned dependencies,
                # tracked secrets, deployment schema, the flow diagram,
                # the dashboard build and its content gate
make diagram    # regenerate docs/THETASHIELD_FLOW.excalidraw from the manifest
```

Solidity: **127 test functions discovered** across 24 `.t.sol` files — 111
unit/integration, 11 fuzz, 5 invariant. **124 pass** in an environment-neutral
run; the remaining **3** are the opt-in fork tests in
`test/fork/InfrastructureFork.t.sol`, skipped without live RPC configuration.
That is the reconciliation between the "124 passing" figure in
`WINNING_PITCH_SCRIPT.md` and the "127" here — one measurement, two
denominators. Python: **48 tests** across 8 modules. Quote exact counts from a
current `make verify` receipt rather than from any document, including this one;
the fork tests also flake against public RPCs.

`check_phase9.py` additionally enforces that the dashboard bundle contains
exactly H1–H6 with complete policy and scenario coverage, and rejects hardcoded
research data or hex identifiers in dashboard components.

## A6 · Judge questions

**Why two chains?** The latency-sensitive hook stays small and deterministic on
Unichain; delayed histories, bounded queues, confidence, persistence and
reference selection live in a separate processor. Cross-chain delivery is not
required for the current swap — it updates later swaps. On mainnet the same
mechanism runs with the processor co-located, which removes both Circle legs
from the loop without changing the math.

**Why would a trader accept it?** Routers choose on the all-in quote. The claim
is that LPs can hold a low baseline for ordinary flow instead of charging every
trader a permanent volatility premium — a benign trader is *cheaper* here than
under a volatility fee. That commercial claim still needs real routing, depth
and elasticity evidence; we do not have it.

**Can an operator label a wallet toxic?** No. There is no address in the
mechanism. Inputs are direction, price, notional and time.

**What if Circle or Reactive stops?** The current swap is unaffected. Existing
recommendations expire and the controller returns to baseline. Reactive is
outside the critical path, and a permissionless keeper can drive the same cycle.

**Is the live reference price real market data?** No — and this is the sharpest
limit in the project. `RESEARCH_V1` reads three fee tiers of a project-issued
pair on Ethereum Sepolia. The protected pool is a *different* pair on Unichain
Sepolia: four ERC-20s, two chains, no bridge, no arbitrage path, no economic
relationship — and all three tiers are moved together by one transaction of
ours. So dispersion rejection structurally cannot fire: the sampler publishes a
fixed confidence of 1.0 with no attenuation for depth, spread or age, and stamps
`observedAt` at sample time, so an untraded pool publishes a stale price with a
fresh timestamp. It exercises the full multi-source path — liquidity floors, robust
median, dispersion, confidence — against a market we control. Independent
evidence needs reference tiers co-located with the protected pair; that is the
next architectural step, not a claim we make today.

**Why didn't the live fee increase?** See slide 16. Sixteen trailing
observations per side are required; two have settled.

**What is the worst thing an attacker can do?** Delay or duplicate a Circle
relay, or withhold keeper work. Both slow learning. Neither forges a
recommendation, neither raises a fee, and neither blocks a swap. Coordinated
manipulation of the reference publishers remains a residual risk and is listed
as such in `docs/THREAT_MODEL.md`.

**What is the coverage ratio on the dashboard?** Bounded telemetry, not a
closed-loop controller — and we would rather say so than have you find it. The
coverage premium sits *inside* the toxicity gate, so a coverage deficit alone
can never move a fee; at shipped values a full deficit is worth about 62 pips of
a 9,500-pip range, and the rate limiter often clips more than the entire
coverage contribution. G1 records a negative fee-revenue delta.
`docs/ARCHITECTURE.md` and `SECOND_PASS_REVIEW.md` R2 carry the analysis and the
open decision.

**Has it been audited?** No. Unaudited research software on public testnets. The
hook has not been submitted. The automation plane's authentication surface
(`vmOnly`, `authorizedSenderOnly`, `rvmIdOnly`) lives in un-vendored
`reactive-lib` submodules — an external audit boundary named in
`docs/THREAT_MODEL.md`.

## A7 · Live counters (read on the page, not memorised)

At the time of writing: origin `observationCount` 5, controller `lastSequence`
2, both sides 500 pips with `usedBaseline` true; processor `pendingCount` 0,
`settledCount` 2, `expiredCount` 1, `droppedCount` 0, `lastObservationId` 4,
`recommendationSequence` 2; executor `cycleCount` 7; RSC wakes 2, observation
signals 1, phase `Idle`.

**These move.** Read them off the dashboard during the presentation rather than
quoting this paragraph — and if the header says the read is stale, say so.

## A8 · What the dashboard is called

Sections: *Outcome · Mechanism · Replay · Live proof · Execution log · Registry
· Evidence.* Headlines worth quoting verbatim because they are already on the
screen: **"Two comparisons, both measured."** · **"See the delayed fee travel."**
· **"Don't trust the demo. Read the contracts."** · **"Everything the queue has
done."** · **"Every claim opens to a receipt."** · **"The failures stayed in the
record."** · footer **"The pool remembers."**

The live-proof panel's baseline explanation is already written and is better
than an improvised one: *"The curve needs 16 trailing observations per side
before it can compute a dispersion at all, and this pool has settled 2 across
both sides. Confidence is therefore structurally zero and the 5 bps baseline is
the only answer available — not a judgement that the flow is benign."*

## A9 · What not to say

These are not stylistic preferences. Each one is a claim the deployment does not
support, and the repository's own gates and copy are written to avoid them.

- ✗ "Reactive is the authenticated cross-chain evidence transport." → Circle is.
  Reactive schedules.
- ✗ "Reactive calculates the fee" / "installs controller state." → It calls a
  bounded, permissionless executor and can do neither.
- ✗ "Circle schedules the delayed work." → Circle has no scheduling. That is
  precisely why Reactive is in the design.
- ✗ "The RSC stays alive indefinitely." → It requires monitored REACT credit;
  idle cron burn is an operational liveness requirement.
- ✗ "The three reference pools are independent price discovery." → One
  project-issued pair, three fee tiers, moved together by our own script. Their
  agreement is **structural**, not evidential.
- ✗ "A live non-baseline fee would be measured adverse selection." → Under the
  current reference topology it would be operator-moved, and must be presented
  as a **mechanism demonstration**.
- ✗ "The deployed testnet reference feed is a production oracle." → It is not.
- ✗ "ThetaShield reduces LVR" / "increases LP profit." → The metric is
  `notional × signed markout`, an adverse-selection **proxy**.
- ✗ Reading addresses or transaction hashes aloud. Put them on screen.
