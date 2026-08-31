import type { DashboardView } from "../../research-data";
import ChartScroll from "./chart-scroll";

type SensitivityAll = DashboardView["sensitivityAll"];
type SensitivityCase = SensitivityAll["dimensions"][number]["cases"][number];

const PARETO_WIDTH = 640;
const PARETO_HEIGHT = 300;
const MINI_WIDTH = 150;
const MINI_HEIGHT = 96;

function bounds(cases: SensitivityCase[]) {
  const maxFpr = Math.max(1, ...cases.map((entry) => entry.fprPercent));
  const maxLatency = Math.max(1, ...cases.map((entry) => entry.latencySteps));
  return { maxFpr: maxFpr * 1.15, maxLatency: maxLatency * 1.12 };
}

function ParetoFrontier({
  cases,
  defaultCase,
}: {
  cases: SensitivityCase[];
  defaultCase: SensitivityAll["defaultCase"];
}) {
  const { maxFpr, maxLatency } = bounds(cases);
  const left = 44;
  const right = PARETO_WIDTH - 12;
  const top = 14;
  const bottom = PARETO_HEIGHT - 40;
  const x = (latency: number) => left + (latency / maxLatency) * (right - left);
  const y = (fpr: number) => bottom - (fpr / maxFpr) * (bottom - top);
  const frontier = cases
    .filter((entry) => entry.pareto)
    .sort((a, b) => a.latencySteps - b.latencySteps);
  const frontierPath = frontier
    .map((entry, index) => `${index === 0 ? "M" : "L"}${x(entry.latencySteps).toFixed(1)} ${y(entry.fprPercent).toFixed(1)}`)
    .join(" ");

  return (
    <ChartScroll label="Phase 6 sensitivity cases: false positives against detection latency">
    <svg
      className="pareto-frontier"
      viewBox={`0 0 ${PARETO_WIDTH} ${PARETO_HEIGHT}`}
      role="img"
      aria-label={`All ${cases.length} Phase 6 sensitivity cases: benign false positives against detection latency, with the ${frontier.length}-point Pareto frontier highlighted${defaultCase ? `, and the unswept default case at ${defaultCase.fprPercent}% false positives and ${defaultCase.latencySteps} steps marked` : ""}.`}
    >
      <text className="ps-axis" x={(left + right) / 2} y={PARETO_HEIGHT - 8}>detection latency · steps</text>
      <text className="ps-axis ps-axis-y" transform={`translate(12 ${(top + bottom) / 2}) rotate(-90)`}>benign false positives · %</text>
      {[0.25, 0.5, 0.75, 1].map((fraction) => (
        <line className="ps-grid" key={fraction} x1={left} x2={right} y1={y(maxFpr * fraction)} y2={y(maxFpr * fraction)} />
      ))}
      {frontier.length > 1 ? <path className="pf-frontier" d={frontierPath} /> : null}
      {defaultCase ? (
        <g className="pf-default">
          <line x1={left} x2={right} y1={y(defaultCase.fprPercent)} y2={y(defaultCase.fprPercent)} />
          <line x1={x(defaultCase.latencySteps)} x2={x(defaultCase.latencySteps)} y1={top} y2={bottom} />
          <text x={x(defaultCase.latencySteps) + 5} y={y(defaultCase.fprPercent) - 5}>
            {`unswept default · ${defaultCase.fprPercent}% · ${defaultCase.latencySteps} steps`}
          </text>
        </g>
      ) : null}
      {cases.map((entry) => (
        <circle
          className={entry.pareto ? "pf-point pareto" : "pf-point"}
          cx={x(entry.latencySteps)}
          cy={y(entry.fprPercent)}
          key={entry.id}
          r={entry.pareto ? 4.5 : 3}
        >
          <title>{`${entry.id}: ${entry.fprPercent}% FPR · ${entry.latencySteps} steps${entry.pareto ? " · Pareto-optimal" : ""}`}</title>
        </circle>
      ))}
    </svg>
    </ChartScroll>
  );
}

function MiniScatter({ dimension }: { dimension: SensitivityAll["dimensions"][number] }) {
  const { maxFpr, maxLatency } = bounds(dimension.cases);
  const x = (latency: number) => 8 + (latency / maxLatency) * (MINI_WIDTH - 16);
  const y = (fpr: number) => MINI_HEIGHT - 10 - (fpr / maxFpr) * (MINI_HEIGHT - 20);

  return (
    <figure className="mini-scatter">
      <svg
        viewBox={`0 0 ${MINI_WIDTH} ${MINI_HEIGHT}`}
        role="img"
        aria-label={`${dimension.label}: ${dimension.cases.length} one-factor cases, false positives against latency.`}
      >
        {dimension.cases.map((entry) => (
          <circle
            className={entry.pareto ? "pf-point pareto" : "pf-point"}
            cx={x(entry.latencySteps)}
            cy={y(entry.fprPercent)}
            key={entry.id}
            r={entry.pareto ? 3.5 : 2.5}
          >
            <title>{`${entry.valueLabel}: ${entry.fprPercent}% FPR · ${entry.latencySteps} steps`}</title>
          </circle>
        ))}
      </svg>
      <figcaption>{`${dimension.label} · ${dimension.cases.length}`}</figcaption>
    </figure>
  );
}

export default function SensitivityMultiples({ sensitivity }: { sensitivity: SensitivityAll }) {
  const allCases = sensitivity.dimensions.flatMap((dimension) => dimension.cases);

  return (
    <div className="sensitivity-multiples">
      <ParetoFrontier cases={allCases} defaultCase={sensitivity.defaultCase} />
      <div className="mini-grid">
        {sensitivity.dimensions.map((dimension) => (
          <MiniScatter dimension={dimension} key={dimension.id} />
        ))}
      </div>
      <p className="card-caption">
        Every point is one locked one-factor Phase 6 case replayed across all scenarios and seeds — never an
        interpolated combination. Highlighted points sit on the false-positive / latency Pareto frontier.
      </p>
    </div>
  );
}
