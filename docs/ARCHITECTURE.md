# Architecture

ThetaShield separates the latency-sensitive swap path from delayed statistical
processing and uses Circle CCTP V2 only as the authenticated cross-chain
transport.

```text
Unichain Sepolia
PoolManager -> ThetaShieldHook -> ThetaShieldCircleTransport
      ^             |                       |
      |             | fee lookup            | finalized CCTP observation
      |             v                       v
      +------ ThetaShieldController   Ethereum Sepolia
                    ^                ThetaShieldCircleProcessor <- keeper
                    |                       ^
                    | finalized CCTP        | delayed reference feed
                    +-- recommendation -----+

Reactive Legacy Lasna
  Ethereum processor events + official Cron10 -> ThetaShieldAutomationRSC
                                  |
                                  | authenticated callback to Ethereum Sepolia
                                  v
                    ThetaShieldAutomationExecutor
                      -> sample -> sync -> process
```

## Responsibilities

- `ThetaShieldHook` applies a bounded directional fee, emits complete execution
  evidence, and attempts Circle dispatch after the swap. Dispatch failure emits
  an event but does not revert the swap.
- `ThetaShieldCircleTransport` accepts observations only from the sealed hook
  and sends finalized CCTP messages to the sealed processor peer.
- `ThetaShieldCircleProcessor` accepts only finalized messages from Circle's
  local transmitter, the Unichain domain, and the configured transport. It owns
  the fixed-size queue, reference history, epoch logic, persistence, confidence,
  and directional fee calculation.
- A permissionless keeper samples the configured v4 reference pools, syncs
  their distinct readings, relays Circle attestations, and calls the processor.
  Circle does not provide scheduling.
- `ThetaShieldAutomationRSC` observes queued work and official Legacy `Cron10`, waits for
  maturity, triggers bounded execution, follows epoch finalization, and caps
  retries. It is the event-driven automation and resilience plane.
- `ThetaShieldAutomationExecutor` authenticates the Reactive callback lane and
  exposes the same bounded sample/sync/process cycle permissionlessly for
  keeper redundancy. It cannot install controller state directly.
- `ThetaShieldController` accepts only finalized messages from Circle's local
  transmitter, the Ethereum domain, and the one-time-sealed processor. It then
  checks pool, sequence, lifetime, cooldown, confidence, fee, and risk bounds.

## Message lifecycle

Observation and recommendation bodies use fixed, versioned encodings in
`CircleMessages`. Both CCTP sends request the finalized threshold (`2000`).
Unfinalized delivery always reverts. Destination peers are sealed once after
deployment. CCTP delivery is permissionless, while the message transmitter,
domain, and sender fields provide authentication.

## Failure behavior

The swap path is fail-open only for observation transport availability. The fee
path remains conservative: missing, paused, low-confidence, not-yet-valid, or
expired recommendations return the baseline. Invalid Circle messages revert and
cannot advance replay state. A stopped keeper delays updates; it does not stop
swaps, and existing recommendations expire.

## Bounded processing

Each processor deployment serves one pool and market. Pending observations,
work per call, reference sources, per-source history, epoch observations,
trailing history, persistence, and fast-path hold are constructor-bounded.
Reference selection uses delayed readings inside the observation's maturity
window. Strictly trailing volatility excludes the sample being scored.

## Reference evidence

`RESEARCH_V1` uses `PoolMedianReferenceSampler`: a permissionless adapter over
three configured Uniswap v4 pools. Each pool must meet its own active-liquidity
floor and becomes a distinct normalized source. The processor then applies its
existing robust median, weighted dispersion, and agreement confidence logic.
`DEMO_V1` retains the owner-published mock only for deterministic local and
historical acceptance tests.

**What the live reference market is not.** The three configured pools are three
fee tiers of a single project-issued pair (`tsrALPHA`/`tsrBETA`) on Ethereum
Sepolia. The protected pool is a *different* pair (`tsALPHA`/`tsBETA`) on
Unichain Sepolia. Four ERC-20s, two chains, no bridge and no arbitrage path
between them — the two markets have no economic relationship, and all three
reference tiers are moved together by one operator transaction
(`runMoveReferences()` in `script/CircleAcceptance.s.sol`). So the sampler's
agreement, dispersion and confidence machinery is fully exercised but cannot
reject: agreement is structural rather than evidential, the sampler publishes a
fixed `confidenceWad = 1e18` with no attenuation for depth, spread or age, and
it stamps `observedAt` at sample time, so an untraded pool publishes a stale
price with a fresh timestamp. Live markout therefore **demonstrates the
mechanism rather than measuring adverse selection**. Reference tiers co-located
with the protected pair are the next architectural step, not a claim made today.

## Coverage accounting

`FeeCurve.calculateClosedLoop` tracks realized fee revenue against estimated
loss per side and exposes a coverage ratio against a 1.25x target. It is
**bounded telemetry with a small nudge, not a closed-loop controller**, and the
distinction is deliberate:

- the coverage premium is computed *inside* the toxicity gate, so a coverage
  deficit on its own can never move a fee — it only amplifies an already
  triggered directional state;
- at shipped values (`coverageGainFeePips` 50 against `gainFeePips` 450,000) a
  full `1.25e18` deficit is worth roughly 62 pips of a 9,500-pip range, and the
  `maximumIncreasePips` rate limit routinely clips more than the whole coverage
  contribution;
- the G1 experiment records `elastic_fee_revenue_delta_quote_wad = -0.011` — it
  does not improve mean fee revenue in that deterministic synthetic setting; and
- each premium is clamped individually before the sum is clamped again, so a
  consumer reading `EpochFinalized` must not assume `toxicPremiumPips +
  coveragePremiumPips == premiumPips`.

Coverage accounting is asymmetric to risk accounting by construction: loss uses
raw markout and uncapped notional, risk uses dead-band-filtered markout and
capped notional. See `docs/SECOND_PASS_REVIEW.md` R2 for the full analysis and
the open decision.

The former Omni design that duplicated markout calculation and attempted a
direct Unichain controller callback remains retired. The current Legacy Lasna
integration calls the Ethereum processor executor, removing the failed
chain-1301 Omni queue while automating the Circle processor without becoming a
second data transport or recommendation authority.
