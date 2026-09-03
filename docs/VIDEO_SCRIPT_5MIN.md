# ThetaShield — Five-Minute Video Script

**Target:** 4:50–5:00. Never over 5:00.
**Audience:** UHI10 judges, plus the Circle and Reactive Network tracks.
**Style:** screen recording with voice-over. Ten segments, recorded separately
and cut together — do not attempt one take.

The spine of this video is the **proven run**: one real swap on Unichain that
changed the fee logic governing a later real swap on Unichain, with
authenticated Circle transport both ways and a Reactive-scheduled callback in
the middle, measured at **43m 12s** end to end. Everything before segment 7
exists to make that run mean something; everything after it says what it does
and does not prove.

Companion documents: [`docs/PITCH_DECK.md`](PITCH_DECK.md) (the same story at
presentation length, with an appendix of Q&A ammunition) and
[`docs/THETASHIELD_FLOW.excalidraw`](THETASHIELD_FLOW.excalidraw) (the canvas
segments 4–6 are cropped from). The older four-minute narrative in
[`docs/WINNING_PITCH_SCRIPT.md`](WINNING_PITCH_SCRIPT.md) remains valid; this is
the longer cut with the live run promoted to the centre.

---

## Before you record

**Screens to prepare, in tab order.**

| # | Screen | Notes |
|---|---|---|
| 1 | A title card, or slide 1 of the deck | 3 seconds of hold at the top |
| 2 | `thetashield.vercel.app` — hero | Let the live read land before recording; check the header does not say the read is stale |
| 3 | `docs/THETASHIELD_FLOW.excalidraw` — **band 1** | Open in excalidraw.com, zoom to the band, do not pan during a take |
| 4 | Same canvas — **band 2**, top row | The Circle → RSC → proxy → executor row |
| 5 | `thetashield.vercel.app/#live-proof` → **THE PROVEN RUN · LIVE RECEIPT TRAIL** | The six-receipt timeline; hover a row so the tooltip is visible |
| 6 | One explorer tab, pre-loaded on the final swap `0x43de2057…20e1b` | Proof that a receipt opens |
| 7 | Live-proof panel, **"Safe baseline active"** copy visible | The 16-vs-2 explanation |
| 8 | Execution log, the **`EXPIRED UNSCORED`** record for observation 4 | The honest failure |
| 9 | Evidence section — **RESERVED HOLDOUT** chart | The H4/H5 remediation |

**Safety pass before the first take.** Close the wallet extension. Close any tab
showing balances or account data. Confirm `.env`, shell history, API keys,
private keys and RPC URLs are not on screen. Enlarge browser text so it is
readable at the delivered resolution. **Do not connect a wallet or broadcast a
transaction during recording** — every screen in this video is a read.

**Pace.** The script is ~790 spoken words across 5:00 — a measured 158 words
per minute, with the pauses coming out of the screen transitions rather than out
of the sentences. Read it once against a stopwatch before the first take. If it
runs long, the trims are listed at the end; take them from segments 2, 6 and 9,
never from 8.

---

## Timing map

| Time | Len | Screen | Beat |
|---|---:|---|---|
| `0:00–0:26` | 26s | Title → hero | The loss nobody sees at execution |
| `0:26–0:48` | 22s | Policy table | Volatility is not toxicity |
| `0:48–1:08` | 20s | Hero, both fee tiles | The question that has a direction in it |
| `1:08–1:46` | 38s | Canvas band 1 | What the trader actually touches |
| `1:46–2:24` | 38s | Canvas band 2, left | Circle carries it; the processor scores it |
| `2:24–3:02` | 38s | Canvas band 2, purple | Reactive decides *when* |
| `3:02–3:46` | 44s | Run timeline → explorer | **The proven run — 43m 12s** |
| `3:46–4:16` | 30s | Baseline copy → execution log | Why it held, and the one that died |
| `4:16–4:40` | 24s | Reserved holdout chart | The research, including what failed |
| `4:40–5:00` | 20s | Hero, then black | Close |

---

## The script

### 0:00–0:26 · The loss nobody sees at execution

**Show:** title card for three seconds, then the dashboard hero. Do not scroll.

> A trader buys at a hundred. One minute later, the market is at a hundred and
> one.
>
> The swap succeeded. Nobody broke a rule. But the liquidity provider sold an
> asset one minute before it was worth more — and could not have known.
>
> A pool has to price a swap *before* it can know whether that swap was fair.
> That gap is where LP returns quietly go.

**Direction.** Let the two numbers land — a hundred, a
hundred and one; they — should be the only things on screen if you have a title card
that can hold them.

---

### 0:26–0:48 · Volatility is not toxicity

**Show:** the five-row policy table (deck slide 3, or the Evidence section's
**POLICY SEPARATION** chart — *"Signal-blind fees tax everyone."*).

> The usual answer is a volatility fee. But volatility is not toxicity.
>
> In our study, a volatility-only policy charged a premium in **sixty percent**
> of benign cases. It taxes ordinary two-sided noise — which is most of the
> time. ThetaShield reaches under eight percent, at a *lower* average fee.
>
> Synthetic streams, not live market data. But the wrong question shows
> through.

