# Deployments

The current G10 `RESEARCH_V1` deployment and its complete Circle + Reactive
Legacy acceptance trace are recorded in
`unichain-sepolia-ethereum-sepolia-reactive-legacy-kaustubh76-live.json`. It
contains the three-pool reference sampler, paired lenses, authenticated Legacy
callbacks, returned Circle recommendation, later fee-proof swap, and the
approved-versus-actual spend record for revision
`4b3aff6247349a581275839f280d9902de3ceccd`.

The earlier Phase 8D Circle deployment used the owner-published single-source
demo feed and was recorded in this same file before it was regenerated for the
G10 `RESEARCH_V1` release at revision
`4b3aff6247349a581275839f280d9902de3ceccd`. There is therefore no separate
Phase 8D manifest on disk; that lifecycle survives as narrative history in
`README.md` and `docs/`, not as a distinct record here.

The files in `archive/` are historical non-broadcast Omni/Lasna dry runs and
must not be used. New Circle + Reactive Legacy dry-runs and live records use
schema version 3.

`manifest.schema.json` records source revision, Circle domains, components,
observation/recommendation relay transactions, later-fee evidence, the pinned
Legacy Lasna system/CRON/callback identity, its real callback receipt, and
separate approved/actual native-token costs. RPC URLs are referenced by secret
name only. A manifest recorded before Reactive automation existed carries no
`reactive_automation` object; the current live manifest does carry one, because
the G10 lifecycle is driven by the Reactive Legacy Lasna RSC and executor.

Secrets and funded credentials must never be stored here. The live manifest
contains public addresses, receipts, message hashes, acceptance evidence, and
costs only. `verified: false` means explorer source verification is not claimed;
on-chain runtime and configuration checks are documented separately.
