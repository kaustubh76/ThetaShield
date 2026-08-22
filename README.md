# ThetaShield

ThetaShield is a directional adaptive-fee Uniswap v4 hook and Reactive Network
research project. It uses delayed signed markout, trailing-noise filtering,
`n-of-k` persistence, and mechanical confidence scoring to raise fees only when
order flow shows sustained evidence of adverse selection.

> **Research status:** Phase 1 mathematics and reference-model gate verified.
> Hook, origin controller, and Reactive contracts have not been implemented and
> no contract in this repository is ready for production deployment.

## Research question

Can delayed signed markout distinguish persistent informed flow from ordinary
volatility well enough to protect liquidity providers without taxing benign
users?

ThetaShield treats `notional x markout` as an adverse-selection proxy—one input
to the fee controller. It is not an exact measurement of LP loss or LVR.

## Core properties

- Separate fee recommendations for `zeroForOne` and `oneForZero` swaps.
- A trailing volatility band that excludes the observation being scored.
- Signed soft-thresholding that preserves favorable and adverse direction.
- Independent `n-of-k` persistence for both swap directions.
- Formula-based confidence from sample count, directional agreement, and
  reference-price dispersion.
- Authenticated, sequenced, expiring fee recommendations with baseline fallback.
- Bounded Reactive processing with explicit oracle and publisher assumptions.

## Repository map

```text
src/          Solidity contracts, interfaces, types, and libraries
script/       Deployment, configuration, and acceptance scripts
test/         Unit, fuzz, invariant, integration, and fork tests
research/     Reference model, experiments, datasets, reports, and tests
dashboard/    Research and live-system dashboard
deployments/  Auditable deployment manifests
docs/         Architecture, roadmap, and verification records
```

## Requirements

- Git with submodule support
- Foundry
- Python 3.11 or newer (required beginning in Phase 1)

## Quick start

```sh
git clone --recurse-submodules git@github.com:RudraBhaskar9439/ThetaShield.git
cd ThetaShield
make verify
```

For an existing clone, initialize dependencies with:

```sh
git submodule update --init --recursive
```

See [the roadmap](docs/ROADMAP.md), [architecture](docs/ARCHITECTURE.md), and
[verification guide](docs/VERIFICATION.md) before contributing.

The Phase 1 definitions and rounding rules are documented in the
[mathematical specification](docs/MATHEMATICAL_SPECIFICATION.md). The independent
Python model and Solidity libraries are checked against the same committed
golden vectors.

## Safety

- Never use real secrets in `.env.example`.
- Deployment scripts must validate chain and infrastructure addresses.
- No paid transaction or deployment occurs without an explicit cost estimate
  and approval.
- Live contracts and mock/demo components must be labeled unambiguously.

## License

This private research repository is currently all rights reserved. See
[`LICENSE`](LICENSE).
