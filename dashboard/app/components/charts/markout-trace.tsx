import type { DashboardView } from "../../research-data";

type HeroTrace = DashboardView["heroTrace"];

const WIDTH = 720;
const HEIGHT = 322;
const PLOT_LEFT = 40;
const PLOT_RIGHT = 712;
const SIGNAL_TOP = 12;
const SIGNAL_BOTTOM = 214;
const FEE_TOP = 240;
const FEE_BOTTOM = 310;

function ticksFor(minimum: number, maximum: number, count: number): number[] {
  const span = maximum - minimum;
  if (span <= 0) return [minimum];
  const rawStep = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].map((base) => base * magnitude).find((base) => base >= rawStep) ?? rawStep;
  const first = Math.ceil(minimum / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= maximum + 1e-9; value += step) ticks.push(round2(value));
  return ticks;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export default function MarkoutTrace({ trace }: { trace: HeroTrace }) {
  const points = trace.points;
  const plotWidth = PLOT_RIGHT - PLOT_LEFT;
  const slot = plotWidth / Math.max(1, points.length);
  const barWidth = Math.max(1.2, slot * 0.55);

  // Symmetric around zero so the dead band reads as a threshold centred on the
  // axis and adverse spikes are visibly the part escaping it.
  const extent =
    Math.max(
      ...points.map((point) => Math.max(Math.abs(point.markoutBps), Math.abs(point.bandBps))),
      0.01,
    ) * 1.08;
  const markoutMin = -extent;
  const markoutMax = extent;
  const yMarkout = (value: number) =>
    SIGNAL_BOTTOM - ((value + extent) / (2 * extent)) * (SIGNAL_BOTTOM - SIGNAL_TOP);

  const feeHigh = Math.max(...points.map((point) => Math.max(point.buyFeeBps, point.sellFeeBps)));
  const feeLow = Math.min(...points.map((point) => Math.min(point.buyFeeBps, point.sellFeeBps)));
  const feePad = Math.max(0.8, (feeHigh - feeLow) * 0.18);
  const feeMax = feeHigh + feePad;
  const feeMin = Math.max(0, feeLow - feePad);
  const yFee = (value: number) =>
    FEE_BOTTOM - ((value - feeMin) / (feeMax - feeMin)) * (FEE_BOTTOM - FEE_TOP);

  const x = (index: number) => PLOT_LEFT + slot * index + slot / 2;

  const bandPath = [
    ...points.map((point, index) => `${index === 0 ? "M" : "L"}${round2(x(index))} ${round2(yMarkout(point.bandBps))}`),
    ...[...points].reverse().map((point, reverseIndex) => {
      const index = points.length - 1 - reverseIndex;
      return `L${round2(x(index))} ${round2(yMarkout(-point.bandBps))}`;
    }),
    "Z",
  ].join(" ");

  const feePath = (select: (point: HeroTrace["points"][number]) => number) =>
    points
      .map((point, index) => `${index === 0 ? "M" : "L"}${round2(x(index))} ${round2(yFee(select(point)))}`)
      .join(" ");

  const lastPoint = points[points.length - 1];

  return (
    <svg
      className="markout-trace"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Signed markout replay for the ${trace.label} research stream: raw markout bars against the trailing dead band, with the directional fee response below.`}
    >
      <text className="mt-panel-label" x={PLOT_LEFT} y={SIGNAL_TOP - 2}>
        signed markout · bps
      </text>
      <text className="mt-legend" x={PLOT_RIGHT} y={SIGNAL_TOP - 2}>
        dashed band = k × trailing σ · only the bright tips survive the filter
      </text>
      {ticksFor(markoutMin, markoutMax, 4).map((tick) => (
        <g key={`m-${tick}`}>
          <line className="mt-grid" x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={yMarkout(tick)} y2={yMarkout(tick)} />
          <text className="mt-tick" x={PLOT_LEFT - 5} y={yMarkout(tick) + 2.5}>{tick}</text>
        </g>
      ))}
      <path className="mt-band" d={bandPath} />
      <line className="mt-zero" x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={yMarkout(0)} y2={yMarkout(0)} />
      {points.map((point, index) => {
        const zero = yMarkout(0);
        const value = yMarkout(point.markoutBps);
        const adverse = point.markoutBps > 0;
        // The stub inside the band is noise the filter removes; the remainder is
        // the signal that survives, so each bar shows both halves of e = |m| − kσ.
        const survives = Math.abs(point.markoutBps) > point.bandBps;
        const edge = survives ? yMarkout(adverse ? point.bandBps : -point.bandBps) : null;
        const label = `event ${point.step}: markout ${adverse ? "+" : "−"}${Math.abs(point.markoutBps)} bps · dead band ±${point.bandBps} bps · ${
          survives ? `${Math.abs(point.filteredBps)} bps survives filtering` : "filtered as noise"
        }`;
        return (
          <g key={point.step}>
            <rect
              className="mt-bar mt-noise"
              x={round2(x(index) - barWidth / 2)}
              y={round2(Math.min(zero, value))}
              width={round2(barWidth)}
              height={round2(Math.max(0.6, Math.abs(zero - value)))}
            >
              <title>{label}</title>
            </rect>
            {edge === null ? null : (
              <rect
                className={adverse ? "mt-bar mt-adverse" : "mt-bar mt-favorable"}
                x={round2(x(index) - barWidth / 2)}
                y={round2(Math.min(edge, value))}
                width={round2(barWidth)}
                height={round2(Math.max(0.6, Math.abs(edge - value)))}
              >
                <title>{label}</title>
              </rect>
            )}
          </g>
        );
      })}
      <line className="mt-sweep" x1={PLOT_LEFT} x2={PLOT_LEFT} y1={SIGNAL_TOP} y2={FEE_BOTTOM} aria-hidden="true" />

      <text className="mt-panel-label" x={PLOT_LEFT} y={FEE_TOP - 6}>
        directional fee · bps
      </text>
      {ticksFor(feeMin, feeMax, 2).map((tick) => (
        <g key={`f-${tick}`}>
          <line className="mt-grid" x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={yFee(tick)} y2={yFee(tick)} />
          <text className="mt-tick" x={PLOT_LEFT - 5} y={yFee(tick) + 2.5}>{tick}</text>
        </g>
      ))}
      <path className="mt-fee mt-fee-sell" d={feePath((point) => point.sellFeeBps)}>
        <title>{`sell-base fee replay · ends at ${lastPoint.sellFeeBps} bps`}</title>
      </path>
      <path className="mt-fee mt-fee-buy" d={feePath((point) => point.buyFeeBps)}>
        <title>{`buy-base fee replay · ends at ${lastPoint.buyFeeBps} bps`}</title>
      </path>
      <text className="mt-fee-label mt-fee-label-buy" x={PLOT_RIGHT} y={yFee(lastPoint.buyFeeBps) - 4}>
        buy
      </text>
      <text className="mt-fee-label mt-fee-label-sell" x={PLOT_RIGHT} y={yFee(lastPoint.sellFeeBps) + 9}>
        sell
      </text>
    </svg>
  );
}
