# Scripts

`Phase7DeploymentPreflight.s.sol` performs read-only origin and Reactive network
validation. It checks exact chain IDs, required bytecode, nonzero/distinct
addresses and identifiers, the pinned Reactive system address, and the callback
gas bound. It contains no broadcast call.

Run its `runOrigin()` and `runReactive()` entry points as documented in
`docs/DEPLOYMENT_RUNBOOK.md`. A successful run emits a configuration fingerprint
that must be recorded in the deployment manifest.

`check_dependencies.py` verifies pinned build inputs and
`check_secrets.py` rejects common credential material in tracked files. They are
part of `make verify` and `make phase7-check`.

Any future broadcast-capable Phase 8 script must reuse the fail-closed validation
library and remain separated from preflight. No broadcast occurs without a
current cost estimate and explicit approval.
