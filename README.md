# ThetaShield

<p align="center">
  <img src="dashboard/public/og.png" alt="ThetaShield — Protect LPs from signal, not noise" width="100%" />
</p>

<p align="center">
  <strong>Directional memory for Uniswap v4.</strong><br />
  Delayed outcome evidence becomes a bounded, direction-specific fee recommendation—ordinary volatility does not.
</p>

<p align="center">
  <img alt="Solidity 0.8.26" src="https://img.shields.io/badge/Solidity-0.8.26-363636?logo=solidity" />
  <img alt="Foundry" src="https://img.shields.io/badge/Tested_with-Foundry-FFDB1C" />
  <img alt="Uniswap v4" src="https://img.shields.io/badge/Uniswap-v4-FF007A?logo=uniswap" />
  <img alt="Circle CCTP V2" src="https://img.shields.io/badge/Circle-CCTP_V2-136FD1" />
  <img alt="Status: testnet research" src="https://img.shields.io/badge/Status-Testnet_research-80FFB2" />
</p>

<p align="center">
  <a href="https://thetashield.vercel.app/#live-proof"><strong>Live testnet proof</strong></a>
  ·
  <a href="docs/THETASHIELD_ARCHITECTURE.png">Architecture</a>
  ·
  <a href="the live deployment manifest">Acceptance trace</a>
  ·
  <a href="docs/WINNING_PITCH_SCRIPT.md">Four-minute pitch</a>
</p>

> [!IMPORTANT]
> ThetaShield is unaudited research software deployed only on public testnets. The historical Phase 8D proof uses an owner-published demo feed; the `RESEARCH_V1` release path uses a permissionless, liquidity-filtered three-pool sampler. That sampler reads a **self-contained** market of project-issued tokens on Ethereum Sepolia — a different pair from the protected Unichain pool, with all three tiers moved together by the acceptance script — so live markout demonstrates the mechanism rather than measuring real adverse selection. Neither feed is a production oracle. The risk metric is a controlled adverse-selection proxy—not exact LVR, individual LP loss, or a profitability claim. The hook has **not** been submitted.

## The problem

Liquidity providers do not need a higher fee every time a market becomes noisy. They need protection when flow repeatedly moves against the pool after execution.

Most adaptive-fee designs react to unsigned volatility. That can make ordinary two-sided movement expensive while missing the distinction that matters: **which swap direction is consistently followed by an adverse price move?**

ThetaShield introduces delayed directional memory:

- it measures what happened *after* a swap;
- preserves the sign of the outcome;
- filters movement already explained by trailing noise;
- requires persistent evidence across bounded epochs; and
- raises only the fee direction supported by sustained adverse selection.

When evidence is missing, stale, paused, or low-confidence, the system returns to the configured baseline.

## How ThetaShield works

1. **Execute on Unichain.** A real Uniswap v4 hook reads the current directional fee, applies it to the swap, and emits compact execution evidence.
2. **Send finalized evidence.** The origin transport sends the observation through Circle CCTP V2. Transport failure never reverts the trader's completed swap.
3. **Wait for the outcome.** A bounded processor on Ethereum Sepolia waits for delayed, liquidity-filtered evidence from three configured v4 pools instead of pretending future information exists at execution time.
4. **Filter and persist.** The processor computes signed markout against strictly trailing volatility, applies confidence and notional bounds, and tests an `n-of-k` persistence window.
5. **Return a recommendation.** Circle carries a sequenced, expiring directional recommendation back to the origin controller.
6. **Verify before use.** The controller authenticates the Circle transmitter, domain, sealed peer, sequence, time window, confidence, fee, and risk bounds before exposing the fee to the hook.

The core signal is deliberately simple:

```text
signed markout   m = direction × (reference price − execution price) / execution price
filtered signal  e = sign(m) × max(|m| − k × trailing volatility, 0)
activation       = toxic epochs ≥ n of K
```

The current sample is excluded from its own volatility band. A trade therefore cannot make itself look harmless by widening the threshold used to score it.

## Architecture

