# Phase 8D Handoff — Live Circle Deployment and Acceptance

## Outcome

ThetaShield is deployed on Unichain Sepolia and Ethereum Sepolia from source
revision `7dcaadad351b238a64133f053f195e11d9a2ef71`. The finalized Circle CCTP
observation and recommendation path completed in both directions, controller
recommendation sequence `1` was installed, and the later Uniswap v4 swap used
the controller's expected `500`-pip fee. The hook was not submitted.

This is an unaudited public-testnet research deployment. The reference feed is
owner-published demo infrastructure, not a production oracle.

## Live components

| Role | Chain | Address |
|---|---|---|
| Circle transport | Unichain Sepolia | `0x24daf359bA811c9dd6903649b968eC6D76C3e568` |
| Controller | Unichain Sepolia | `0x6db44e172C7E1bae468A6e1e3683f34D7f3fD791` |
| Hook | Unichain Sepolia | `0xC53d57f4778E67B73B5535dEb2B841D56CBE40C0` |
| Hook factory | Unichain Sepolia | `0xd01D5C3bBdf7D23cAA3bC3bB90AdEd6209Db74C6` |
| Demo token 0 | Unichain Sepolia | `0x0627aFF7157a9d6A81Af63AdED4AdFD113F6690D` |
| Demo token 1 | Unichain Sepolia | `0xc069A2ad03c24C30b662BD0d998031f68C8A9D5A` |
| Reference feed | Ethereum Sepolia | `0x7138a53A06527bb68f74D4DcA31c46acAb8c1BAc` |
| Circle processor | Ethereum Sepolia | `0x10970CC15d1DF81bA6c8968F87036b21c694d744` |

Pool ID:
`0xa5eae55c727913799f7fc1eadd98f4c67b5c0da5417b5fe0adfafd12e9e93ca4`.

Both chains use Circle `MessageTransmitterV2`
`0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`; domains are `10` for Unichain
Sepolia and `0` for Ethereum Sepolia. Both configured peers are sealed.

## Acceptance evidence

| Step | Transaction | Result |
|---|---|---|
| Fresh observation swap | `0xb81b1e11daa419162a172b84636ba8d0398c7da9e7fe90b59224e2535e33f5d6` | Hook observation `2` emitted |
| Observation relay to Ethereum | `0x52c7f55ff3c85a31cbf1990cce3f0d5290133304302d45533fd449e2f26583f9` | Pending count became `1` |
| Reference publication | `0xc2aef5c9bbd8dae427d4c51df2bbb8de2fcd60d0078bbcd5201add45ae04efd8` | `0.99e18` reference accepted |
| Reference synchronization | `0xcc9f2065a76e6b32060d6b40ddf502336137878ccbeb3729f8f5d438a7e76f2d` | Source sequence accepted |
| Observation settlement | `0x7f13d36606793df918907e8a68b9fe792440880eb748f05240a2bf3c6f68889b` | Settled count became `1` |
| Epoch finalization | `0x7d58946a80cc2fb604feb784c547fdfc2055b940aa3101af5e3cb3d5e2c7cfb0` | Recommendation sequence `1` sent |
| Recommendation relay to Unichain | `0xb39029264e3828380c23f5ca97c279371bcf5c518def0f1b95f1db6b3f6aeb19` | Controller sequence `1` installed |
| Later fee-proof swap | `0x79ff916f7f2cb6501cc2eaf032955355dac9f9bad85c51a4fe11f14ed0637853` | Expected and PoolManager-observed fee both `500` pips |

The proof swap emitted observation `3`, as every healthy swap should. It was not
relayed because it begins the next continuous measurement cycle and is outside
the bounded Phase 8D acceptance trace.

The first attempt is retained as failure evidence. Observation `1` was relayed
successfully in transaction
`0x77bfbedb0547872aad873e76cd88ee50a10f685507ad04e44817be14dcc11ee4`,
but a multi-hour workstation lock delayed delivery beyond the configured
two-hour observation lifetime. The processor correctly expired it instead of
using stale evidence. The fresh, awake retry above completed the full path.

## Safety-state evidence

- processor: last observation `2`, pending `0`, settled `1`, expired `1`,
  recommendation sequence `1`;
- controller: sequence `1`, expected fee `500` pips in both directions;
- hook: observation count `3` after the proof swap;
- no lREACT was used; and
- hook submission remained outside the authorized boundary.

The first completed sample is deliberately cold-start data. Its zero shared
confidence makes the controller use the safe configured baseline while still
accepting and replay-protecting recommendation sequence `1`. Local lifecycle
tests separately cover the second-sample transition to a non-baseline
directional fee.

## Actual spend

Actual cost includes deployment, configuration, the expired first attempt, the
successful acceptance lifecycle, and the proof swap.

| Chain | Approved maximum | Actual | Gas used |
|---|---:|---:|---:|
| Unichain Sepolia | `0.000050000 ETH` | `0.000007574347000000 ETH` | `7,574,347` |
| Ethereum Sepolia | `0.030013166 ETH` | `0.014809343349884545 ETH` | `6,936,683` |
| Reactive Lasna | `0 lREACT` | `0 lREACT` | `0` |

The machine-readable receipt record is
`deployments/unichain-sepolia-ethereum-sepolia-circle-phase8d-live.json`.

## Verification

- `FOUNDRY_PROFILE=ci make verify`: `94` Solidity tests passed, `38` Python
  tests passed, both rendered-dashboard tests passed, lint/build/research/
  dependency/secret gates passed, and no high-severity production dependency
  vulnerability was reported. The two opt-in fork tests were skipped in this
  network-neutral command as designed.
- The separately configured live fork gate passed both Unichain Sepolia and
  Ethereum Sepolia infrastructure tests with zero skips.
- The schema-v3 live manifest passed JSON parsing and Draft 2020-12 validation.
- Read-only post-deployment checks found runtime code at all eight component
  addresses, sealed peers on both origin contracts, controller sequence `1`,
  and hook observation count `3`.

## Remaining boundary

Phase 8D is complete. Production use would still require an external oracle
adapter, independent audits, redundant monitored relayers, incident response,
and hardware-backed or multisig ownership. These are production-hardening
items, not missing parts of the approved testnet deployment.
