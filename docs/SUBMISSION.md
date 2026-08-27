# ThetaShield Submission Draft

This is copy-ready draft material only. It has not been submitted, posted, or
sent to any external service.

## ThetaShield — Protect LPs from signal, not noise

ThetaShield is a directional adaptive-fee Uniswap v4 hook that uses delayed
signed markout, strictly trailing noise filtering, persistence, and mechanical
confidence to protect LPs from sustained adverse selection without reacting to
ordinary volatility.

The hook runs on Unichain Sepolia. It sends compact observations through Circle
CCTP V2 to a bounded Ethereum Sepolia processor. A permissionless keeper relays
finalized attestations and advances delayed work. The processor sends a
sequenced recommendation back through Circle, where the controller verifies the
transmitter, source domain, sealed processor peer, sequence, validity,
confidence, fee, and risk bounds. Missing or stale data returns the baseline.

Technically distinctive properties:

- separate state and fees for both swap directions;
- the current observation cannot widen the volatility band scoring itself;
- favorable/adverse sign is preserved instead of reduced to volatility;
- bounded `n-of-k` persistence and an explicitly gated fast path;
- Circle-authenticated transport with a permissionless, non-trusted keeper;
- swap continuity when observation transport is unavailable; and
- visible original H4/H5 failures plus disjoint train/holdout remediation.

Evidence includes the Solidity lifecycle suite, 38 Python research tests, 3,150
sensitivity runs, stateful invariants, boundary fuzzing, gas ceilings, golden
vectors, and reproducible research artifacts. H4 reaches `-0.727` holdout rank
correlation; H5 retains `59.70%` toxic coverage with a `20.79` percentage-point
false-positive reduction. These are synthetic risk-proxy results, not exact LVR
or profitability claims.

Repository: <https://github.com/RudraBhaskar9439/ThetaShield> (private during development)

Dashboard: <https://theta-shield.vercel.app> (public production deployment)

Current boundary: unaudited, testnet-only, owner-published mock reference feed,
and a completed public two-chain Circle acceptance lifecycle. The hook has not
been submitted, and no submission should occur until the owner separately
approves it.
