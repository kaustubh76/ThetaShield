import type { DeploymentView } from "../../deployment-data";
import { shortHex } from "../format";
import type { LatestAttemptView } from "./types";

function clock(seconds: number): string {
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

const OUTCOME: Record<LatestAttemptView["outcome"], { label: string; tone: string }> = {
  settled: { label: "SCORED", tone: "ok" },
  expired: { label: "EXPIRED UNSCORED", tone: "bad" },
  dropped: { label: "DROPPED", tone: "bad" },
  pending: { label: "IN FLIGHT", tone: "wait" },
};

export default function LatestAttempt({
  attempt,
  deployment,
  referenceWindowSeconds,
}: {
  attempt: LatestAttemptView | null;
  deployment: DeploymentView;
  referenceWindowSeconds: number | null;
}) {
  if (!attempt) return null;
  const processor = deployment.networks.find((network) => network.role === "processor");
  const txUrl = (hash: string) => `${processor?.explorerBase}/tx/${hash}`;
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
    <section aria-labelledby="attempt-heading" className={`latest-attempt ${outcome.tone}`}>
      <div className="attempt-head">
        <p className="kicker">Most recent attempt · read from the queue’s own lifecycle</p>
        <span className={`attempt-verdict ${outcome.tone}`}>{outcome.label}</span>
      </div>
      <h3 id="attempt-heading">
        {attempt.outcome === "expired"
          ? `Observation ${attempt.observationId} arrived, was never scored, and expired`
          : attempt.outcome === "settled"
            ? `Observation ${attempt.observationId} was carried through to an epoch`
            : attempt.outcome === "dropped"
              ? `Observation ${attempt.observationId} was dropped before scoring`
              : `Observation ${attempt.observationId} is in flight`}
      </h3>

      <ol className="attempt-steps">
        <li>
          <time>{attempt.queuedAt !== null ? clock(attempt.queuedAt) : "—"}</time>
          <b>Queued on {processor?.name}</b>
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
            {attempt.sweptByCycle !== null
              ? `Cycle ${attempt.sweptByCycle}, advanced by ${attempt.sweptByReactive ? "an authenticated Reactive callback" : "a permissionless keeper — not by the scheduler"}.`
              : `Expires ${clock(attempt.expiresAt)} if nothing advances it.`}
            {lifetime !== null ? ` ${span(lifetime)} after it was queued.` : ""}
          </span>
          {attempt.outcomeTx ? (
            <a href={txUrl(attempt.outcomeTx)} rel="noreferrer" target="_blank">
              <code>{shortHex(attempt.outcomeTx)}</code> ↗
            </a>
          ) : null}
        </li>
      </ol>
    </section>
  );
}
