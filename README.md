# ThetaShield

ThetaShield is a directional adaptive-fee Uniswap v4 hook. It waits for delayed
signed markout, filters ordinary movement, requires persistent evidence, and
raises only the swap direction supported by adverse-selection evidence.

The active testnet design uses Circle CCTP V2 generic messages between Unichain
Sepolia and Ethereum Sepolia. Circle authenticates transport; a permissionless
keeper relays attestations and advances the bounded processor. No IReact, RVM
callback proxy, Lasna contract, or lREACT funding is part of the deployable path.

> Research prototype: unaudited, testnet-only, and not a profitability claim.
> The Circle contracts and real local lifecycle are implemented. No complete
> live ThetaShield deployment is claimed yet, and the hook has not been
> submitted.

## How it works

1. The Unichain Sepolia hook chooses the current directional fee and records a
   compact post-swap observation.
2. The origin transport sends that observation through finalized Circle CCTP.
   Circle outages fail open for the swap: the observation event remains, but
   transport failure never reverts the user's trade.
3. An Ethereum Sepolia processor waits for delayed reference evidence and runs
   bounded markout, trailing-noise, confidence, persistence, and fee logic.
4. The processor sends a finalized Circle recommendation back to Unichain.
5. The controller authenticates the Circle transmitter, source domain, sealed
   processor peer, sequence, timing, confidence, fee, and risk bounds. Missing
   or stale state returns the configured baseline.

## Repository map

```text
src/          Solidity hook, Circle transport/processor, controller, math
script/       Circle preflight, deployment, relay, and acceptance tools
test/         Unit, fuzz, invariant, integration, gas, and opt-in fork tests
research/     Independent model and reproducible experiments
dashboard/    Interactive research dashboard (simulated cards, not telemetry)
deployments/  Auditable manifests and historical retired candidates
docs/         Architecture, threat model, runbook, reports, and phase records
```

## Verify locally

Requirements: Foundry, Python 3.11+, Node.js 22.13+, npm, and Git submodules.

```sh
git clone --recurse-submodules git@github.com:RudraBhaskar9439/ThetaShield.git
cd ThetaShield
make verify
```

Start with [the architecture](docs/ARCHITECTURE.md), [deployment
runbook](docs/DEPLOYMENT_RUNBOOK.md), [threat model](docs/THREAT_MODEL.md), and
[Circle migration record](docs/CIRCLE_MIGRATION.md).

The older Phase 3/4/7/8 Lasna documents are retained only as historical evidence
of the retired implementation and must not be used for deployment.

## Safety boundary

- Never commit a private key or live credential.
- Recheck official chain, Uniswap, and Circle addresses immediately before use.
- Simulate every paid action and obtain a fresh exact spend approval before
  broadcast.
- The included owner-published reference feed is a testnet demo mock, not a
  production oracle.
- Nothing in this repository authorizes hook submission.

This private research repository is currently all rights reserved. See
[`LICENSE`](LICENSE).
