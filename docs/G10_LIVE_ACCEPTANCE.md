# G10 Live Acceptance

## Outcome

ThetaShield G10 completed its public three-network acceptance on 28 August
2026 from source revision
`c0a44dac111848e794989ba4b6bde62e6ffc4cf7`.

The deployed `RESEARCH_V1` path proved:

1. a real Unichain Sepolia swap emitted a sealed Circle observation;
2. Circle CCTP V2 delivered finalized evidence to Ethereum Sepolia;
3. Reactive Legacy Lasna observed the queue, waited for maturity, and emitted an
   authenticated callback;
4. the executor sampled and synchronized all three v4 reference pools and
   advanced bounded processing;
5. Reactive issued the separate finalization wake and authenticated callback;
6. the processor sent recommendation sequence `1` through Circle;
7. the Unichain controller installed that sequence; and
8. a later swap recorded the expected `500`-pip fee in both the hook and
   PoolManager events.

The hook was not submitted.

## Release contracts

| Plane | Component | Address |
|---|---|---|
| Unichain | Circle transport | `0x0C36E4a7a83Bf916B10f467b95296f2E19Dca55C` |
| Unichain | Controller | `0x20C178712A124F5B1e86206280c6672082C5C9C6` |
| Unichain | Hook | `0xD4b944d3b50003d0DBa0201De2828663903900C0` |
| Unichain | Origin Lens | `0x393cBc35F3303Cbb2e83657fC2DDAd03b65Ce3A0` |
| Ethereum | Three-pool sampler | `0x9be441e3abe6d6919a1d2e54992b841ca29a7310` |
| Ethereum | Circle processor | `0x64846969b386444BFa1a2905DB6Dad319b578654` |
| Ethereum | Processor Lens | `0xf1EE0503F968E9E828eEBf258594bEF8C40d97a9` |
| Ethereum | Automation executor | `0x94535d4EC8c013f6D669ae72aB2683aC7eE820C4` |
| Reactive | Legacy RSC | `0x56E5590ef1fdA9fcA32ab2EEbF1B57845c29900a` |

Protected pool:
`0x7395eeea4b661939d12196748d988ba1ed168e5d1b9c73094f372edf41bab9a5`.

## Immutable acceptance trail

| Step | Receipt | Result |
|---:|---|---|
| 1 | [Unichain observation swap](https://unichain-sepolia.blockscout.com/tx/0x7bc130d5dc7c031f253c6418540c16d3b7143aa2e24dd99a7c092fbea0f55bd7) | Observation `5` emitted. |
| 2 | [Ethereum Circle relay](https://eth-sepolia.blockscout.com/tx/0xb348e4ba02762635b18b3299158f4523b15b8fadd0fb8af72dde0275f4d0a5bc) | `ObservationQueued(5)`; processor pending count advanced. |
| 3 | [Reactive observation signal](https://lasna.reactscan.net/tx/0x1a7d286b6c09d14c734ba85d4e6cef5fad3c29a3da93c47af8b18013ce13594d) | Final RSC armed observation `5` until maturity. |
| 4 | [Reactive maturity wake](https://lasna.reactscan.net/tx/0xf5577cc1819d6f1519cbf3734c3d289980df3e29361f21e66c4f93ff1f41567e) | Wake request `1` emitted for `AwaitMaturity`. |
| 5 | [Ethereum callback 1](https://eth-sepolia.blockscout.com/tx/0xbe1b53942518324fdf9494c857b8a9b9a4b42a6f4455780fe6d1d952a7ec31d3) | Official proxy and RVM identity authenticated; three sources sampled; observations settled. |
| 6 | [Reactive finalization wake](https://lasna.reactscan.net/tx/0x56f432c88ea8342c758e523c0b8300bb13b968e5d6b13e2ece4d7748c3a267de) | Wake request `2` emitted for `AwaitFinalization`. |
| 7 | [Ethereum callback 2](https://eth-sepolia.blockscout.com/tx/0x8ad2731242f40d7d42b3b13ab3bc56c8a6adf8e66a7a06e37867b127bffe9ffc) | Recommendation sequence `1` scheduled and Circle message sent. |
| 8 | [Unichain recommendation relay](https://unichain-sepolia.blockscout.com/tx/0x14928a93c760ca5c04a9343d24b3622da8dbdcc2044120186b984714e1ff35a9) | Controller emitted `RecommendationApplied` for sequence `1`. |
| 9 | [Unichain fee-proof swap](https://unichain-sepolia.blockscout.com/tx/0x678ab18735f94703508d184c5585fcc2689df260b64362c8c9e598cb41dde724) | Hook observation `6`, controller sequence `1`, and fee `500` pips recorded. |

The accepted sample is cold-start evidence. Its risk and confidence values are
zero, so the recommendation equals the safe `500`-pip baseline and the
controller reports `usedBaseline = true`. This is expected safety behavior,
not evidence of a non-baseline directional premium. The local lifecycle suite
separately covers sufficient-evidence transitions to directional fees.

## Reactive Legacy correction history

Two earlier RSC deployments remain public failure evidence:

- `0xf8b9bf987A47256e06bD2950C72EDc57581243B7` used the wrong callback caller
  assumption.
- `0x99B7fa8FbCf52281423AA8342C6b0f5199100479` corrected callback authentication but matched exact zero Cron
  topics instead of Legacy's wildcard topic representation.

The final `0x56E5…900a` RSC at deployment transaction
[`0xf7cbb5…5e719`](https://lasna.reactscan.net/tx/0xf7cbb5bbea56ca1e79e3632a8871b0e7a7cd43c58cb7a0cc27f9f94dd355e719)
uses the real Legacy event shape and proved both callbacks. These failed
attempts are not dependencies of the accepted release.

## Spend record

| Network | Approved maximum | Accepted-release actual |
|---|---:|---:|
| Unichain Sepolia | `0.000050000 ETH` | `0.000016584369098132 ETH` |
| Ethereum Sepolia | `0.030013166 ETH` | `0.022154682210546031 ETH` |
| Reactive Legacy final deployment | `2.024800 lREACT` | `2.001689376 lREACT` |

The Reactive actual includes the final deployment reserve, deployment gas, and
the approved `depositTo` reactivation used before acceptance. It excludes the
separately approved historical failed deployments.

## Operational boundary

Legacy `Cron10` execution consumes RSC credit even while no work is armed.
The accepted callback receipts remain immutable, but keeping the RSC currently
active requires debt monitoring and lREACT top-ups. If the RSC becomes
underfunded, automation pauses; Circle authentication, controller expiry,
baseline fallback, and permissionless executor access remain intact. This is a
liveness/operations requirement, not fee authority.

The canonical machine-readable record is
`deployments/unichain-sepolia-ethereum-sepolia-reactive-legacy-g10-live.json`.
