# Phase 5 Verification Handoff

## Scope completed

Phase 5 delivers the reproducible research harness and required baselines. It
does not assign a pass or fail result to H1-H6; those decisions require the
Phase 6 sensitivity sweeps.

Delivered:

- deterministic generation for all 15 required market, oracle, callback, and
  controller-stress scenarios;
- five repeated seeds per scenario and 240 events per run;
- the five required policies: fixed fee, volatility-only dynamic fee, raw
  positive markout, dead-band markout without persistence, and full
  ThetaShield;
- a shared-stream simulator that gives every policy the same trades, prices,
  references, labels, and delivery failures;
- deterministic fee-budget calibration for the dynamic baselines;
- separate quote cash, base inventory, fee-revenue, buy-and-hold benchmark, and
  LP net accounting;
- complete classification, latency, directionality, operational, and economic
  metrics;
- actual isolated local `beforeSwap` and warm `afterSwap` gas measurements;
- committed raw CSV, aggregate JSON, scenario manifest, generated Markdown
  report, and three generated SVG charts; and
- exact artifact regeneration and stale-file rejection through `make`.

## Fair comparison rules

For each scenario and seed, the event stream is generated once and reused by
all policies. The direction, notional, execution price, delayed reference,
reference availability and dispersion, toxicity label, and delivery mode do not
change between policies.

Every policy uses the same 500-pip baseline, 10,000-pip maximum, update rate
limits, and evaluation period. ThetaShield keeps the documented 500,000 gain
starting point. Each other dynamic policy selects its gain from a committed grid
by minimizing calibration mean-fee distance from ThetaShield across benign,
informed-buying, and informed-selling streams. The selected dynamic calibration
means span 49 fee pips, so comparisons are not driven by a manually granted fee
budget.

The fixed policy remains at 500 pips by definition and is not forced to match a
dynamic average fee.

## Scenarios and repetition

The harness covers:

1. benign zero-mean noise;
2. persistent informed buying;
3. persistent informed selling;
4. alternating buy/sell toxicity;
5. high volatility without informed direction;
6. a toxic burst attempting to widen its own band;
7. a neutral epoch inside an attack;
8. microtrade spam;
9. one oversized observation;
10. conflicting reference prices;
11. stale references;
12. missing callbacks;
13. replayed callbacks;
14. out-of-order callbacks; and
15. fee-controller oscillation.

Five committed seeds produce 75 scenario-seed streams. Five policies produce
375 raw result rows. Aggregate JSON includes a mean and descriptive 95% normal
interval across scenario-seed runs. These intervals describe synthetic run
dispersion; they are not inferential confidence claims about live markets.

## Metrics

Every result row records:

- LP fee revenue;
- buy-and-hold-relative inventory PnL and LP net PnL;
- realized adverse markout proxy;
- benign- and toxic-trader fees;
- false-positive and false-negative rates;
- detection latency;
- toxic notional charged a premium;
- time above baseline and fee oscillation;
- toxic buy and sell fees plus correct-direction premium rate;
- correlation with the volatility-only fee series;
- measured hook gas per swap;
- Reactive processing and callback latency; and
- applied, missing, rejected, and reference-expiry counts.

The adverse-markout proxy is not used as the only LP outcome. Cash and inventory
are tracked independently, and inventory PnL is measured against holding the
initial inventory to the terminal price before fee revenue is added.

## Generated artifacts

`make research-report` regenerates:

- `research/datasets/phase5_scenarios.json`;
- `research/reports/phase5_results.csv`;
- `research/reports/phase5_summary.json`;
- `research/reports/PHASE5_BASELINES.md`;
- `research/reports/charts/phase5_policy_scorecard.svg`;
- `research/reports/charts/phase5_fee_budget.svg`; and
- `research/reports/charts/phase5_scenario_lp_outcomes.svg`.

`make phase5-check` regenerates all content in memory and compares it byte for
byte with the committed files. No chart consumes a manually edited intermediate
file.

## Gas measurement

The pinned local compiler and EVM profile report:

- `beforeSwap`: 33,000 gas;
- warm `afterSwap`: 47,097 gas; and
- combined measured hook operations: 80,097 gas per swap.

These are isolated hook-call measurements. They exclude PoolManager/router gas,
network pricing, calldata pricing differences, and live transaction overhead.

## Verification evidence

The focused Phase 5 checks require:

```sh
python3 -m unittest research.tests.test_phase5_harness -v
make phase5-check
```

The final phase commit is gated by:

```sh
FOUNDRY_PROFILE=ci make verify
```

The completed gate passed 75 Solidity tests and 23 Python research tests with
zero failures. Formatting, linting, compilation, golden-vector checks, the
Phase 1 benign experiment, and exact Phase 5 artifact reproduction also passed.

## Explicit limitations

- Synthetic results are not live-profitability claims.
- Exogenous order flow does not react to policy fee changes.
- The accounting model is not a concentrated-liquidity tick replay.
- Oracle and callback failure modes are deterministic simulations.
- Gas measurements are local and isolated rather than complete transaction
  costs.
- H1-H6 remain explicitly unevaluated until Phase 6.
- No live deployment, paid transaction, external token, or private key is used.
