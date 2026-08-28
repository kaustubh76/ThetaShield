# G10 Deployment Readiness

> **Superseded by live acceptance.** The predicted origin and processor
> addresses below were deployed as simulated. The corrected final Reactive RSC
> is `0x56E5590ef1fdA9fcA32ab2EEbF1B57845c29900a`, and the complete public
> acceptance trail is recorded in [G10 Live Acceptance](G10_LIVE_ACCEPTANCE.md).
> The remaining text is retained as the pre-broadcast approval snapshot.

## Status

Implementation revision `62164d4` is verified and pushed. No transaction in
this readiness exercise was broadcast, no peer was sealed, and the hook was not
submitted. The addresses below are simulation predictions, not deployments.

The simulations were run on 27 August 2026 against account
`0xd1DcAAFf9356d5a42f2eE6F90179C4509386a83f` at these live nonces:

| Chain | Nonce | Balance at simulation |
|---|---:|---:|
| Unichain Sepolia | 231 | `0.166750912146799865 ETH` |
| Ethereum Sepolia | 43 | `0.035178431739894976 ETH` |
| Reactive Legacy Lasna | 4 | `34.757784576 lREACT` |

Any nonce change invalidates every later predicted address on that chain and
requires a fresh simulation and cost review.

## Predicted Unichain Sepolia stack

The 14-transaction simulation completed against the live Phase 8-compatible
PoolManager and routers.

| Component | Predicted address |
|---|---|
| Circle transport | `0x0C36E4a7a83Bf916B10f467b95296f2E19Dca55C` |
| Controller | `0x20C178712A124F5B1e86206280c6672082C5C9C6` |
| Test token 0 | `0x27e56c080E57409e87412164dA6CfAE3D3874575` |
| Test token 1 | `0xfF591dEaa341355Db9feB5ED5183666c4B6E79Bd` |
| Hook factory | `0x6ffDE7c06eaccdE648901F0ED7395581c994a641` |
| ThetaShield hook | `0xD4b944d3b50003d0DBa0201De2828663903900C0` |
| Origin Lens | `0x393cBc35F3303Cbb2e83657fC2DDAd03b65Ce3A0` |

Protected pool ID:
`0x7395eeea4b661939d12196748d988ba1ed168e5d1b9c73094f372edf41bab9a5`.

## Predicted Ethereum Sepolia stack

The 14-transaction simulation completed against the live Uniswap v4
PoolManager `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`. Both official test routers
returned that same manager. The simulation used `1 wei` only to satisfy the
nonzero reserve gate; a real reserve must use the separately approved value.

| Component | Predicted address |
|---|---|
| Reference token 0 | `0x05dd085BE4a4EA85B49290b4b334a1CA47CED0d2` |
| Reference token 1 | `0xc6048437c2bB296caf25b004fb33DF356712d845` |
| Three-pool sampler | `0x9be441e3abe6d6919a1d2e54992b841ca29a7310` |
| Circle processor | `0x64846969b386444BFa1a2905DB6Dad319b578654` |
| Processor Lens | `0xf1EE0503F968E9E828eEBf258594bEF8C40d97a9` |
| Legacy callback executor | `0x94535d4EC8c013f6D669ae72aB2683aC7eE820C4` |

| Reference tier | Pool ID |
|---|---|
| 0.05%, tick spacing 10 | `0xc0c7b0a5f8f084bb8179386357ca77daa59b859c8bfe340f6403a7bd2e7636e3` |
| 0.30%, tick spacing 60 | `0x25fb7679a210efbf1a6632f20f48cd852c526ba828e8f948d0b83a54cfe88237` |
| 1.00%, tick spacing 200 | `0x670a352d7bbb56c804f1e0925a11cefca46424eab865a05d80b6169aafd812f7` |

All pools initialize at 1:1 with `1e18` active liquidity, a `1e17` eligibility
floor, 18-decimal tokens, and distinct locked source IDs.

## Reactive Legacy boundary

The live Legacy system bytecode, Lasna chain ID, Ethereum callback proxy, and
official `Cron10` topic passed read-only validation. Local full-cycle tests
prove all three subscriptions, maturity scheduling, authenticated callback,
bounded sampling/synchronization, retries, and permissionless recovery.

Lasna's system subscription precompile reverts inside Forge's forked
`eth_call` simulation path before contract creation completes. The same result
was reproduced with both predicted and already-live Ethereum contract
addresses. The normal official deployment pattern calls `subscribe()` in the
constructor, so the release must broadcast only after the exact initcode and a
conservative lREACT ceiling are approved, then verify all three subscriptions
through `rnk_getSubscribers`. The nonce-4 provisional RSC address is
`0xf8b9bf987A47256e06bD2950C72EDc57581243B7`; it is not claimed as final until
a receipt exists.

## Verification and spend boundary

- `make verify`: `123` Solidity tests passed, `0` failed, and the `3` opt-in
  infrastructure forks skipped in the environment-neutral run; `48` Python
  tests and all dashboard, lint, build, dependency, secret, schema, and
  research gates passed.
- Live origin and processor simulations both completed without a revert.
- Simulated gas ceilings were `11,325,870` on Unichain and `18,061,413` on
  Ethereum. At the sampled gas prices, their estimated deployment gas was
  approximately `0.000016988805 ETH` and `0.017012546452077597 ETH` before
  constructor reserves and acceptance actions.

The recommended fresh all-in maximums are:

| Chain | Maximum | Includes |
|---|---:|---|
| Unichain Sepolia | `0.000050000 ETH` | V2 origin stack, peer sealing, swaps, and acceptance margin |
| Ethereum Sepolia | `0.030013166 ETH` | reference/processor stack, `0.006 ETH` executor reserve, relays, and acceptance margin |
| Reactive Legacy Lasna | `2.028505 lREACT` | `2.0 lREACT` RSC reserve, deployment gas, and margin |

These are ceilings, not spending targets. They require fresh explicit approval
for this exact revision after one final nonce/gas refresh. No hook submission is
included or authorized.