<p align="center">
  <a href="docs/THETASHIELD_ARCHITECTURE.png">
    <img src="docs/THETASHIELD_ARCHITECTURE.png" alt="ThetaShield system architecture" width="100%" />
  </a>
</p>

The latency-sensitive execution plane stays on Unichain Sepolia. Delayed statistical work runs on Ethereum Sepolia. Circle CCTP V2 is the authenticated primary transport; Reactive Legacy Lasna schedules bounded processor work, while permissionless keepers retain independent relay and automation recovery paths. Neither receives authority to forge messages or recommendations.

| Component | Responsibility |
|---|---|
| `ThetaShieldHook` | Selects the directional fee, records the swap observation, and fails open only for observation transport availability. |
| `ThetaShieldCircleTransport` | Accepts observations from the sealed hook and sends finalized Circle messages to the sealed processor peer. |
| `ThetaShieldCircleProcessor` | Owns bounded queues, delayed references, trailing volatility, confidence, persistence, and directional fee calculation. |
| `PoolMedianReferenceSampler` | Permissionlessly normalizes three liquidity-qualified v4 pools into distinct sources for robust median and dispersion scoring. |
| `ThetaShieldController` | Verifies returned Circle messages and exposes a safe fee to the hook. Missing or invalid state resolves to baseline. |
| `ThetaShieldAutomationRSC` | Watches queued observations and CRON, schedules maturity/finalization wake-ups, and caps retries on Reactive Network. |
| `ThetaShieldAutomationExecutor` | Authenticates the RVM callback and executes one bounded sample/sync/process cycle; independent keepers can invoke the same safe cycle. |
| Permissionless keeper | Relays Circle attestations and provides automation redundancy without becoming a trust root. |

### Reactive Network: automation and resilience plane

Reactive Network Legacy Lasna provides ThetaShield's event-driven maturity scheduler and liveness guardian. Ethereum processor events arm work, the official Legacy `Cron10` signal wakes it only after maturity, and an authenticated callback through the official Ethereum Sepolia proxy runs the bounded three-source sampling and processing cycle. Failed or incomplete cycles enter a capped retry path.

Its authority is deliberately narrow: Reactive cannot forge a Circle observation, calculate an independent recommendation, install controller state, or block a swap. Independent keepers can call the same executor, so a Reactive outage degrades automation while Circle authentication, expiry, and baseline fallback preserve fee safety. The former Omni design that duplicated processing and attempted a direct chain-1301 callback remains historical failure evidence; the live G10 release uses the supported Legacy path and calls the Ethereum processor executor instead.

## Live testnet deployment

The G10 `RESEARCH_V1` lifecycle is live across Unichain Sepolia, Ethereum
Sepolia, and Reactive Legacy Lasna. A real swap emitted observation `5`; Circle
delivered it to the processor; Reactive armed the delayed work, issued the
maturity and finalization wakes, and produced two authenticated Ethereum
callbacks; Circle returned recommendation sequence `1`; and a later PoolManager
swap recorded the controller's expected `500`-pip (`5 bps`) fee.

