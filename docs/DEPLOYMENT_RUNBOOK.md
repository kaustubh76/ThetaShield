# Circle Deployment Runbook

## Release boundary

This is an unaudited two-testnet demonstration. Do not broadcast until the exact
commit passes all gates, both live infrastructure checks pass, every transaction
has been simulated at the current nonce, a total maximum spend is presented,
and the owner explicitly approves that Circle-specific spend. Do not submit the
hook.

## Networks

| Role | Chain | Chain ID | Circle domain |
|---|---|---:|---:|
| Origin | Unichain Sepolia | 1301 | 10 |
| Processor/reference | Ethereum Sepolia | 11155111 | 0 |

The current testnet `MessageTransmitterV2` configured in `.env.example` is
`0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` on both chains. Recheck Circle's
official address registry immediately before simulation and broadcast.

## Required checks

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
changed fingerprint aborts the release.

## Dependency order

1. Simulate `DeployCircleOrigin.s.sol` on Unichain Sepolia. It deploys the
   transport, controller, demo tokens, hook factory, deterministic hook, dynamic
   pool, approvals, and bounded demo liquidity. Record all predicted addresses
   and costs.
2. Put the predicted origin transport, controller, hook, and pool ID in the
   untracked environment, then simulate `DeployCircleProcessor.s.sol` on
   Ethereum Sepolia. It deploys the owner-published demo feed and bounded Circle
   processor.
3. Simulate `ConfigureCirclePeers.s.sol` on Unichain. This one-time action seals
   the hook/processor peers; verify every value before signing.
4. Sum both-chain deployment and configuration costs, preserve a safety margin,
   and obtain a fresh explicit approval. An earlier Lasna/lREACT approval is not
   valid for Circle.
5. Broadcast only the reviewed transactions in the same dependency order and
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
4. After the configured markout horizon, run `CircleAcceptance.runReference()`
   and then `runProcess()` on Ethereum Sepolia. The processor sends a
   recommendation if mature work finalizes.
5. Fetch that transaction's attestation with source domain `0` and relay it on
   Unichain using `RelayCircleMessage.s.sol`.
6. Run a later bounded swap and prove the PoolManager event fee matches the
   controller's directional recommendation.

Circle API output and every source/destination transaction hash belong in the
live manifest. Attestations are public message data, but RPC credentials and
private keys never belong in Git.

## Abort and recovery

Abort on any unexpected nonce, fee increase beyond approval, reverted action,
unverified peer, expired attestation workflow, wrong fee, or incomplete event
trace. If an already deployed system misbehaves, pause the controller, preserve
receipts/logs, and investigate before retrying. Deployments and one-time peer
seals are irreversible; pause is containment, not rollback.
