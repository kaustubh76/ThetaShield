"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import G9Experience from "./g9-experience";
import LaunchIntro from "./launch-intro";
import type { DashboardView } from "./research-data";

type FeeState = { feePips: number; usedBaseline: boolean };

type LiveProof = {
  ok: true;
  generatedAt: string;
  poolId: string;
  readPath: "lens" | "historical-direct";
  recommendationExpired: boolean;
  origin: {
    chainId: number;
    blockNumber: number;
    contractsHealthy: boolean;
    circlePeerSealed: boolean;
    baselineFeePips: number;
    configured: boolean;
    globallyPaused: boolean;
    poolPaused: boolean;
    observationCount: number;
    buy: FeeState;
    sell: FeeState;
    lastSequence: number;
    recommendation: {
      confidenceBps: number;
      validAfter: number;
      validUntil: number;
      sequence: number;
    };
  };
  processor: {
    chainId: number;
    blockNumber: number;
    contractHealthy: boolean;
    pendingCount: number;
    settledCount: number;
    expiredCount: number;
    lastObservationId: number;
    recommendationSequence: number;
    droppedCount: number | null;
    referenceSourceCount: number | null;
    zeroForOneCoverageRatioWad: string | null;
    oneForZeroCoverageRatioWad: string | null;
  };
};

const explorers = {
  unichain: "https://unichain-sepolia.blockscout.com",
  ethereum: "https://eth-sepolia.blockscout.com",
  reactive: "https://lasna.reactscan.net",
};

const liveAddresses = [
  ["Hook", "0x7f5d1beB9957d94c7fc0c8FC4D8DA4A0A0b8c0c0", explorers.unichain],
  ["Controller", "0x23ae3E1A306824F0CBA0b6561cB7E5502f63dFb7", explorers.unichain],
  ["Circle transport", "0x4f00e3BDd224F4c4b4958D54cD774E84B9092609", explorers.unichain],
  ["Processor", "0x7bdF95029fd614e5FCB5C7B2D63e263a8Ca4BBF2", explorers.ethereum],
  ["Reactive RSC", "0x4f00e3BDd224F4c4b4958D54cD774E84B9092609", explorers.reactive],
] as const;

const liveReceipts = [
  ["01", "Swap observed", "Unichain Sepolia", "0x3ad17b9a8e284026df5f30b675689c500841478ef349944f89b90decda0e93cf", explorers.unichain],
  ["02", "Circle observation received", "Ethereum Sepolia", "0x34619e9faa51bec6e08ca79317103d0126e09e4a6d79e4d7c18bcdf62db526e6", explorers.ethereum],
  ["03", "Authenticated processing callback", "Ethereum Sepolia", "0x302af17e45e9c6e0e92f3cd5a2a8c09ef7e049a2fc5e9e928653b79d736a96a8", explorers.ethereum],
  ["04", "Recommendation sent", "Ethereum Sepolia", "0x77eb4442df3c08ec62e13222bdde301627bc2901b8973ecfe746b6be84d51719", explorers.ethereum],
  ["05", "Recommendation installed", "Unichain Sepolia", "0xe95924edea96230539da0a3e329d8948e9994fd9b37a92918599ca179309d18a", explorers.unichain],
  ["06", "Hook fee proven", "Unichain Sepolia", "0x43de20571e80987e566f240e4cb3dad8de0c3235fd90942475360e2e75520e1b", explorers.unichain],
] as const;

function shortHex(value: string, left = 8, right = 6) {
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

function feeBps(feePips: number) {
  return (feePips / 100).toFixed(2);
}

function formatChainTime(seconds: number) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(seconds * 1_000));
}

function MetricBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-bar">
      <div><span>{label}</span><b>{value}%</b></div>
      <i style={{ "--value": `${value}%` } as CSSProperties} />
    </div>
  );
}

