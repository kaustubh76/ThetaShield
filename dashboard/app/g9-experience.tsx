"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { formatInt } from "./components/format";
import type { DeploymentView } from "./deployment-data";
import type { DashboardView } from "./research-data";

type SimulatorData = DashboardView["simulator"];

// Which control-journey phase each acceptance receipt proves (by receipt order).
const receiptPhaseIndex = [0, 1, 3, 5, 6, 6] as const;

type FailureMode = "healthy" | "cctp" | "stale" | "replay" | "capacity";

const failureModes: Record<FailureMode, { label: string; code: string; result: string }> = {
  healthy: {
    label: "Healthy loop",
    code: "bounded success path",
    result: "Finalized evidence advances; the next swap can consume a fresh directional fee.",
  },
  cctp: {
    label: "CCTP outage",
    code: "ObservationTransportFailed",
    result: "The hook catches transport failure. The swap continues and the controller falls back safely.",
  },
  stale: {
    label: "Stale reference",
    code: "reference unavailable",
    result: "No risk is invented from stale data. The recommendation expires to the configured baseline.",
  },
  replay: {
    label: "Out-of-order",
    code: "RecommendationReplay",
    result: "Domain, peer, and monotonic sequence checks reject the stale recommendation.",
  },
  capacity: {
    label: "Queue full",
    code: "DropReason.Capacity",
    result: "Bounded queues remain safe. Capacity and EpochCapacity drops stay observable for operators.",
  },
};

const mechanismStages = [
  ["origin", "Swap", "Trader calls the v4 pool"],
  ["origin", "beforeSwap", "Controller selects buy or sell fee"],
  ["origin", "afterSwap", "Hook emits compact execution evidence"],
  ["circle", "Circle dispatch", "Sealed origin peer sends observation"],
  ["circle", "CCTP attestation", "Finality, domain, and sender authenticate"],
  ["processor", "Processor queue", "Bounded observation slot is reserved"],
  ["reactive", "Reactive event plane", "RSC watches queue and cron signals"],
  ["reactive", "Bounded callback", "Executor advances eligible work"],
  ["processor", "Maturity wait", "Future price evidence becomes available"],
  ["processor", "Reference sync", "Permissionless pool-derived samples land"],
  ["processor", "Signed markout", "Direction preserves favorable vs adverse flow"],
  ["processor", "Dead band", "Trailing noise is removed"],
  ["processor", "Epoch + persistence", "Notional, confidence, and n-of-k agree"],
  ["processor", "Fee curve", "Bounded directional premium is calculated"],
  ["circle", "Circle return", "Sequenced recommendation crosses back"],
  ["origin", "Controller validation", "Peer, domain, TTL, bounds, sequence"],
  ["origin", "Next fee", "Later swap consumes installed state"],
] as const;

const mechanismPhases = [
  { lane: "origin", label: "Swap path", network: "Unichain", firstStage: 0, lastStage: 2 },
  { lane: "circle", label: "Evidence outbound", network: "CIRCLE CCTP V2", firstStage: 3, lastStage: 4 },
  { lane: "processor", label: "Queue evidence", network: "Ethereum", firstStage: 5, lastStage: 5 },
  { lane: "reactive", label: "Autonomous wake", network: "REACTIVE NETWORK", firstStage: 6, lastStage: 7 },
  { lane: "processor", label: "Delayed analysis", network: "Ethereum", firstStage: 8, lastStage: 13 },
  { lane: "circle", label: "Recommendation return", network: "CIRCLE CCTP V2", firstStage: 14, lastStage: 14 },
  { lane: "origin", label: "Apply next fee", network: "Unichain", firstStage: 15, lastStage: 16 },
] as const;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// Autoplay stops when the visitor prefers reduced motion, but the transport
// controls stay live so they can still opt into the animation deliberately.
function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

function percent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

function quote(value: number, digits = 3) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

function selectInitialOption(
  dimension: SimulatorData["sensitivity"][number],
  expected: string,
) {
  return dimension.options.find((option) => option.label.startsWith(expected))?.id ?? dimension.options[0].id;
}

