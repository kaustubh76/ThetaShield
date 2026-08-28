# Circle Release Scripts

All paid scripts must be simulated at the current nonce and reviewed before
`--broadcast`. No script submits the hook.

- `CircleDeploymentPreflight.s.sol`: read-only origin/processor chain, code,
  canonical transmitter, and Circle-domain validation.
- `profiles/ThetaShieldProfiles.sol`: shared `RESEARCH_V1` and explicit-opt-in
  `DEMO_V1` origin/processor configurations.
- `DeployCircleOrigin.s.sol`: Unichain Sepolia transport, controller, demo
  tokens, deterministic hook, pool, approvals, and demo liquidity.
- `DeployCircleProcessor.s.sol`: Ethereum Sepolia three-pool permissionless
  sampler for `RESEARCH_V1` (owner-published fixture for `DEMO_V1`) and bounded
  processor.
- `ConfigureCirclePeers.s.sol`: one-time origin hook/processor peer sealing.
- `fetch_circle_attestation.py`: polls Circle's sandbox API for a finalized
  message and attestation; never broadcasts.
- `RelayCircleMessage.s.sol`: permissionlessly delivers one attested message on
  its destination chain.
- `CircleAcceptance.s.sol`: separate bounded swap, reference, and processor
  actions for an auditable acceptance trace.

Use the exact dependency order and abort rules in
`docs/DEPLOYMENT_RUNBOOK.md`. Lasna/Reactive scripts are retired and absent.

`THETASHIELD_PROFILE` defaults to `RESEARCH_V1`. Setting it to `DEMO_V1`
prints a warning because that profile intentionally disables the researched
dead band, persistence, smoothing, and fast path. Both deployment-complete
events include the selected profile ID.

For acceptance, `RESEARCH_V1` uses `runSampleReferences()` followed by
`runProcessResearch()`. The legacy `runReference()` and `runProcess()` entry
points are retained only for `DEMO_V1` and historical Phase 8D reproduction.