function LiveProofPanel() {
  const [proof, setProof] = useState<LiveProof | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/live", { cache: "no-store" });
      const payload = (await response.json()) as LiveProof | { message?: string };
      if (!response.ok || !("ok" in payload) || payload.ok !== true) {
        throw new Error("message" in payload && payload.message ? payload.message : "Testnet RPC unavailable");
      }
      setProof(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Testnet RPC unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const safeBaseline = proof ? proof.origin.buy.usedBaseline && proof.origin.sell.usedBaseline : true;
  const statusCopy = proof?.recommendationExpired
    ? "Safe baseline active · recommendation expired"
    : safeBaseline
      ? "Safe baseline active"
      : "Live directional recommendation active";

  return (
    <>
      <div className="live-toolbar">
        <div>
          <span className={`live-status ${proof ? "ok" : error ? "error" : ""}`}><i />{proof ? "Live read" : error ? "RPC unavailable" : "Connecting"}</span>
          <p>{proof ? `${proof.readPath === "lens" ? "Lens aggregate" : "Historical direct getters"} · read at ${new Date(proof.generatedAt).toLocaleTimeString()}` : "Reading both public testnets…"}</p>
        </div>
        <button className="refresh-button" disabled={loading} onClick={() => void refresh()} type="button">
          {loading ? "Reading on-chain state…" : "Refresh on-chain state"}
        </button>
      </div>

      {error && !proof ? <div className="rpc-error"><b>Live RPC read paused.</b><span>{error}. The verified receipt trail remains available below.</span></div> : null}

      <div className="live-grid" aria-live="polite">
        <article className="live-card origin-card">
          <div className="live-card-header"><span>ORIGIN · UNICHAIN SEPOLIA</span><b>{proof ? `block ${proof.origin.blockNumber.toLocaleString()}` : "reading…"}</b></div>
          <div className="live-fees">
            <div><span>BUY-BASE FEE</span><strong>{proof ? feeBps(proof.origin.buy.feePips) : "—"}</strong><small>bps</small></div>
            <div><span>SELL-BASE FEE</span><strong>{proof ? feeBps(proof.origin.sell.feePips) : "—"}</strong><small>bps</small></div>
          </div>
          <dl className="live-facts">
            <div><dt>Hook observations</dt><dd>{proof?.origin.observationCount ?? "—"}</dd></div>
            <div><dt>Installed sequence</dt><dd>{proof?.origin.lastSequence ?? "—"}</dd></div>
            <div><dt>Read path</dt><dd>{proof ? (proof.readPath === "lens" ? "ThetaShieldLens" : "direct fallback") : "—"}</dd></div>
            <div><dt>Contract code</dt><dd className={proof?.origin.contractsHealthy ? "healthy" : ""}>{proof ? (proof.origin.contractsHealthy ? "verified present" : "missing") : "—"}</dd></div>
            <div><dt>Circle peer</dt><dd className={proof?.origin.circlePeerSealed ? "healthy" : ""}>{proof ? (proof.origin.circlePeerSealed ? "sealed" : "open") : "—"}</dd></div>
          </dl>
        </article>

        <article className="live-card processor-card">
          <div className="live-card-header"><span>PROCESSOR · ETHEREUM SEPOLIA</span><b>{proof ? `block ${proof.processor.blockNumber.toLocaleString()}` : "reading…"}</b></div>
          <div className="processor-counts">
            <div><strong>{proof?.processor.pendingCount ?? "—"}</strong><span>pending</span></div>
            <div><strong>{proof?.processor.settledCount ?? "—"}</strong><span>settled</span></div>
            <div><strong>{proof?.processor.expiredCount ?? "—"}</strong><span>expired</span></div>
          </div>
          <dl className="live-facts">
            <div><dt>Last observation</dt><dd>{proof?.processor.lastObservationId ?? "—"}</dd></div>
            <div><dt>Recommendation sequence</dt><dd>{proof?.processor.recommendationSequence ?? "—"}</dd></div>
            <div><dt>Reference sources</dt><dd>{proof?.processor.referenceSourceCount ?? "historical"}</dd></div>
            <div><dt>Contract code</dt><dd className={proof?.processor.contractHealthy ? "healthy" : ""}>{proof ? (proof.processor.contractHealthy ? "verified present" : "missing") : "—"}</dd></div>
            <div><dt>Chain ID</dt><dd>{proof?.processor.chainId ?? "—"}</dd></div>
          </dl>
        </article>
      </div>

      <div className={`live-proof-note ${proof && !safeBaseline ? "active" : ""}`}>
        <i />
        <div><b>{statusCopy}</b><p>{proof?.recommendationExpired ? `Sequence ${proof.origin.lastSequence} remains auditable, but its validity window ended. Both swap directions safely return the configured ${feeBps(proof.origin.baselineFeePips)} bps baseline.` : "The displayed fee is the value the deployed hook controller currently returns for the proven pool."}</p></div>
        {proof ? <span>confidence {proof.origin.recommendation.confidenceBps / 100}% · valid until {formatChainTime(proof.origin.recommendation.validUntil)}</span> : null}
      </div>

      <div className="receipt-heading"><span>LIVE RECEIPT TRAIL</span><b>Six public transactions · open any receipt</b></div>
      <div className="receipt-rail">
        {liveReceipts.map(([number, title, chain, hash, explorer]) => (
          <a className="receipt-step" href={`${explorer}/tx/${hash}`} key={hash} rel="noreferrer" target="_blank">
            <span className="receipt-index">{number}</span>
            <span className="receipt-copy"><b>{title}</b><small>{chain}</small><code>{shortHex(hash)}</code></span>
            <span aria-hidden="true">↗</span>
          </a>
        ))}
      </div>

      <div className="address-strip">
        {liveAddresses.map(([label, address, explorer]) => (
          <a href={`${explorer}/address/${address}`} key={address} rel="noreferrer" target="_blank"><span>{label}</span><code>{shortHex(address)}</code><b>↗</b></a>
        ))}
      </div>
      <p className="proof-disclosure">Read-only proof. Refreshing performs public RPC reads; it never connects a wallet, signs a message, or spends testnet funds.</p>
      <p className="proof-disclosure">{proof?.readPath === "lens" ? "G10 state is aggregated through the deployed stateless ThetaShield lenses." : "Direct audited getters are used only when the paired G10 lenses are explicitly disabled."}</p>
    </>
  );
}

export default function DashboardClient({ data }: { data: DashboardView }) {
  const {
    bundleMeta,
    controllerConfig,
    evidenceStats,
    heroScenario,
    hypotheses,
    policyRows,
    researchScale,
    scenarios,
    trustBands,
  } = data;
  const [selectedId, setSelectedId] = useState(scenarios[0].id);
  const selected = scenarios.find((scenario) => scenario.id === selectedId) ?? scenarios[0];

  return (
    <main>
      <LaunchIntro />
      <header className="site-header">
        <a className="brand" href="#top" aria-label="ThetaShield home">
          <span className="brand-mark">θ</span>
          <span>THETASHIELD</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#mechanism">Mechanism</a>
          <a href="#simulator">LP simulator</a>
          <a href="#lab">Signal lab</a>
          <a href="#live-proof">Live proof</a>
          <a href="#evidence">Evidence</a>
          <a href="#trust">Trust</a>
          <a href="#system">System</a>
        </nav>
        <span className="release-state"><i /> Live testnet · research</span>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="kicker">Directional adaptive fees · Uniswap v4</p>
          <h1>Protect LPs from<br /><em>signal,</em> not noise.</h1>
          <p className="hero-lede">
            ThetaShield waits for delayed signed markout, filters ordinary movement, and raises only the fee direction
            supported by persistent adverse-selection evidence.
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="#live-proof">View live testnet proof</a>
            <a className="secondary-action" href="#lab">Run the signal lab</a>
          </div>
          <p className="trust-line">Risk proxy—not exact LVR, individual LP loss, or a profitability claim.</p>
        </div>

        <div className="signal-stage" aria-label="Signed markout filtering illustration">
          <div className="stage-label"><span>POST-TRADE SIGNAL</span><b>{controllerConfig.evidenceDelaySeconds}s evidence delay</b></div>
          <div className="signal-grid">
            <div className="dead-band"><span>trailing dead band</span></div>
            {[18, 34, 45, 51, 43, 58, 67, 71, 62, 78, 86, 73].map((height, index) => (
              <i
                className={height > 70 ? "signal adverse" : height < 38 ? "signal favorable" : "signal"}
                key={`${height}-${index}`}
                style={{ "--height": `${height}%`, "--delay": `${index * 45}ms` } as CSSProperties}
              />
            ))}
          </div>
          <div className="direction-readout">
            <div><span>BUY-BASE FEE</span><strong>{heroScenario.buyFee}</strong><small>bps · protected</small></div>
            <div><span>SELL-BASE FEE</span><strong>{heroScenario.sellFee}</strong><small>bps · baseline</small></div>
          </div>
          <div className="stage-foot"><span>signed evidence preserved</span><span>{controllerConfig.persistenceRequired} / {controllerConfig.persistenceWindow} toxic epochs</span></div>
        </div>
      </section>

      <section className="thesis-strip" aria-label="Core distinctions">
        <div><span>01</span><b>Trailing</b><p>The current observation cannot widen its own noise band.</p></div>
        <div><span>02</span><b>Persistent</b><p>One neutral epoch cannot erase sustained toxic history.</p></div>
        <div><span>03</span><b>Directional</b><p>Buy and sell recommendations evolve independently.</p></div>
        <div><span>04</span><b>Portable</b><p>Circle carries finalized observations and recommendations across chains.</p></div>
      </section>

      <G9Experience controllerConfig={controllerConfig} data={data} />

      <section className="section lab" id="lab">
        <div className="section-heading split-heading">
          <div><p className="kicker">Interactive signal lab</p><h2>Same volatility. Different information.</h2></div>
          <p>Illustrative scenario replay using the controller’s documented units and direction rules. These cards are simulated—not live chain state.</p>
        </div>

        <div className="scenario-tabs" role="tablist" aria-label="Choose a market scenario">
          {scenarios.map((scenario) => (
            <button
              aria-selected={scenario.id === selectedId}
              className={scenario.id === selectedId ? "active" : ""}
              key={scenario.id}
              onClick={() => setSelectedId(scenario.id)}
              role="tab"
              type="button"
            >
              <span>{scenario.eyebrow}</span>{scenario.label}
            </button>
          ))}
        </div>

        <div className="lab-grid">
          <article className="scenario-card">
            <div className="scenario-intro"><span>SELECTED STREAM</span><b>{selected.label}</b><p>{selected.summary}</p></div>
            <div className="fee-pair">
              <div className={selected.buyFee !== controllerConfig.baselineFeeBps ? "fee active" : "fee"}>
                <span>BUY-BASE</span><strong>{selected.buyFee}</strong><small>bps</small>
              </div>
              <div className={selected.sellFee !== controllerConfig.baselineFeeBps ? "fee active" : "fee"}>
                <span>SELL-BASE</span><strong>{selected.sellFee}</strong><small>bps</small>
              </div>
            </div>
            <div className="verdict"><i />{selected.verdict}</div>
          </article>

          <article className="filter-card">
            <div className="card-title"><span>FILTER TRACE</span><b>Current sample excluded from σ</b></div>
            <dl>
              <div><dt>Signed markout</dt><dd>{selected.markout}</dd></div>
              <div><dt>Trailing sigma</dt><dd>{selected.sigma}</dd></div>
              <div><dt>Dead band</dt><dd>{selected.band}</dd></div>
              <div className="filtered"><dt>Filtered markout</dt><dd>{selected.filtered}</dd></div>
            </dl>
            <div className="persistence">
              <span>PERSISTENCE · {controllerConfig.persistenceRequired} OF {controllerConfig.persistenceWindow}</span>
              <div>{selected.persistence.map((value, index) => <i className={value ? "toxic" : ""} key={index}>{value}</i>)}</div>
            </div>
          </article>

          <article className="confidence-card">
            <div className="card-title"><span>MECHANICAL CONFIDENCE</span><b>{selected.confidence.toFixed(1)}% composite</b></div>
            <MetricBar label="confidence score" value={selected.confidence} />
            <MetricBar label="reference cohesion" value={selected.referenceCohesion} />
            <MetricBar label="transport delivery" value={selected.deliveryRate} />
            <p>Bundle trace step {selected.evidenceStep.toLocaleString()} of {selected.eventCount.toLocaleString()}. The historical research stream caps confidence at {controllerConfig.confidenceCapPercent.toFixed(0)}%.</p>
          </article>
        </div>
      </section>

      <section className="section live-proof" id="live-proof">
        <div className="section-heading split-heading">
          <div><p className="kicker">Live testnet proof</p><h2>Don’t trust the demo. Read the contracts.</h2></div>
          <p>Read directly from deployed contracts across Unichain Sepolia and Ethereum Sepolia. This panel separates current chain state from the simulated signal lab.</p>
        </div>
        <LiveProofPanel />
      </section>

      <section className="section evidence" id="evidence">
        <div className="section-heading split-heading">
          <div><p className="kicker">Falsifiable evidence</p><h2>The failures stayed in the record.</h2></div>
          <p>Phase 6 failed H4 and H5. Phase 6.1 introduced a versioned change, locked parameters on training streams, and evaluated reserved holdout seeds.</p>
        </div>

        <div className="evidence-banner">
          <div><span>H4 HOLDOUT</span><strong>{evidenceStats.h4Correlation}</strong><p>rank correlation</p></div>
          <div><span>PARETO FRONTIER</span><strong>{evidenceStats.paretoPoints}</strong><p>points · {evidenceStats.latencySpan}-step span</p></div>
          <div><span>H5 HOLDOUT</span><strong>{evidenceStats.h5RetainedCoverage}</strong><p>toxic coverage retained</p></div>
          <div><span>NOISE REDUCTION</span><strong>{evidenceStats.h5NoiseReduction}</strong><p>raw-minus-filtered FPR</p></div>
        </div>

        <div className="hypothesis-grid">
          {hypotheses.map((hypothesis) => (
            <article key={hypothesis.id}>
              <span>{hypothesis.id}</span><h3>{hypothesis.title}</h3><b>{hypothesis.status}</b><p>{hypothesis.evidence}</p>
            </article>
          ))}
        </div>

        <div className="research-grid">
          <article className="pareto-card">
            <div className="card-title"><span>DETECTION TRADE-OFF</span><b>Reserved holdout audit</b></div>
            <div className="tradeoff-audit">
              <div><span>Rank correlation</span><strong>{evidenceStats.h4Correlation}</strong></div>
              <div><span>Pareto points</span><strong>{evidenceStats.paretoPoints}</strong></div>
              <div><span>Latency span</span><strong>{evidenceStats.latencySpan}</strong><small>steps</small></div>
              <div><span>Oscillation reduction</span><strong>{evidenceStats.h5OscillationReduction.toLocaleString()}</strong><small>fee pips</small></div>
            </div>
            <p>Stronger filtering reduces false positives but delays reaction. ThetaShield makes the trade-off measurable instead of hiding it.</p>
          </article>

          <article className="research-scale">
            <p className="kicker">Reproducible scope</p>
            <div><strong>{researchScale.phase6_raw_runs.toLocaleString()}</strong><span>Phase 6 sensitivity runs</span></div>
            <div><strong>{researchScale.phase61_training_cases.toLocaleString()}</strong><span>training-only remediation candidates</span></div>
            <div><strong>{researchScale.phase5_scenarios} × {researchScale.phase5_seeds}</strong><span>scenarios × repeated seeds</span></div>
            <div><strong>{researchScale.hook_gas_per_swap.toLocaleString()}</strong><span>measured Circle hook gas per swap</span></div>
          </article>
        </div>

        <div className="policy-table" role="region" aria-label="Baseline comparison" tabIndex={0}>
          <div className="table-heading"><span>POLICY COMPARISON</span><b>Mean fee budgets calibrated within {bundleMeta.calibrationSpreadBps} bps</b></div>
          <table>
            <thead><tr><th>Policy</th><th>Mean fee · bps</th><th>False positives</th><th>Detection · steps</th><th>Signed</th><th>Persistent</th><th>Behavior</th></tr></thead>
            <tbody>{policyRows.map((row) => <tr key={row.id}><td>{row.label}</td><td>{row.meanFeeBps}</td><td>{row.falsePositiveRate}</td><td>{row.detectionLatency ?? "—"}</td><td>{row.signed}</td><td>{row.persistent}</td><td>{row.behavior}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="section trust-surface" id="trust">
        <div className="section-heading split-heading">
          <div><p className="kicker">Trust surface</p><h2>Proof, simulation, and live history stay separate.</h2></div>
          <p>{bundleMeta.boundary}</p>
        </div>
        <div className="trust-bands">
          {trustBands.map((band) => (
            <article className={`trust-band ${band.id}`} key={band.id}>
              <span>{band.badge}</span>
              <h3>{band.title}</h3>
              <ul>{band.items.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          ))}
        </div>
        <p className="bundle-proof">Evidence bundle <code>{bundleMeta.id}</code> · {bundleMeta.sourceCount} content-addressed sources</p>
      </section>

      <section className="section system" id="system">
        <div className="section-heading"><p className="kicker">Autonomous system</p><h2>One delayed control loop. Bounded everywhere.</h2></div>
        <div className="system-flow">
          <article><span>ORIGIN · UNISWAP V4</span><h3>ThetaShield Hook</h3><p>Select fee · emit observation</p></article>
          <i>→</i>
          <article><span>ETHEREUM SEPOLIA · CIRCLE</span><h3>Bounded processor</h3><p>Relay · mature · score · persist</p></article>
          <i>→</i>
          <article><span>FINALIZED CCTP MESSAGE</span><h3>Origin controller</h3><p>Domain · peer · sequence · store</p></article>
        </div>
        <div className="boundary-grid">
          <article><span>SAFE FALLBACK</span><h3>Expired recommendation → {controllerConfig.baselineFeeBps} bps</h3><p>Stale state cannot keep a premium alive. Pause and missing-data paths return to the configured baseline.</p></article>
          <article><span>MESSAGE SECURITY</span><h3>Transmitter + domain + peer</h3><p>Only finalized Circle messages from the sealed processor peer are accepted; replays and malformed recommendations revert.</p></article>
          <article><span>PROCESSING BOUND</span><h3>Fixed work per keeper call</h3><p>Pending observations, reference history, epochs, and each permissionless processing call are capped.</p></article>
        </div>
      </section>

      <section className="release-section">
        <div>
          <p className="kicker">Current release boundary</p>
          <h2>Live Circle + Reactive loop proven.<br />Testnet-only.</h2>
        </div>
        <div className="release-list">
          <p><i className="done" /><span><b>Public Circle lifecycle</b> · Unichain → Ethereum → Unichain, later-fee proof</span></p>
          <p><i className="done" /><span><b>Research regression suite</b> · golden vectors and reproducible artifacts</span></p>
          <p><i className="done" /><span><b>Security gates</b> · dependency lock, secret scan, gas ceilings</span></p>
          <p><i className="done" /><span><b>G10 live acceptance</b> · Circle return, Reactive Legacy callbacks, and later-fee receipt trail preserved</span></p>
        </div>
      </section>

      <footer>
        <div className="brand"><span className="brand-mark">θ</span><span>THETASHIELD</span></div>
        <p>Outcome-aware protection for sustainable liquidity.</p>
        <div><span>UHI10 research prototype</span><span>Unaudited · testnet only</span></div>
      </footer>
    </main>
  );
}
