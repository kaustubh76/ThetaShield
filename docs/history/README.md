# Historical record — phase handoffs

**Nothing in this directory is a current instruction.** These eleven documents
are the verification handoffs written as each phase closed. They are kept
because the project's claim is that its failures stayed in the record, and that
claim is only checkable if the record is still here.

Read them as dated receipts, not as documentation. Where a handoff and a current
document disagree, the current document wins:

| For | Read instead |
|---|---|
| What the system is and how it fits together | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Shipped parameter values | [`../MATHEMATICAL_SPECIFICATION.md`](../MATHEMATICAL_SPECIFICATION.md) §11–§12 |
| How to verify any of it | [`../VERIFICATION.md`](../VERIFICATION.md) |
| How to deploy or run the loop | [`../DEPLOYMENT_RUNBOOK.md`](../DEPLOYMENT_RUNBOOK.md) |
| The current state of the deployment | the live dashboard, <https://thetashield.vercel.app/#live-proof> |
| The most recent review of the whole system | [`../SECOND_PASS_REVIEW.md`](../SECOND_PASS_REVIEW.md) |

## Two things these files will tell you that are no longer true

**Test counts are point-in-time gate receipts.** Each handoff records what the
suite looked like the day that phase closed — 38, then 59, 71, 74, 75, 75, 93,
97, 94. None is a claim about today. The current suite discovers **127** Solidity
test functions across 24 `.t.sol` files, of which **124 pass** in an
environment-neutral run and **3** are opt-in fork tests skipped without live RPC
configuration; Python is **48** tests across 8 modules. Take exact numbers from a
current `make verify` receipt, never from a document.

**Early parameter values were research starting points.** `PHASE1_HANDOFF.md` in
particular carries the Phase 1 defaults — trailing window 32, dead-band
`k = 1.5`, recommendation TTL 180 s — which are *not* what ships.
[`../MATHEMATICAL_SPECIFICATION.md`](../MATHEMATICAL_SPECIFICATION.md) §11 sets
the research column beside the shipped column, and §12 records the two constants
where the shipped profile deliberately diverges from the research artifacts.

## What each phase established

| Phase | Established | Superseded by |
|---|---|---|
| [1](PHASE1_HANDOFF.md) | The pure controller mathematics — markout, trailing volatility, dead band, aggregation, confidence, persistence, fee curve — before any protocol integration. No hook, no chain, no paid transaction. | Values by `MATHEMATICAL_SPECIFICATION.md` §11; the mathematics itself still stands |
| [2](PHASE2_HANDOFF.md) | The first cross-chain controller and callback receiver. | The Circle CCTP migration — `CIRCLE_MIGRATION.md`. Carries its own historical banner |
| [3](PHASE3_HANDOFF.md) | The original Reactive/Lasna scheduler, which called `applyRecommendation` on the controller directly. | Retired in Phase 8A. The current design deliberately denies Reactive any controller authority — see `REACTIVE_LEGACY_MIGRATION.md`. Banner present |
| [4](PHASE4_HANDOFF.md) | The pre-Circle end-to-end lifecycle. | The Circle migration. Banner present |
| [5](PHASE5_HANDOFF.md) | The reproducible research harness and the five baseline policies, on shared synthetic streams. Assigns no H1–H6 verdicts. | Phase 6 for verdicts; `FINAL_REPORT.md` for the current summary |
| [6](PHASE6_HANDOFF.md) | The sensitivity sweep and the explicit H1–H6 evaluation — including the H4 and H5 **failures**, which were kept rather than tuned away. | Phase 6.1 for the remediation; the failures themselves are permanent record |
| [6.1](PHASE61_HANDOFF.md) | The train/holdout remediation that recovered H4 and H5 without overwriting the originals, plus the bounded fast path. Its parameter values *are* the current shipped ones. | Still current for parameters; `MATHEMATICAL_SPECIFICATION.md` §12 records where the shipped profile diverges |
| [7](PHASE7_HANDOFF.md) | The security gate set — boundary fuzzing, invariants, gas ceilings, dependency and secret checks, deployment validation. | Lasna-specific preflight replaced by the Legacy path. Banner present |
| [8B](PHASE8B_HANDOFF.md) | The Circle-only control path. | Reactive was restored in G6 as an automation plane with no fee authority, so this file's "no longer depends on Reactive" statement is stale. Banner present |
| [8C](PHASE8C_HANDOFF.md) | The Reactive/Lasna removal. | Same — reversed by G6. Banner present |
| [9](PHASE9_HANDOFF.md) | The dashboard and the submission package. | The dashboard has been rebuilt since; read the live site. This file is still required to exist by `script/check_phase9.py`, which asserts it says "Phase 9 is complete" |

## One correction to make while you are here

`PHASE9_HANDOFF.md` and [`../ROADMAP.md`](../ROADMAP.md) both use the phrase
"private dashboard published". That refers to the **Vercel project** being
owner-administered. The **production site is public** and needs no login —
<https://thetashield.vercel.app> answers anonymously, which is the whole point
of it being the project's evidence surface.
