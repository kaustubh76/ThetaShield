import type { DashboardView } from "../../research-data";
import ChartScroll from "./chart-scroll";
import { round2 } from "../format";

type PolicyRows = DashboardView["policyRows"];

const WIDTH = 640;
const HEIGHT = 330;
const PLOT_LEFT = 48;
const PLOT_RIGHT = 624;
const PLOT_TOP = 18;
const PLOT_BOTTOM = 282;

export default function PolicyScatter({ policies }: { policies: PolicyRows }) {
  // research-data collapses a missing interval bound to the mean, so these are
  // always plottable and the domain covers every whisker.
  const feeLow = Math.min(...policies.map((policy) => policy.scatter.feeLowBps));
  const feeHigh = Math.max(...policies.map((policy) => policy.scatter.feeHighBps));
  const fprHigh = Math.max(...policies.map((policy) => policy.scatter.fprHighPercent));
  const feeMin = feeLow - 0.35;
  const feeMax = feeHigh + 0.35;
  const fprMax = fprHigh * 1.12 + 2;

  const x = (fee: number) => PLOT_LEFT + ((fee - feeMin) / (feeMax - feeMin)) * (PLOT_RIGHT - PLOT_LEFT);
  const y = (fpr: number) => PLOT_BOTTOM - (fpr / fprMax) * (PLOT_BOTTOM - PLOT_TOP);

  const thetashield = policies.find((policy) => policy.id === "thetashield");
  const volatility = policies.find((policy) => policy.id === "volatility_only");
  const delta =
    thetashield && volatility
      ? round2(volatility.scatter.fprPercent - thetashield.scatter.fprPercent)
      : null;

  const feeTicks = [];
  for (let tick = Math.ceil(feeMin); tick <= Math.floor(feeMax); tick += 1) feeTicks.push(tick);
  const fprTicks = [0, 20, 40, 60].filter((tick) => tick <= fprMax);

  return (
    <ChartScroll label={"Policy separation: mean applied fee against benign false positives"}>
    <svg
      className="policy-scatter"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Benign false-positive rate against mean applied fee for the five calibrated policies, with 95% confidence whiskers."
    >
      {fprTicks.map((tick) => (
        <g key={`fpr-${tick}`}>
          <line className="ps-grid" x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y(tick)} y2={y(tick)} />
          <text className="ps-tick" x={PLOT_LEFT - 6} y={y(tick) + 2.5}>{tick}%</text>
        </g>
      ))}
      {feeTicks.map((tick) => (
        <g key={`fee-${tick}`}>
          <line className="ps-grid" x1={x(tick)} x2={x(tick)} y1={PLOT_TOP} y2={PLOT_BOTTOM} />
          <text className="ps-tick ps-tick-x" x={x(tick)} y={PLOT_BOTTOM + 12}>{tick}</text>
        </g>
      ))}
      <text className="ps-axis" x={(PLOT_LEFT + PLOT_RIGHT) / 2} y={HEIGHT - 22}>
        mean applied fee · bps
      </text>
      <text className="ps-axis ps-axis-y" transform={`translate(12 ${(PLOT_TOP + PLOT_BOTTOM) / 2}) rotate(-90)`}>
        benign false positives · %
      </text>

      {thetashield && volatility ? (
        <g>
          <line
            className="ps-delta-line"
            x1={x(volatility.scatter.feeBps)}
            y1={y(volatility.scatter.fprPercent)}
            x2={x(thetashield.scatter.feeBps)}
            y2={y(thetashield.scatter.fprPercent)}
          />
          {/* Parked in the empty upper-left quadrant so it never collides with a point label. */}
          <text className="ps-delta-label" x={PLOT_LEFT + 12} y={PLOT_TOP + 26}>
            {`ThetaShield: −${delta} pp benign false alarms`}
          </text>
          <text className="ps-delta-label ps-delta-sub" x={PLOT_LEFT + 12} y={PLOT_TOP + 42}>
            at a lower mean fee than volatility-only
          </text>
        </g>
      ) : null}

      {policies.map((policy) => {
        const scatter = policy.scatter;
        const pointX = x(scatter.feeBps);
        const pointY = y(scatter.fprPercent);
        const emphasis =
          policy.id === "thetashield" ? "ps-point ps-hero" : policy.id === "volatility_only" ? "ps-point ps-rival" : "ps-point";
        const labelAbove = scatter.fprPercent < fprMax * 0.85;
        return (
          <g className={emphasis} key={policy.id}>
            <line className="ps-whisker" x1={x(scatter.feeLowBps)} x2={x(scatter.feeHighBps)} y1={pointY} y2={pointY} />
            <line className="ps-whisker" x1={pointX} x2={pointX} y1={y(scatter.fprLowPercent)} y2={y(scatter.fprHighPercent)} />
            <circle cx={pointX} cy={pointY} r={policy.id === "thetashield" ? 7 : 5}>
              <title>{`${policy.label}: ${scatter.fprPercent}% benign false positives at ${scatter.feeBps} bps mean fee (95% CI fee ${scatter.feeLowBps}–${scatter.feeHighBps}, FPR ${scatter.fprLowPercent}–${scatter.fprHighPercent})`}</title>
            </circle>
            <text className="ps-label" x={pointX + 10} y={labelAbove ? pointY - 8 : pointY + 16}>
              {policy.label}
            </text>
          </g>
        );
      })}
    </svg>
    </ChartScroll>
  );
}
