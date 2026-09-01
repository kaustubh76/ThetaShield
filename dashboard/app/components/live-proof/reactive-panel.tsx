import { useEffect, useState } from "react";
import type { DeploymentView } from "../../deployment-data";
import CallbackAuthentication from "./callback-authentication";
import type { AuthenticationView, AutomationView, PendingMaturityView, ReactiveView } from "./types";

// The five phases the RSC moves through, in the order the loop walks them.
// Retry is off the main path: it is where a failed cycle waits out its backoff.
const PHASES = [
  { id: 0, label: "Idle", detail: "no observation pending" },
  { id: 1, label: "Await maturity", detail: "waiting out the markout horizon" },
  { id: 2, label: "Await cycle", detail: "callback issued, work in flight" },
  { id: 3, label: "Await finalization", detail: "epoch close scheduled" },
] as const;
const RETRY_PHASE = { id: 4, label: "Retry", detail: "bounded backoff after a failed cycle" };

// Chain seconds, rendered in the reader's zone. Used only for values that came
// from a chain read, never for a locally inferred moment.
function chainTime(seconds: number): string {
  return new Date(seconds * 1_000).toLocaleTimeString();
}

// Coarse elapsed time for a span measured in days, where seconds would be noise.
// Rounded, not floored: the run timeline states the run's date a few lines away,
// and flooring 2d22h to "2 days" contradicts the date a reader can subtract.
function elapsed(seconds: number): string {
  if (seconds >= 86_400) {
    const days = Math.round(seconds / 86_400);
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (seconds >= 3_600) {
    const hours = Math.round(seconds / 3_600);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${Math.max(1, Math.round(seconds / 60))} minutes`;
}

function countdown(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${String(minutes).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

export default function ReactivePanel({
  reactive,
  automation,
  authentication,
  pendingMaturity,
  pendingCount,
  lastRunAt,
  deployment,
  generatedAt,
}: {
  reactive: ReactiveView;
  automation: AutomationView | null;
  authentication: AuthenticationView | null;
  pendingMaturity: PendingMaturityView | null;
  pendingCount: number;
  /** Unix seconds of the last completed run's final step, or null. */
  lastRunAt: number | null;
  deployment: DeploymentView;
  generatedAt: string;
}) {
  const rvm = reactive.source === "rvm";
  const phaseName = (id: number) =>
    (id === RETRY_PHASE.id ? RETRY_PHASE : PHASES.find((entry) => entry.id === id))?.label ?? `phase ${id}`;

  // A local ticker so an armed wake visibly counts down between polls. It never
  // decides the phase — only a read does. The same discipline as the TTL ring.
  const [now, setNow] = useState(() => Math.floor(new Date(generatedAt).getTime() / 1_000));
  const [readAt, setReadAt] = useState(generatedAt);
  if (readAt !== generatedAt) {
    setReadAt(generatedAt);
    setNow(Math.floor(new Date(generatedAt).getTime() / 1_000));
  }
  useEffect(() => {
    const interval = window.setInterval(() => setNow((current) => current + 1), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const armed = rvm && reactive.dueAt > 0;
  const remaining = armed ? reactive.dueAt - now : 0;
  const executorCycle = automation?.lastCycle.cycleId ?? null;
  const cyclesAgree = executorCycle !== null && executorCycle === reactive.lastCycleId;
  const config = reactive.networkConfig;
  const processorName =
    deployment.networks.find((network) => network.role === "processor")?.name ?? "the processor chain";

  // The two planes must at least agree on whether work is outstanding: the
  // processor holds the queue on one chain, the scheduler arms a wake on the
  // other. With an empty queue that agreement is real but weak, and the panel
  // says so rather than presenting zero equals zero as evidence.
  // Coarse: do both sides agree that work is outstanding at all. Fine: do they
  // name the same second for it. The fine check overrides — two planes can
  // agree that something is due and still disagree about when, and reporting
  // that as "in step" would be the one false positive this whole block exists
  // to avoid.
  const queueAgrees = (pendingCount > 0) === armed;
  const maturityAgrees =
    pendingMaturity !== null && pendingMaturity.earliestMatureAt !== null
      ? reactive.dueAt === pendingMaturity.earliestMatureAt
      : null;
  const planeVerdict: "idle" | "agree" | "coarse-only" | "settling" | "conflict" =
    pendingCount === 0 && !armed
      ? "idle"
      : maturityAgrees === false
        ? "conflict"
        : !queueAgrees
          ? "settling"
          : maturityAgrees === true
            ? "agree"
            : "coarse-only";

  return (
    <section aria-labelledby="reactive-heading" className="reactive-panel">
      <div className="reactive-head">
        <div>
          <p className="kicker">Autonomous scheduling · REACTIVE NETWORK</p>
          <h3 id="reactive-heading">
            {rvm ? `The scheduler is ${phaseName(reactive.phase).toLowerCase()}` : "Scheduler state unavailable"}
          </h3>
        </div>
        <span className={rvm ? "reactive-source" : "reactive-source degraded"}>
          {rvm
            ? `read from the deployer’s ReactiveVM · ${deployment.automation.cronName}`
            : "RVM read unavailable — the chain-side copy react() never writes"}
        </span>
      </div>

      {rvm && reactive.phase === 0 ? (
        <p className="reactive-rest">
          {`Idle is the resting state, not a fault: the scheduler is subscribed and wakes on swap
          traffic, and this pool has had none since it last completed a full run`}
          {lastRunAt !== null ? ` ${elapsed(now - lastRunAt)} ago` : ""}
          {`. The run below is dated from its own transactions.`}
        </p>
      ) : null}

      {/* The state machine. This is what makes Reactive legible: it is a
          scheduler with a position, not a black box that occasionally fires. */}
      <ol className="reactive-machine">
        {PHASES.map((entry) => (
          <li
            className={
              rvm && entry.id === reactive.phase ? "reactive-state current" : "reactive-state"
            }
            key={entry.id}
          >
            <b>{entry.label}</b>
            <span>{entry.detail}</span>
            {rvm && entry.id === reactive.phase ? <em>now</em> : null}
          </li>
        ))}
        <li
          className={
            rvm && reactive.phase === RETRY_PHASE.id ? "reactive-state retry current" : "reactive-state retry"
          }
        >
          <b>{RETRY_PHASE.label}</b>
          <span>{RETRY_PHASE.detail}</span>
          {rvm ? (
            <em>{config ? `${reactive.consecutiveRetries} of ${config.maximumRetries} used` : `${reactive.consecutiveRetries} used`}</em>
          ) : null}
        </li>
      </ol>

      <div className="reactive-facts">
        <div>
          <dt>Next wake</dt>
          <dd className={armed ? "armed" : ""}>
            {!rvm ? "—" : armed ? (remaining > 0 ? countdown(remaining) : "due now") : "not armed"}
          </dd>
        </div>
        <div>
          <dt>Last wake issued from</dt>
          <dd>{rvm ? phaseName(reactive.triggerPhase) : "—"}</dd>
        </div>
        <div>
          <dt>Wakes requested</dt>
          <dd>{rvm ? reactive.wakeRequestCount : "—"}</dd>
        </div>
        <div>
          <dt>Observation signals</dt>
          <dd>{rvm ? reactive.observationSignalCount : "—"}</dd>
        </div>
        <div>
          <dt>Queued behind cycle</dt>
          <dd>{rvm ? (reactive.queuedMaturityAt > 0 ? "one waiting" : "none") : "—"}</dd>
        </div>
        <div>
          <dt>Cycle observed</dt>
          <dd className={cyclesAgree ? "agrees" : ""}>
            {rvm
              ? executorCycle === null
                ? String(reactive.lastCycleId)
                : `${reactive.lastCycleId} · executor ${cyclesAgree ? "agrees" : `reports ${executorCycle}`}`
              : "—"}
          </dd>
        </div>
      </div>

      {/* The cross-plane check. Cheap and always available: the processor holds
          the queue on one chain, the scheduler arms the wake on the other.
          While the queue is empty the two sides match trivially, and this says
          so rather than dressing zero equals zero as evidence. The planes are
          eventually consistent by construction — a queued observation reaches
          the scheduler as a log — so being out of step is a state, not a fault. */}
      {rvm ? (
        <div className={`plane-agreement ${planeVerdict}`}>
          <b>
            {planeVerdict === "idle"
              ? "Both planes idle"
              : planeVerdict === "conflict"
                ? "The two planes name different moments"
                : planeVerdict === "settling"
                  ? "The two planes are not yet in step"
                  : planeVerdict === "agree"
                    ? "The two planes are in step"
                    : "The two planes agree that work is outstanding"}
          </b>
          <span>
            {`${processorName} holds `}
            <b>{pendingCount === 0 ? "nothing pending" : `${pendingCount} pending`}</b>
            {` · ${deployment.automation.networkName} has `}
            <b>{armed ? "a wake armed" : "no wake armed"}</b>
          </span>
          {pendingMaturity && pendingMaturity.earliestMatureAt !== null ? (
            <em>
              {maturityAgrees
                ? `Both name the same second for the next work — ${pendingMaturity.activeSlots} of ${pendingMaturity.scannedSlots} slots occupied, and the scheduler on the other chain arrived at it independently.`
                : `The scheduler is due at ${chainTime(reactive.dueAt)}; the earliest of ${pendingMaturity.activeSlots} occupied slots matures at ${chainTime(pendingMaturity.earliestMatureAt)}. A wake that early fires before its evidence is scoreable.`}
            </em>
          ) : (
            <em>
              {pendingCount === 0
                ? "With an empty queue that agreement is trivially true and proves nothing. The check that counts — the scheduler’s due time against the earliest maturity across the processor’s 32 pending slots — arms itself the moment an observation queues."
                : "The maturity scan did not complete on this read, so only the coarse agreement above was checked."}
            </em>
          )}
        </div>
      ) : null}

      <CallbackAuthentication
        authentication={authentication}
        deployment={deployment}
        networkConfig={config}
      />

      {config ? (
        <p className="card-caption">
          {`Cadence read from the scheduler itself, not from configuration this page carries: one epoch
          every ${config.epochDurationSeconds}s, a failed cycle retried after ${config.retryDelaySeconds}s up to
          ${config.maximumRetries} times, each callback funded to ${config.callbackGasLimit.toLocaleString("en")} gas. The RSC can
          only request bounded wake-ups — it cannot forge evidence, compute a fee, or block a swap.
          Circle decides which evidence is authentic; Reactive decides when eligible work runs.`}
        </p>
      ) : (
        <p className="card-caption">
          {`The RSC can only request bounded wake-ups — it cannot forge evidence, compute a fee, or block
          a swap. Circle decides which evidence is authentic; Reactive decides when eligible work runs.`}
        </p>
      )}
    </section>
  );
}
