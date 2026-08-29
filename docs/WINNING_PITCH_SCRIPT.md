# ThetaShield — Four-Minute Judge Narrative

## Positioning

Do not pitch ThetaShield as another volatility-based dynamic-fee hook. Pitch it
as **directional memory for a Uniswap v4 pool**:

> ThetaShield measures what past flow actually did to LPs, filters ordinary
> noise, and adjusts only the direction for which persistent evidence shows
> adverse selection.

The presentation must distinguish three claims:

1. The live control loop is deployed and proven across Unichain Sepolia,
   Ethereum Sepolia, and Reactive Legacy Lasna.
2. The first live recommendation correctly stayed at the safe baseline because
   one sample has zero cold-start confidence.
3. The non-baseline directional transition is proven in the lifecycle test
   suite, but has not yet been shown in a second public live cycle.

Reactive Network is the active event-driven automation and resilience plane.
Circle remains the authenticated evidence and recommendation rail. Reactive
observes Circle-delivered processor state, schedules the maturity and
finalization wakes, and calls the bounded Ethereum executor; it never becomes
fee authority or a swap dependency.

## Four-minute script

### 0:00–0:30 — The loss nobody sees at execution

**Show:** one simple trade: buy at 100, reference price 101 one minute later.

“A pool prices a swap before it knows whether that swap was fair. Suppose a
trader buys at 100, and one minute later the market is at 101. The trader
captured the stale price, and the LP paid for that information gap.

A static fee treats every direction and every market condition the same. A
volatility fee often protects LPs by charging everyone more. Neither asks the
question that matters: did this direction of flow repeatedly harm the pool?”

### 0:30–0:55 — The thesis

**Show:** hero statement and two directional arrows.

“ThetaShield gives a Uniswap v4 pool memory. It records the execution, waits
for delayed price evidence, filters ordinary noise, and measures directional
markout. If buying repeatedly harms LPs, only the buy-side fee can rise. The
sell side can remain at the low baseline.

ThetaShield does not blacklist wallets, predict identities, delay the trader,
or custody the swap. It prices measured outcomes.”

### 0:55–1:30 — What happens during a real swap

**Show:** the top Unichain lane of the architecture.

“The trader experiences a normal Uniswap swap. Before execution, the hook asks
the controller for that direction’s fee. Without a fresh, valid, confident
recommendation, it uses the safe five basis-point baseline.

After execution, the hook records the pool, direction, execution price,
notional, timestamp, and sequence. It attempts to dispatch that evidence, but
transport failure can never revert the trader’s completed swap.”

### 1:30–2:05 — How a trade becomes evidence

**Show:** Circle and Ethereum processor lanes; animate only the numbered flow.

“Circle carries the finalized observation from Unichain Sepolia to the
processor on Ethereum Sepolia. Reactive Legacy Lasna sees the queued
observation, waits for the delayed evidence boundary, and sends an authenticated
callback to the bounded executor. A permissionless keeper remains available as
the independent fallback.

After the markout horizon, the processor compares the later reference price
with the execution price. A move in the trader’s direction is adverse evidence
for the LP. A move against the trader is favorable or inventory-improving
evidence.

The processor subtracts trailing volatility, caps oversized trades, ignores
microtrade spam, measures agreement and reference dispersion, and requires
confidence and persistence. Buy and sell flow never share a risk bucket.”

### 2:05–2:35 — From evidence to the next fee

**Show:** recommendation returning to the controller.

“Only positive, persistent, confidence-qualified risk can add a premium. The
fee is bounded and rate-limited. The recommendation returns through Circle,
where the controller verifies the transmitter, source domain, sealed peer,
pool, sequence, age, cooldown, confidence, risk, and fee bounds.

The next swap uses that recommendation. Invalid, missing, low-confidence, or
expired data returns the pool to baseline.”

### 2:35–3:05 — Public proof and the cold-start result

**Show:** the live acceptance receipts, then the fee-proof transaction.

“This is deployed evidence, not a mocked architecture. A real Uniswap v4 swap
created an observation on Unichain. Circle delivered it to Ethereum. Reactive
armed the work, issued separate maturity and finalization wakes, and both
authenticated callbacks succeeded publicly. The processor sent recommendation
sequence one back through Circle. The Unichain controller installed it, and a
later PoolManager swap used exactly the controller’s expected 500-pip fee.

That first recommendation remained at five basis points because one completed
sample deliberately has zero shared confidence. The system’s first live safety
decision was refusing to overreact. The local end-to-end lifecycle separately
proves the second-sample transition to a non-baseline directional fee.”

### 3:05–3:35 — Why Reactive Network is integral

**Show:** only the separate purple Reactive Network section.

“Reactive Network is ThetaShield’s event-driven automation and resilience
plane. It watches the authenticated processor queue, wakes work only after the
markout horizon, returns for epoch finalization, and retries bounded incomplete
cycles without a centralized cron server.

