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

Before any live deployment, the project must complete callback-authentication,
replay, sequence, timestamp, fee-bound, oracle-staleness, bounded-processing,
gas-griefing, invariant, and deployment-configuration checks.
