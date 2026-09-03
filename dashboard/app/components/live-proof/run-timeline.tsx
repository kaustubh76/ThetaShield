import type { DeploymentView } from "../../deployment-data";
import type { JourneyPhaseId } from "../../journey-phases";
import { shortHex } from "../format";
import type { RunTimelineView } from "./types";

// Durations are the whole point of this widget, so they are spelled out rather
// than rounded to a unit: "23m 54s", not "~24m".
function duration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (!minutes) return `${rest}s`;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function clockTime(seconds: number): string {
  return new Date(seconds * 1_000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function RunTimeline({
  timeline,
  deployment,
  onOpenPhase,
}: {
  timeline: RunTimelineView | null;
  deployment: DeploymentView;
  onOpenPhase: (id: JourneyPhaseId) => void;
}) {
  const receipts = deployment.receipts;

  // Before the read lands — and if it never does — the trail still renders as
  // the six receipts it has always been. The timing is an enrichment on top of
  // the transactions, not a precondition for showing them.
  const steps = receipts.map((receipt, index) => ({
    receipt,
    step: timeline?.steps.find((entry) => entry.index === index) ?? null,
  }));

  // The comparison this widget exists to make. Both terms come from the read,
  // so neither is a claim the page is asserting on its own.
  // The slowest link is found, not assumed. Naming Circle here because it
  // happened to be slowest on this run would silently become a false statement
  // the first time a retry or a congested epoch made some other step the worst
  // one — so the step that actually owns the interval is named from the data.
  const gaps = (timeline?.steps ?? []).filter((step) => step.gapSeconds !== null);
  const slowest = gaps.reduce<(typeof gaps)[number] | null>(
    (worst, step) => (worst === null || (step.gapSeconds as number) > (worst.gapSeconds as number) ? step : worst),
    null,
  );
  const slowestTitle = slowest ? receipts[slowest.index]?.title.toLowerCase() : null;
  // Step 2 is the authenticated callback: the scheduler's own wake latency, and
  // the only interval on this trail that Reactive is responsible for.
  const wakeGap = timeline?.steps.find((step) => step.index === 2)?.gapSeconds ?? null;
  const ranOn = timeline?.steps[0]?.observedAt ?? null;

  return (
    <>
      <div className="receipt-heading">
        <span>THE PROVEN RUN · LIVE RECEIPT TRAIL</span>
        <b>
          {timeline?.endToEndSeconds !== null && timeline?.endToEndSeconds !== undefined
            ? `${duration(timeline.endToEndSeconds)} end to end${
                timeline.complete ? "" : " (partial — some steps did not come back dated)"
              } · ${deployment.receipts.length} public transactions · walk the trail, or open any receipt`
            : `${deployment.receipts.length} public transactions · walk the trail, or open any receipt`}
        </b>
      </div>

      {slowest !== null && wakeGap !== null ? (
        <p className="run-verdict">
          {`Read back from the transactions themselves${ranOn ? ` — the run of ${new Date(ranOn * 1_000).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}` : ""}. `}
          <b>
            {/* Named as the longest INTERVAL READ, not the longest wait, unless
                every step came back dated. A pruned transaction removes its own
                interval from the set, and stating the remaining maximum flatly
                would contradict the "(partial)" note this same header renders. */}
            {`The longest ${timeline?.complete ? "wait" : "interval that came back dated"} was ${duration(slowest.gapSeconds as number)}${slowestTitle ? `, arriving at “${slowestTitle}”` : ""}; the scheduler's own wake accounted for ${duration(wakeGap)} of the whole run.`}
          </b>
          {` Cross-chain finality dominates the wall clock here, and neither plane computes the fee —
          the transport carries authenticated evidence, the scheduler decides when eligible work runs.`}
        </p>
      ) : null}

      {/* A vertical sequence, because the gaps between the steps are the
          content. The connector carries the measured interval; a three-column
          grid could not say how long anything took. */}
      <ol className="run-timeline">
        {steps.map(({ receipt, step }, index) => (
          <li className="run-step" key={receipt.hash}>
            {index > 0 ? (
              <div className={step?.gapSeconds === null || step?.gapSeconds === undefined ? "run-gap unknown" : "run-gap"}>
                <i aria-hidden="true" />
                <span>
                  {step?.gapSeconds !== null && step?.gapSeconds !== undefined
                    ? `+${duration(step.gapSeconds)}`
                    : "interval not read"}
                </span>
              </div>
            ) : null}
            <div className="run-body">
              {/* The clock is the left axis. Pinned there rather than trailing
                  the row, so the eye reads time down the edge and the interval
                  labels line up with the moments they separate. */}
              <time>{step?.observedAt ? clockTime(step.observedAt) : "—"}</time>
              <button className="receipt-jump" onClick={() => onOpenPhase(receipt.phase)} type="button">
                <span className="receipt-index">{receipt.index}</span>
                <span className="receipt-copy">
                  <b>{receipt.title}</b>
                  <small>{`${receipt.chainName}${step?.blockNumber ? ` · block ${step.blockNumber.toLocaleString("en")}` : ""}`}</small>
                  {step?.detail ? <u>{step.detail}</u> : null}
                  <em>{"show this step in the loop →"}</em>
                </span>
              </button>
              <a className="receipt-open" href={receipt.url} rel="noreferrer" target="_blank">
                <code>{shortHex(receipt.hash)}</code>
                <span aria-hidden="true">↗</span>
              </a>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
