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
| Phase 7 — Security and release hardening | Complete |
| Phase 8A — Circle migration architecture | Complete |
| Phase 8B — Circle contracts and local lifecycle | Complete |
| Phase 8C — Circle release hardening | Complete |
| Phase 8D — Live deployment | Complete |
| Phase 9 — Dashboard and submission | Complete; private dashboard published, submission still owner-gated |
| Gap G0 — Baseline and architecture lock | Complete |
| Gap G1 — Coverage and flow-elasticity research | Complete |
| Gap G2 — Solidity coverage feedback | Complete |
| Gap G3 — Deployment profiles and regression gates | Complete |
| Gap G4 — Read-only protocol lens | Complete |
| Gap G5 — Multi-source reference sampler | Complete |
| Gap G6 — Reactive automation plane | Complete |
| Gap G7 — Deterministic dashboard bundle | Complete |
| Gap G8 — Evidence-driven dashboard | Complete |
| Gap G9 — Animated mechanism and LP simulator | Complete |
| Gap G10 — V2 deployment and acceptance | Complete; public Circle + Reactive Legacy acceptance proven |

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

## Phase 8A — Circle migration architecture

Retire the non-working Lasna candidate and define a Circle CCTP V2 generic
message path between Unichain Sepolia and Ethereum Sepolia. Preserve the
delayed bounded computation as a permissionlessly advanced contract rather
than claiming that Circle provides scheduling.

## Phase 8B — Circle contracts and local lifecycle

Replace the Reactive subscription/callback boundary with authenticated Circle
observation and recommendation messages. Verify the real PoolManager-to-hook-
to-processor-to-controller lifecycle locally, including failure and replay
cases.

## Phase 8C — Circle release hardening

Add Circle-specific validation, attestation relay tooling, fork tests,
manifests, runbooks, dashboard language, and complete project verification.

## Phase 8D — Live deployment

After a fresh two-chain simulation and explicit Circle-specific cost approval,
deploy in dependency order and verify a real swap-to-Circle-to-processor-to-
Circle-to-controller lifecycle.

## Phase 9 — Dashboard and submission

Deliver the research dashboard, diagrams, manifests, report, demo, submission
copy, and a final clean-clone reproduction.

The dashboard, final report, demo script, draft submission, and Phase 9
verification gate are complete. Phase 8D live addresses and acceptance evidence
are recorded in [`the live deployment manifest`](../deployments/unichain-sepolia-ethereum-sepolia-reactive-legacy-kaustubh76-live.json). No external
submission has been made. The migration decision is recorded in
[`CIRCLE_MIGRATION.md`](CIRCLE_MIGRATION.md).

The post-release functional programme and its locked architecture decisions are
recorded in [`FUNCTIONAL_GAP_IMPLEMENTATION.md`](FUNCTIONAL_GAP_IMPLEMENTATION.md).
The completed G10 deployment and public receipts are recorded in
[`the live deployment manifest`](../deployments/unichain-sepolia-ethereum-sepolia-reactive-legacy-kaustubh76-live.json).
