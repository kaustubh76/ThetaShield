# Deployments

No contracts have been deployed.

`manifest.schema.json` defines the required record for future dry-runs and live
releases: source revision, networks, components, deployment transactions/blocks,
explorer and verification status, subscriptions, acceptance evidence, and
estimated/actual approved cost. RPC URLs are referenced by secret name only.

Secrets and funded credentials must never be stored here. A live manifest must
not be created as proof of success until its transactions are confirmed and its
acceptance lifecycle is independently checked.
