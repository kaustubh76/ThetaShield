# Dependency Review

## Reproducibility result

Top-level Git submodules, Solidity/Python/Foundry CI versions, and GitHub Actions
are pinned in `security/dependency-lock.json`. `make dependency-check` verifies
the checked-out commits, configured upstream URLs, recursive submodule status,
compiler pin, CI tool versions, and Actions SHAs.

| Dependency | Pinned revision | Use | Local licensing observation |
|---|---|---|---|
| `forge-std` | `bf647bd6046f2f7da30d0c2bf435e5c76a780c1b` | Tests and scripts | MIT and Apache-2.0 license files are present |
| `reactive-lib` | `f6990ce3526928d039fec78855b2004ff8d65c9f` | Reactive interfaces/base contracts | No top-level license file; imported source is marked `UNLICENSED` |
| `reactive-test-lib` | `2ff9b2a68ca9956306ec943c10d1c757c1dd1956` | Local Reactive simulation | Imported source files are marked MIT; no top-level license file |
| `v4-core` | `e50237c43811bd9b526eff40f26772152a42daba` | PoolManager types, libraries, and local integration | Repository contains BUSL-1.1 and MIT license texts; file-level terms must be checked for deployed imports |

The licensing column records what exists in the pinned checkout; it is not legal
advice. The `reactive-lib` licensing ambiguity must be resolved with its
maintainer before public distribution or production use.

## Review boundaries

- Pinning protects repeatability, not correctness or security.
- This phase did not conduct a line-by-line independent audit of third-party
  code and did not establish a vulnerability-monitoring service.
- Nested submodules are checked for clean pinned state, while the lock records
  the four top-level dependencies controlled directly by this repository.
- GitHub Actions are commit-pinned to reduce tag-movement risk. Their upstream
  source and build provenance remain external trust assumptions.
- `solc 0.8.26`, Foundry `v1.7.1`, and Python `3.11` are the CI compatibility
  pins. Developer workstations should print and record their actual versions
  for a live release.

## Required release review

Before Phase 8, review current upstream advisories and release notes, confirm
official infrastructure documentation and addresses, resolve licensing, run a
clean-clone build, and record any approved dependency update as its own reviewed
commit. Never update a dependency during a live deployment window.
