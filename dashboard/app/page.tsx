"use client";

import { useMemo, useState, type CSSProperties } from "react";

type ScenarioId = "benign" | "volatile" | "buy" | "sell";

type Scenario = {
  id: ScenarioId;
  label: string;
  eyebrow: string;
  summary: string;
  buyFee: string;
  sellFee: string;
  markout: string;
  sigma: string;
  band: string;
  filtered: string;
  confidence: number;
  count: number;
  agreement: number;
  dispersion: number;
  persistence: number[];
  verdict: string;
};

const scenarios: Scenario[] = [
  {
    id: "benign",
    label: "Benign noise",
    eyebrow: "ordinary flow",
    summary: "Zero-mean movement stays inside the trailing band, so neither side receives a premium.",
    buyFee: "5.00",
    sellFee: "5.00",
    markout: "+1.10 bps",
    sigma: "1.24 bps",
    band: "±1.86 bps",
    filtered: "0.00 bps",
    confidence: 68,
    count: 88,
    agreement: 61,
    dispersion: 94,
    persistence: [0, 0, 0, 0, 0],
    verdict: "Baseline held",
  },
  {
    id: "volatile",
    label: "Mixed volatility",
    eyebrow: "risk without direction",
    summary: "Prices move, but opposing signed observations cancel. A volatility fee reacts; ThetaShield waits.",
    buyFee: "5.00",
    sellFee: "5.00",
    markout: "+6.20 bps",
    sigma: "5.02 bps",
    band: "±7.53 bps",
    filtered: "0.00 bps",
    confidence: 72,
    count: 100,
    agreement: 58,
    dispersion: 91,
    persistence: [0, 0, 0, 0, 0],
    verdict: "Noise rejected",
  },
  {
    id: "buy",
    label: "Informed buying",
    eyebrow: "persistent adverse selection",
    summary: "Three toxic epochs survive the filter. The buy-base side rises while sell-base flow stays at baseline.",
    buyFee: "10.00",
    sellFee: "5.00",
    markout: "+18.40 bps",
    sigma: "4.20 bps",
    band: "±6.30 bps",
    filtered: "+12.10 bps",
    confidence: 83,
    count: 100,
    agreement: 92,
    dispersion: 90,
    persistence: [1, 0, 1, 1, 0],
    verdict: "Buy protection active",
  },
  {
    id: "sell",
    label: "Informed selling",
    eyebrow: "opposite direction",
    summary: "The same controller reacts independently on the sell-base side. Direction is never absolute-valued away.",
    buyFee: "5.00",
    sellFee: "9.00",
    markout: "+15.70 bps",
    sigma: "3.84 bps",
    band: "±5.76 bps",
    filtered: "+9.94 bps",
    confidence: 79,
    count: 88,
    agreement: 90,
    dispersion: 91,
    persistence: [0, 1, 1, 0, 1],
    verdict: "Sell protection active",
  },
];

const hypotheses = [
  ["H1", "LP protection", "PASS", "+1.2254 quote paired improvement"],
  ["H2", "Benign-flow fairness", "PASS", "0.00% benign false positives"],
  ["H3", "Noise robustness", "PASS", "23.88 pp fewer false positives"],
  ["H4", "Detection trade-off", "PASS · v2", "−0.727 rank correlation on holdout"],
  ["H5", "Manipulation resistance", "PASS · v2", "59.70% toxic coverage retained"],
  ["H6", "Directional discrimination", "PASS", "+44.33 pp directional advantage"],
];

const policyRows = [
  ["Fixed fee", "5.00", "No", "No", "Reference floor"],
  ["Volatility only", "7.56", "No", "No", "Moves with market state"],
  ["Raw positive markout", "7.30", "Yes", "No", "Noise-biased"],
  ["Dead band only", "7.07", "Yes", "No", "Filters, but reacts once"],
  ["ThetaShield", "7.27", "Yes", "Yes", "Directional + persistent"],
];

function MetricBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-bar">
      <div><span>{label}</span><b>{value}%</b></div>
      <i style={{ "--value": `${value}%` } as CSSProperties} />
    </div>
  );
}

