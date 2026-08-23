# Phase 8 Release Candidate

## Scope

This candidate deploys a public testnet research demonstration on Ethereum
Sepolia and Reactive Lasna. It is not a production deployment: prices come from
the owner-published `MockNormalizedReferencePriceFeed`, assets are fixed-supply
demo tokens, and liquidity/swaps use Uniswap's official test routers.

## Reviewed infrastructure

| Role | Chain | Reviewed infrastructure |
| --- | --- | --- |
| Origin and reference | Ethereum Sepolia (`11155111`) | PoolManager `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`; callback proxy `0xc9f36411C9897e7F959D99ffca2a0Ba7ee0D7bDA`; PoolSwapTest `0x9b6b46e2c869aa39918db7f52f5557fe577b6eee`; PoolModifyLiquidityTest `0x0c478023803a644c94c4ce1c1e7b9a087e411b0a` |
| Reactive | Lasna (`5318007`) | RPC `https://lasna-rpc.rnk.dev/`; system contract `0x0000000000000000000000000000000000fffFfF`; `Cron1` topic `0xf02d6ea5c22a71cffe930a4523fcb4f129be6c804db50e4202fb4e0b07ccb514` |

Official registries checked for this candidate:

- <https://developers.uniswap.org/docs/protocols/v4/deployments>
- <https://dev.reactive.network/legacy/origins-and-destinations>
- <https://dev.reactive.network/legacy/reactive-mainnet>
- <https://dev.reactive.network/legacy/subscriptions>
- <https://dev.reactive.network/legacy/economy>

## Deterministic dry-run result

The owner, deployer and expected RVM ID are all
`0xd1DcAAFf9356d5a42f2eE6F90179C4509386a83f`. With Sepolia nonce `10` and
Lasna nonce `2`, the current candidate predicts:

| Component | Predicted address |
| --- | --- |
| Reference feed | `0xa7f884a3dd8e30dd5ad90d0599a0199c33353490` |
| Token alpha | `0x79913e558b8882862e28e57d9513885600794fbf` |
| Token beta | `0x66ff90b39846985b38de1013108e93e6521fafcd` |
| Controller | `0x93fef8c724844056f63add6dfcd3717d4fd29bf4` |
| Hook factory | `0x52a4e8f70b5c60bdea74cd942cca3a62e444cdbc` |
| Hook | `0xCbD9c5E02596bB2D7c9dc74Df63aBcd0111F80C0` |
| Reactive scheduler | `0xdd81EF6558E4D4F8403B3416c25ecD1CcB303e4e` |

The dynamic-fee pool ID is
`0xdb6a33ab8e1eb051ae66f9dfc4711b424c1a34dff1a6111ed4b907eea08292e1`.
Any nonce change invalidates these addresses and requires a new simulation,
manifest and approval.

Origin preflight fingerprint:
`0xc118dcff1d8135fb79b332c7ce7f734a271ac72cd7e69d9ef239bb020509bcc8`.

Reactive preflight fingerprint:
`0x61b04dfa12f01e692d131b01dc4c36a19793ce4c521c8fd14f593d50ee244ade`.

## Verification evidence

- `FOUNDRY_PROFILE=ci make verify`: 98 Solidity tests and 38 Python tests
  passed; the three opt-in network tests were skipped in this network-neutral
  command as designed.
- `make phase7-check` with both reviewed RPCs configured: all origin, Reactive
  and Phase 8 deployment fork tests passed with zero skips.
- Sepolia no-broadcast script: 14 transactions simulated successfully with a
  total gas limit of `7,742,691`.
- Persistent Sepolia fork: all 14 deployment transactions were mined locally;
  the acceptance swap emitted `SwapObserved`, and the owner reference update
  published successfully after the 60-second markout horizon.
- Lasna local EVM simulation cannot emulate Lasna's chain-specific subscription
  precompile. The live Lasna RPC's `eth_estimateGas` dry-run executed the exact
  constructor and all three subscriptions successfully at `6,019,571` gas.

## Spend gate

The requested approval cap uses explicit maximum fee settings. If either network
requires more, deployment must abort and be re-approved.

| Network | Gas limit | Fee cap | Funding included | Exact maximum |
| --- | ---: | ---: | ---: | ---: |
| Sepolia deployment + two swap/reference cycles | `8,415,469` | `3 gwei` | `0.005 SepETH` callback reserve | `0.030246407 SepETH` |
| Lasna deployment/subscriptions | `6,019,571` | `250 gwei` | `0.1 lREACT` contract funding | `1.604892750 lREACT` |

Both are valueless public testnet tokens, so the direct fiat spend is `$0.00`.
Approval status remains **pending**. No live transaction has been broadcast.
