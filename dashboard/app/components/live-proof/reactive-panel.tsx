import { useEffect, useState } from "react";
import type { DeploymentView } from "../../deployment-data";
import CallbackAuthentication from "./callback-authentication";
import type { SchedulerHealth } from "./scheduler-health";
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
  health,
  referenceWindowSeconds,
  lastRunAt,
  deployment,
  generatedAt,
}: {
  reactive: ReactiveView;
  automation: AutomationView | null;
  authentication: AuthenticationView | null;
  pendingMaturity: PendingMaturityView | null;
  pendingCount: number;
  /** Shared with the run console so the two cannot describe the scheduler differently. */
  health: SchedulerHealth;
  /** Deployed referenceSelectionWindowSeconds: past it, evidence is unscoreable. */
  referenceWindowSeconds: number | null;
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
  // The RSC subscribes to AutomationCycleCompleted with topic_3 == 1, so it
  // counts ONLY cycles authenticated through executeFromReactive and ignores
  // permissionless keeper cycles by construction. Rendering its counter beside
  // the executor's total as "2 · executor reports 6" therefore showed correct
  // filtering as though it were two chains disagreeing.
  const keeperCycles = executorCycle === null ? null : executorCycle - reactive.lastCycleId;
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
  // Only meaningful when BOTH planes name a moment. With no wake armed the
  // scheduler names none, and comparing against dueAt = 0 rendered the Unix
  // epoch as a wall-clock time in the disagreement copy.
  const maturityAgrees =
    armed && pendingMaturity !== null && pendingMaturity.earliestMatureAt !== null
      ? reactive.dueAt === pendingMaturity.earliestMatureAt
      : null;
  // The scheduler declares its own worst case: one epoch, plus a retry for every
  // attempt it is allowed. Work still outstanding past that bound has not been
  // slow, it has missed — so "not yet in step" would promise a resolution the
  // contract's own numbers no longer support. Observed live on 2026-09-01: an
  // observation sat 29 minutes past maturity with no wake armed.
  const schedulerBudget = config ? config.epochDurationSeconds + config.maximumRetries * config.retryDelaySeconds : null;
  const matureAt = pendingMaturity?.earliestMatureAt ?? null;
  const overdueBy = matureAt !== null ? now - matureAt : null;
  const stalled =
    !queueAgrees && schedulerBudget !== null && overdueBy !== null && overdueBy > schedulerBudget;
  // Past the reference selection window, no sample can fall inside this
  // observation's scoring range any more: the work is not merely late, it can
  // no longer be done at all — by the scheduler or by anyone else. Observed
  // live on 2026-09-01, where a keeper cycle returned processSucceeded with
  // pendingAfter unchanged and no recommendation dispatched.
  const unscoreable =
    stalled && referenceWindowSeconds !== null && overdueBy !== null && overdueBy > referenceWindowSeconds;

  const planeVerdict: "idle" | "agree" | "coarse-only" | "settling" | "stalled" | "conflict" =
    pendingCount === 0 && !armed
      ? "idle"
      : stalled
        ? "stalled"
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

      {/* Idle can mean two different things and they are not interchangeable:
          no work to do, or work that never arrived. The health verdict comes
          from what happened to the last observation, so this cannot claim the
          quiet kind while the loud kind is true. */}
      {rvm && reactive.phase === 0 ? (
        health && !health.waking ? (
          <div className="reactive-rest degraded">
            <b>Integration verified · log delivery degraded upstream</b>
            <p>
              {`Everything this side controls checks out on this read: the subscription is live on the
              processor contract and the ObservationQueued topic, the callback authentication passes
              on every term, the ReactiveVM is funded, and ${deployment.automation.networkName} is
              emitting the ${deployment.automation.cronName} this contract subscribes to. What has not
              happened is delivery of the log into the VM — the signal counter has not moved for the
              last observation, and that is reported upstream.`}
            </p>
            <p>
              {`The protocol is built for exactly this. The executor's cycle is permissionless, so the
              same bounded work any callback would do was carried by a keeper instead, and the loop
              closed end to end. Nothing here waits on a single scheduler to be healthy.`}
            </p>
          </div>
        ) : (
          <p className="reactive-rest">
            {`Idle is the resting state, not a fault: the scheduler is subscribed and wakes on swap
            traffic, and there is nothing outstanding`}
            {lastRunAt !== null ? ` since the last run ${elapsed(now - lastRunAt)} ago` : ""}
            {`. The run below is dated from its own transactions.`}
          </p>
        )
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
          <dt>Authenticated callbacks</dt>
          <dd className={rvm && reactive.lastCycleId > 0 ? "agrees" : ""}>
            {!rvm
              ? "—"
              : keeperCycles === null
                ? String(reactive.lastCycleId)
                : keeperCycles > 0
                  ? `${reactive.lastCycleId} · ${keeperCycles} keeper ${keeperCycles === 1 ? "cycle" : "cycles"} correctly ignored`
                  : `${reactive.lastCycleId} · all cycles authenticated`}
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
              : planeVerdict === "stalled"
                ? unscoreable
                  ? "The scheduler missed its window and the evidence can no longer be scored"
                  : "The scheduler has not woken for work that is already due"
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
          {/* The detail follows the verdict rather than re-deriving it, so the
              two can never disagree about what is being reported. */}
          <em className={planeVerdict === "agree" ? "agrees" : ""}>
            {planeVerdict === "idle"
              ? "With an empty queue that agreement is trivially true and proves nothing. The check that counts — the scheduler’s due time against the earliest maturity across the processor’s 32 pending slots — arms itself the moment an observation queues."
              : planeVerdict === "stalled" && overdueBy !== null && schedulerBudget !== null
                ? unscoreable && referenceWindowSeconds !== null
                  ? `The work matured ${elapsed(overdueBy)} ago; the scheduler allows itself ${schedulerBudget}s, one epoch plus every retry it is permitted. It is now past the ${Math.round(referenceWindowSeconds / 60)}-minute reference selection window, so no sample can fall inside this observation’s scoring range any more — it cannot be scored by the scheduler or by any keeper, and it will be swept as expired. This is the failure the scheduler exists to prevent. The pool is unharmed: the hook keeps charging the last valid recommendation, and no fee can be derived from evidence that was never scored.`
                  : `The work matured ${elapsed(overdueBy)} ago and the scheduler allows itself ${schedulerBudget}s — one epoch plus every retry it is permitted. Past its own bound this is a miss, not a delay. It does not halt the pool: the executor’s cycle is permissionless, so any keeper can advance the same bounded work while the evidence is still inside its reference window, and the hook keeps charging the last valid recommendation until one does.`
                : planeVerdict === "conflict" && pendingMaturity?.earliestMatureAt
                  ? `They name different moments: the scheduler is due at ${chainTime(reactive.dueAt)}, the earliest of ${pendingMaturity.activeSlots} occupied slots matures at ${chainTime(pendingMaturity.earliestMatureAt)}. A wake that early fires before its evidence is scoreable.`
                  : planeVerdict === "agree" && pendingMaturity
                    ? `Both name the same second for the next work — ${pendingMaturity.activeSlots} of ${pendingMaturity.scannedSlots} slots occupied, and the scheduler on the other chain arrived at it independently.`
                    : planeVerdict === "settling"
                      ? "The processor has queued work the scheduler has not armed a wake for yet. The two planes are eventually consistent by construction — a queued observation reaches the scheduler as a log — so this is a state, not a fault."
                      : "The maturity scan did not complete on this read, so only the coarse agreement above was checked."}
          </em>
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
