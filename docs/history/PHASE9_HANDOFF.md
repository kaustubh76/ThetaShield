# Phase 9 Handoff — Dashboard and Submission Package

> **Post-Phase-9 update:** the public dashboard now defaults to the paired G10
> lenses and links the complete Circle + Reactive Legacy acceptance trail. See
> [G10 Live Acceptance](../../deployments/unichain-sepolia-ethereum-sepolia-reactive-legacy-kaustubh76-live.json). The original Phase 9 text below
> is retained as its historical handoff.

## Delivered

- A responsive interactive research dashboard in `dashboard/`.
- Four explicit simulated signal scenarios covering benign noise, mixed
  volatility, informed buying, and informed selling.
- Mechanism, mathematical filter, confidence, H1–H6, Phase 6.1 holdout,
  architecture, security boundary, and release-status sections.
- Request-host-derived Open Graph/Twitter metadata and a project-owned social
  preview card.
- A final research report, 3–4 minute demo script, and draft submission copy.
- A Phase 9 integrity checker plus root Make targets for dependency install,
  dashboard verification, and clean-clone reproduction.

The public Vercel production deployment is available at
<https://thetashield.vercel.app>.

## Verification

```sh
make phase9-check
FOUNDRY_PROFILE=ci make verify
```

The dashboard gate requires lint, a production build, server-rendered content
assertions, removal of starter preview code, and zero high-severity production
dependency advisories. The Phase 9 checker verifies required documents,
identity separation from MARKOUT, simulated/live labels, package identity, and
the PNG social-card signature.

## Status

Phase 9 is complete. Its system copy reflects the Circle CCTP migration and the
completed Phase 8D public testnet acceptance trace. The private dashboard is
published, but its scenario cards remain clearly labelled as simulations rather
than live telemetry. The submission draft has not been sent externally.