export default function Home() {
  const [selectedId, setSelectedId] = useState<ScenarioId>("benign");
  const selected = useMemo(
    () => scenarios.find((scenario) => scenario.id === selectedId) ?? scenarios[0],
    [selectedId],
  );

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="ThetaShield home">
          <span className="brand-mark">θ</span>
          <span>THETASHIELD</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#mechanism">Mechanism</a>
          <a href="#lab">Signal lab</a>
          <a href="#evidence">Evidence</a>
          <a href="#system">System</a>
        </nav>
        <span className="release-state"><i /> Research prototype</span>
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
            <a className="primary-action" href="#lab">Run the signal lab</a>
            <a className="secondary-action" href="#evidence">Inspect the research</a>
          </div>
          <p className="trust-line">Risk proxy—not exact LVR, individual LP loss, or a profitability claim.</p>
        </div>

        <div className="signal-stage" aria-label="Signed markout filtering illustration">
          <div className="stage-label"><span>POST-TRADE SIGNAL</span><b>60s horizon</b></div>
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
            <div><span>BUY-BASE FEE</span><strong>10.00</strong><small>bps · protected</small></div>
            <div><span>SELL-BASE FEE</span><strong>5.00</strong><small>bps · baseline</small></div>
          </div>
          <div className="stage-foot"><span>signed evidence preserved</span><span>3 / 5 toxic epochs</span></div>
        </div>
      </section>

      <section className="thesis-strip" aria-label="Core distinctions">
        <div><span>01</span><b>Trailing</b><p>The current observation cannot widen its own noise band.</p></div>
        <div><span>02</span><b>Persistent</b><p>One neutral epoch cannot erase sustained toxic history.</p></div>
        <div><span>03</span><b>Directional</b><p>Buy and sell recommendations evolve independently.</p></div>
        <div><span>04</span><b>Autonomous</b><p>Reactive schedules delayed observation and authenticated callbacks.</p></div>
      </section>

      <section className="section mechanism" id="mechanism">
        <div className="section-heading">
          <p className="kicker">The mechanism</p>
          <h2>Future evidence cannot exist at execution.</h2>
          <p>That is why the hook stays cheap and Reactive Network handles the delayed control loop.</p>
        </div>
        <div className="mechanism-flow">
          {[
            ["01", "Execute", "The v4 hook selects a directional fee and emits compact execution evidence."],
            ["02", "Wait", "Reactive holds the observation until the configured markout horizon matures."],
            ["03", "Filter", "Signed markout is scored against trailing volatility that excludes itself."],
            ["04", "Persist", "Notional, confidence, and n-of-k history decide whether risk is sustained."],
            ["05", "Callback", "An authenticated sequence updates only the affected fee direction."],
          ].map(([number, title, copy]) => (
            <article key={number}>
              <span>{number}</span><h3>{title}</h3><p>{copy}</p>
            </article>
          ))}
        </div>
        <div className="equation-row">
          <div><span>signed markout</span><code>m = d × (Pᵣₑ𝒻 − Pₑₓₑ𝒸) / Pₑₓₑ𝒸</code></div>
          <div><span>soft threshold</span><code>e = sign(m) × max(|m| − kσ, 0)</code></div>
          <div><span>activation</span><code>active = toxic epochs ≥ n of K</code></div>
        </div>
      </section>

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
              <div className={selected.buyFee !== "5.00" ? "fee active" : "fee"}>
                <span>BUY-BASE</span><strong>{selected.buyFee}</strong><small>bps</small>
              </div>
              <div className={selected.sellFee !== "5.00" ? "fee active" : "fee"}>
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
              <span>PERSISTENCE · 3 OF 5</span>
              <div>{selected.persistence.map((value, index) => <i className={value ? "toxic" : ""} key={index}>{value}</i>)}</div>
            </div>
          </article>

          <article className="confidence-card">
            <div className="card-title"><span>MECHANICAL CONFIDENCE</span><b>{selected.confidence}% composite</b></div>
            <MetricBar label="observation count" value={selected.count} />
            <MetricBar label="directional agreement" value={selected.agreement} />
            <MetricBar label="reference dispersion" value={selected.dispersion} />
            <p>Single-source testnet mode caps confidence at 60%. Research values shown here use the multi-source model.</p>
          </article>
        </div>
      </section>

      <section className="section evidence" id="evidence">
        <div className="section-heading split-heading">
          <div><p className="kicker">Falsifiable evidence</p><h2>The failures stayed in the record.</h2></div>
          <p>Phase 6 failed H4 and H5. Phase 6.1 introduced a versioned change, locked parameters on training streams, and evaluated reserved holdout seeds.</p>
        </div>

        <div className="evidence-banner">
          <div><span>H4 HOLDOUT</span><strong>−0.727</strong><p>rank correlation</p></div>
          <div><span>PARETO FRONTIER</span><strong>6</strong><p>points · 29-step span</p></div>
          <div><span>H5 HOLDOUT</span><strong>59.70%</strong><p>toxic coverage retained</p></div>
          <div><span>NOISE REDUCTION</span><strong>20.79 pp</strong><p>raw-minus-filtered FPR</p></div>
        </div>

        <div className="hypothesis-grid">
          {hypotheses.map(([id, title, status, evidence]) => (
            <article key={id}>
              <span>{id}</span><h3>{title}</h3><b>{status}</b><p>{evidence}</p>
            </article>
          ))}
        </div>

        <div className="research-grid">
          <article className="pareto-card">
            <div className="card-title"><span>DETECTION TRADE-OFF</span><b>Reserved holdout frontier</b></div>
            <div className="pareto-chart" aria-label="False-positive rate against detection latency">
              <span className="axis-y">false positives</span><span className="axis-x">detection latency →</span>
              {[
                [15, 76], [26, 61], [37, 49], [50, 40], [66, 28], [80, 18],
              ].map(([x, y], index) => <i key={index} style={{ left: `${x}%`, bottom: `${y}%` }}><small>{index + 1}</small></i>)}
            </div>
            <p>Stronger filtering reduces false positives but delays reaction. ThetaShield makes the trade-off measurable instead of hiding it.</p>
          </article>

          <article className="research-scale">
            <p className="kicker">Reproducible scope</p>
            <div><strong>3,150</strong><span>Phase 6 sensitivity runs</span></div>
            <div><strong>90</strong><span>training-only remediation candidates</span></div>
            <div><strong>15 × 5</strong><span>scenarios × repeated seeds</span></div>
            <div><strong>80,253</strong><span>measured hook gas per swap</span></div>
          </article>
        </div>

        <div className="policy-table" role="region" aria-label="Baseline comparison" tabIndex={0}>
          <div className="table-heading"><span>POLICY COMPARISON</span><b>Mean fee budgets calibrated within 0.49 bps</b></div>
          <table>
            <thead><tr><th>Policy</th><th>Mean fee · bps</th><th>Signed</th><th>Persistent</th><th>Behavior</th></tr></thead>
            <tbody>{policyRows.map((row) => <tr key={row[0]}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="section system" id="system">
        <div className="section-heading"><p className="kicker">Autonomous system</p><h2>One delayed control loop. Bounded everywhere.</h2></div>
        <div className="system-flow">
          <article><span>ORIGIN · UNISWAP V4</span><h3>ThetaShield Hook</h3><p>Select fee · emit observation</p></article>
          <i>→</i>
          <article><span>REACTIVE · LASNA</span><h3>Scheduler + filter</h3><p>Mature · score · persist</p></article>
          <i>→</i>
          <article><span>AUTHENTICATED CALLBACK</span><h3>Origin controller</h3><p>Sequence · validate · store</p></article>
        </div>
        <div className="boundary-grid">
          <article><span>SAFE FALLBACK</span><h3>Expired recommendation → 5 bps</h3><p>Stale state cannot keep a premium alive. Pause and missing-data paths return to the configured baseline.</p></article>
          <article><span>CALLBACK SECURITY</span><h3>Proxy + RVM ID + sequence</h3><p>Spoofed, replayed, out-of-order, future-dated, malformed, or out-of-range recommendations revert.</p></article>
          <article><span>PROCESSING BOUND</span><h3>Fixed work per reaction</h3><p>Pending observations, epoch history, and cron processing are capped to prevent unbounded iteration and gas griefing.</p></article>
        </div>
      </section>

      <section className="release-section">
        <div>
          <p className="kicker">Current release boundary</p>
          <h2>Local system proven.<br />Live acceptance pending.</h2>
        </div>
        <div className="release-list">
          <p><i className="done" /><span><b>98 Solidity tests</b> · unit, fuzz, invariant, integration</span></p>
          <p><i className="done" /><span><b>38 research tests</b> · golden vectors and reproducible artifacts</span></p>
          <p><i className="done" /><span><b>Security gates</b> · dependency lock, secret scan, gas ceilings</span></p>
          <p><i className="pending" /><span><b>Public testnet lifecycle</b> · requires owner-approved spend</span></p>
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
