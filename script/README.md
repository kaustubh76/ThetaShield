# Circle Release Scripts

All paid scripts must be simulated at the current nonce and reviewed before
`--broadcast`. No script submits the hook.

- `CircleDeploymentPreflight.s.sol`: read-only origin/processor chain, code,
  canonical transmitter, and Circle-domain validation.
- `DeployCircleOrigin.s.sol`: Unichain Sepolia transport, controller, demo
  tokens, deterministic hook, pool, approvals, and demo liquidity.
- `DeployCircleProcessor.s.sol`: Ethereum Sepolia demo reference feed and
  bounded processor.
- `ConfigureCirclePeers.s.sol`: one-time origin hook/processor peer sealing.
- `fetch_circle_attestation.py`: polls Circle's sandbox API for a finalized
  message and attestation; never broadcasts.
- `RelayCircleMessage.s.sol`: permissionlessly delivers one attested message on
  its destination chain.
- `CircleAcceptance.s.sol`: separate bounded swap, reference, and processor
  actions for an auditable acceptance trace.

Use the exact dependency order and abort rules in
`docs/DEPLOYMENT_RUNBOOK.md`. Lasna/Reactive scripts are retired and absent.
