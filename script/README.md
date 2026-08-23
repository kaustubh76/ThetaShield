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

`DeployOrigin.s.sol` deploys the Sepolia demo feed, fixed-supply test tokens,
controller, deterministic hook factory/hook, dynamic-fee pool and bounded test
liquidity. `DeployReactive.s.sol` installs the single-source testnet demo profile
on Lasna and creates the three subscriptions. `Phase8Acceptance.s.sol` keeps the
acceptance swap and reference publication as separate, independently simulated
transactions.

All three Phase 8 scripts are broadcast-capable by design. Run them without
`--broadcast` first. No `--broadcast` command may be used until the current
native-token and fiat estimate is approved by the owner. The included reference
feed and official Uniswap test routers make this a testnet research release, not
a production release for valuable assets.
