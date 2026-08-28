# Circle Release Scripts

All paid scripts must be simulated at the current nonce and reviewed before
`--broadcast`. No script submits the hook.

- `CircleDeploymentPreflight.s.sol`: read-only origin/processor chain, code,
  canonical transmitter, and Circle-domain validation.
- `profiles/ThetaShieldProfiles.sol`: shared `RESEARCH_V1` and explicit-opt-in
  `DEMO_V1` origin/processor configurations.
- `DeployCircleOrigin.s.sol`: Unichain Sepolia transport, controller, demo
  tokens, deterministic hook, pool, approvals, demo liquidity, and origin Lens.
- `DeployCircleProcessor.s.sol`: one deterministic Ethereum Sepolia stack. For
  `RESEARCH_V1` it creates two reference tokens, initializes and funds three v4
  fee-tier pools, deploys the permissionless median sampler, bounded Circle
  processor, processor Lens, and funded Legacy callback executor. `DEMO_V1`
  keeps the owner-published fixture and does not deploy automation.
- `DeployAutomationExecutor.s.sol`: recovery-only standalone deployment of the
  processor-chain work target; the normal `RESEARCH_V1` stack deploys it in
  `DeployCircleProcessor.s.sol` to avoid nonce/address drift.
- `ReactiveLegacyPreflight.s.sol`: non-broadcasting checks for the pinned
  Legacy Lasna system bytecode, Ethereum Sepolia callback proxy, official
  `Cron10` topic, chains, dependencies, and nonzero reviewed reserves.
- `DeployAutomationRSC.s.sol`: Legacy Lasna maturity scheduler, official CRON
  subscriber, and funded capped liveness guardian for `RESEARCH_V1`.
- `ConfigureCirclePeers.s.sol`: one-time origin hook/processor peer sealing.
- `fetch_circle_attestation.py`: polls Circle's sandbox API for a finalized
  message and attestation; never broadcasts.
- `RelayCircleMessage.s.sol`: permissionlessly delivers one attested message on
  its destination chain.
- `CircleAcceptance.s.sol`: separate bounded origin swap, three-pool reference
  move/sample, and processor actions for an auditable acceptance trace.

Use the exact dependency order and abort rules in
`docs/DEPLOYMENT_RUNBOOK.md`. Reactive provides scheduling and resilience;
Circle remains the sole authenticated observation/recommendation rail.
The Legacy migration and pinned infrastructure are documented in
`docs/REACTIVE_LEGACY_MIGRATION.md`. Never use the retired Omni RPC for these
scripts.

`THETASHIELD_PROFILE` defaults to `RESEARCH_V1`. Setting it to `DEMO_V1`
prints a warning because that profile intentionally disables the researched
dead band, persistence, smoothing, and fast path. Both deployment-complete
events include the selected profile ID.

For acceptance, `RESEARCH_V1` can use `runMoveReferences()` to produce visible
price movement, then `runSampleReferences()` and `runProcessResearch()` as the
permissionless recovery path. The Reactive executor performs those bounded
steps automatically. The legacy `runReference()` and `runProcess()` entry
points are retained only for `DEMO_V1` and historical Phase 8D reproduction.
