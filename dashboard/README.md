# ThetaShield Research Dashboard

Judge-facing interactive dashboard for ThetaShield's directional fee mechanism, filtering pipeline, persistence,
mechanical confidence, Phase 6/6.1 evidence, system boundaries, and release status.

## Evidence policy

- Interactive scenario cards are explicitly labeled simulated.
- Research values are imported at build time from the content-addressed
  `research/reports/dashboard_bundle.json` boundary.
- Vercel's project-root isolation is served by the byte-identical generated
  `dashboard/data/dashboard_bundle.json` mirror; the repository gate rejects
  either copy when it is stale.
- Contract and test counts come from the repository verification gate.
- Live deployment claims are backed by the Phase 8D explorer receipts and the read-only on-chain API.
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

## Production builds

The repository keeps both supported deployment targets explicit:

```sh
npm run build          # Sites/Cloudflare vinext build
npm run vercel-build   # Native Next.js build for Vercel
```

For Vercel, select `dashboard` as the project root. The committed
`vercel.json` selects the Next.js framework and native build command; the
output directory remains the Next.js default.

Production: <https://theta-shield.vercel.app>

## Lens-aware live reads

The historical Phase 8D deployment predates `ThetaShieldLens`, so the public
panel currently identifies its read path as `historical-direct`. After an
owner-approved G10 V2 deployment, configure both
`THETASHIELD_ORIGIN_LENS_ADDRESS` and
`THETASHIELD_PROCESSOR_LENS_ADDRESS`; the API then fails closed onto the two
stateless lens snapshots. It never silently mixes lens and direct state.