The proof is public: the final Legacy RSC emitted both wake requests, and the
official Ethereum callback proxy delivered both authenticated calls to our
executor. The executor sampled three independent v4 pools and advanced the same
permissionless processor a fallback keeper can call.

Circle decides which evidence is authentic. Reactive decides when eligible work
should run. That separation gives ThetaShield automation without giving the
scheduler custody, fee authority, or the ability to block a trader.”

### 3:35–4:00 — Evidence and close

**Show:** three proof points, then return to the hero statement.

“ThetaShield has 124 passing environment-neutral Solidity tests, 48 Python
tests, fuzz and invariant coverage, and a public three-network acceptance
trace. On the declared holdout, the
policy retained 59.70 percent toxic coverage while reducing false positives by
20.79 percentage points. That is a controlled synthetic study, not live LP
profit.

ThetaShield does not guess who is toxic. It measures which direction of flow
was harmful, protects future liquidity with bounded fees, and fails safely when
evidence disappears.

ThetaShield gives the pool memory—without making the trader wait.”

## Slide and screen strategy

Use six visual states, not six architecture slides:

1. **The stale-price loss:** one trade at 100, later market at 101.
2. **The distinction:** static fee versus volatility fee versus directional
   realized-outcome fee.
3. **The live swap:** hook asks for a fee, swap completes, evidence is emitted.
4. **The numbered architecture:** one 30-second pass through the solid arrows.
5. **The proof:** Circle receipts, installed sequence, and fee-proof swap.
6. **The result and close:** one holdout chart plus “The pool remembers.”

The architecture screen gets at most 30 seconds before the dedicated Reactive
section. Never tour every contract or read addresses aloud. Put transaction
links and addresses on screen for verification, not narration.

## Reactive Network section — live G10 proof

### Say

- “Reactive is ThetaShield’s event-driven automation and resilience plane.”
- “It observes Circle-delivered processor events, waits for the delayed
  evidence boundary, and issues the maturity and finalization wakes.”
- “Both G10 wakes produced public, authenticated Ethereum Sepolia callbacks;
  the executor sampled three reference pools and advanced bounded processing.”
- “Reactive supplies liveness while Circle preserves message authority, so a
  scheduler failure cannot block swaps or forge a recommendation.”

### Do not say

- Reactive is the authenticated cross-chain evidence transport.
- Reactive calculates fees or installs controller state.
- The RSC remains active forever without lREACT credit monitoring.
- Circle schedules delayed work automatically.
- The deployed testnet reference feed is a production oracle.
- The three live reference pools are independent price discovery. (They are one
  self-contained project-issued pair across three fee tiers, moved together by
  `runMoveReferences()`; their agreement is structural, not evidential.)
- A live non-baseline fee would be measured adverse selection. (Under the current
  topology it would be operator-moved, and must be shown as a mechanism demo.)

## Judge questions

### Why use two chains?

The latency-sensitive hook remains small and deterministic on Unichain, while
delayed histories, bounded queues, confidence, persistence, and reference
selection live in a separate processor. Cross-chain delivery is not required
for the current swap; it updates later swaps.

### Why would a trader use it?

Routers choose pools by the all-in quote. ThetaShield aims to let LPs maintain a
low baseline for ordinary flow instead of charging every trader a permanent
volatility premium. Its commercial claim still requires real-market routing,
depth, and elasticity evidence.

### Can an operator label a wallet toxic?

No. The mechanism evaluates delayed directional price outcomes and never uses a
wallet blacklist or identity score.

### What if Circle or Reactive stops?

The current swap continues. Existing recommendations expire, and the controller
returns to the bounded baseline. Reactive is outside the critical path.

### Is the live reference price real market data?

No. The `RESEARCH_V1` reference market is three fee tiers of a project-issued pair on
Ethereum Sepolia, separate from the protected Unichain pair, seeded and moved by us.
It exercises the full multi-source path — liquidity floors, robust median, dispersion,
confidence — against a market we control. Independent evidence needs reference tiers
co-located with the protected pair; that is the next architectural step, not a claim
we make today.

### Why did the live fee not increase?

The first completed sample is deliberately cold start and has zero shared
confidence. A safety mechanism that moved the fee from one observation would be
easier to demo but easier to manipulate. The next public evidence milestone is
a second mature cycle showing a non-baseline directional fee.

## Final rehearsal rules

- Target 3:50–3:58; never exceed four minutes.
- Lead with the LP loss, not Circle, Reactive, contracts, or equations.
- Do not spend more than 30 seconds on the main architecture.
- Show one numbered lifecycle and one economic result.
- Explain the baseline live result before a judge can frame it as a failure.
- Give Reactive its own 30-second section, with the canary boundary visible.
- End immediately after “without making the trader wait.”
