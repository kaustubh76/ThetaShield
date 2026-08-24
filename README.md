# ThetaShield

ThetaShield is a directional adaptive-fee Uniswap v4 hook and Reactive Network
research project. It uses delayed signed markout, trailing-noise filtering,
`n-of-k` persistence, and mechanical confidence scoring to raise fees only when
order flow shows sustained evidence of adverse selection.

> **Research status:** The local research build is complete through Phase 9.
> The original Phase 6 report still records four passes and two failures; a
> separate train/holdout revision passes the failed H4/H5 criteria on reserved
> synthetic streams. The dashboard and submission package are complete, but
> Phase 8 live acceptance remains open. The contracts are unaudited and are not
> ready for production deployment.

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
- Node.js 22.13 or newer and npm (required for the Phase 9 dashboard)

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

The Phase 2 trust boundaries, fee fallback rules, event schema, and local
Uniswap v4 verification evidence are recorded in the
[Phase 2 handoff](docs/PHASE2_HANDOFF.md).

The Phase 3 subscriptions, bounded queues, reference-price assumptions,
maturity rules, epoch processing, and callback evidence are recorded in the
[Phase 3 handoff](docs/PHASE3_HANDOFF.md).

The Phase 4 real local PoolManager-to-hook-to-Reactive-to-controller lifecycle,
including fallback and callback-ordering evidence, is recorded in the
[Phase 4 handoff](docs/PHASE4_HANDOFF.md).

The Phase 5 scenario manifest, fair baseline calibration, complete metric set,
repeated-seed outputs, measured local hook gas, and reproducible charts are
recorded in the [Phase 5 handoff](docs/PHASE5_HANDOFF.md) and generated
[baseline report](research/reports/PHASE5_BASELINES.md).

The Phase 6 parameter grid, decision criteria, raw sensitivity results, Pareto
analysis, and retained failed hypotheses are recorded in the
[Phase 6 handoff](docs/PHASE6_HANDOFF.md) and generated
[hypothesis report](research/reports/PHASE6_HYPOTHESES.md).

The versioned H4/H5 root-cause analysis, confidence-gated fast path, disjoint
train/holdout protocol, and reserved-seed evidence are recorded in the
[Phase 6.1 handoff](docs/PHASE61_HANDOFF.md) and generated
[remediation report](research/reports/PHASE61_REMEDIATION.md).

The Phase 7 threat model, stateful invariants, boundary fuzzing, gas evidence,
dependency/secret gates, fork checks, and non-broadcasting deployment preflight
are recorded in the [Phase 7 handoff](docs/PHASE7_HANDOFF.md). Review the
[threat model](docs/THREAT_MODEL.md) and
[deployment runbook](docs/DEPLOYMENT_RUNBOOK.md) before any Phase 8 planning.

The Phase 9 interactive dashboard, final report, demo script, and draft
submission are recorded in the [Phase 9 handoff](docs/PHASE9_HANDOFF.md). Read
the [final research report](docs/FINAL_REPORT.md), run the
[demo script](docs/DEMO_SCRIPT.md), or review the unsubmitted
[submission draft](docs/SUBMISSION.md). Use `make phase9-check` for the focused
dashboard and handoff gate.

The owner-only dashboard preview is available at
<https://thetashield-uhi10.rbrudra9439.chatgpt.site>.

## Safety

- Never use real secrets in `.env.example`.
- Deployment scripts must validate chain and infrastructure addresses.
- No paid transaction or deployment occurs without an explicit cost estimate
  and approval.
- Live contracts and mock/demo components must be labeled unambiguously.

## License

This private research repository is currently all rights reserved. See
[`LICENSE`](LICENSE).
