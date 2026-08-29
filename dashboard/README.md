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
- Live deployment claims are backed by the G10 Circle and Reactive Legacy explorer receipts and the read-only on-chain API.
- The adverse-selection proxy is never described as exact LVR or individual LP loss.
- The G9 mechanism animator shares its failure selection with the LP replay
  console, so transport outages, stale references, replay rejection, and bounded
  queue drops remain visible instead of disappearing behind a success demo.
- The simulator covers all 15 scenarios and five policies. Its dead-band,
  persistence, alpha, and fee-cap selectors are exact Phase 6 one-factor cases,
  not client-side guesses or claims about untested parameter combinations.

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

Production: <https://thetashield.vercel.app>

## Lens-aware live reads

The public panel defaults to the paired G10 `ThetaShieldLens` deployments on
Unichain Sepolia and Ethereum Sepolia. Both addresses may be overridden with
`THETASHIELD_ORIGIN_LENS_ADDRESS` and
`THETASHIELD_PROCESSOR_LENS_ADDRESS`; the API rejects a one-sided override and
never silently mixes lens and direct state. The named `historical-direct` path
remains only as an explicit code-level fallback.
