import type { DashboardView } from "../../research-data";

type HoldoutStory = DashboardView["holdoutStory"];

const WIDTH = 320;
const HEIGHT = 48;
const TRACK_LEFT = 10;
const TRACK_RIGHT = 310;
const TRACK_Y = 22;

function Dumbbell({ row }: { row: HoldoutStory[number] }) {
  const [domainMin, domainMax] = row.domain;
  const x = (value: number) =>
    TRACK_LEFT + ((value - domainMin) / (domainMax - domainMin)) * (TRACK_RIGHT - TRACK_LEFT);
  const historicalX = x(row.historicalValue);
  const holdoutX = x(row.holdoutValue);
  const targetX = x(row.targetValue);

  return (
    <svg
      className="holdout-dumbbell"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`${row.title}: ${row.metricLabel} moved from ${row.historicalValue}${row.unit} (historical, ${row.historicalStatus}) to ${row.holdoutValue}${row.unit} on reserved holdout (${row.holdoutStatus}); ${row.target}.`}
    >
      <line className="hd-track" x1={TRACK_LEFT} x2={TRACK_RIGHT} y1={TRACK_Y} y2={TRACK_Y} />
      <line className="hd-target" x1={targetX} x2={targetX} y1={TRACK_Y - 12} y2={TRACK_Y + 12} />
      <text className="hd-target-label" x={targetX} y={TRACK_Y - 15}>{row.target}</text>
      <line className="hd-link" x1={historicalX} x2={holdoutX} y1={TRACK_Y} y2={TRACK_Y} />
      <circle className="hd-historical" cx={historicalX} cy={TRACK_Y} r={5}>
        <title>{`historical: ${row.historicalValue}${row.unit} · ${row.historicalStatus}`}</title>
      </circle>
      <circle className="hd-holdout" cx={holdoutX} cy={TRACK_Y} r={6}>
        <title>{`reserved holdout: ${row.holdoutValue}${row.unit} · ${row.holdoutStatus}`}</title>
      </circle>
      <text className="hd-value hd-value-historical" x={historicalX} y={TRACK_Y + 21}>
        {`${row.historicalValue}${row.unit}`}
      </text>
      <text className="hd-value hd-value-holdout" x={holdoutX} y={TRACK_Y + 21}>
        {`${row.holdoutValue}${row.unit}`}
      </text>
    </svg>
  );
}

export default function HoldoutPaired({ story }: { story: HoldoutStory }) {
  return (
    <div className="holdout-paired">
      {story.map((row) => (
        <article className="holdout-row" key={row.id}>
          <div className="holdout-row-head">
            <span>{row.id} · {row.title}</span>
            <span className="holdout-chips">
              <b className={row.historicalStatus === "PASS" ? "chip-pass" : "chip-fail"}>{row.historicalStatus} · historical</b>
              <i aria-hidden="true">→</i>
              <b className={row.holdoutStatus === "PASS" ? "chip-pass" : "chip-fail"}>{row.holdoutStatus} · holdout</b>
            </span>
          </div>
          <Dumbbell row={row} />
          <p>{row.metricLabel} · versioned remediation locked on training streams, then scored once on reserved holdout seeds.</p>
        </article>
      ))}
    </div>
  );
}
