"use client";

import { useCallback, useRef, useState } from "react";
import Accordion from "./components/accordion";
import HoldoutPaired from "./components/charts/holdout-paired";
import MarkoutTrace from "./components/charts/markout-trace";
import PolicyScatter from "./components/charts/policy-scatter";
import SensitivityMultiples from "./components/charts/sensitivity-multiples";
import DistinctionStrip from "./components/distinction-strip";
import LiveProofPanel from "./components/live-proof/live-proof-panel";
import { useLiveProof } from "./components/live-proof/use-live-proof";
import LpOutcome from "./components/lp-outcome";
import RegistrySection from "./components/registry/registry-section";
import { useReducedMotion } from "./components/use-reduced-motion";
import type { DeploymentView } from "./deployment-data";
import G9Experience, { type RunPhase } from "./g9-experience";
import LaunchIntro from "./launch-intro";
import type { DashboardView } from "./research-data";

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
    heroTrace,
    holdoutStory,
    hypotheses,
    lpOutcome,
    policyRows,
    researchConfigRows,
    sensitivityAll,
  } = data;
  const live = useLiveProof();
  // "stale" is not a flavour of ready: the header must not keep asserting a live
  // recommendation once refreshes have stopped landing.
  const liveStatus = live.stale
    ? "stale"
    : live.proof
      ? "ready"
      : live.error
        ? "error"
        : "loading";
  const sensitivityCaseCount = sensitivityAll.dimensions.reduce(
    (total, dimension) => total + dimension.cases.length,
    0,
  );

  // The guided run. It owns only the phase; the sections it drives own their own
  // playback state and report back when they reach the end. `runSeq` lets a
  // re-run restart a phase it is already in.
  const reducedMotion = useReducedMotion();
  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const [runSeq, setRunSeq] = useState(0);
  const [policyId, setPolicyId] = useState("thetashield");
  const runningRef = useRef(false);

  const reveal = useCallback(
    (id: string) => {
      document.getElementById(id)?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
    },
    [reducedMotion],
  );

  const startRun = useCallback(() => {
    runningRef.current = true;
    setRunSeq((current) => current + 1);
    setRunPhase("journey");
    reveal("mechanism");
  }, [reveal]);

  const stopRun = useCallback(() => {
    runningRef.current = false;
    setRunPhase("idle");
  }, []);

  // Each driven section calls this when it reaches its own end.
  const advanceRun = useCallback(
    (finished: RunPhase) => {
      if (!runningRef.current) return;
      if (finished === "journey") {
        setRunPhase("replay");
        reveal("simulator");
        return;
      }
      if (finished === "replay") {
        setRunPhase("outcome");
        reveal("lp-outcome");
        runningRef.current = false;
      }
    },
    [reveal],
  );

  const running = runPhase !== "idle" && runPhase !== "outcome";
  const runStep = runPhase === "journey" ? 1 : runPhase === "replay" ? 2 : runPhase === "outcome" ? 3 : 0;

  const selectPolicy = useCallback(
    (id: string) => {
      setPolicyId(id);
      reveal("simulator");
    },
    [reveal],
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
          <a href="#lp-outcome">Outcome</a>
          <a href="#mechanism">Mechanism</a>
          <a href="#simulator">Replay</a>
          <a href="#live-proof">Live proof</a>
          <a href="#registry">Registry</a>
          <a href="#evidence">Evidence</a>
        </nav>
        <span className={`release-state ${liveStatus}`}>
          <i />
          {liveStatus === "ready"
            ? live.proof?.recommendationExpired
              ? "Testnet · baseline held"
              : "Testnet · recommendation live"
            : liveStatus === "stale"
              ? "Testnet · last known state"
              : liveStatus === "error"
                ? "Testnet · chain read unavailable"
                : "Testnet · reading chain"}
        </span>
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
            <button
              className={running ? "run-action is-running" : "run-action"}
              onClick={running ? stopRun : startRun}
              type="button"
            >
              {running ? "Stop the run" : "Run the protection loop"}
              <span aria-hidden="true">{running ? "■" : "▶"}</span>
            </button>
            <a className="secondary-action" href="#live-proof">Read the live contracts</a>
          </div>
          {runStep > 0 ? (
            <p aria-live="polite" className="run-progress">
              <i className={runStep >= 1 ? "on" : ""} />
              <i className={runStep >= 2 ? "on" : ""} />
              <i className={runStep >= 3 ? "on" : ""} />
              {runPhase === "journey"
                ? "1 of 3 · the loop carries the evidence across both chains"
                : runPhase === "replay"
                  ? "2 of 3 · the fee responds only where the signal persists"
                  : "3 of 3 · what the LP kept"}
              {reducedMotion ? " · reduced motion: steps advance without animation" : ""}
            </p>
          ) : null}
          <p className="trust-line">Risk proxy—not exact LVR, individual LP loss, or a profitability claim.</p>
        </div>

        <div className="signal-stage" aria-label="Signed markout research replay">
          <div className="stage-label"><span>POST-TRADE SIGNAL</span><b>{controllerConfig.evidenceDelaySeconds}s evidence delay</b></div>
          <MarkoutTrace trace={heroTrace} />
          <div className="direction-readout">
            <div><span>BUY-BASE FEE</span><strong>{heroTrace.finalBuyBps}</strong><small>bps · protected</small></div>
            <div><span>SELL-BASE FEE</span><strong>{heroTrace.finalSellBps}</strong><small>bps · baseline</small></div>
          </div>
          <div className="stage-foot">
            <span>{`${heroTrace.label} stream · ${heroTrace.eventCount} events · seed ${heroTrace.seed}`}</span>
            <span>end of replay</span>
          </div>
          <p className="stage-simnote">Research replay from the locked evidence bundle — not live chain state.</p>
        </div>
      </section>

      <LpOutcome
        highlighted={runPhase === "outcome"}
        onExplore={() => reveal("simulator")}
        outcome={lpOutcome}
      />

      <DistinctionStrip onSelect={selectPolicy} policies={policyRows} selectedId={policyId} />

      <G9Experience
        data={data}
        deployedConfig={live.proof?.processor.deployedConfig ?? null}
        deployment={deployment}
        finalizedThreshold={live.proof?.origin.finalizedThreshold ?? null}
        onPolicyChange={setPolicyId}
        onRunPhaseComplete={advanceRun}
        policyId={policyId}
        runPhase={runPhase}
        runSeq={runSeq}
      />

      <section className="section live-proof" id="live-proof">
        <div className="section-heading split-heading">
          <div><p className="kicker">Live testnet proof</p><h2>Don’t trust the demo. Read the contracts.</h2></div>
          <p>Read directly from deployed contracts across Unichain Sepolia and Ethereum Sepolia, on every refresh.</p>
        </div>
        <LiveProofPanel deployment={deployment} live={live} />
      </section>

      <RegistrySection
        deployedConfig={live.proof?.processor.deployedConfig ?? null}
        deployment={deployment}
        finalizedThreshold={live.proof?.origin.finalizedThreshold ?? null}
        liveStatus={liveStatus}
        readPath={live.proof?.readPath ?? null}
        researchConfig={researchConfigRows}
      />

      <section className="section evidence" id="evidence">
        <div className="section-heading split-heading">
          <div><p className="kicker">Falsifiable evidence</p><h2>The failures stayed in the record.</h2></div>
          <p>Phase 6 failed H4 and H5. Phase 6.1 locked a versioned change on training streams, then scored it once on reserved holdout seeds.</p>
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

        {/* Six prose cards became six rows that open to the rule they were tested
            against — the pass_rule was already loaded and never rendered here. */}
        <div className="hypothesis-list">
          {hypotheses.map((hypothesis) => (
            <details className="hypothesis-row" key={hypothesis.id}>
              <summary>
                <span className="hypothesis-id">{hypothesis.id}</span>
                <b>{hypothesis.title}</b>
                <em className={hypothesis.passed ? "pass" : "mixed"}>{hypothesis.status}</em>
                <i aria-hidden="true">▸</i>
              </summary>
              <div className="hypothesis-body">
                <p className="hypothesis-rule">{`Gate: ${hypothesis.passRule}.`}</p>
                <p>{hypothesis.evidence}</p>
              </div>
            </details>
          ))}
        </div>

        <div className="gate-board" role="list" aria-label="G1 closed-loop gates">
          {data.simulator.closedLoop.gates.map((gate) => (
            <div className={gate.status === "pass" ? "gate pass" : "gate fail"} key={gate.id} role="listitem">
              <i aria-hidden="true" /><b>{gate.label}</b><p>{gate.rule}</p><span>{gate.status.toUpperCase()}</span>
            </div>
          ))}
        </div>

        <div className="policy-table" role="region" aria-label="Baseline comparison" tabIndex={0}>
          <div className="table-heading"><span>POLICY COMPARISON</span><b>select a row to replay it</b></div>
          <table>
            <thead><tr><th>Policy</th><th>Mean fee · bps</th><th>False positives</th><th>Detection · steps</th><th>Behavior</th></tr></thead>
            <tbody>
              {policyRows.map((row) => (
                <tr className={row.id === policyId ? "is-selected" : ""} key={row.id}>
                  <td>
                    <button className="policy-pick" onClick={() => selectPolicy(row.id)} type="button">
                      {row.label}
                    </button>
                  </td>
                  <td>{row.meanFeeBps}</td>
                  <td>{row.falsePositiveRate}</td>
                  <td>{row.detectionLatency ?? "—"}</td>
                  <td>{row.behavior}</td>
                </tr>
              ))}
            </tbody>
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

        {/* The provenance line the trust section used to carry: what kind of
            evidence this is, and which bundle it came from. */}
        <p className="evidence-provenance">
          <b>Trust surface:</b> {bundleMeta.boundary}
          {` Evidence bundle `}
          <code>{bundleMeta.id}</code>
          {` · ${bundleMeta.sourceCount} content-addressed sources.`}
        </p>
      </section>

      <footer>
        <div className="brand"><span className="brand-mark">θ</span><span>THETASHIELD</span></div>
        <p>The pool remembers.</p>
        <div><span>UHI10 research prototype</span><span>Unaudited · testnet only</span></div>
      </footer>
    </main>
  );
}
