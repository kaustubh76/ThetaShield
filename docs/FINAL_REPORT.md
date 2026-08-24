# ThetaShield Final Research Report

## Executive summary

ThetaShield is a directional adaptive-fee Uniswap v4 hook. It observes each
swap, waits for delayed price evidence, computes signed markout against a
strictly trailing volatility band, requires persistent evidence, and returns
separate fee recommendations for the two swap directions.

The research prototype is complete locally through Phase 9. The contracts,
simulator, research artifacts, security gates, deployment tooling, dashboard,
and submission material are reproducible from the repository. Phase 8 live
acceptance is deliberately still open: no deployment is called complete until
confirmed origin, Reactive, callback, and acceptance transactions are recorded.

ThetaShield is not MARKOUT. It does not escrow or rebate a provisional swap
surcharge, and Circle or Pyth are not part of this protocol. Those choices
belong to a different project. ThetaShield's core contribution is a delayed,
persistent, directional fee-control loop using Reactive Network.

## Research question

Can delayed signed markout distinguish persistent informed flow from ordinary
volatility well enough to protect liquidity providers without taxing benign
users?

The project uses `notional × signed markout` as a controlled adverse-selection
risk proxy. It is not an exact measurement of LP loss, LVR, profitability, or
live trader behavior.

## Mechanism

1. The v4 hook applies the latest authenticated fee for the current swap
   direction and emits a complete post-swap observation.
2. Reactive Network records the observation and waits for the configured
   markout horizon.
3. An eligible delayed reference price produces a signed directional markout.
4. The current sample is compared with volatility computed only from prior
   samples, preventing self-widening of its own dead band.
5. Independent `n-of-k` histories and a confidence-gated fast path decide
   whether the evidence is persistent enough to affect each direction.
6. The origin controller accepts only authenticated, sequenced, bounded,
   non-stale recommendations and otherwise returns the baseline fee.

This separation keeps the hook path small while moving delayed aggregation and
decision logic into the Reactive scheduler.

## Implementation delivered

- A real Uniswap v4 dynamic-fee hook and authenticated origin controller.
- A bounded Reactive scheduler with delayed reference ingestion, epoch
  aggregation, independent directional state, expiry, and callback generation.
- Local end-to-end PoolManager → hook → Reactive → controller lifecycle tests.
- An independent Python reference model, Solidity/Python golden vectors, and
  deterministic synthetic research harness.
- Five policy baselines, 15 market/delivery scenarios, repeated seeds, full
  sensitivity sweeps, and versioned H4/H5 remediation.
- Boundary fuzzing, stateful invariants, gas ceilings, dependency and secret
  checks, fork preflights, deployment validation, and manifest schema.
- An interactive research dashboard with explicit simulated/live labels.
- A demo script and draft submission package. Nothing is submitted externally.

## Evidence

### Baseline study

Phase 5 evaluates five policies on the same 15 scenarios and five seeds. The
calibrated mean fees are 5.00 bps for fixed fee, 7.56 bps for volatility-only,
7.30 bps for raw positive markout, 7.07 bps for dead-band without persistence,
and 7.27 bps for ThetaShield.

The Phase 5 aggregate scorecard is descriptive synthetic evidence, not a live
profitability claim. Under this deliberately controlled model ThetaShield's
mean fee is 6.28 bps, false-positive rate is 7.70%, and measured hook operations
cost 80,253 gas: 33,052 before swap plus 47,201 for a warm after-swap path.

### Hypothesis audit

| Hypothesis | Phase 6 v1 | Versioned conclusion |
| --- | --- | --- |
| H1 — LP protection | Pass | Paired improvement +1.2254 quote; both compared means remain negative |
| H2 — Benign-flow fairness | Pass | 0.00% benign fee excess and 0.00% FPR in the declared test |
| H3 — Noise robustness | Pass | Raw policy minus ThetaShield FPR: 23.88 percentage points |
| H4 — Detection trade-off | Fail | Phase 6.1 holdout passes: rank correlation -0.727, 6 Pareto points, 22.75 pp FPR span, 29-step latency span |
| H5 — Manipulation resistance | Fail | Phase 6.1 holdout passes: 59.70% retained toxic coverage, 20.79 pp FPR reduction, 2,216-pip oscillation reduction |
| H6 — Directional discrimination | Pass | 44.33 pp directional advantage; fee/volatility correlation 0.253 |

The original H4/H5 failures remain committed. Phase 6.1 is a separate
train/holdout experiment: it selects from 90 training-only candidates and then
evaluates five disjoint reserved seeds. It does not rewrite the unfavorable v1
result.

### Verification snapshot

- 98 Solidity tests pass in the standard local gate.
- 38 Python research tests pass.
- Stateful invariants complete 512 runs and 65,536 calls per invariant under
  the CI profile.
- Phase 6 evaluates 42 configurations × 15 scenarios × 5 seeds = 3,150 raw
  ThetaShield runs.
- Dependency lock, tracked-secret scan, deployment schema, formatting, build,
  golden vectors, and generated research artifacts all pass their gates.
- The dashboard passes lint, production server rendering, content assertions,
  and a high-severity dependency audit with zero known vulnerabilities.

## Security and operating boundary

The controller fails back to the baseline fee when data is missing, stale,
paused, low-confidence, malformed, or expired. Authentication, monotonic
sequence checks, fee/risk bounds, recommendation lifetime, cooldown, bounded
queues, and bounded Cron work constrain the control plane.

The prototype is still unaudited. A valuable deployment additionally requires
an independently reviewed oracle adapter and publishing policy, multisig or
hardware-backed operations, monitoring and alerting, a callback funding policy,
resolved dependency licensing, and external contract/economic/infrastructure
review.

## Deployment status

No live deployment or acceptance lifecycle is claimed. The committed Phase 8
manifest is a non-broadcasting dry run with predicted addresses from a past
nonce snapshot. Those addresses and cost caps must be regenerated from current
wallet nonces, balances, gas conditions, and official network infrastructure
before approval. A live manifest can be created only after confirmed
transactions and a verified swap-to-callback lifecycle.

## Reproduction

```sh
git clone --recurse-submodules git@github.com:RudraBhaskar9439/ThetaShield.git
cd ThetaShield
FOUNDRY_PROFILE=ci make verify
```

Focused evidence is available through `make phase5-check`,
`make phase6-check`, `make phase61-check`, `make phase7-check`, and
`make phase9-check`.

## Evidence map

- Mathematics: `docs/MATHEMATICAL_SPECIFICATION.md`
- Architecture: `docs/ARCHITECTURE.md`
- Baselines: `research/reports/PHASE5_BASELINES.md`
- Original hypotheses: `research/reports/PHASE6_HYPOTHESES.md`
- H4/H5 holdout: `research/reports/PHASE61_REMEDIATION.md`
- Threat model: `docs/THREAT_MODEL.md`
- Deployment runbook: `docs/DEPLOYMENT_RUNBOOK.md`
- Phase 8 release candidate: `docs/PHASE8_RELEASE_CANDIDATE.md`
- Phase 9 handoff: `docs/PHASE9_HANDOFF.md`
