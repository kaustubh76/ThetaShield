# Phase 8C Handoff — Circle Release Hardening

> Historical record: the Reactive/Lasna removal described here was partly
> reversed in G6, which restored the Reactive Legacy Lasna scheduler that the
> live G10 deployment now uses. Submodule and Reactive claims below describe
> the Phase 8C state, not the current one.

## Outcome

The deployable and user-facing ThetaShield release path now uses Circle CCTP V2
end to end. Reactive/Lasna libraries, remappings, validation, fork tests, scripts,
active runbooks, and active dashboard copy have been removed or retired.

## Delivered

- Fail-closed origin and processor preflight validation for chain IDs, Circle
  domains, canonical `MessageTransmitterV2`, bytecode, Uniswap infrastructure,
  addresses, peers, pool ID, and market ID.
- Unichain Sepolia origin deployment, Ethereum Sepolia processor deployment,
  one-time peer sealing, bounded acceptance, generic CCTP relay, and sandbox
  attestation-fetch tooling.
- Circle-aware environment template and schema-v3 deployment manifest.
- Current threat model, architecture, verification guide, runbook, README,
  dashboard, final report, demo, and unsubmitted draft.
- Archived non-broadcast Lasna manifests and clear historical warnings on old
  phase handoffs.
- Removed `reactive-lib` and `reactive-test-lib` submodules, lock entries, and
  remappings. Only `forge-std` and `v4-core` remain as top-level submodules.
- Regenerated Phase 5/6/6.1 artifacts with the current Circle hook measurement:
  33,192 gas for `beforeSwap`, 166,781 warm `afterSwap`, 199,973 combined.

## Verification evidence

- Standard Solidity run: 94 passed, 0 failed, 2 opt-in fork tests skipped.
- Explicit live fork run: 2 passed, 0 failed, 0 skipped.
- Unichain Sepolia reports chain ID 1301 and Circle domain 10.
- Ethereum Sepolia reports chain ID 11155111 and Circle domain 0.
- The official testnet `MessageTransmitterV2` address has bytecode and reports
  the expected local domain on both chains.
- 38 Python tests pass; generated Phase 5/6/6.1 checks are current.
- Dashboard lint, production build, server-render test, content/identity gate,
  and high-severity dependency audit pass with zero reported vulnerabilities.
- `ThetaShieldCircleProcessor` runtime is 21,398 bytes, below EIP-170.

Official registries used for the live check:

- Circle CCTP contract addresses:
  <https://developers.circle.com/cctp/references/contract-addresses>
- Circle supported domains:
  <https://developers.circle.com/cctp/concepts/supported-chains-and-domains>
- Uniswap v4 deployments:
  <https://developers.uniswap.org/docs/protocols/v4/deployments>

## Remaining boundary

Phase 8D remains. No Circle ThetaShield deployment was broadcast during 8C.
Before any paid action, simulate the exact two-chain transaction set at the
current wallet nonce/balances, calculate separate Unichain Sepolia ETH and
Ethereum Sepolia ETH caps, and obtain fresh explicit approval. The old
SepETH/lREACT approval is not reusable. Hook submission remains prohibited.
