# ThetaShield Functional Gap Programme

This programme closes the research, protocol, automation, and interface gaps
identified after the Phase 8D Circle release. It starts from revision
`e68c2aca6a31c9ae761cdf6061fa6de603fe642d` and preserves the existing live
deployment as an immutable historical acceptance trace.

## Locked architecture decisions

1. Build a coverage-ratio feedback loop before describing the controller as
   closed loop.
2. Circle CCTP V2 remains the authenticated observation and recommendation
   rail.
3. Reactive Network is the event-driven automation and resilience plane. It
   may invoke bounded permissionless work, but it cannot install or forge a
   recommendation.
4. `RESEARCH_V1` is the default deployment profile. `DEMO_V1` requires explicit
   opt-in.
5. A multi-source reference sampler is the release target. The owner-published
   mock remains a deterministic test and demo fixture.
6. Volatility and inventory premiums must pass research gates before they are
   enabled. Unsupported premium language is not a substitute for code.
7. Gap phases G0-G9 are local implementation phases. Public-chain spending is
   reserved for a separately approved G10 deployment.
8. The hook remains owner-submission gated.

## Phase gates

| Phase | Deliverable | Status |
|---|---|---|
| G0 | Verified baseline and locked decisions | Complete |
| G1 | Coverage and flow-elasticity research | Complete |
| G2 | Solidity coverage feedback loop | Pending |
| G3 | Research/demo profiles and regression gates | Pending |
| G4 | Stateless protocol lens | Pending |
| G5 | Multi-source reference sampler | Pending |
| G6 | Reactive automation contracts | Pending |
| G7 | Deterministic dashboard bundle | Pending |
| G8 | Evidence-driven dashboard and lens integration | Pending |
| G9 | Animated mechanism and LP simulator | Pending |
| G10 | V2 deployment and public acceptance | Owner-gated |

Each phase must pass its focused checks and the relevant repository regression
suite before it is committed and pushed. A later phase cannot silently weaken
an earlier phase's acceptance criteria.

## G0 baseline

The baseline was verified on 2026-08-27 with `make verify`:

- Solidity: 94 passed, 0 failed, 2 environment-gated fork tests skipped;
- research: 38 passed, 0 failed;
- deterministic Phase 1, Phase 5, Phase 6, and Phase 6.1 checks passed;
- dependency lock and secret scan passed;
- deployment manifest schema validation passed;
- dashboard lint, build, rendered-HTML tests, and production dependency audit
  passed; and
- `script/check_phase9.py` passed.

The machine-readable artifact hashes and benchmark metrics are recorded in
`research/reports/gap_g0_baseline.json`.

## Release boundary

The existing Phase 8D contracts and receipts remain evidence for the original
single-source Circle demo profile. They are not modified in place. Any contract
whose configuration or sealed peer changes will receive a new V2 address and a
new manifest during G10.
