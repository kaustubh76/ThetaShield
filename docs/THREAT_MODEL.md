# Threat Model

## Objective

An invalid, untrusted, stale, or unavailable recommendation must not create an
unbounded fee or stop swaps. The safe fee response is rejection or the
configured baseline. ThetaShield is unaudited research software.

## Trust boundaries

- Uniswap v4 `PoolManager` is trusted to invoke the hook and report pool state.
- Circle CCTP V2 `MessageTransmitterV2`, its attestation service, and supported
  domain mapping are cross-chain trust boundaries.
- The keeper is untrusted and permissionless: it can delay, duplicate, or omit
  work, but cannot forge a valid Circle peer or bypass sequence/timing checks.
- Reference publishers are trusted for their readings. The included
  single-owner mock feed is testnet-only and not production-safe.
- The two-step controller/transport owner, RPCs, deployer device, dependencies,
  and CI are operational trust boundaries.

## Threats and controls

| Threat | Control |
|---|---|
| Direct hook call | Immutable PoolManager-only base hook; dynamic-fee pools only. |
| Circle sender spoof | Recipient checks local transmitter, source domain, sealed peer, and finalized threshold. |
| Replay or reordering | Monotonic observation, reference, and recommendation sequences. |
| Unfinalized message | Both recipients reject unfinalized delivery; sends request threshold 2000. |
| Circle/keeper outage | Hook dispatch failure cannot revert a swap; stale recommendations expire to baseline. |
| Malformed or wrong-pool data | Versioned fixed-size messages plus pool, direction, amount, price, time, and bounds validation. |
| Gas/storage griefing | Fixed pending slots, histories, epoch capacity, source count, and work per processor call. |
| Oracle staleness/manipulation | Maturity/selection windows, future-time bound, monotonic source sequence, confidence weighting, and dispersion; coordinated publishers remain residual risk. |
| Cold-start overreaction | Minimum trailing observations, cold-start sigma, persistence, confidence/notional gates, bounded fast path. |
| Fee manipulation | Per-pool min/baseline/max, global fee ceiling, risk bound, confidence floor, lifetime, and cooldown. |
| Owner/deployer error | Two-step ownership, one-time peer sealing, fail-closed chain/domain/address/code preflights, exact simulation. |
| Dependency/secret substitution | Pinned submodules/toolchains/actions and tracked-secret scanning. |

## Residual blockers

- Replace the mock feed with an independently reviewed production adapter and
  publisher/heartbeat/decimal policy.
- Obtain independent smart-contract, economic, and infrastructure audits.
- Add monitored keeper redundancy and alerts for stuck CCTP messages, queue
  pressure, expiring recommendations, and transport failures.
- Use hardware-backed or multisig ownership for anything valuable.
- Revalidate Circle and Uniswap addresses immediately before every release.
- Testnet evidence cannot establish mainnet safety or profitability.
