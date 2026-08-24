# Phase 9 Handoff — Dashboard and Submission Package

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

Phase 9 is complete locally. The dashboard and submission material do not claim
live deployment. Phase 8 stays open until the owner approves a regenerated
current cost cap and the real origin-to-Reactive-to-origin acceptance evidence
is confirmed. The submission draft has not been sent externally.
