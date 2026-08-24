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
- A permissionless keeper relays Circle attestations, syncs the reference feed,
  and calls the processor. Circle does not provide scheduling.
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

## Research boundary

The included mock reference feed is owner-published for deterministic testnet
acceptance. The independent Python model, golden vectors, synthetic scenarios,
H1–H6 analysis, and dashboard remain unchanged by the transport migration.
They are controlled research evidence, not live profitability evidence.

The former Reactive/Lasna architecture is retired. Historical phase handoffs
remain in the repository for auditability but are not deployable instructions.