function ArchitectureAnimator({
  failureMode,
  onFailureMode,
  deployment,
}: {
  failureMode: FailureMode;
  onFailureMode: (mode: FailureMode) => void;
  deployment: DeploymentView;
}) {
  const [activeStage, setActiveStage] = useState(0);
  const [playing, setPlaying] = useState(true);
  const reducedMotion = useReducedMotion();
  const [motionApplied, setMotionApplied] = useState(false);
  if (reducedMotion && !motionApplied) {
    setMotionApplied(true);
    setPlaying(false);
  }

  useEffect(() => {
    if (!playing) return;
    const interval = window.setInterval(
      () => setActiveStage((current) => (current + 1) % mechanismStages.length),
      1_600,
    );
    return () => window.clearInterval(interval);
  }, [playing]);

  const active = mechanismStages[activeStage];
  const activePhaseIndex = mechanismPhases.findIndex(
    (phase) => activeStage >= phase.firstStage && activeStage <= phase.lastStage,
  );
  const activePhase = mechanismPhases[Math.max(0, activePhaseIndex)];
  const activePhaseStages = mechanismStages.slice(activePhase.firstStage, activePhase.lastStage + 1);
  const failure = failureModes[failureMode];
  const phaseReceipts = deployment.receipts.filter(
    (_, index) => receiptPhaseIndex[index] === Math.max(0, activePhaseIndex),
  );

  return (
    <section className="section mechanism-explorer" id="mechanism">
      <div className="section-heading split-heading">
        <div><p className="kicker">Animated control loop</p><h2>See the delayed fee travel.</h2></div>
        <p>Circle authenticates what crosses chains. Reactive Network drives when bounded processor work advances. The swap path never waits for either.</p>
      </div>

      <div className="mechanism-toolbar">
        <div className="failure-switches" aria-label="Architecture failure mode">
          {(Object.keys(failureModes) as FailureMode[]).map((mode) => (
            <button
              aria-pressed={failureMode === mode}
              className={failureMode === mode ? "active" : ""}
              key={mode}
              onClick={() => onFailureMode(mode)}
              type="button"
            >{failureModes[mode].label}</button>
          ))}
        </div>
        <button className="play-control" onClick={() => setPlaying((current) => !current)} type="button">
          {playing ? "Pause trace" : "Play trace"}
        </button>
      </div>

      <div
        className="control-journey"
        style={{ "--journey-progress": `${(Math.max(0, activePhaseIndex) / (mechanismPhases.length - 1)) * 100}%` } as CSSProperties}
      >
        <div className="journey-track" aria-hidden="true"><i /><b /></div>
        <div className="journey-phases" aria-label="ThetaShield control journey">
          {mechanismPhases.map((phase, phaseIndex) => (
            <button
              aria-label={`Phase ${phaseIndex + 1}: ${phase.label} on ${phase.network}`}
              className={phaseIndex === activePhaseIndex ? "active" : phaseIndex < activePhaseIndex ? "complete" : ""}
              data-lane={phase.lane}
              key={`${phase.network}-${phase.label}`}
              onClick={() => { setActiveStage(phase.firstStage); setPlaying(false); }}
              type="button"
            >
              <span>{String(phaseIndex + 1).padStart(2, "0")}</span>
              <i aria-hidden="true" />
              <b>{phase.label}</b>
              <small>{phase.network}</small>
            </button>
          ))}
        </div>
        <div className="journey-detail">
          <div>
            <span>ACTIVE STEP {String(activeStage + 1).padStart(2, "0")} / {mechanismStages.length}</span>
            <b>{active[1]}</b>
            <p>{active[2]}</p>
          </div>
          <div className="phase-sequence" aria-label={`Steps in ${activePhase.label}`}>
            <span>{activePhase.network.toUpperCase()} · {activePhase.label}</span>
            <div>
              {activePhaseStages.map(([, title], index) => {
                const absoluteIndex = activePhase.firstStage + index;
                return (
                  <button
                    aria-label={`Step ${absoluteIndex + 1}: ${title}`}
                    className={absoluteIndex === activeStage ? "active" : absoluteIndex < activeStage ? "complete" : ""}
                    key={title}
                    onClick={() => { setActiveStage(absoluteIndex); setPlaying(false); }}
                    type="button"
                  >
                    <i />{title}
                  </button>
                );
              })}
            </div>
            {phaseReceipts.length ? (
              <div className="journey-receipts">
                <span>PROVEN BY RECEIPT</span>
                {phaseReceipts.map((receipt) => (
                  <a href={receipt.url} key={receipt.hash} rel="noreferrer" target="_blank">
                    {`${receipt.index} · ${receipt.title} ↗`}
                  </a>
                ))}
              </div>
            ) : (
              <div className="journey-receipts idle">
                <span>PROVEN BY RECEIPT</span>
                <em>receipts land on the adjacent phases</em>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mechanism-status" aria-live="polite">
        <div><span>CONTROL JOURNEY</span><b>{activePhase.label}</b><p>{activePhase.network} is carrying this stage. The trace advances in execution order without moving the reader between disconnected lanes.</p></div>
        <div className={failureMode === "healthy" ? "healthy" : "failed"}><span>SELECTED PATH</span><code>{failure.code}</code><p>{failure.result}</p></div>
      </div>

      <div className="loss-monitor">
        <span>SILENT-LOSS SURFACES MADE VISIBLE</span>
        <code>hook try/catch → ObservationTransportFailed</code>
        <code>queue bound → DropReason.Capacity</code>
        <code>epoch bound → DropReason.EpochCapacity</code>
      </div>
    </section>
  );
}

function FeeTimeline({
  points,
  meanFeeBps,
  activeIndex,
}: {
  points: SimulatorData["scenarios"][number]["points"];
  meanFeeBps: number;
  activeIndex: number;
}) {
  const WIDTH = 700;
  const HEIGHT = 235;
  const LEFT = 34;
  const RIGHT = 694;
  const TOP = 10;
  const BOTTOM = 210;

  const values = points.flatMap((point) => [point.buyFeeBps, point.sellFeeBps, meanFeeBps]);
  const high = Math.max(...values);
  const low = Math.min(...values);
  const pad = Math.max(0.4, (high - low) * 0.18);
  const max = high + pad;
  const min = Math.max(0, low - pad);
  const x = (index: number) =>
    LEFT + (points.length > 1 ? (index / (points.length - 1)) * (RIGHT - LEFT) : 0);
  const y = (value: number) => BOTTOM - ((value - min) / (max - min || 1)) * (BOTTOM - TOP);
  const round1 = (value: number) => Math.round(value * 10) / 10;

  // Step lines: the controller holds a fee until a recommendation installs, so a
  // stepped path is the honest shape — straight interpolation would imply drift.
  const stepPath = (select: (point: (typeof points)[number]) => number) =>
    points
      .map((point, index) => {
        const px = round1(x(index));
        const py = round1(y(select(point)));
        return index === 0 ? `M${px} ${py}` : `H${px} V${py}`;
      })
      .join(" ");

  const cursorX = round1(x(Math.min(activeIndex, points.length - 1)));
  const active = points[Math.min(activeIndex, points.length - 1)];
  const ticks = [min, (min + max) / 2, max];

  return (
    <div className="fee-timeline">
      <svg
        className="timeline-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Directional fee replay: buy and sell fees across ${points.length} sampled steps against the selected policy's pooled mean of ${meanFeeBps.toFixed(2)} bps.`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="tl-grid" x1={LEFT} x2={RIGHT} y1={y(tick)} y2={y(tick)} />
            <text className="tl-tick" x={LEFT - 6} y={y(tick) + 2.5}>{tick.toFixed(1)}</text>
          </g>
        ))}
        <line className="tl-mean" x1={LEFT} x2={RIGHT} y1={y(meanFeeBps)} y2={y(meanFeeBps)} />
        <path className="tl-line tl-sell" d={stepPath((point) => point.sellFeeBps)} />
        <path className="tl-line tl-buy" d={stepPath((point) => point.buyFeeBps)} />
        <line className="tl-cursor" x1={cursorX} x2={cursorX} y1={TOP} y2={BOTTOM} />
        <circle className="tl-dot tl-dot-sell" cx={cursorX} cy={round1(y(active.sellFeeBps))} r={4} />
        <circle className="tl-dot tl-dot-buy" cx={cursorX} cy={round1(y(active.buyFeeBps))} r={4}>
          <title>{`step ${active.step}: buy ${active.buyFeeBps.toFixed(2)} bps · sell ${active.sellFeeBps.toFixed(2)} bps`}</title>
        </circle>
      </svg>
      <div className="timeline-legend"><span className="buy">ThetaShield buy</span><span className="sell">ThetaShield sell</span><span className="mean">Selected-policy pooled mean</span></div>
    </div>
  );
}

