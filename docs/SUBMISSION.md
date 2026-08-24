# ThetaShield Submission Draft

This is copy-ready draft material only. It has not been submitted, posted, or
sent to any external service.

## Project

**ThetaShield — Protect LPs from signal, not noise.**

## One-line description

A directional adaptive-fee Uniswap v4 hook that uses delayed signed markout,
trailing noise filtering, persistence, and mechanical confidence to protect LPs
from sustained adverse selection without reacting to ordinary volatility.

## Problem

Volatility-only fee controllers can charge benign users during noisy but
directionless markets. Raw markout controllers can react to transient samples.
Both approaches can miss the fact that adverse selection is directional: buy
flow and sell flow should not automatically receive the same premium.

## Solution

ThetaShield applies separate fees for `zeroForOne` and `oneForZero` swaps. A v4
hook emits post-swap observations, Reactive Network waits for delayed price
evidence, and a bounded scheduler computes signed markout against a strictly
trailing volatility band. Independent `n-of-k` histories plus formula-based
confidence determine whether the signal is persistent. An authenticated origin
controller enforces sequence, expiry, cooldown, risk, and fee bounds, with a
baseline fallback for every invalid or unavailable state.

## What is technically distinctive

- The current observation cannot widen the volatility band used to score itself.
- Favorable and adverse directions remain signed rather than being collapsed
  into an unsigned volatility measure.
- Buy- and sell-direction histories, risks, confidence, and fees are independent.
- Delayed work is moved off the hook path into a bounded Reactive control loop.
- Failed original hypotheses remain visible; remediation is versioned and uses
  disjoint train/holdout seeds.

## Evidence

The local release gate passes 99 Solidity tests and 38 Python tests. Phase 6
covers 42 configurations, 15 scenarios, and five seeds (3,150 raw runs). The
original experiment passes H1, H2, H3, and H6 while failing H4 and H5. A
versioned holdout experiment passes the original H4/H5 criteria: H4 rank
correlation -0.727 with six Pareto points, and H5 retained toxic coverage
59.70% with a 20.79 percentage-point false-positive reduction.

These are controlled synthetic results. `notional × markout` is a risk proxy,
not exact LP loss or LVR, and the prototype makes no live-profitability claim.

## Links

- Repository: <https://github.com/RudraBhaskar9439/ThetaShield> (private during development)
- Dashboard: <https://thetashield-uhi10.rbrudra9439.chatgpt.site> (owner-only private preview)
- Architecture: `docs/ARCHITECTURE.md`
- Final report: `docs/FINAL_REPORT.md`
- Demo script: `docs/DEMO_SCRIPT.md`

## Current boundary

The contracts are unaudited and testnet-only. Local end-to-end and deployment
preflight evidence are complete. Live Phase 8 addresses and transaction hashes
must not be added until current network checks, explicit spend approval,
confirmed deployments, and a verified real callback lifecycle are complete.
