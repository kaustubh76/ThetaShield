# Documentation index

Twenty documents live here and they are not equally important. This page is the
map: the first two tables are what a reviewer wants, the third is working
history kept for auditability. The eleven per-phase records that used to sit
between you and them now live in [`history/`](history/).

Everything below is written against the deployment recorded in
[the live manifest](../deployments/unichain-sepolia-ethereum-sepolia-reactive-legacy-kaustubh76-live.json),
and every live number is readable at <https://thetashield.vercel.app>.

## Start here

| Document | What it answers |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | What the components are, how a message travels, and how each hop fails |
| [Mathematical specification](MATHEMATICAL_SPECIFICATION.md) | Units, formulas, rounding, confidence, and persistence — every number the fee curve uses |
| [Threat model](THREAT_MODEL.md) | Trust boundaries, attack surfaces, controls, and what is deliberately left open |
| [Verification guide](VERIFICATION.md) | How to check the claims yourself, gate by gate |
| [Final report](FINAL_REPORT.md) | What was delivered, what was measured, and where the release boundary sits |
| [Deployment runbook](DEPLOYMENT_RUNBOOK.md) | The exact procedure that produced the live deployment |

## Presenting it

| Document | Use |
| --- | --- |
| [Pitch deck](PITCH_DECK.md) | 21 slides, with an appendix of live counters and an explicit "what not to say" |
| [Four-minute pitch](WINNING_PITCH_SCRIPT.md) | The short narrative, with the honest three-claim split |
| [Five-minute video script](VIDEO_SCRIPT_5MIN.md) | Shot list and tab order for the recorded demo |
| [Submission blurb](SUBMISSION.md) | Copy-ready description |
| [End-to-end flow diagram](THETASHIELD_FLOW.png) ([source](THETASHIELD_FLOW.excalidraw)) | The whole system on one canvas, in four bands. Generated from the manifest by `script/gen_flow_diagram.py` and rendered by `make diagram-png`, so neither can drift from what is deployed |
| [Architecture diagram](THETASHIELD_ARCHITECTURE.drawio) · [detail](THETASHIELD_ARCHITECTURE4.drawio) · [16:9](THETASHIELD_VIDEO_ARCHITECTURE.drawio) | Editable draw.io sources, with rendered `.png` beside each |

## Working history

Kept because the record is part of the evidence, not because it is current. Two
documents carry a status banner explaining what has since changed.

| Document | Note |
| --- | --- |
| [Second-pass review](SECOND_PASS_REVIEW.md) | Self-review measured 2026-08-29. **Partly superseded** — see the banner at the top |
| [Functional gap report](FUNCTIONAL_GAP_REPORT.md) · [implementation](FUNCTIONAL_GAP_IMPLEMENTATION.md) | The G0–G10 programme that closed the first-pass findings |
| [Circle migration](CIRCLE_MIGRATION.md) · [Reactive Legacy migration](REACTIVE_LEGACY_MIGRATION.md) | Why the transport and automation planes are what they are |
| [Dependency review](DEPENDENCY_REVIEW.md) · [Roadmap](ROADMAP.md) | Submodule pinning; what is deliberately not built yet |
| [Teammate handover](TEAMMATE_HANDOVER_VIDEO.md) | Operational handover, not a pitch |
| [Research package](../research/README.md) · [deployments](../deployments/README.md) | The Python model and its reports; the manifest and why the earlier records are gone |
| [Demo script](DEMO_SCRIPT.md) | **Superseded** — predates the Reactive automation plane |
| [Phase handoffs](history/) (11 files) | Per-phase verification records, with an [index](history/README.md) saying what each established and what superseded it. Historical; not deployment instructions |
