import type { DashboardView } from "../research-data";

type LpOutcome = DashboardView["lpOutcome"];

// The page's headline result, in two halves because either alone misleads.
// Against a fixed fee the paired interval is above zero, which is exactly what
// H1 tests. Against volatility-only the LP-net gap is NOT in ThetaShield's
// favour — what is in its favour is charging less and false-alarming far less on
// benign flow. Saying only the first would overclaim; saying only the second
// would bury the tested result.
export default function LpOutcome({
  outcome,
  onExplore,
  highlighted,
}: {
  outcome: LpOutcome;
  onExplore: () => void;
  highlighted: boolean;
}) {
  return (
    <section
      aria-labelledby="lp-outcome-heading"
      className={highlighted ? "lp-outcome is-result" : "lp-outcome"}
      id="lp-outcome"
    >
      <div className="lp-outcome-head">
        <p className="kicker">What the LP keeps</p>
        <h2 id="lp-outcome-heading">Two comparisons, both measured.</h2>
      </div>

      <div className="lp-outcome-grid">
        <article className="lp-figure primary">
          <span className="lp-figure-label">vs a fixed fee, on identical streams</span>
          <strong>{outcome.paired.mean}</strong>
          <small>quote kept per matched stream</small>
          <p>
            {`95% interval [${outcome.paired.low}, ${outcome.paired.high}] across ${outcome.paired.pairs} matched pairs — above zero, which is the whole of H1's pass rule. H1 ${outcome.paired.status}.`}
          </p>
        </article>

        <article className="lp-figure">
          <span className="lp-figure-label">vs volatility-only, on the same flow</span>
          <strong>{`${outcome.fairness.falsePositiveGap} pp`}</strong>
          <small>fewer benign false alarms</small>
          <p>
            {`${outcome.fairness.falsePositivePercent}% of ordinary flow mispriced against ${outcome.fairness.rivalFalsePositivePercent}% — while charging ${outcome.fairness.feeBps} bps mean fee against ${outcome.fairness.rivalFeeBps} bps. Signal-blind protection costs the traders who did nothing. Measured on a deterministic synthetic stream, not on an operator-moved live market.`}
          </p>
        </article>
      </div>

      <div className="lp-outcome-foot">
        <p className="lp-reconcile">
          {`The paired figure is ${outcome.paired.pairs} matched pairs; the pooled table across all ${outcome.pooledRuns} runs shows a smaller ${outcome.pooledGap} gap over the same baseline. Different populations, both in the record. Absolute LP net is negative for every policy on these synthetic streams — this is a relative comparison, not a profitability claim.`}
        </p>
        <button className="lp-explore" onClick={onExplore} type="button">
          Open the replay behind these numbers <span aria-hidden="true">↓</span>
        </button>
      </div>
      <p className="lp-boundary">{outcome.boundary}</p>
    </section>
  );
}
