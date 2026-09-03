// One observation's lifecycle, rendered as a sequence. Shared so the execution
// log's rows and any single-record view stay one implementation: the
// "matured on arrival" and closing-window reasoning is subtle enough that a
// second copy would drift.
import { shortHex } from "../format";
import type { ObservationRecordView } from "./types";

export function clock(seconds: number): string {
  return new Date(seconds * 1_000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function span(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  return minutes ? `${minutes}m ${whole % 60}s` : `${whole % 60}s`;
}

export const OUTCOME: Record<ObservationRecordView["outcome"], { label: string; tone: string }> = {
  settled: { label: "SCORED", tone: "ok" },
  expired: { label: "EXPIRED UNSCORED", tone: "bad" },
  dropped: { label: "DROPPED", tone: "bad" },
  pending: { label: "IN FLIGHT", tone: "wait" },
};

export function attemptHeadline(attempt: ObservationRecordView): string {
  const id = `Observation ${attempt.observationId}`;
  if (attempt.outcome === "expired") return `${id} arrived, was never scored, and expired`;
  if (attempt.outcome === "settled") return `${id} was carried through to an epoch`;
  if (attempt.outcome === "dropped") return `${id} was dropped before scoring`;
  return `${id} is in flight`;
}

export function AttemptSteps({
  attempt,
  processorName,
  referenceWindowSeconds,
  txUrl,
}: {
  attempt: ObservationRecordView;
  processorName: string;
  referenceWindowSeconds: number | null;
  txUrl: (hash: string) => string;
}) {
  const outcome = OUTCOME[attempt.outcome];

  // Circle's transport can take longer than the markout horizon, in which case
  // an observation is already scoreable the moment it lands. That is not a
  // fault — but it means the scheduler's window starts closing immediately.
  const matureOnArrival = attempt.queuedAt !== null && attempt.queuedAt >= attempt.matureAt;
  const lifetime =
    attempt.queuedAt !== null && attempt.outcomeAt !== null ? attempt.outcomeAt - attempt.queuedAt : null;
  const windowCloses = attempt.matureAt + (referenceWindowSeconds ?? 0);
  const windowStillMatters =
    attempt.outcome !== "settled" || attempt.outcomeAt === null || attempt.outcomeAt > windowCloses;

  return (
      <ol className="attempt-steps">
        <li>
          <time>{attempt.queuedAt !== null ? clock(attempt.queuedAt) : "—"}</time>
          <b>Queued on {processorName}</b>
          <span>
            {matureOnArrival
              ? `already past its ${clock(attempt.matureAt)} maturity on arrival — Circle's transport outran the markout horizon, so its scoring window was open from the moment it landed`
              : `matures ${clock(attempt.matureAt)}`}
          </span>
          <a href={txUrl(attempt.queuedTx)} rel="noreferrer" target="_blank">
            <code>{shortHex(attempt.queuedTx)}</code> ↗
          </a>
        </li>
        {/* The window row is a deadline, so it only belongs in the sequence
            while it still bears on the outcome: as the thing to beat when the
            observation is in flight, or as the explanation when it was not
            beaten. Rendering it for an observation that was scored in time put
            a future timestamp between two past ones. */}
        {referenceWindowSeconds !== null && windowStillMatters ? (
          <li className={attempt.outcome === "expired" ? "missed" : ""}>
            <time>{clock(attempt.matureAt + referenceWindowSeconds)}</time>
            <b>Reference selection window closes</b>
            <span>
              {`After this no sample can fall inside the observation's scoring range, so no scheduler and no keeper can score it.`}
            </span>
          </li>
        ) : null}
        <li className={outcome.tone === "bad" ? "missed" : ""}>
          <time>{attempt.outcomeAt !== null ? clock(attempt.outcomeAt) : "—"}</time>
          <b>
            {attempt.outcome === "expired"
              ? "Expired and swept"
              : attempt.outcome === "dropped"
                ? `Dropped — ${attempt.outcomeDetail ?? "reason unavailable"}`
                : attempt.outcome === "settled"
                  ? "Scored into an epoch"
                  : "Still waiting"}
          </b>
          <span>
            {/* Selected on the outcome, not on whether the sweeping cycle was
                identified. Keyed on sweptByCycle, an observation that settled
                but whose cycle lane came back empty read "Scored into an epoch"
                and then "Expires 14:22 if nothing advances it" directly below. */}
            {attempt.sweptByCycle !== null
              ? `Cycle ${attempt.sweptByCycle}, advanced by ${attempt.sweptByReactive ? "an authenticated Reactive callback" : "a permissionless keeper — not by the scheduler"}.`
              : attempt.outcome === "pending"
                ? `Expires ${clock(attempt.expiresAt)} if nothing advances it.`
                : "The cycle that swept it was not identified on this read."}
            {lifetime !== null ? ` ${span(lifetime)} after it was queued.` : ""}
          </span>
          {attempt.outcomeTx ? (
            <a href={txUrl(attempt.outcomeTx)} rel="noreferrer" target="_blank">
              <code>{shortHex(attempt.outcomeTx)}</code> ↗
            </a>
          ) : null}
        </li>
    </ol>
  );
}