function FrontierPlot({
  points,
}: {
  points: { id: string; label: string; recall: number; specificity: number }[];
}) {
  const WIDTH = 420;
  const HEIGHT = 250;
  const LEFT = 40;
  const RIGHT = 406;
  const TOP = 16;
  const BOTTOM = 212;
  // Percentages can sit at the very edge of the domain, so clamp the plotted
  // centre by the marker radius — the old percentage positioning let a 100%
  // value render entirely outside the plot box.
  const x = (recall: number) => LEFT + (Math.min(100, Math.max(0, recall)) / 100) * (RIGHT - LEFT);
  const y = (specificity: number) =>
    BOTTOM - (Math.min(100, Math.max(0, specificity)) / 100) * (BOTTOM - TOP);

  return (
    <div className="frontier-plot">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={points
          .map((point) => `${point.label}: ${point.specificity.toFixed(1)}% specificity at ${point.recall.toFixed(1)}% recall`)
          .join("; ")}
      >
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line className="fp-grid" x1={LEFT} x2={RIGHT} y1={y(tick)} y2={y(tick)} />
            <line className="fp-grid" x1={x(tick)} x2={x(tick)} y1={TOP} y2={BOTTOM} />
          </g>
        ))}
        <line className="fp-axis" x1={LEFT} x2={LEFT} y1={TOP} y2={BOTTOM} />
        <line className="fp-axis" x1={LEFT} x2={RIGHT} y1={BOTTOM} y2={BOTTOM} />
        <text className="fp-label" x={LEFT} y={TOP - 5}>specificity ↑</text>
        <text className="fp-label fp-label-end" x={RIGHT} y={BOTTOM + 15}>recall →</text>
        {points.map((point, index) => {
          const cx = x(point.recall);
          const cy = y(point.specificity);
          // Anchor the caption away from whichever edge the marker is nearest.
          const flipDown = cy - TOP < 26;
          const flipLeft = cx > RIGHT - 90;
          return (
            <g className={`fp-point fp-${point.id}`} key={point.id}>
              <circle cx={cx} cy={cy} r={index === 0 ? 6 : 5} />
              <text
                className={flipLeft ? "fp-caption fp-label-end" : "fp-caption"}
                x={flipLeft ? cx - 10 : cx + 10}
                y={flipDown ? cy + 15 : cy - 9}
              >
                {point.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function LPBenefitSimulator({
  data,
  failureMode,
}: {
  data: SimulatorData;
  failureMode: FailureMode;
}) {
  const [scenarioId, setScenarioId] = useState("persistent_informed_buying");
  const [policyId, setPolicyId] = useState("thetashield");
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(true);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const reducedMotion = useReducedMotion();
  const [motionApplied, setMotionApplied] = useState(false);
  if (reducedMotion && !motionApplied) {
    setMotionApplied(true);
    setReplayPlaying(false);
  }
  const [activeDimension, setActiveDimension] = useState(data.sensitivity[0].id);
  const [sensitivitySelections, setSensitivitySelections] = useState<Record<string, string>>(() => {
    const expected: Record<string, string> = {
      dead_band_k: String(data.defaults.deadBandK),
      persistence_n_of_k: data.defaults.persistence,
      ewma_alpha: data.defaults.alpha.toFixed(2),
      maximum_fee: `${formatInt(Math.round(data.defaults.maximumFeeBps * 100))} pips`,
    };
    return Object.fromEntries(data.sensitivity.map((dimension) => [
      dimension.id,
      selectInitialOption(dimension, expected[dimension.id]),
    ]));
  });

  const scenario = data.scenarios.find((entry) => entry.id === scenarioId) ?? data.scenarios[0];
  const policy = data.policies.find((entry) => entry.id === policyId) ?? data.policies[0];
  const safeReplayIndex = Math.min(replayIndex, Math.max(0, scenario.points.length - 1));
  const replayPoint = scenario.points[safeReplayIndex] ?? scenario.points[0];
  const outcome = scenario.lpOutcomes[policy.id];
  const sensitivityDimension = data.sensitivity.find((entry) => entry.id === activeDimension) ?? data.sensitivity[0];
  const sensitivity = sensitivityDimension.options.find(
    (entry) => entry.id === sensitivitySelections[sensitivityDimension.id],
  ) ?? sensitivityDimension.options[0];
  // All five policies land within ~0.1% of each other, so a zero-based scale
  // renders five identical full-width bars. The zoom spans the observed window
  // instead, and the caption says so.
  const outcomeMeans = Object.values(scenario.lpOutcomes).map((entry) => entry.mean);
  const zoomWindow = { best: Math.max(...outcomeMeans), worst: Math.min(...outcomeMeans) };
  const zoomSpan = Math.max(1e-9, zoomWindow.best - zoomWindow.worst);
  const zoomShare = (value: number) =>
    Math.round((12 + ((value - zoomWindow.worst) / zoomSpan) * 88) * 10) / 10;
  const trueScale = Math.max(Math.abs(policy.inventoryPnlQuote), Math.abs(policy.feeRevenueQuote), 0.000001);
  const transportTotal =
    scenario.finalTransport.callbacks_applied +
    scenario.finalTransport.callbacks_missing +
    scenario.finalTransport.callbacks_rejected;
  const deliveryPercent = transportTotal
    ? (scenario.finalTransport.callbacks_applied * 100) / transportTotal
    : 100;
  const coverage = data.closedLoop.coverage[data.closedLoop.coveragePolicyId];
  const failure = failureModes[failureMode];

  const selectedScenarioOutcomes = useMemo(
    () => data.policies.map((entry) => ({ ...entry, outcome: scenario.lpOutcomes[entry.id] })),
    [data.policies, scenario],
  );

  useEffect(() => {
    if (!replayPlaying || scenario.points.length < 2) return;
    const interval = window.setInterval(
      () => setReplayIndex((current) => current >= scenario.points.length - 1 ? 0 : current + 1),
      Math.max(55, 220 / replaySpeed),
    );
    return () => window.clearInterval(interval);
  }, [replayPlaying, replaySpeed, scenario.points.length]);

  return (
    <section className="section benefit-simulator" id="simulator">
      <div className="section-heading split-heading">
        <div><p className="kicker">LP-benefit replay console</p><h2>Interrogate the trade-offs.</h2></div>
        <p>Every displayed result comes from the deterministic evidence bundle. Parameter selectors replay exact one-factor Phase 6 cases; they do not invent untested combinations.</p>
      </div>

      <div className="simulator-controls">
        <label><span>Scenario · {data.scenarios.length}</span><select value={scenarioId} onChange={(event) => { setScenarioId(event.target.value); setReplayIndex(0); setReplayPlaying(true); }}>{data.scenarios.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
        <label><span>Policy · {data.policies.length}</span><select value={policyId} onChange={(event) => setPolicyId(event.target.value)}>{data.policies.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
        {data.sensitivity.map((dimension) => (
          <label key={dimension.id}>
            <span>{dimension.label}</span>
            <select
              value={sensitivitySelections[dimension.id]}
              onChange={(event) => {
                setSensitivitySelections((current) => ({ ...current, [dimension.id]: event.target.value }));
                setActiveDimension(dimension.id);
              }}
            >{dimension.options.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select>
          </label>
        ))}
      </div>

      <div className="simulator-context">
        <div><span>STREAM</span><b>{scenario.label}</b><p>{scenario.description}</p></div>
        <div><span>ACTIVE EXACT SENSITIVITY</span><b>{sensitivityDimension.label} · {sensitivity.label}</b><p>All other Phase 6 parameters remain at that experiment’s locked default.</p></div>
      </div>

      <div className="replay-toolbar">
        <div className="replay-actions">
          <button
            className="replay-play-control"
            onClick={() => setReplayPlaying((current) => !current)}
            type="button"
          >{replayPlaying ? "Pause replay" : "Play replay"}</button>
          <button
            className="replay-reset-control"
            onClick={() => { setReplayIndex(0); setReplayPlaying(false); }}
            type="button"
          >Reset</button>
        </div>
        <label className="replay-scrubber">
          <span>Replay cursor</span>
          <input
            aria-label="Replay cursor"
            max={Math.max(0, scenario.points.length - 1)}
            min="0"
            onChange={(event) => { setReplayIndex(Number(event.target.value)); setReplayPlaying(false); }}
            type="range"
            value={safeReplayIndex}
          />
        </label>
        <div className="replay-speeds" aria-label="Replay speed">
          {[1, 2, 4].map((speed) => (
            <button
              aria-pressed={replaySpeed === speed}
              className={replaySpeed === speed ? "active" : ""}
              key={speed}
              onClick={() => setReplaySpeed(speed)}
              type="button"
            >{speed}×</button>
          ))}
        </div>
        <div className="replay-readout" aria-live="off">
          <span>EVENT {safeReplayIndex + 1} / {scenario.points.length} · T+{replayPoint.step * scenario.stepSeconds}s</span>
          <b><i className="buy" />BUY {replayPoint.buyFeeBps.toFixed(2)} BPS <i className="sell" />SELL {replayPoint.sellFeeBps.toFixed(2)} BPS</b>
        </div>
      </div>

      <div className="simulator-grid">
        <article className="sim-panel timeline-panel">
          <div className="panel-heading"><span>01 · FEE BY DIRECTION</span><b>{scenario.eventCount} events · {scenario.stepSeconds}s steps</b></div>
          <FeeTimeline activeIndex={safeReplayIndex} meanFeeBps={policy.meanFeeBps} points={scenario.points} />
          <p>Directional lines are the ThetaShield control replay; the dotted guide is the selected policy’s pooled mean.</p>
        </article>

        <article className="sim-panel flow-fee-panel">
          <div className="panel-heading"><span>02 · WHO PAYS</span><b>{policy.label}</b></div>
          <div className="comparison-bars">
            {[{ label: "Benign fee", value: policy.benignFeeQuote }, { label: "Toxic fee", value: policy.toxicFeeQuote }].map((entry) => {
              const maximum = Math.max(policy.benignFeeQuote, policy.toxicFeeQuote, 0.000001);
              return <div key={entry.label}><span>{entry.label}</span><i style={{ "--bar": `${(entry.value / maximum) * 100}%` } as CSSProperties} /><b>{entry.value.toFixed(3)} quote</b></div>;
            })}
          </div>
        </article>

        <article className="sim-panel frontier-panel">
          <div className="panel-heading"><span>03 · SPECIFICITY / RECALL</span><b>pooled + sensitivity</b></div>
          <FrontierPlot
            points={[
              { id: "policy", label: policy.label, recall: policy.recallPercent, specificity: policy.specificityPercent },
              {
                id: "sensitivity",
                label: sensitivityDimension.label,
                recall: 100 - sensitivity.falseNegativePercent,
                specificity: 100 - sensitivity.falsePositivePercent,
              },
            ]}
          />
          <p>{`${percent(policy.specificityPercent)} specificity (benign flow passed at baseline) · ${percent(policy.recallPercent)} recall · ${policy.detectionLatency ?? "—"} step detection`}</p>
        </article>

        <article className="sim-panel lp-outcome-panel">
          <div className="panel-heading"><span>04 · LP NET OUTCOME</span><b>true scale + paired zoom</b></div>
          <div className="true-scale">
            <div><span>Inventory PnL</span><i style={{ "--bar": `${Math.abs(policy.inventoryPnlQuote) / trueScale * 100}%` } as CSSProperties} /><b>{quote(policy.inventoryPnlQuote)} quote</b></div>
            <div><span>Fee revenue</span><i style={{ "--bar": `${Math.abs(policy.feeRevenueQuote) / trueScale * 100}%` } as CSSProperties} /><b>{quote(policy.feeRevenueQuote)} quote</b></div>
            <div><span>Net</span><i style={{ "--bar": `${Math.abs(policy.lpNetQuote) / trueScale * 100}%` } as CSSProperties} /><b>{quote(policy.lpNetQuote)} quote</b></div>
          </div>
          <div className="paired-zoom">
            {selectedScenarioOutcomes.map((entry) => (
              <div className={entry.id === policy.id ? "active" : ""} key={entry.id}>
                <span>{entry.label}</span>
                <i style={{ "--bar": `${zoomShare(entry.outcome.mean)}%` } as CSSProperties} />
                <b>{quote(entry.outcome.mean)}</b>
              </div>
            ))}
          </div>
          <p>{`Scenario mean ${quote(outcome.mean)} quote · 95% interval [${quote(outcome.low)}, ${quote(outcome.high)}]. Inventory PnL is shown at its real scale above; the zoom below spans only ${quote(zoomWindow.worst)} to ${quote(zoomWindow.best)}, so bar length compares policies against each other, not against zero.`}</p>
        </article>

        <article className="sim-panel transport-panel">
          <div className="panel-heading"><span>05 · TRANSPORT HEALTH</span><b>{scenario.operationalMode}</b></div>
          <div className="transport-score"><strong>{percent(deliveryPercent, 0)}</strong><span>callbacks applied</span></div>
          <dl><div><dt>Applied</dt><dd>{scenario.finalTransport.callbacks_applied}</dd></div><div><dt>Missing</dt><dd>{scenario.finalTransport.callbacks_missing}</dd></div><div><dt>Rejected</dt><dd>{scenario.finalTransport.callbacks_rejected}</dd></div><div><dt>Expired references</dt><dd>{scenario.finalTransport.expired_references}</dd></div></dl>
          <div className={failureMode === "healthy" ? "transport-path healthy" : "transport-path failed"}><code>{failure.code}</code><p>{failure.result}</p></div>
        </article>

        <article className="sim-panel retained-panel">
          <div className="panel-heading"><span>06 · G1 CLOSED LOOP</span><b>{data.closedLoop.status}</b></div>
          <div className="retained-metrics"><div><strong>{percent(coverage.benignRetainedPercent, 2)}</strong><span>benign volume retained</span></div><div><strong>{percent(coverage.toxicRetainedPercent, 2)}</strong><span>toxic volume retained</span></div><div><strong>{quote(data.closedLoop.feeRevenueDeltaQuote, 4)}</strong><span>fee-revenue delta · quote</span></div></div>
          <p>{data.closedLoop.interpretation}</p>
        </article>
      </div>

      <div className="sensitivity-audit">
        <span>EXACT CASE · {sensitivity.id}</span>
        <div><b>{percent(sensitivity.directionalAccuracyPercent)}</b><small>directional accuracy</small></div>
        <div><b>{sensitivity.detectionLatency}</b><small>detection steps</small></div>
        <div><b>{quote(sensitivity.lpImprovementQuote)}</b><small>persistent LP improvement</small></div>
        <div><b>{sensitivity.oscillationBps.toFixed(2)}</b><small>oscillation · bps</small></div>
      </div>
      <p className="sim-boundary">{data.closedLoop.boundary}</p>
    </section>
  );
}

export default function G9Experience({
  data,
  deployment,
}: {
  data: DashboardView;
  deployment: DeploymentView;
}) {
  const [failureMode, setFailureMode] = useState<FailureMode>("healthy");
  return (
    <>
      <ArchitectureAnimator deployment={deployment} failureMode={failureMode} onFailureMode={setFailureMode} />
      <LPBenefitSimulator data={data.simulator} failureMode={failureMode} />
    </>
  );
}
