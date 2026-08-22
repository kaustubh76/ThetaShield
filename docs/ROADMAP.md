# Gated Roadmap

Every phase is verified before it is committed and pushed to `main`.

| Phase | Status |
|---|---|
| Phase 0 — Repository foundation | Complete |
| Phase 1 — Mathematics and research specification | Complete |
| Phase 2 — Hook and origin controller | Complete |
| Phase 3 — Reactive scheduler | Complete |
| Phase 4 — Local end-to-end lifecycle | Complete |
| Phase 5 — Research harness and baselines | Complete |
| Phase 6 — Sensitivity analysis and hypotheses | Complete |
| Phase 6.1 — H4/H5 remediation and holdout audit | Complete |
| Phase 7 — Security and release hardening | Pending |
| Phase 8 — Live deployment | Pending approval and cost gate |
| Phase 9 — Dashboard and submission | Pending |

## Phase 0 — Repository foundation

Create the private repository, Foundry scaffold, CI, safe configuration template,
documentation, and verification commands. Confirm privacy and clean-clone use.

## Phase 1 — Mathematics and research specification

Implement formal definitions, fixed-point Solidity libraries, the independent
reference model, golden vectors, statistical tests, and a benign-noise experiment.

## Phase 2 — Hook and origin controller

Implement the Uniswap v4 hook, directional dynamic-fee override, observation
events, authenticated controller, expiry, pause, bounds, and baseline fallback.

## Phase 3 — Reactive scheduler

Implement subscriptions, bounded pending observations, reference-price
ingestion, maturity, epoch aggregation, persistence, and callback generation.

## Phase 4 — Local end-to-end lifecycle

Connect the hook, pool, feed, Reactive simulator, callback receiver, and fee
controller. Exercise successful, stale, replayed, and out-of-order flows.

## Phase 5 — Research harness and baselines

Implement the five required policies, scenarios, datasets, metrics, repeated
seeds, and one-command chart reproduction.

## Phase 6 — Sensitivity analysis and hypotheses

Sweep controller parameters and assign H1-H6 explicit pass, fail, or
inconclusive outcomes, including directional discrimination.

## Phase 6.1 — H4/H5 remediation and holdout audit

Preserve the original failed H4/H5 evidence, add harder benign challenges and
a bounded confidence-gated fast path, select only on training streams, and
confirm the revised criteria on disjoint reserved seeds.

## Phase 7 — Security and release hardening

Expand fuzzing, invariants, gas analysis, fork tests, threat documentation,
dependency review, and deployment dry-runs.

## Phase 8 — Live deployment

After a cost estimate and explicit approval, deploy in dependency order and
verify a real swap-to-Reactive-callback lifecycle.

## Phase 9 — Dashboard and submission

Deliver the research dashboard, diagrams, manifests, report, demo, submission
copy, and a final clean-clone reproduction.
