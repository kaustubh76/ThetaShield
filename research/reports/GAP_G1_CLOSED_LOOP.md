# G1 Coverage Feedback and Elastic-Flow Report

## Outcome

The locked G1 decision is **PASS** across 300 deterministic policy runs.
The controller now observes realized fee coverage against estimated positive markout loss,
then composes a bounded coverage premium with the existing directional toxic-flow premium.

## Declared gates

- `precision_preserved`: **PASS** — coverage policy inelastic mean FPR <= historical ThetaShield mean FPR.
- `feedback_is_exercised`: **PASS** — coverage policy must observe both eligible and deficit epochs.
- `benign_flow_noninferiority`: **PASS** — elastic benign retained-volume rate >= historical ThetaShield.
- `total_flow_noninferiority`: **PASS** — elastic total retained-volume rate >= historical ThetaShield.

## Elastic-flow comparison

| Metric | Historical ThetaShield | Coverage ThetaShield |
|---|---:|---:|
| Benign volume retained | 98.980% | 98.985% |
| Toxic volume retained | 99.419% | 99.450% |
| Total volume retained | 99.274% | 99.293% |
| False-positive rate | 6.889% | 6.876% |
| False-negative rate | 70.138% | 70.117% |
| Mean fee revenue (quote WAD) | 2213158280000000000 | 2202126746666666666 |

Fee revenue is disclosed, not used as a pass gate. Its coverage-policy delta is
`-11031533333333334` quote WAD in this experiment.

## Reproduction

```sh
make gap-g1-report
make gap-g1-check
make phase5-check
```

## Interpretation boundary

The selected controller shifts part of the toxic-risk gain into bounded coverage feedback. It preserves the declared precision and retained-flow gates, but does not improve mean fee revenue in this deterministic synthetic experiment.
Controlled deterministic synthetic evidence only; this is not live-market, profitability, deployment, or security-audit evidence.