The [live proof dashboard](https://thetashield.vercel.app/#live-proof) reads current state directly from both public testnets, displays the active safety state, and links the complete receipt trail. It performs read-only RPC calls and never connects a wallet or spends funds.

### Deployed contracts

| Role | Network | Address |
|---|---|---|
| Hook | Unichain Sepolia | [`0x7f5d…c0c0`](https://unichain-sepolia.blockscout.com/address/0x7f5d1beB9957d94c7fc0c8FC4D8DA4A0A0b8c0c0) |
| Controller | Unichain Sepolia | [`0x23ae…dFb7`](https://unichain-sepolia.blockscout.com/address/0x23ae3E1A306824F0CBA0b6561cB7E5502f63dFb7) |
| Circle transport | Unichain Sepolia | [`0x4f00…2609`](https://unichain-sepolia.blockscout.com/address/0x4f00e3BDd224F4c4b4958D54cD774E84B9092609) |
| Origin Lens | Unichain Sepolia | [`0xEF9C…3D5d`](https://unichain-sepolia.blockscout.com/address/0xEF9C630C6977d16Dac5107fe590FB184CB593D5d) |
| Three-pool sampler | Ethereum Sepolia | [`0xEF9C…3D5d`](https://eth-sepolia.blockscout.com/address/0xEF9C630C6977d16Dac5107fe590FB184CB593D5d) |
| Circle processor | Ethereum Sepolia | [`0x7bdF…BBF2`](https://eth-sepolia.blockscout.com/address/0x7bdF95029fd614e5FCB5C7B2D63e263a8Ca4BBF2) |
| Processor Lens | Ethereum Sepolia | [`0x4a1b…1EAb`](https://eth-sepolia.blockscout.com/address/0x4a1b453f4Ba183d7BEcd7e81bFfd8fB0682F1EAb) |
| Automation executor | Ethereum Sepolia | [`0x1A3a…9707`](https://eth-sepolia.blockscout.com/address/0x1A3a275dF6658ab96151480d920d58CeA5ab9707) |
| Automation RSC | Reactive Lasna | [`0x4f00…2609`](https://lasna.reactscan.net/address/0x4f00e3BDd224F4c4b4958D54cD774E84B9092609) |

**Pool ID:** `0x98cea44f9f7d6a1432b12a8a56e022758ffe447a9f2e529da7557eb788cdc2a5`

### Public acceptance receipts

| Step | Network | Receipt | Proven result |
|---:|---|---|---|
| 1 | Unichain Sepolia | [Observation swap](https://unichain-sepolia.blockscout.com/tx/0x3ad17b9a8e284026df5f30b675689c500841478ef349944f89b90decda0e93cf) | Hook observation `1` emitted and dispatched through Circle. |
| 2 | Ethereum Sepolia | [Circle observation relay](https://eth-sepolia.blockscout.com/tx/0x34619e9faa51bec6e08ca79317103d0126e09e4a6d79e4d7c18bcdf62db526e6) | Finalized Circle message queued on the processor. |
| 3 | Ethereum Sepolia | [Authenticated processing callback](https://eth-sepolia.blockscout.com/tx/0x302af17e45e9c6e0e92f3cd5a2a8c09ef7e049a2fc5e9e928653b79d736a96a8) | Reactive Legacy callback (`reactiveTrigger = true`) sampled three references and settled the observation. |
| 4 | Ethereum Sepolia | [Finalization callback](https://eth-sepolia.blockscout.com/tx/0x77eb4442df3c08ec62e13222bdde301627bc2901b8973ecfe746b6be84d51719) | Second authenticated callback finalized the epoch; recommendation sequence `1` sent through Circle. |
| 5 | Unichain Sepolia | [Recommendation relay](https://unichain-sepolia.blockscout.com/tx/0xe95924edea96230539da0a3e329d8948e9994fd9b37a92918599ca179309d18a) | Controller emitted `RecommendationApplied` for sequence `1`. |
| 6 | Unichain Sepolia | [Later fee-proof swap](https://unichain-sepolia.blockscout.com/tx/0x43de20571e80987e566f240e4cb3dad8de0c3235fd90942475360e2e75520e1b) | PoolManager `Swap` event recorded `500` pips, matching the controller. |

Both automation callbacks authenticated through the official Reactive Legacy callback proxy
`0xc9f36411C9897e7F959D99ffca2a0Ba7ee0D7bDA`; neither used the permissionless keeper fallback.

The first completed sample is intentionally cold-start data: zero shared confidence keeps both directions at the safe baseline while sequence and replay protection are still exercised. Local lifecycle tests cover the transition to a non-baseline directional fee once sufficient evidence exists.

For the machine-readable deployment record, exact approved/actual spend, Circle
message hashes, and Reactive callback evidence, see the [live
manifest](deployments/unichain-sepolia-ethereum-sepolia-reactive-legacy-kaustubh76-live.json),
which records all four preflight fingerprints, both Circle message hashes, and the
Reactive callback evidence.

## What makes the design different

| Property | ThetaShield behavior |
|---|---|
| **Directional** | Buy-base and sell-base recommendations evolve independently. Sign is never reduced to absolute volatility. |
| **Delayed** | The system waits for post-trade evidence instead of claiming future information at execution. |
| **Strictly trailing** | The current observation cannot widen the noise band used to score itself. |
| **Persistent** | Bounded `n-of-k` memory distinguishes sustained toxic flow from one noisy sample. |
| **Confidence-aware** | Observation count, directional agreement, and reference dispersion mechanically gate recommendations. |
| **Fail-safe** | Missing, stale, low-confidence, paused, or malformed recommendations select the baseline. |
| **Bounded** | Queues, histories, epochs, sources, message sizes, fee changes, risk, and keeper work are capped. |
| **Transport-authenticated** | Finality, transmitter, source domain, sealed peer, sequence, and timing checks constrain every cross-chain update. |

## Research evidence

ThetaShield was evaluated against fixed-fee, volatility-only, raw-markout, and dead-band baselines on shared deterministic synthetic streams.

| Evidence | Result |
|---|---:|
| Phase 6 sensitivity runs | `3,150` |
| Python research tests | `38` |
| H4 holdout rank correlation | `−0.727` |
| H4 holdout Pareto points | `6` |
| H5 retained toxic coverage | `59.70%` |
| H5 raw-minus-filtered false-positive reduction | `20.79 pp` |
| Measured Circle hook gas per swap | `199,973` |

The original Phase 6 H4 and H5 failures remain in the repository. Phase 6.1 uses a versioned train/holdout remediation: parameters were selected on training streams and evaluated on reserved holdout seeds. The evidence is reproducible, but it remains controlled synthetic evidence—not live-market or profitability evidence.

See the [final report](docs/FINAL_REPORT.md), [mathematical specification](docs/MATHEMATICAL_SPECIFICATION.md), and [research package](research/README.md).

## Security model

ThetaShield separates **swap continuity** from **recommendation validity**:

- an unavailable observation transport emits failure evidence but does not revert a completed swap;
- a forged, unfinalized, wrong-domain, wrong-peer, replayed, stale, future, malformed, or out-of-bounds recommendation reverts before advancing state;
- a stopped keeper delays updates but cannot stop swaps, and installed recommendations expire;
- controller pause, missing data, expiry, or insufficient confidence returns the baseline; and
- every externally driven processing path is bounded.

The repository includes unit tests, boundary fuzzing, stateful invariants, gas ceilings, deployment validation, golden vectors, dependency locking, and secret scanning. Passing these gates is not a substitute for an independent audit.

Read the [threat model](docs/THREAT_MODEL.md), [security policy](SECURITY.md), and [dependency review](docs/DEPENDENCY_REVIEW.md).

## Repository layout

```text
src/
├── hook/          Uniswap v4 dynamic-fee hook
├── controller/    Authenticated directional recommendation store
├── circle/        CCTP V2 transport, messages, and bounded processor
├── libraries/     Markout, filtering, confidence, persistence, and fee math
├── deployment/    CREATE2 mining and deployment validation
└── feeds/         Deterministic testnet demo feed

test/              Unit, fuzz, invariant, gas, deployment, and integration tests
script/            Circle preflight, deploy, configure, relay, and acceptance tools
research/          Independent Python model, scenarios, experiments, and reports
dashboard/         Interactive dashboard and read-only live testnet proof
deployments/       Machine-readable live manifest and archived retired candidates
docs/              Architecture, threat model, runbooks, reports, and phase handoffs
```

## Run locally

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Python `3.11+`
- Node.js `22.13+`
- npm
- Git with submodule support

### Install and verify

```bash
git clone --recurse-submodules git@github.com:kaustubh76/ThetaShield.git
cd ThetaShield
make verify
```

`make verify` runs the complete repository gate:

- Solidity formatting, linting, compilation, size checks, and tests;
- Python compilation, research tests, golden vectors, and reproducibility checks;
- dependency lock and tracked-secret checks;
- deployment-manifest validation; and
- dashboard lint, production build, rendered-content tests, and dependency audit.

Useful focused commands:

```bash
make test                  # Solidity suite
make research-test         # Python research suite
make boundary-fuzz-check   # boundary and property fuzzing
make invariant-check       # stateful invariants
make gas-check             # gas ceilings
make deployment-dry-run    # deployment and Circle lifecycle validation
make dashboard-check       # dashboard build and tests
```

Fork tests are deliberately opt-in because they require live RPC configuration:

```bash
make fork-check
```

### Run the dashboard

```bash
npm --prefix dashboard ci
npm --prefix dashboard run dev
```

The interactive signal-lab cards are explicitly simulated. The separate **Live Testnet Proof** section reads deployed contracts through public RPC endpoints and links to explorer receipts.

## Documentation

| Document | Purpose |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Component responsibilities, message lifecycle, and failure behavior |
| [Editable draw.io architecture](docs/THETASHIELD_ARCHITECTURE.drawio) | Presentation-ready system diagram |
| [Video architecture](docs/THETASHIELD_VIDEO_ARCHITECTURE.drawio) | Editable 16:9 diagram with a dedicated Reactive automation and resilience plane |
| [Detailed Architecture 4](docs/THETASHIELD_ARCHITECTURE4.drawio) | Editable component map with frontend, chain boundaries, Circle transport, and a dedicated Reactive control plane |
| [Mathematical specification](docs/MATHEMATICAL_SPECIFICATION.md) | Units, formulas, rounding, confidence, and persistence |
| [Threat model](docs/THREAT_MODEL.md) | Trust boundaries, attack surfaces, controls, and residual risks |
| [Verification guide](docs/VERIFICATION.md) | Whole-repository and focused verification gates |
| [Deployment runbook](docs/DEPLOYMENT_RUNBOOK.md) | Current G10 Circle + Reactive Legacy deployment and acceptance procedure |
| [G10 live acceptance](deployments/unichain-sepolia-ethereum-sepolia-reactive-legacy-kaustubh76-live.json) | Deployed addresses, Circle/Reactive receipts, fee proof, spend, and operating boundary |
| [G10 deployment readiness](deployments/unichain-sepolia-ethereum-sepolia-reactive-legacy-kaustubh76-live.json) | Historical pre-broadcast simulations, predicted addresses, and approved ceilings |
| [Reactive Legacy migration](docs/REACTIVE_LEGACY_MIGRATION.md) | Pinned Legacy topology, infrastructure, authentication, funding, and proof gates |
| [Circle migration](docs/CIRCLE_MIGRATION.md) | Rationale and record of the active transport migration |
| [Phase 8D handoff](deployments/unichain-sepolia-ethereum-sepolia-reactive-legacy-kaustubh76-live.json) | Live deployment, receipts, spend, and acceptance evidence |
| [Final research report](docs/FINAL_REPORT.md) | Delivered implementation, findings, and release boundary |
| [Four-minute pitch](docs/WINNING_PITCH_SCRIPT.md) | Judge-oriented project narrative |
| [Teammate handover video](docs/TEAMMATE_HANDOVER_VIDEO.md) | Rough recording script, repository tour, access boundary, and first-day checklist |

Historical Phase 3/4/7/8 Omni/Lasna documents are retained for auditability. They are not current deployment instructions.

## Production boundary

The approved public-testnet implementation and coding scope are complete. Production use would still require:

- a decentralized external oracle adapter;
- independent smart-contract and economic audits;
- redundant monitored keepers and incident response;
- hardware-backed or multisig ownership;
- production chain configuration and current infrastructure verification; and
- explicit deployment and hook-submission authorization.

No file, script, or document in this repository authorizes a mainnet deployment or hook submission.

## Contributing and disclosure

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes. Report vulnerabilities privately according to [SECURITY.md](SECURITY.md); do not open a public issue containing exploit details or credentials.

## License

This private research repository is currently **all rights reserved**. See [LICENSE](LICENSE).
