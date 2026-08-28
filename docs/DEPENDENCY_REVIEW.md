# Dependency Review

`security/dependency-lock.json` pins the four top-level Git submodules plus the
Solidity/Python/Foundry CI versions and GitHub Action SHAs. Run:

```sh
make dependency-check
```

| Dependency | Pinned revision | Use | License observation |
|---|---|---|---|
| `forge-std` | `bf647bd6046f2f7da30d0c2bf435e5c76a780c1b` | Tests and scripts | MIT and Apache-2.0 files present |
| `v4-core` | `e50237c43811bd9b526eff40f26772152a42daba` | PoolManager types/libraries/integration | BUSL-1.1 and MIT files; check file-level terms |
| `reactive-lib` | `f6990ce3526928d039fec78855b2004ff8d65c9f` | Reactive interfaces, subscriptions, callback payment/authentication | Unlicense files present; check file-level terms |
| `reactive-test-lib` | `2ff9b2a68ca9956306ec943c10d1c757c1dd1956` | Local subscription, ReactVM, CRON, and callback lifecycle simulation | MIT |

Reactive libraries are used only by the automation and resilience plane. They
do not replace Circle authentication or enter the hook's synchronous swap
path. Circle is integrated through minimal locally defined interfaces; the
deployed testnet transmitter remains an external infrastructure trust boundary.

Pinning protects reproducibility, not correctness. Before release, review
current advisories and official Circle/Uniswap addresses, run a clean-clone
build, and record dependency updates separately from deployment activity.
