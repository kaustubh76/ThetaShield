# ThetaShield Research Dashboard

Judge-facing interactive dashboard for ThetaShield's directional fee mechanism, filtering pipeline, persistence,
mechanical confidence, Phase 6/6.1 evidence, system boundaries, and release status.

## Evidence policy

- Interactive scenario cards are explicitly labeled simulated.
- Research values come from the committed Phase 5, Phase 6, and Phase 6.1 generated reports.
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
