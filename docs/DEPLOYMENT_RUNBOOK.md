# G10 Circle + Reactive Legacy Deployment Runbook

## Release boundary

This is an unaudited two-testnet demonstration. Do not broadcast until the exact
commit passes all gates, both live infrastructure checks pass, every transaction
has been simulated at the current nonce, a total maximum spend is presented,
and the owner explicitly approves the combined Circle, Ethereum callback, and
Legacy lREACT spend. Do not submit the hook.

## Networks

| Role | Chain | Chain ID | Circle domain |
|---|---|---:|---:|
| Origin | Unichain Sepolia | 1301 | 10 |
| Processor/reference | Ethereum Sepolia | 11155111 | 0 |
| Automation | Reactive Legacy Lasna | 5318007 | N/A |

The current testnet `MessageTransmitterV2` configured in `.env.example` is
`0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` on both chains. Recheck Circle's
official address registry immediately before simulation and broadcast.

The `RESEARCH_V1` reference market is self-contained on Ethereum Sepolia. Its
release profile pins Uniswap's active v4 `PoolManager`
`0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` and the matching test liquidity
and swap routers. The processor script creates two test tokens and three
no-hook pools at 0.05%, 0.30%, and 1.00% fee tiers, provides bounded liquidity,
and wires their distinct pool/source IDs into the sampler. Recheck the
[official Uniswap deployment feed](https://developers.uniswap.org/deployments.json)
and both live router `manager()` values before release.

The automation RPC is `https://lasna-rpc.rnk.dev/`, not the Omni RPC. The
release uses the official Legacy `Cron10` topic and sends callbacks to the
Ethereum Sepolia proxy `0xc9f36411C9897e7F959D99ffca2a0Ba7ee0D7bDA`.
The pinned Legacy system runtime hash prevents the shared chain ID from hiding
an accidental Omni connection. See `REACTIVE_LEGACY_MIGRATION.md`.

## Required checks

Keep `THETASHIELD_PROFILE=RESEARCH_V1` for a release. `DEMO_V1` is an explicit
accelerated demonstration profile and is not research-equivalent. Both chain
simulations must emit the same profile ID; record the name and ID in the new
deployment manifest.

```sh
cp .env.example .env
make verify
make fork-check

forge script script/CircleDeploymentPreflight.s.sol:CircleDeploymentPreflight \
  --rpc-url "$ORIGIN_RPC_URL" --sig "runOrigin()" -vv
```

After the reference feed exists, run `runProcessor()` against
`$PROCESSOR_RPC_URL`. A skipped fork test, wrong chain/domain, noncanonical
transmitter, missing code, router/PoolManager mismatch, dirty source tree, or
changed fingerprint or profile ID aborts the release.

After setting nonzero, separately approved callback reserves, run both Legacy
preflights without `--broadcast`:

```sh
forge script script/ReactiveLegacyPreflight.s.sol:ReactiveLegacyPreflight \
  --rpc-url "$PROCESSOR_RPC_URL" --sig "runProcessor()" -vv

forge script script/ReactiveLegacyPreflight.s.sol:ReactiveLegacyPreflight \
  --rpc-url "$REACTIVE_RPC_URL" --sig "runReactive()" -vv
```

A wrong Legacy system code hash, wrong Sepolia callback proxy, nonofficial CRON
topic, `Cron1` release cadence, zero reserve, or Omni RPC aborts the release.

## Dependency order

1. Simulate `DeployCircleOrigin.s.sol` on Unichain Sepolia. It deploys the
   transport, controller, demo tokens, hook factory, deterministic hook, dynamic
   pool, approvals, and bounded demo liquidity. Record all predicted addresses
   and costs.
2. Put the predicted origin transport, controller, hook, and pool ID in the
   untracked environment, then simulate `DeployCircleProcessor.s.sol` on
   Ethereum Sepolia. Under `RESEARCH_V1` this single nonce-consistent stack
   deploys and funds the three reference pools, sampler, processor, processor
   Lens, and funded Legacy callback executor. Verify the locked manager and
   routers, all three emitted pool/source IDs, 18-decimal orientation,
   liquidity floor, callback proxy, `reactiveRvmId()`, and every predicted
   address. `DEMO_V1` alone deploys the owner-published fixture without the
   executor.
3. Run the Legacy read-only preflight, then prepare
   `DeployAutomationRSC.s.sol` only through the Legacy Lasna RPC. Verify the
   pinned system bytecode, official `Cron10` topic, callback gas, retry policy,
   and approved initial lREACT funding. The deploying EOA must match the
   executor's stored ReactVM identity. Lasna's subscription precompile reverts
   under Forge's forked `eth_call` simulation path, including for already-live
   Ethereum contracts; therefore the local full-cycle tests, live read-only
   preflight, exact initcode review, conservative gas ceiling, and fresh spend
   approval are the pre-broadcast gates. Do not mistake the simulation
   limitation for a successful subscription: after broadcast, all three live
   subscriptions must be verified with `rnk_getSubscribers` before continuing.
4. Simulate `ConfigureCirclePeers.s.sol` on Unichain. This one-time action seals
   the hook/processor peers; verify every value before signing.
5. Sum all-chain deployment, callback reserves, Legacy lREACT funding, and configuration costs,
   preserve a safety margin, and obtain fresh explicit approval. Earlier
   Circle or lREACT approvals do not authorize the G10 release.
6. Broadcast only the reviewed transactions in the same dependency order and
   record receipts before continuing.

## Acceptance lifecycle

Each paid action is separate so it can be simulated and approved:

1. Run `CircleAcceptance.runSwap()` on Unichain. The swap sends an observation.
2. Fetch the finalized attestation:

   ```sh
   python3 script/fetch_circle_attestation.py --source-domain 10 --tx-hash <swap-tx>
   ```

3. Set `CIRCLE_MESSAGE`, `CIRCLE_ATTESTATION`, and the destination transmitter,
   then simulate/broadcast `RelayCircleMessage.s.sol` on Ethereum Sepolia.
4. To make the delayed evidence visually obvious, run the bounded
   `CircleAcceptance.runMoveReferences()` action on Ethereum Sepolia, then wait
   for the configured markout horizon.
5. Run a fresh Legacy automation cycle. Confirm the RSC observed
   `ObservationQueued`, an official `Cron10` signal produced `WakeRequested`,
   the destination transaction called `executeFromReactive`, and
   `AutomationCycleCompleted.reactiveTrigger` is true. The executor samples and
   syncs all three references before bounded processing. The permissionless
   `CircleAcceptance.runSampleReferences()` and `runProcessResearch()` calls
   remain the recovery path, not the primary acceptance proof.
6. Fetch that transaction's attestation with source domain `0` and relay it on
   Unichain using `RelayCircleMessage.s.sol`.
7. Run a later bounded swap and prove the PoolManager event fee matches the
   controller's directional recommendation.

Circle API output, Reactive subscription/callback evidence, balances, debts,
reserves, and every source/destination transaction hash belong in the live
manifest. Attestations are public message data, but RPC credentials and private
keys never belong in Git.

## Abort and recovery

Abort on any unexpected nonce, fee increase beyond approval, reverted action,
unverified peer, expired attestation workflow, wrong fee, or incomplete event
trace. If an already deployed system misbehaves, pause the controller, preserve
receipts/logs, and investigate before retrying. Deployments and one-time peer
seals are irreversible; pause is containment, not rollback.
