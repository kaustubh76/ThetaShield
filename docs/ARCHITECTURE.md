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

Reactive Network
  processor events + CRON -> ThetaShieldAutomationRSC
                                  |
                                  | authenticated callback
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
- `ThetaShieldAutomationRSC` observes queued work and Reactive CRON, waits for
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

The former Lasna design that duplicated markout calculation and attempted a
direct controller callback remains retired. The current Reactive integration
automates the Circle processor without becoming a second data transport or
recommendation authority.
