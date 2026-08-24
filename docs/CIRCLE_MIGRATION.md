# Phase 8 Circle Migration

## Decision

The Lasna/Reactive deployment candidate is retired before deployment. The
active Phase 8 path uses Circle CCTP V2 generic messages between Unichain
Sepolia and Ethereum Sepolia. No `IReactive`, RVM callback proxy, Lasna system
contract, CRON subscription, or lREACT funding remains in the deployable path.

Circle CCTP is the authenticated transport, not the scheduler. ThetaShield
keeps its delayed markout computation in a bounded processor contract. A
permissionless keeper relays Circle attestations, synchronizes the configured
reference feed, and calls processing after observations mature. The contracts,
not the keeper, enforce sender identity, domains, replay protection, maturity,
price selection, fee bounds, and recommendation expiry.

## Target topology

```text
Unichain Sepolia (domain 10)
  PoolManager -> ThetaShieldHook -> ThetaShieldCircleTransport
                                      |
                                      | CCTP V2 finalized message
                                      v
Ethereum Sepolia (domain 0)
  reference feed -> ThetaShieldCircleProcessor <- permissionless keeper
                                      |
                                      | CCTP V2 finalized recommendation
                                      v
Unichain Sepolia (domain 10)
  MessageTransmitterV2 -> ThetaShieldController -> later swap fee
```

## Safety properties

- The hook's swap path fails open if Circle message dispatch is unavailable:
  the swap completes at the current safe fee and a transport-failure event is
  emitted for monitoring.
- The processor accepts observations only from Circle's local
  `MessageTransmitterV2`, domain 10, and the configured origin transport.
- The controller accepts recommendations only from Circle's local
  `MessageTransmitterV2`, domain 0, and the configured processor.
- Only finalized CCTP messages are accepted. Fast/unfinalized messages fail
  closed.
- Anyone may relay a valid Circle attestation or advance mature processor work;
  no relayer key is trusted to invent data.
- The existing bounded queue, price-source checks, directional mathematics,
  persistence, confidence, fee bounds, sequence checks, expiry, pause, and
  baseline fallback remain in force.
- No USDC burn is required for ThetaShield messages. The integration uses
  `MessageTransmitterV2.sendMessage` directly; native testnet gas is still
  required on both chains.

## Deployment order

1. Deploy the origin Circle transport and controller on Unichain Sepolia.
2. Mine and deploy the hook, then initialize the v4 demo pool.
3. Deploy the reference feed and Circle processor on Ethereum Sepolia.
4. One-time configure and seal the transport and controller peers.
5. Run an observation -> attestation -> delayed processing -> attestation ->
   later-fee acceptance lifecycle.

Every address, Circle domain, contract bytecode, message body, gas estimate,
and attestation transaction must be recorded in a new manifest. The previous
Sepolia/Lasna dry-run manifests are historical and must not be broadcast.

## Migration gates

| Gate | Deliverable | Status |
|---|---|---|
| Phase 8A | Circle architecture and trust-boundary decision | Complete |
| Phase 8B | Circle transport, processor, controller, hook, and local lifecycle tests | Complete |
| Phase 8C | Circle deployment tooling, relayer, fork checks, docs, and dashboard | Complete |
| Phase 8D | Fresh two-chain simulation, explicit cost approval, deployment, and acceptance | Pending |

Hook submission remains outside this plan and must not be performed.
