# Security Policy

ThetaShield is pre-release research software. It has not been audited and must
not be used to manage production liquidity or valuable assets.

## Reporting a vulnerability

Report vulnerabilities privately through a GitHub private vulnerability report
for this repository, or contact the repository owner through their verified
GitHub profile. Do not open a public issue containing exploit details or
secrets.

Include the affected component, impact, reproduction steps, and any suggested
mitigation. Please avoid interacting with third-party contracts or funds while
reproducing an issue.

## Security gates

Phase 7 implements callback-authentication, replay, sequence, timestamp,
cooldown, fee/risk bounds, oracle-window, bounded-processing, gas, invariant,
dependency, secret, and deployment-configuration checks. Run:

```sh
make phase7-check
FOUNDRY_PROFILE=ci make verify
```

See the [threat model](docs/THREAT_MODEL.md),
[dependency review](docs/DEPENDENCY_REVIEW.md), and
[deployment runbook](docs/DEPLOYMENT_RUNBOOK.md). Passing local gates is not an
audit. A production oracle, independent audit, live non-skipped fork checks,
current infrastructure verification, exact cost estimate, and explicit owner
approval remain mandatory before a deployment involving value.