**Direction.** Highlight the volatility-only row, not the ThetaShield row.
Judges discount a chart where the presenter's own policy is the highlighted one.

---

### 0:48–1:08 · The question that has a direction in it

**Show:** the hero with both fee tiles visible — `BUY-BASE FEE` and
`SELL-BASE FEE`, each reading 5.00 bps.

> The right question has a direction in it. Not "is the market moving." Not "is
> this wallet suspicious." But: **which direction of flow was repeatedly
> followed by an adverse move?**
>
> ThetaShield gives the pool memory. Buying and selling get separate state, and
> separate fees. If buying keeps hurting LPs, only the buy side rises.

**Direction.** Two tiles, two numbers, on screen the whole time. This is the
idea of the project and it gets its own twenty seconds.

---

### 1:08–1:46 · What the trader actually touches

**Show:** canvas **band 1**, left to right. Move the cursor along the row as you
narrate; land it on the red `fail-open boundary` box for the last sentence.

> Here is everything a trader touches. An ordinary v4 swap.
>
> Before execution, the hook asks the controller for *this direction's* fee.
> Without a fresh, valid, confident recommendation, that is the safe five
> basis point baseline. The swap executes. Afterwards, the hook records what
> actually happened — direction, execution price, notional, timestamp — and
> tries to send it onward.
>
> That dispatch is wrapped in a try-catch. If the transport is down, the hook
> emits a failure event and the swap still completes.
>
> **Fail-open for evidence. Fail-closed for fees.** No second chain is ever in
> the critical path of a swap.

**Direction.** Thirty-eight seconds is generous for one row; use the slack to
pause before "fail-open for evidence, fail-closed for fees" and let it land. Do
not read addresses. Do not tour the contracts.

---

### 1:46–2:24 · Circle carries it, the processor scores it

**Show:** canvas **band 2**, blue and green boxes on the left. Hold on
`DeadBandFilter` and `TrailingVolatility` for the middle sentence.

> Circle CCTP carries that observation to a processor on Ethereum Sepolia.
> Relaying is permissionless — authentication is not. The recipient checks the
> local transmitter, the source domain, a one-time-sealed peer, and rejects
> anything unfinalized. A relayer can delay a message. It cannot forge one.
>
> Then the processor waits. It compares a later reference price against the
> execution price, and subtracts a strictly trailing volatility band — one that
> **excludes the very observation being scored**, so a trade cannot widen the
> threshold used to judge it.
>
> Ordinary noise filters to exactly zero. Only persistent, confidence-qualified
> evidence survives, and buy and sell never share a bucket.

**Direction.** The strictly-trailing detail is the most technically credible
thing in the video. Slow down for it. Skip the other eight libraries entirely.

---

### 2:24–3:02 · Reactive decides *when*

**Show:** canvas **band 2**, the purple boxes only — RSC → callback proxy →
executor.

> But that evidence is worthless until the markout horizon has passed. Somebody
> has to come back sixty seconds later.
>
> That is Reactive Network. Its contract watches the authenticated processor
> queue, waits out the horizon, and calls a bounded executor through the
> official callback proxy — which the executor checks against both the proxy
> address and the injected ReactVM identity. Both are public getters you can
> read right now.
>
> **Circle decides what is authentic. Reactive decides when eligible work
> runs.** Neither computes a fee — and a permissionless keeper can call the same
> cycle, so a scheduler outage degrades automation without stopping a swap.

**Direction.** This is the Reactive track's thirty seconds and it must be its
own beat, not a clause inside the Circle segment. The last sentence is the one
that matters: automation without custody, fee authority, or the ability to block
a trader.

---

### 3:02–3:46 · The proven run

**Show:** `#live-proof` → **THE PROVEN RUN · LIVE RECEIPT TRAIL**. Walk the six
rows as you say each leg. On "exactly the fee the controller expected," cut to
the pre-loaded explorer tab for two seconds, then back.

> This is deployed evidence, not a diagram. One complete run, read back from its
> own transactions.
>
> A real Uniswap v4 swap on Unichain. Circle delivers it to Ethereum —
> **twenty-three minutes, fifty-four seconds.** Reactive wakes the work in
> **thirty-six seconds.** The processor scores it and dispatches recommendation
> one. Circle carries it back and the controller authenticates and installs it.
> And a later PoolManager swap is charged **exactly the fee the controller
> expected.**
>
> **Forty-three minutes and twelve seconds, end to end. Six public
> transactions**, every one of them openable.
>
> Nearly forty minutes of that is Circle finality, both legs. Thirty-six seconds
> is the scheduler. And none of it was on the path of a swap.

**Direction.** Longest segment, and the one the whole video is for. Do not read
hashes aloud — say "every row opens to a public explorer" and show one opening.
The durations are read back from block timestamps on every cold start; they are
not stored numbers, and it is worth saying so if you have the breath.

---

### 3:46–4:16 · Why it held, and the one that died

