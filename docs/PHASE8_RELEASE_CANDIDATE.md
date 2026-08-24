# Phase 8 Release Candidate

> RETIRED — DO NOT BROADCAST. This Lasna candidate was replaced by the Circle
> CCTP release path before a ThetaShield hook/controller deployment occurred.

## Scope

This candidate deploys a public testnet research demonstration on Ethereum
Sepolia and Reactive Lasna. It is not a production deployment: prices come from
the owner-published `MockNormalizedReferencePriceFeed`, assets are fixed-supply
demo tokens, and liquidity/swaps use Uniswap's official test routers.

## Reviewed infrastructure

| Role | Chain | Reviewed infrastructure |
| --- | --- | --- |
| Origin and reference | Ethereum Sepolia (`11155111`) | PoolManager `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`; callback proxy `0xc9f36411C9897e7F959D99ffca2a0Ba7ee0D7bDA`; PoolSwapTest `0x9b6b46e2c869aa39918db7f52f5557fe577b6eee`; PoolModifyLiquidityTest `0x0c478023803a644c94c4ce1c1e7b9a087e411b0a` |
| Reactive | Lasna Omni (`5318007`) | RPC `https://lasna-omni-rpc.rnk.dev/`; system contract `0x0000000000000000000000000000000000fffFfF`; system code hash `0xe69df7552e24b6f99148ea1e6c21cc0473c35f4e1add0dbc87166cc8021a13e0`; `Cron1` topic `0xf02d6ea5c22a71cffe930a4523fcb4f129be6c804db50e4202fb4e0b07ccb514` |

Official registries checked for this candidate:

- <https://developers.uniswap.org/docs/protocols/v4/deployments>
- <https://dev.reactive.network/origins-and-destinations>
- <https://dev.reactive.network/reactive-mainnet>
- <https://dev.reactive.network/subscriptions>
- <https://dev.reactive.network/economy>

## Deterministic dry-run result

The simulated source revision is
`e1585a763a8e76c02f04f7e2c478d8aab3ed5f64`.

The owner, deployer and expected RVM ID are all
`0xd1DcAAFf9356d5a42f2eE6F90179C4509386a83f`. With Sepolia nonce `22` and
Lasna Omni nonce `16`, the current candidate predicts:

| Component | Predicted address |
| --- | --- |
| Reference feed | `0xb73ba61b1b9d50f9bd68bb0916ca30ca3ae2cd1f` |
| Token alpha | `0xa00db1d51f505c90583b0ab3798109e1e4de1831` |
| Token beta | `0xeeb18d96aabcec142d95ba2b9e7e3221832cf139` |
| Controller | `0xe370f6e512cfaf920e84e04d3877fbcefec49478` |
| Hook factory | `0x7cf0c9c0e993d7b179f5abcb7a1edc43374b7d1a` |
| Hook | `0x6bB54Be59003F941b2EdD14d061A5E0Ab29380c0` |
| Reactive scheduler | `0xd3fb3eb093c9bb0bf44198bbc9b8ce91479fe940` |

The dynamic-fee pool ID is
`0x1ec4544c6fcb524a6af65702030b7b9804ff9a367c2598d10621342927670af7`.
Any nonce change invalidates these addresses and requires a new simulation,
manifest and approval.

Origin preflight fingerprint:
`0xc118dcff1d8135fb79b332c7ce7f734a271ac72cd7e69d9ef239bb020509bcc8`.

Reactive preflight fingerprint:
`0x41312a7101248f6e1b59af4acc814b1b31c6a91fb460bff776896569a1443974`.

## Verification evidence

- `FOUNDRY_PROFILE=ci make verify`: 99 Solidity tests and 38 Python tests
  passed; the three opt-in network tests were skipped in this network-neutral
  command as designed.
- The current Sepolia and finalized Lasna Omni fork gate passed all three
  infrastructure/deployment tests with zero skips. A finalized block pin was
  used after the Omni RPC briefly reported its latest head ahead of its
  available upstream state.
- Sepolia no-broadcast script: 14 transactions simulated successfully at
  `7,714,747` gas. A persistent local Sepolia fork then mined all 14 transactions
  plus two swap/reference cycles, for a combined bounded gas limit of
  `8,337,722`.
- The first and second local acceptance swaps emitted real hook observations;
  both owner reference publications succeeded after a 60-second horizon.
- The current Lasna Omni RPC dry-run executed the exact Reactive constructor and
  all three subscriptions successfully at `7,714,020` gas.

Read-only wallet snapshot on 2026-08-21:

| Network | Block | Nonce | Balance | RPC gas price |
| --- | ---: | ---: | ---: | ---: |
| Sepolia | `11,536,221` | `22` | `0.054793067537324333 SepETH` | `1.060518807 gwei` |
| Lasna Omni | `4,820,395` | `16` | `9.582359963992880087 lREACT` | `100 gwei` |

## Spend gate

The requested approval cap uses explicit maximum fee settings. If either network
requires more, deployment must abort and be re-approved.

| Network | Gas limit | Fee cap | Funding included | Exact maximum |
| --- | ---: | ---: | ---: | ---: |
| Sepolia deployment + two swap/reference cycles | `8,337,722` | `3 gwei` | `0.005 SepETH` callback reserve | `0.030013166 SepETH` |
| Lasna Omni deployment/subscriptions | `7,714,020` | `250 gwei` | `0.1 lREACT` contract funding | `2.028505000 lREACT` |

Both are public testnet tokens and no fiat payment is required by these scripts.
Approval status remains **pending**. No live transaction has been broadcast.
