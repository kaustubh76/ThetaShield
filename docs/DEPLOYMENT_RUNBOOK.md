# Deployment Runbook

## Release boundary

Phase 7 supplies read-only preflight and local dry-runs. Phase 8 adds separately
reviewable broadcast-capable scripts. A live Phase 8 deployment may begin only
after all network values are independently rechecked, the scripts have completed
without `--broadcast`, an exact native-token and fiat cost estimate is shown to
the owner, and the owner explicitly approves the transaction spend.

## Required inputs

Copy `.env.example` to an untracked `.env` and fill every value for the selected
origin, reference, and Reactive networks. The public owner/deployer default is
`0xd1DcAAFf9356d5a42f2eE6F90179C4509386a83f`; the corresponding private key must
remain outside Git and must never be pasted into a manifest or issue.

Do not use `MockNormalizedReferencePriceFeed` for a production deployment. The
Phase 8 configuration is explicitly a Sepolia/Lasna research demonstration with
owner-published prices and official Uniswap test routers. A production release
still requires a reviewed external adapter, publisher allowlist, decimals,
heartbeat, market ID, source IDs and production router/liquidity policy.

## Preflight sequence

1. Check out the exact intended commit with recursive submodules and require a
   clean working tree.
2. Run `FOUNDRY_PROFILE=ci make verify` and `make phase7-check`.
3. Set the opt-in RPC and infrastructure values, then run `make fork-check`.
   Both fork checks must execute; a skipped test is not acceptable for Phase 8.
4. Run the read-only origin preflight:

   ```sh
   forge script script/Phase7DeploymentPreflight.s.sol:Phase7DeploymentPreflight \
     --rpc-url "$ORIGIN_RPC_URL" --sig "runOrigin()" -vv
   ```

5. Run the read-only Reactive preflight:

   ```sh
   forge script script/Phase7DeploymentPreflight.s.sol:Phase7DeploymentPreflight \
     --rpc-url "$REACTIVE_RPC_URL" --sig "runReactive()" -vv
   ```

6. Record both configuration fingerprints. A changed fingerprint invalidates a
   previous review.
7. Simulate the proposed Phase 8 transactions, estimate cost with current fee
   data, and present the complete transaction list and maximum spend for
   explicit approval. Do not add `--broadcast` before approval.

## Intended Phase 8 dependency order

1. Confirm official PoolManager, callback proxy, Reactive system, Cron topic,
   chain IDs, explorers, and production reference source.
2. Deploy/configure the reference adapter or confirm the reviewed external feed.
3. Deploy the origin controller with the callback proxy, RVM ID, and final
   two-step owner.
4. Mine the hook address with the required Uniswap v4 permission bits, deploy
   the hook against the reviewed PoolManager/controller, and initialize the
   dynamic-fee pool.
5. Configure pool bounds, confidence floor, maximum lifetime, cooldown, and
   initial pause state on the controller.
6. Deploy the Reactive contract with the exact origin hook, controller,
   reference source, market/pool identifiers, Cron topic, and bounded scheduler.
7. Confirm subscriptions and fund only the minimum reviewed callback budget.
8. Verify source on each explorer, then execute one bounded acceptance swap and
   trace observation, reference, Cron processing, callback, and subsequent fee.
9. Transfer/accept ownership according to the approved key policy.

## Phase 8 script boundary

- `DeployOrigin.s.sol` requires the initial owner, deployer and expected RVM ID
  to be the same reviewed account. It checks both routers resolve to the exact
  configured PoolManager before recording any transaction.
- `DeployReactive.s.sol` uses the hard-coded
  `THETASHIELD_PHASE8_SINGLE_SOURCE_TESTNET_DEMO_V1` profile. Its single-source
  confidence is capped at 60%; it is intentionally easier to exercise than the
  Phase 6.1 research candidate and must not be represented as that candidate.
- `Phase8Acceptance.s.sol` separates the swap and feed publication so their
  timing and costs can be controlled. A complete adverse-flow trace requires two
  swap/reference cycles plus Reactive CRON processing and successful callbacks.

## Manifest and acceptance evidence

Every dry-run or live release record must validate against
`deployments/manifest.schema.json` and include the source revision, networks,
component addresses, transaction hashes, blocks, explorers, verification,
subscriptions, preflight fingerprints, acceptance transactions, estimated and
actual cost, and approval status. RPC URLs and credentials are referenced only
by secret name, never stored.

## Abort and recovery

Abort on any chain/address/code mismatch, changed fingerprint, skipped required
fork test, unexpected bytecode, cost increase beyond approval, failed source
verification, or incomplete callback trace. Before a test involving value,
ensure the controller is at baseline or paused. If the system misbehaves after
deployment, pause globally, stop funding callbacks, retain all transaction
evidence, and do not retry until the cause is understood. Contract deployment
is irreversible; a pause is containment, not rollback.