**Show:** the live-proof panel's **"Safe baseline active"** block, then scroll to
the execution log and the **`EXPIRED UNSCORED`** record for observation 4.

> That recommendation stayed at five basis points — and that is the result, not
> a failure to act. The curve needs **sixteen** trailing observations per side.
> This pool has settled **two**. Confidence is structurally zero.
>
> The first live safety decision this system made was refusing to move a fee off
> a single sample.
>
> We also left a failure on the page. Observation four arrived, was never
> scored, and expired past its reference window — labelled, with its receipt.

**Direction.** Never cut this segment. Volunteering the expired observation is
worth more than any passing metric, and a judge reading the counters — five
observations, two settled, one expired — will notice the discrepancy whether or
not you explain it.

---

### 4:16–4:40 · The research, including what failed

**Show:** the Evidence section, **RESERVED HOLDOUT** — *"Failures remediated,
then re-scored once."*

> Two of our six hypotheses originally failed. Those failures are still in the
> repository, versioned, unedited.
>
> The remediation was scored **once**, on a reserved holdout with disjoint
> seeds: **fifty-nine point seven percent** of toxic coverage retained, and
> **twenty point eight points** fewer false positives.
>
> A deterministic synthetic study — not a profitability claim, and the metric is
> an adverse-selection proxy, not LVR.

**Direction.** "Still in the repository, versioned, unedited" is the sentence
that buys credibility for every other number in the video. The disclaimer at the
end is delivered at the same pace as the results, not rushed.

---

### 4:40–5:00 · Close

**Show:** back to the hero. Hold two seconds on the footer — *"The pool
remembers."* — then cut to black.

> ThetaShield is unaudited and testnet only, and the reference market is one we
> move ourselves — so this proves the machine, not the economics.
>
> It measures which direction of flow was harmful, prices it within bounds, and
> returns to baseline the moment the evidence disappears.
>
> **The pool remembers — without making the trader wait.**

**Direction.** Stop. No thank-you card, no team slide, no roadmap. Cut to black
on the last word.

---

## If a take runs long

Trim in this order. Each line is a clean cut that costs no claim:

1. **§0:26** — drop *"ThetaShield reaches under eight percent, at a lower
   average fee."* (−7s)
2. **§1:46** — drop *"Ordinary noise filters to exactly zero."* (−4s)
3. **§2:24** — drop *"Both are public getters you can read right now."* (−5s)
4. **§1:08** — drop *"and tries to send it onward"*, and start the next sentence
   at *"The dispatch is wrapped…"* (−4s)

**Never trim:** the fail-open sentence (§1:08), the Circle/Reactive authority
split (§2:24), the 43m 12s total (§3:02), or any part of §3:46.

---

## Do not say

Each of these is a claim the deployment does not support. They are the same
constraints the dashboard copy is written under.

- ✗ "Reactive is the cross-chain evidence transport." → **Circle** is. Reactive
  schedules.
- ✗ "Reactive calculates the fee" or "installs the recommendation." → It calls a
  bounded, permissionless executor and can do neither.
- ✗ "Circle schedules the delayed work." → Circle has no scheduling. That is why
  Reactive is in the design.
- ✗ "The three reference pools are independent price discovery." → They are one
  project-issued pair across three fee tiers, moved together by our own script.
  Their agreement is **structural**, not evidential.
- ✗ "A live non-baseline fee would be measured adverse selection." → Under the
  current reference topology it would be operator-moved, and must be described
  as a **mechanism demonstration**.
- ✗ "The testnet reference feed is a production oracle." → It is not.
- ✗ "ThetaShield reduces LVR" or "increases LP profit." → The metric is
  `notional × signed markout`, an adverse-selection **proxy**.
- ✗ Reading any address or transaction hash aloud. Show them; never narrate
  them.

---

## Shot list

| Shot | Source | Duration |
|---|---|---|
| Title card | deck slide 1 | 0:03 |
| Dashboard hero, both fee tiles | `thetashield.vercel.app` | 0:25 + 0:20 |
| Policy separation chart | `#evidence` → POLICY SEPARATION | 0:22 |
| Canvas band 1, slow left-to-right pan | `THETASHIELD_FLOW.excalidraw` | 0:38 |
| Canvas band 2, blue+green left half | same canvas | 0:38 |
| Canvas band 2, purple boxes | same canvas | 0:34 |
| Run timeline, six rows walked | `#live-proof` | 0:40 |
| Explorer, final swap receipt | blockscout | 0:04 |
| "Safe baseline active" block | `#live-proof` | 0:14 |
| Execution log, `EXPIRED UNSCORED` | `#execution-log` | 0:16 |
| Reserved holdout chart | `#evidence` | 0:26 |
| Hero + footer, hold, fade | `thetashield.vercel.app` | 0:16 |

**Capture settings.** 1920×1080 minimum, 30 fps, browser at a zoom level where
the smallest rendered label is legible in the delivered file. Record the voice
separately from the screen — reading while navigating produces both a worse read
and worse navigation.
