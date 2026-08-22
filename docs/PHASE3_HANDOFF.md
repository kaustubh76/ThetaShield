# Phase 3 Verification Handoff

## Scope completed

Phase 3 implements and locally verifies the bounded Reactive scheduler without
deploying or sending a paid transaction.

Delivered:

- `ThetaShieldReactive`, with one immutable-in-practice pool/market
  configuration per deployment;
- exact swap, normalized-reference, and official Lasna `Cron1` subscriptions;
- Reactive-system-only log handling with strict chain, emitter, topic, indexed
  identifier, decoding, sequence, and timestamp validation;
- fixed pending-observation storage, bounded per-Cron scanning, maturity,
  reference-selection, settlement, and expiry;
- an explicit allowlist of reference sources with bounded per-source history;
- token-decimal and execution-price normalization;
- confidence-weighted reference median and dispersion;
- strictly trailing volatility, signed dead-band scoring, per-direction bounded
  epochs, persistence, confidence, risk smoothing, and rate-limited fee output;
- cold-start and low-confidence premium suppression;
- one sequenced recommendation callback at most per Cron reaction;
- `INormalizedReferencePriceFeed`, `IReferencePriceAdapter`, and
  `ReferencePriceNormalizer` adapter boundaries; and
- an explicitly labeled owner-published mock feed for local testing only.

## Lifecycle and bounds

An observation becomes eligible only at `observedAt + markoutHorizon`. For each
allowed source, the scheduler selects the earliest normalized reference sample
whose timestamp falls between maturity and the end of the configured selection
window. It settles when the configured minimum source count is available, or
uses the available sources after that selection window closes. If no reference
is available by the observation lifetime, the observation expires.

The constructor enforces these absolute ceilings:

| Resource | Absolute maximum |
|---|---:|
| Pending observations | 256 |
| Slots inspected per Cron | 64 |
| Observations per directional epoch | 128 |
| Reference sources | 16 |
| Stored samples per source | 8 |
| Absolute markout | 10 WAD |

Configured limits may be lower. The scheduler scans a fixed number of slots per
Cron call even when slots are empty, so work cannot grow with an unbounded event
history. Reference, markout-history, persistence, missing-epoch, and epoch loops
are also bounded.

## Callback contract

The callback payload calls `ThetaShieldController.applyRecommendation` with the
pool ID, both directional fees and signed risks, confidence, validity window,
and a strictly increasing sequence. Its first address argument is encoded as
zero because the Reactive callback proxy replaces that word with the RVM ID.
The official local simulator exercises this replacement and successfully
updates the Phase 2 controller through its authenticated callback proxy.

The scheduler returns the configured baseline for a direction unless that
direction has positive risk, active persistence, and confidence at or above the
fee floor. Cold-start epochs cannot activate toxic persistence. This keeps the
callback compatible with the Phase 2 controller's independent premium safety
checks.

## Reference-price trust boundary

`ReferencePricePublished` contains a market ID, source ID, monotonic per-source
sequence, WAD price, WAD confidence, and observation timestamp. The scheduler
accepts only constructor-allowlisted sources from its configured feed contract.
Duplicate or out-of-order sequences, invalid confidence, zero values, malformed
data, and timestamps beyond the configured future-skew allowance revert. A
sample accepted within that allowance is not used before its own timestamp.

`MockNormalizedReferencePriceFeed` is centralized development scaffolding. It
is not decentralized, manipulation-resistant, or production-safe. Phase 3 does
not claim that a production price adapter has been selected. A future live
deployment must define its oracle publisher, liveness, staleness, aggregation,
decimal, and failure assumptions explicitly.

## Dependency and network integrity

The official Reactive libraries are Git submodules pinned by the parent
repository:

- `reactive-lib` commit
  `f6990ce3526928d039fec78855b2004ff8d65c9f`;
- `reactive-test-lib` commit
  `2ff9b2a68ca9956306ec943c10d1c757c1dd1956`.

Phase 3 uses Lasna chain ID `5318007`, system contract
`0x0000000000000000000000000000000000fffFfF`, and the `Cron1(uint256)` topic
recorded in `.env.example`. These are development-network values and must be
rechecked against official records immediately before deployment.

The compiler uses the IR pipeline with the already pinned optimizer settings.
This keeps `ThetaShieldReactive` below the EIP-170 runtime limit; the Phase 3
size gate records 21,060 bytes with 3,516 bytes of runtime margin.

## Verification evidence

Focused Phase 3 checks pass with:

- Reactive scheduler integration: 10 passed, 0 failed;
- reference-price normalization: 2 passed, 0 failed;
- official simulator callback execution into the real controller: pass;
- format and warning-denied Solidity lint: pass; and
- scheduler EIP-170 runtime-size check: pass.

The CI-profile whole-repository gate completed with 71 Foundry tests and 15
Python tests passing, including six Solidity properties at 2,000 fuzz runs
each, shared golden-vector checks, and the deterministic benign-noise check.

The final phase commit is gated by the CI-profile whole-repository command:

```sh
FOUNDRY_PROFILE=ci make verify
```

## Explicit limitations

- Contracts are unaudited research code and have not been deployed.
- The development mock feed is not a production oracle.
- Phase 4 still must connect a real local Uniswap v4 pool and hook observation
  directly through the Reactive simulator to the controller in one lifecycle.
- Live callback-proxy, RVM, pool, feed, and deployment addresses remain unset.
- No private key is stored or required for this phase.
