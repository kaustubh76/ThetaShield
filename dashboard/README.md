# ThetaShield Research Dashboard

Judge-facing interactive dashboard for ThetaShield's directional fee mechanism, filtering pipeline, persistence,
mechanical confidence, Phase 6/6.1 evidence, system boundaries, and release status.

## Evidence policy

- Interactive scenario cards are explicitly labeled simulated.
- Research values come from the committed Phase 5, Phase 6, and Phase 6.1 generated reports.
- Contract and test counts come from the repository verification gate.
- Live deployment remains labeled pending until explorer-backed acceptance evidence exists.
- The adverse-selection proxy is never described as exact LVR or individual LP loss.

## Local use

```sh
npm ci
npm run dev
```

Run the production verification with:

```sh
npm run verify
```
