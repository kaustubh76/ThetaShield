# Reactive Legacy Lasna Migration

> **Implemented and accepted.** The final Legacy RSC
> `0x56E5590ef1fdA9fcA32ab2EEbF1B57845c29900a` produced both authenticated
> Ethereum Sepolia callbacks in the public G10 lifecycle. See
> [G10 Live Acceptance](G10_LIVE_ACCEPTANCE.md) for receipts and operating
> funding notes.

## Decision

ThetaShield's G10 automation release targets **Reactive Legacy Lasna**, not
Lasna Omni. Reactive Network support advised using Legacy while the Omni
destination relayer path is unreliable. The former Omni RSC and its missing
chain-1301 callbacks remain historical failure evidence and must not be reused
as a release dependency.

Circle CCTP V2 remains the only authenticated cross-chain observation and
recommendation rail. Reactive Legacy supplies event-driven scheduling,
maturity wake-ups, finalization wake-ups, and bounded retries. It never creates
evidence, calculates a fee independently, or installs controller state.

## Release topology

```text
Unichain Sepolia hook
  -> Circle CCTP V2 finalized observation
  -> Ethereum Sepolia Circle processor emits ObservationQueued
  -> Legacy Lasna RSC observes processor event + official Cron10
  -> authenticated Legacy callback to Ethereum Sepolia executor
  -> executor samples three pools, syncs references, and processes bounded work
  -> Circle CCTP V2 finalized recommendation returns to Unichain Sepolia
```

The Reactive callback destination is Ethereum Sepolia. This removes the
previous Omni-to-Unichain relayer queue from the automation path. Unichain
Sepolia remains a documented Legacy destination, but direct Unichain callbacks
are not part of the G10 release topology.

## Pinned Legacy infrastructure

| Item | Release value |
|---|---|
| Network | Reactive Lasna |
| RPC | `https://lasna-rpc.rnk.dev/` |
| Chain ID | `5318007` |
| System contract | `0x0000000000000000000000000000000000fffFfF` |
| System runtime hash | `0x29fce405ff34f9c7a0bb44f9e6241ca21807dc47ac9b8c4f6bdd2eb748a67465` |
| Processor/destination | Ethereum Sepolia (`11155111`) |
| Callback proxy | `0xc9f36411C9897e7F959D99ffca2a0Ba7ee0D7bDA` |
| Release cadence | Legacy `Cron10`, approximately one minute |
| Cron topic | `0x04463f7c1651e6b9774d7f85c85bb94654e3c46ca79b0c16fb16d4183307b687` |

`ReactiveLegacy.sol` is the repository source of truth for these constants.
The deploy scripts reject wrong chains, the Omni system bytecode, the wrong
callback proxy, simulator placeholder CRON topics, zero initial funding, and a
non-`Cron10` release configuration.

Official references:

- <https://dev.reactive.network/legacy/reactive-mainnet>
- <https://dev.reactive.network/legacy/origins-and-destinations>
- <https://dev.reactive.network/legacy/reactive-library>
- <https://dev.reactive.network/legacy/events-%26-callbacks>
- <https://dev.reactive.network/legacy/economy>

These values must still be rechecked immediately before every broadcast. A
legitimate upstream bytecode change intentionally stops the pinned preflight
until it is reviewed and committed.

## Authentication and funding invariants

The Ethereum executor and Legacy RSC must be deployed by the same EOA.
`AbstractCallback` stores that deployer as the expected ReactVM ID. Legacy
rewrites the callback payload's first zero-address argument to that ID, and the
executor requires both:

1. `msg.sender` is the official Ethereum Sepolia callback proxy; and
2. the injected ReactVM ID equals the executor's stored deployer.

The executor exposes both values for post-deployment verification. Its
constructor is payable so a reviewed Sepolia ETH callback reserve can be added
atomically. The RSC constructor is also payable for its reviewed lREACT
operating balance. Both initial funding environment values intentionally
default to zero; validation refuses to proceed until a fresh G10 budget is
approved.

Funding is operational capacity, not authority. Anyone can still call the
executor's bounded `execute()` fallback. If Legacy is unavailable or depleted,
the system loses automation but cannot accept forged Circle evidence or charge
an unbounded fee.

## Verification sequence

1. Run `make reactive-legacy-check`.
2. Run the processor preflight against Ethereum Sepolia.
3. Simulate the funded executor deployment at the current nonce.
4. Record the executor address and confirm its callback proxy, ReactVM ID,
   sampler, processor, and three source IDs.
5. Run the Reactive preflight against `https://lasna-rpc.rnk.dev/`.
6. Simulate the funded RSC deployment at the current nonce.
7. Present the combined maximum Sepolia ETH and lREACT spend for fresh owner
   approval.
8. Broadcast only after approval, then check balances, debt, reserves,
   subscriptions, and Reactscan active status.
9. Relay one fresh Circle observation, wait for maturity, and prove an
   authenticated Reactive callback produced an automation-cycle receipt.
10. Complete the Circle recommendation return and later-fee proof. Record every
    receipt in a new G10 manifest; do not mutate the Phase 8D manifest.

No step submits the hook.
