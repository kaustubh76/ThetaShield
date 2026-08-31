"use client";

import { useState, type CSSProperties } from "react";
import Accordion from "./components/accordion";
import HoldoutPaired from "./components/charts/holdout-paired";
import MarkoutTrace from "./components/charts/markout-trace";
import PolicyScatter from "./components/charts/policy-scatter";
import SensitivityMultiples from "./components/charts/sensitivity-multiples";
import DistinctionStrip from "./components/distinction-strip";
import { formatInt } from "./components/format";
import LiveProofPanel from "./components/live-proof/live-proof-panel";
import { useLiveProof } from "./components/live-proof/use-live-proof";
import RegistrySection from "./components/registry/registry-section";
import type { DeploymentView } from "./deployment-data";
import G9Experience from "./g9-experience";
import LaunchIntro from "./launch-intro";
import type { DashboardView } from "./research-data";

function MetricBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-bar">
      <div><span>{label}</span><b>{value}%</b></div>
      <i style={{ "--value": `${value}%` } as CSSProperties} />
    </div>
  );
}

export default function DashboardClient({
  data,
  deployment,
}: {
  data: DashboardView;
  deployment: DeploymentView;
}) {
  const {
    bundleMeta,
    controllerConfig,
    evidenceStats,
    heroScenario,
    heroTrace,
    holdoutStory,
    hypotheses,
    policyRows,
    researchConfigRows,
    researchScale,
    scenarios,
    sensitivityAll,
    trustBands,
  } = data;
  const live = useLiveProof();
  const liveStatus = live.proof ? "ready" : live.error ? "error" : "loading";
  const [selectedId, setSelectedId] = useState(scenarios[0].id);
  const selected = scenarios.find((scenario) => scenario.id === selectedId) ?? scenarios[0];
  const sensitivityCaseCount = sensitivityAll.dimensions.reduce(
    (total, dimension) => total + dimension.cases.length,
    0,
  );
  const bands = trustBands.map((band) =>
    band.id === "live"
      ? {
          ...band,
          items: [
            `Cycle ${deployment.acceptance.reactiveCycleId} accepted · expected ${(deployment.acceptance.expectedFeePips / 100).toFixed(2)} = observed ${(deployment.acceptance.observedFeePips / 100).toFixed(2)} bps`,
            ...band.items,
          ],
        }
      : band,
  );

  return (
    <main>
      <LaunchIntro deployment={deployment} />
      <header className="site-header">
        <a className="brand" href="#top" aria-label="ThetaShield home">
          <span className="brand-mark">θ</span>
          <span>THETASHIELD</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#mechanism">Mechanism</a>
          <a href="#simulator">Replay</a>
          <a href="#lab">Signal lab</a>
          <a href="#live-proof">Live proof</a>
          <a href="#registry">Registry</a>
          <a href="#evidence">Evidence</a>
          <a href="#trust">Trust</a>
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
          <p className="hero-vignette">
            <b>The quiet loss:</b> a trader buys at 100 and a minute later the market prints 101. The trader kept the
            stale price; the LP financed the gap. ThetaShield prices that gap only when it repeats.
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="#live-proof">View live testnet proof</a>
            <a className="secondary-action" href="#lab">Run the signal lab</a>
          </div>
          <p className="trust-line">Risk proxy—not exact LVR, individual LP loss, or a profitability claim.</p>
        </div>

        <div className="signal-stage" aria-label="Signed markout research replay">
          <div className="stage-label"><span>POST-TRADE SIGNAL</span><b>{controllerConfig.evidenceDelaySeconds}s evidence delay</b></div>
          <MarkoutTrace trace={heroTrace} />
          <div className="direction-readout">
            <div><span>BUY-BASE FEE</span><strong>{heroScenario.buyFee}</strong><small>bps · protected</small></div>
            <div><span>SELL-BASE FEE</span><strong>{heroScenario.sellFee}</strong><small>bps · baseline</small></div>
          </div>
          <div className="stage-foot">
            <span>{`${heroTrace.label} stream · ${heroTrace.eventCount} events · seed ${heroTrace.seed}`}</span>
            <span>{controllerConfig.persistenceRequired} / {controllerConfig.persistenceWindow} toxic epochs</span>
          </div>
          <p className="stage-simnote">Research replay from the locked evidence bundle — not live chain state.</p>
        </div>
      </section>

      <DistinctionStrip calibrationSpreadBps={bundleMeta.calibrationSpreadBps} policies={policyRows} />

      <G9Experience data={data} deployment={deployment} />

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
            <p>Bundle trace step {formatInt(selected.evidenceStep)} of {formatInt(selected.eventCount)}. The historical research stream caps confidence at {controllerConfig.confidenceCapPercent.toFixed(0)}%.</p>
          </article>
        </div>
      </section>

      <section className="section live-proof" id="live-proof">
        <div className="section-heading split-heading">
          <div><p className="kicker">Live testnet proof</p><h2>Don’t trust the demo. Read the contracts.</h2></div>
          <p>Read directly from deployed contracts across Unichain Sepolia and Ethereum Sepolia. This panel separates current chain state from the simulated signal lab.</p>
        </div>
        <LiveProofPanel deployment={deployment} live={live} />
      </section>

      <RegistrySection
        deployedConfig={live.proof?.processor.deployedConfig ?? null}
        deployment={deployment}
        liveStatus={liveStatus}
        researchConfig={researchConfigRows}
      />

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

        <div className="evidence-charts">
          <article className="chart-panel">
            <div className="card-title"><span>POLICY SEPARATION</span><b>Signal-blind fees tax everyone.</b></div>
            <PolicyScatter policies={policyRows} />
            <p>{`Five policies on identical streams; the four dynamic policies' fee budgets were calibrated within ${bundleMeta.calibrationSpreadBps} bps of each other, with the fixed baseline pinned at ${controllerConfig.baselineFeeBps} bps. Whiskers are 95% intervals across seeds.`}</p>
          </article>
          <article className="chart-panel">
            <div className="card-title"><span>RESERVED HOLDOUT</span><b>Failures remediated, then re-scored once.</b></div>
            <HoldoutPaired story={holdoutStory} />
          </article>
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
              <div><span>Oscillation reduction</span><strong>{formatInt(evidenceStats.h5OscillationReduction)}</strong><small>fee pips</small></div>
            </div>
            <p>Stronger filtering reduces false positives but delays reaction. ThetaShield makes the trade-off measurable instead of hiding it.</p>
          </article>

          <article className="research-scale">
            <p className="kicker">Reproducible scope</p>
            <div><strong>{formatInt(researchScale.phase6_raw_runs)}</strong><span>Phase 6 sensitivity runs</span></div>
            <div><strong>{formatInt(researchScale.phase61_training_cases)}</strong><span>training-only remediation candidates</span></div>
            <div><strong>{researchScale.phase5_scenarios} × {researchScale.phase5_seeds}</strong><span>scenarios × repeated seeds</span></div>
            <div><strong>{formatInt(researchScale.hook_gas_per_swap)}</strong><span>measured Circle hook gas per swap</span></div>
          </article>
        </div>

        <div className="gate-board" role="list" aria-label="G1 closed-loop gates">
          {data.simulator.closedLoop.gates.map((gate) => (
            <div className={gate.status === "pass" ? "gate pass" : "gate fail"} key={gate.id} role="listitem">
              <i aria-hidden="true" /><b>{gate.label}</b><p>{gate.rule}</p><span>{gate.status.toUpperCase()}</span>
            </div>
          ))}
        </div>

        <div className="policy-table" role="region" aria-label="Baseline comparison" tabIndex={0}>
          <div className="table-heading"><span>POLICY COMPARISON</span><b>{`Dynamic-policy fee budgets calibrated within ${bundleMeta.calibrationSpreadBps} bps`}</b></div>
          <table>
            <thead><tr><th>Policy</th><th>Mean fee · bps</th><th>False positives</th><th>Detection · steps</th><th>Signed</th><th>Persistent</th><th>Behavior</th></tr></thead>
            <tbody>{policyRows.map((row) => <tr key={row.id}><td>{row.label}</td><td>{row.meanFeeBps}</td><td>{row.falsePositiveRate}</td><td>{row.detectionLatency ?? "—"}</td><td>{row.signed}</td><td>{row.persistent}</td><td>{row.behavior}</td></tr>)}</tbody>
          </table>
        </div>

        <Accordion
          badge="Σ"
          id="evidence-sensitivity"
          meta={`${sensitivityCaseCount} locked cases · ${sensitivityAll.dimensions.length} dimensions`}
          title="Full sensitivity sweep"
        >
          <SensitivityMultiples sensitivity={sensitivityAll} />
        </Accordion>
      </section>

      <section className="section trust-surface" id="trust">
        <div className="section-heading split-heading">
          <div><p className="kicker">Trust surface</p><h2>Proof, simulation, and live history stay separate.</h2></div>
          <p>{bundleMeta.boundary}</p>
        </div>
        <div className="trust-bands">
          {bands.map((band) => (
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

        <div className="gas-panel">
          <div className="card-title"><span>MEASURED GAS · ISOLATED LOCAL EVM</span><b>{`hook total ${formatInt(deployment.gas.hookTotal)} per swap`}</b></div>
          <div className="gas-rows">
            <div className="gas-row">
              <span>hook · beforeSwap + afterSwap (warm)</span>
              <div className="gas-bar" role="img" aria-label={`Hook gas: beforeSwap ${formatInt(deployment.gas.beforeSwap)} plus warm afterSwap ${formatInt(deployment.gas.afterSwapWarm)} equals ${formatInt(deployment.gas.hookTotal)} per swap.`}>
                <i className="seg-a" style={{ width: `${(deployment.gas.beforeSwap / deployment.gas.hookTotal) * 100}%` }} />
                <i className="seg-b" style={{ width: `${(deployment.gas.afterSwapWarm / deployment.gas.hookTotal) * 100}%` }} />
              </div>
              <b>{`${formatInt(deployment.gas.beforeSwap)} + ${formatInt(deployment.gas.afterSwapWarm)}`}</b>
            </div>
            <div className="gas-row">
              <span>controller · apply recommendation cold / warm</span>
              <div className="gas-bar">
                <i className="seg-a" style={{ width: `${(deployment.gas.applyCold / deployment.gas.hookTotal) * 100}%` }} />
              </div>
              <b>{`${formatInt(deployment.gas.applyCold)} / ${formatInt(deployment.gas.applyWarm)}`}</b>
            </div>
            <div className="gas-row">
              <span>controller · feeForSwap (warm read)</span>
              <div className="gas-bar">
                <i className="seg-a" style={{ width: `${Math.max(1, (deployment.gas.feeForSwapWarm / deployment.gas.hookTotal) * 100)}%` }} />
              </div>
              <b>{formatInt(deployment.gas.feeForSwapWarm)}</b>
            </div>
          </div>
          <p className="card-caption">
            Isolated local EVM call measurements under the pinned compiler profile. They exclude the
            PoolManager and router transaction and are not a live-chain cost quote.
          </p>
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
        <p>The pool remembers.</p>
        <div><span>UHI10 research prototype</span><span>Unaudited · testnet only</span></div>
      </footer>
    </main>
  );
}
