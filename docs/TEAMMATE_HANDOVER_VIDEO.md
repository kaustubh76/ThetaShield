# ThetaShield — Teammate Handover Video

Target length: **12–15 minutes**  
Style: informal screen recording, one continuous take  
Audience: a technical teammate who will receive repository access

This is an operational handover, not a hackathon pitch. The goal is for the
teammate to understand what ThetaShield does, what is live, where everything
lives, how to verify it, and which boundaries must not be crossed casually.

## Before recording

Open these tabs in order:

1. [`README.md`](../README.md)
2. [ThetaShield dashboard](https://theta-shield.vercel.app)
3. [Detailed Architecture 4](THETASHIELD_ARCHITECTURE4.png)
4. [Simplified video architecture](THETASHIELD_VIDEO_ARCHITECTURE.png)
5. [`docs/PHASE8D_HANDOFF.md`](PHASE8D_HANDOFF.md)
6. [`deployments/unichain-sepolia-ethereum-sepolia-circle-phase8d-live.json`](../deployments/unichain-sepolia-ethereum-sepolia-circle-phase8d-live.json)
7. The repository tree in an editor
8. A terminal at the repository root

Before pressing record:

- close the wallet extension and any tabs containing balances or account data;
- make sure `.env`, shell history, API keys, private keys, and RPC credentials
  are not visible;
- enlarge the browser/editor text enough to remain readable in the recording;
- keep the dashboard on the hero section initially; and
- do not broadcast a transaction or connect a wallet during the video.

## Recording map

| Time | Screen | Purpose |
|---|---|---|
| `0:00–0:45` | README hero | Introduce the repository and current status |
| `0:45–2:00` | Dashboard hero | Explain the LP problem and product idea |
| `2:00–4:15` | Mechanism + architecture | Walk through the delayed control loop |
| `4:15–5:30` | Signal Lab | Show directional behavior; label it simulated |
| `5:30–7:15` | Live Testnet Proof | Show real contracts, state, and receipts |
| `7:15–9:20` | Repository tree | Explain where code, tests, research, and scripts live |
| `9:20–10:30` | Research evidence | Explain results and the honest claim boundary |
| `10:30–11:45` | Terminal + verification docs | Show how to reproduce the project |
| `11:45–13:15` | Deployment handoff | Explain ownership, operations, and secrets |
| `13:15–14:30` | Roadmap + close | State what is complete and what remains |

## Word-for-word rough script

### 0:00–0:45 — What I am handing over

**Show:** the top of `README.md`.

“This repository is ThetaShield, my UHI10 Uniswap v4 project. The short version
is that ThetaShield gives a liquidity pool directional memory. It measures what
happened after earlier swaps and can adapt the buy-side and sell-side fees
independently.

The coding and approved public-testnet scope are complete. The Circle lifecycle
has been proven across Unichain Sepolia and Ethereum Sepolia, the dashboard has
a read-only live proof section, and the verification suite is passing. This is
still unaudited testnet research. The hook has not been submitted, and nothing
in this handover authorizes a mainnet deployment or submission.”

### 0:45–2:00 — The problem ThetaShield solves

**Show:** dashboard hero and the buy-base/sell-base readout.

“A normal pool must price a swap before it knows whether that trade was fair to
the LP. If a trader buys at 100 and the external market is at 101 shortly
afterward, the LP sold at a stale price. That later movement is adverse
selection.

A fixed fee treats every market state the same. A volatility fee can charge
every trader more whenever prices move, even when the movement is harmless
two-sided noise. ThetaShield asks a more specific question: which direction of
flow repeatedly moved against the pool after execution?

It does not blacklist wallets, predict trader identities, delay swaps, or take
custody. It records the outcome and prices only the direction supported by
persistent evidence. If buying is repeatedly harmful, the buy-base fee can
rise while the sell-base fee stays at the five-basis-point baseline.”

### 2:00–4:15 — Complete mechanism

**Show:** the dashboard mechanism section, followed by the architecture image.

“The flow starts on Unichain Sepolia with a real Uniswap v4 dynamic-fee pool.
Before each swap, the hook asks the controller for the fee for that direction.
If there is no fresh and confident recommendation, the controller returns the
safe baseline.

After the swap, the hook emits the execution evidence: pool, direction,
amounts, execution price, applied fee, timestamp, and sequence. It then tries
to send the observation through Circle CCTP V2. This dispatch is deliberately
fail-open for transport availability. If Circle is unavailable, the evidence
event remains, but the trader's completed swap is not reverted.

A permissionless keeper relays the finalized Circle message to the processor
on Ethereum Sepolia. Circle authenticates the transport; the keeper only
provides scheduling and cannot forge the sender or recommendation.

The processor waits for delayed reference evidence. It computes signed
markout, subtracts a strictly trailing volatility band, checks notional and
reference quality, and aggregates evidence into bounded epochs. The current
sample is excluded from the band used to score itself, so a trade cannot hide
its own signal by widening its threshold.

The processor then applies confidence and n-of-k persistence. Buy and sell
directions have separate state. Only positive, persistent, confidence-qualified
risk can add a bounded premium.

The recommendation returns through Circle. The Unichain controller checks the
local message transmitter, source domain, sealed processor peer, pool,
sequence, timing, cooldown, confidence, fee, and risk bounds. Missing, stale,
paused, low-confidence, replayed, or malformed state cannot keep a premium
alive; the fee returns to baseline.”

**Point to the purple architecture lane.**

“Reactive Network is ThetaShield’s automation and resilience plane. It observes
hook evidence, reference updates, and relay health; schedules maturity-aware
work; monitors stuck messages; and drives recovery and redundant delivery.
Circle is the authenticated cross-chain rail verified by the current public
testnet trace. The Reactive callback route is canary-gated because the earlier
Lasna run emitted correctly targeted callback requests but public destination
delivery did not complete. This boundary preserves swap safety while keeping
Reactive central to the event-to-action control loop.”

### 4:15–5:30 — Signal Lab

**Show:** `#lab`. Click benign noise, mixed volatility, informed buying, and
informed selling.

“This Signal Lab explains the policy behavior. These four cards are simulated
scenarios using the documented protocol units; they are not live telemetry.

Benign noise remains at baseline. Mixed volatility also remains at baseline
when opposing signed observations cancel. Persistent informed buying raises
only the buy-base side, and persistent informed selling raises only the
sell-base side.

The filter trace shows signed markout, trailing sigma, the dead band, filtered
markout, and the persistence window. Mechanical confidence combines the
observation count, directional agreement, and reference dispersion.”

### 5:30–7:15 — Live public-testnet proof

**Show:** `#live-proof`. Press **Refresh on-chain state** once.

“This section is different from the Signal Lab. It reads the deployed
contracts through public RPC endpoints. Refreshing is read-only: it does not
connect a wallet, sign a message, or spend funds.

On Unichain, it shows the live buy and sell fee returned by the controller,
the hook observation count, installed sequence, runtime contract code, and the
sealed Circle peer. On Ethereum, it shows the bounded processor's pending,
settled, and expired counts, last observation, and recommendation sequence.

The current deployment is safely at five basis points in both directions. The
first installed recommendation had zero cold-start confidence and has now
expired, so the controller correctly returns the baseline. That is a safety
result, not a claim that the live fee became directional.

The receipt trail proves the completed lifecycle: a real swap emitted the
observation, Circle delivered it to Ethereum, delayed reference evidence was
accepted and settled, sequence one was sent back and installed, and a later
PoolManager swap used exactly the expected 500-pip fee. Every receipt opens in
the public explorer.”

### 7:15–9:20 — Repository tour

**Show:** the project tree in the editor.

“The active Solidity implementation is under `src`.

`src/hook` contains the Uniswap v4 hook. `src/controller` contains the safe
directional fee store. `src/circle` contains the versioned message encoding,
origin transport, and bounded processor. `src/libraries` contains the markout,
trailing volatility, dead-band, confidence, epoch, persistence, smoothing, and
fee math. `src/deployment` contains CREATE2 hook address mining and deployment
validation. `src/feeds` contains only the owner-published testnet demo feed.

The Solidity tests are under `test`, split into unit, math, integration, fuzz,
invariant, gas, deployment, demo, and opt-in fork suites.

The independent Python model is under `research`. Its experiments generate the
golden vectors, baseline comparisons, sensitivity sweep, and Phase 6.1
train/holdout remediation. The raw machine-readable results and charts are
committed so the conclusions can be reproduced.

`script` contains the current Circle preflight, deployment, peer configuration,
attestation fetching, relaying, and acceptance tools. These scripts never
submit the hook. `deployments` contains the live schema-v3 manifest and archived
retired candidates. `dashboard` contains the interactive site and the live
read-only API. `docs` contains the architecture, math, threat model, runbook,
phase handoffs, final report, and presentation material.

Historical Lasna documents remain for auditability, but they are not current
deployment instructions.”

### 9:20–10:30 — Research evidence

**Show:** dashboard Evidence section or `docs/FINAL_REPORT.md`.

“The research compares fixed fee, volatility-only, raw markout, dead-band, and
full ThetaShield policies on shared deterministic synthetic streams.

The original Phase 6 study passed H1, H2, H3, and H6, but failed H4 and H5. I
kept those failures. Phase 6.1 introduced a versioned change, selected
parameters only on training streams, and evaluated reserved holdout seeds.

On the holdout, H4 reached minus 0.727 rank correlation with six Pareto points.
H5 retained 59.70 percent toxic coverage while reducing false positives by
20.79 percentage points. There were 3,150 sensitivity runs and 38 Python tests.

These are controlled synthetic risk-proxy results. They are not exact LVR,
live LP profit, or proof of market demand.”

### 10:30–11:45 — Reproduce and verify

**Show:** a terminal at the repository root. Do not run the entire suite during
the recording unless there is time; show the command and the latest receipt.

“Clone the private repository with submodules, then run the full gate.”

```bash
git clone --recurse-submodules git@github.com:RudraBhaskar9439/ThetaShield.git
cd ThetaShield
FOUNDRY_PROFILE=ci make verify
```

“That command checks Solidity formatting, lint, compilation, contract sizes,
94 passing Solidity tests, 38 Python tests, golden vectors, reproducible
experiments, dependency locks, secret scanning, the deployment schema, the
dashboard production build, both rendered-dashboard tests, and the production
dependency audit.

The two fork tests are opt-in and skip without configured RPC variables. Use
`make fork-check` when the RPC endpoints are explicitly configured. The
verification command itself never broadcasts.”

### 11:45–13:15 — Operational handover and ownership

**Show:** `.env.example`, never `.env`.

“The repository contains no private key or populated environment file. Start
from `.env.example`. Public chain IDs, addresses, pool ID, domains, and demo
parameters are documented, but credentials must be shared separately through
an approved secure channel or replaced with teammate-owned credentials.

The live deployment was created from the public owner address
`0xd1DcAAFf9356d5a42f2eE6F90179C4509386a83f`. Repository access alone does not
transfer on-chain administration.

The controller, Circle transport, and demo reference feed use two-step
ownership. If operational ownership is ever transferred, the current owner
starts the transfer and the new owner explicitly accepts. That must be a
separate reviewed testnet action. The existing hook factory owner is immutable,
so a different administrative model would require a new factory for future
hook deployments. The processor itself is configured immutably and its mature
processing functions are permissionless.

The dashboard is also owner-only right now. GitHub collaborator access does not
automatically grant dashboard access. If the teammate is eligible under the
site workspace policy, add them separately; otherwise they can run the same
dashboard locally from the repository.

Never send a seed phrase or private key in the video, repository, chat, issue,
or normal message. Prefer a fresh team-controlled testnet account or multisig
over sharing the original wallet secret.”

### 13:15–14:30 — What is complete and what remains

**Show:** README Production Boundary section.

“What is complete is the approved testnet build: the hook, Circle transport,
bounded processor, controller, research harness, security gates, live
two-chain acceptance trace, dashboard, live proof, documentation, and handoff
materials.

What is not complete is production readiness. Before anything involving value,
ThetaShield still needs a decentralized external oracle adapter, independent
smart-contract and economic audits, redundant monitored keepers, incident
response, hardware-backed or multisig ownership, production chain
configuration, and explicit approval for deployment and hook submission.

The best first task after handover is to clone cleanly, run `make verify`, read
the architecture and threat model, and reproduce the live state using only the
dashboard and public explorers. Do not begin by redeploying or sending a paid
transaction.

That is the full project. The README is the entry point, Phase 8D is the live
deployment receipt, the manifest is the machine-readable source of truth, and
the threat model defines the safety boundary.”

## Access that must be handed over separately

Do not put any credential in Git or in the video.

| Access | Safe handover method | Current meaning |
|---|---|---|
| Private GitHub repository | Add the teammate as a named collaborator | Source and issue access only |
| Owner-only dashboard | Add a named viewer/editor if site policy permits; otherwise run it locally | Dashboard access only |
| RPC/API accounts | Have the teammate create their own credentials where possible | Read/fork/deployment tooling |
| Testnet wallet operation | Prefer a fresh team-controlled account or reviewed two-step ownership transfer | On-chain administration |
| Historical receipts | No secret required; use explorers and the live manifest | Public audit evidence |

Repository access, dashboard access, and on-chain ownership are three separate
permissions. Grant only what the teammate actually needs.

## Teammate first-day checklist

- [ ] Accept access to the private GitHub repository.
- [ ] Clone with `--recurse-submodules`.
- [ ] Confirm the checked-out commit and read `README.md`.
- [ ] Run `FOUNDRY_PROFILE=ci make verify` with no populated private key.
- [ ] Read `docs/ARCHITECTURE.md` and `docs/THREAT_MODEL.md`.
- [ ] Open the live proof dashboard and verify the public receipt trail.
- [ ] Compare deployed addresses with the Phase 8D manifest.
- [ ] Copy `.env.example` to a local ignored `.env` only if operational work is needed.
- [ ] Use teammate-owned RPC credentials.
- [ ] Confirm the hook remains unsubmitted.
- [ ] Obtain explicit approval before any broadcast, ownership transfer, access-policy change, or paid deployment.

## Questions the teammate is likely to ask

### Why are two chains involved?

The current swap needs a small deterministic hook. Delayed reference selection,
history, confidence, epochs, and persistence need more state and do not belong
on the latency-sensitive path. Cross-chain work updates later swaps; it never
blocks the current trade.

### Why does the live dashboard show five basis points?

Sequence `1` was a cold-start recommendation with zero shared confidence and
has expired. Safe fallback therefore returns the configured `500`-pip baseline.
The local end-to-end suite proves the later transition to a directional
non-baseline fee once sufficient evidence exists.

### Does the keeper control the recommendation?

No. Anyone may relay attestations and call bounded processing, but Circle
authenticates message delivery and the processor/controller enforce the math,
peers, domains, sequences, timing, and bounds.

### What is Reactive Network's role?

Reactive is the automation and resilience plane: event observation,
maturity-aware scheduling, liveness monitoring, retry signals, and the
canary-gated redundant delivery route. Circle is the authenticated transport
verified by the current public testnet acceptance trace.

### Can the project be used with real funds now?

No. It is unaudited, the demo reference feed is centralized, and the production
operational controls are not complete.

## Final recording checklist

- [ ] The Signal Lab was called simulated.
- [ ] The Live Testnet Proof was called read-only on-chain state.
- [ ] The live 5 bps result was explained as cold-start/expired safe fallback.
- [ ] Circle was described as the proven primary rail.
- [ ] Reactive was described as the automation and resilience plane, with its
      callback route accurately identified as canary-gated.
- [ ] No private key, balance, seed phrase, `.env`, email, or token appeared.
- [ ] No transaction was broadcast.
- [ ] The hook was explicitly described as not submitted.
- [ ] Production limitations were stated clearly.
