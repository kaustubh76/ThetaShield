# Deployments

No complete ThetaShield deployment is claimed. One orphan Ethereum Sepolia mock
feed from the retired attempt is documented in the final report; it is not a
Circle release component.

The files in `archive/` are historical non-broadcast Lasna dry runs and must not
be used. New Circle dry-runs and live records use schema version 3.

`manifest.schema.json` records source revision, Circle domains, components,
observation/recommendation relay transactions, later-fee evidence, and separate
approved/actual native-token costs for both chains. RPC URLs are referenced by
secret name only.

Secrets and funded credentials must never be stored here. A live manifest must
not be created as proof of success until its transactions are confirmed and its
acceptance lifecycle is independently checked.
