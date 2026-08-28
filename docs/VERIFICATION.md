# Verification

## Whole-repository gate

```sh
make verify
```

This checks Solidity formatting/lint/build/tests and size limits, Python tests,
golden vectors, reproducible research reports, pinned dependencies, tracked
secrets, deployment-schema syntax, and the dashboard production build/content.

## Current Circle lifecycle

```sh
forge test --match-contract ThetaShieldCircleProcessorTest -vv
forge test --match-contract ThetaShieldCircleTransportTest -vv
forge test --match-contract ThetaShieldCircleEndToEndTest -vv
forge test --match-contract ThetaShieldControllerTest -vv
forge test --match-contract ThetaShieldHookIntegrationTest -vv
```

Required evidence:

- only the local Circle transmitter, configured source domain, sealed peer, and
  finalized threshold can deliver an observation or recommendation;
- unfinalized, wrong-domain, wrong-peer, replayed, stale, future, malformed,
  low-confidence, out-of-fee-range, and out-of-risk-range inputs fail closed;
- Circle dispatch failure does not revert the user's swap;
- queues, reference histories, epochs, sources, and work per call are bounded;
- a real local PoolManager swap sends the observation, delayed reference work
  produces a recommendation, and a later real swap applies the new directional
  fee; and
- expiry, pause, or unavailable data selects the baseline.

## Deployment checks

```sh
make deployment-dry-run
make fork-check
```

`DeploymentValidationTest` covers wrong chains, noncanonical transmitters,
wrong Circle domains, missing code, zero identifiers, and duplicate addresses.
Fork tests are opt-in and must not be skipped for a release: they check Unichain
Sepolia's PoolManager/routers/domain 10 and Ethereum Sepolia's domain 0 against
the configured `MessageTransmitterV2`.

Run the read-only scripts from `docs/DEPLOYMENT_RUNBOOK.md` before simulation.
No broadcast is part of a verification command.

## Reactive Legacy automation

```sh
make reactive-legacy-check
```

This gate uses ThetaShield's official Legacy `Cron10` topic rather than the
simulator package's placeholder constants. It proves exact processor/executor/
CRON subscriptions, maturity suppression, authenticated ReactVM callbacks,
three-source bounded work, finalization, retries, and the permissionless keeper
fallback. Deployment validation separately rejects the Omni system bytecode,
wrong callback proxy, wrong chain, wrong CRON topic, and zero initial reserves.

The two live, read-only `ReactiveLegacyPreflight` calls in the deployment
runbook are mandatory for G10 because unit tests cannot prove that an external
RPC still serves the pinned Legacy infrastructure. A release additionally
requires a public destination callback receipt; a locally simulated callback
is never presented as that evidence.

## Focused security/research gates

```sh
make boundary-fuzz-check
make invariant-check
make gas-check
make dependency-check
make secret-check
make research-test
make phase5-check
make phase6-check
make phase61-check
make reactive-legacy-check
make phase9-check
```

Historical Phase 2/3/4/7 Omni/Lasna commands in old handoffs describe the
retired implementation and are not current release gates. Use the current
Legacy migration record and G10 runbook.
