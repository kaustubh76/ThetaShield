# Deployments

The Phase 8D Circle deployment and complete two-chain acceptance trace are
recorded in
`unichain-sepolia-ethereum-sepolia-circle-phase8d-live.json`. It covers the
live Unichain Sepolia hook/controller/transport and Ethereum Sepolia demo
feed/processor deployed from revision
`7dcaadad351b238a64133f053f195e11d9a2ef71`.

The files in `archive/` are historical non-broadcast Omni/Lasna dry runs and
must not be used. New Circle + Reactive Legacy dry-runs and live records use
schema version 3.

`manifest.schema.json` records source revision, Circle domains, components,
observation/recommendation relay transactions, later-fee evidence, the pinned
Legacy Lasna system/CRON/callback identity, its real callback receipt, and
separate approved/actual native-token costs. RPC URLs are referenced by secret
name only. The Phase 8D manifest intentionally has no `reactive_automation`
object because that historical lifecycle did not use Reactive.

Secrets and funded credentials must never be stored here. The live manifest
contains public addresses, receipts, message hashes, acceptance evidence, and
costs only. `verified: false` means explorer source verification is not claimed;
on-chain runtime and configuration checks are documented separately.
