import { useEffect, useState } from "react";
import type { DeploymentView } from "../../deployment-data";
import { shortHex } from "../format";
import type { AutomationView, ReactiveView } from "./types";

// The five phases the RSC moves through, in the order the loop walks them.
// Retry is off the main path: it is where a failed cycle waits out its backoff.
const PHASES = [
  { id: 0, label: "Idle", detail: "no observation pending" },
  { id: 1, label: "Await maturity", detail: "waiting out the markout horizon" },
  { id: 2, label: "Await cycle", detail: "callback issued, work in flight" },
  { id: 3, label: "Await finalization", detail: "epoch close scheduled" },
] as const;
const RETRY_PHASE = { id: 4, label: "Retry", detail: "bounded backoff after a failed cycle" };

function countdown(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${String(minutes).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

export default function ReactivePanel({
  reactive,
  automation,
  deployment,
  generatedAt,
}: {
  reactive: ReactiveView;
  automation: AutomationView | null;
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
  const callbackReceipts = deployment.receipts.filter(
    (receipt) => receipt.phase === "autonomous-wake" || receipt.phase === "recommendation-return",
  );

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
          {rvm ? <em>{`${reactive.consecutiveRetries} used`}</em> : null}
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

      {callbackReceipts.length ? (
        <div className="reactive-receipts">
          <span>Authenticated callbacks, proven on-chain</span>
          {callbackReceipts.map((receipt) => (
            <a href={receipt.url} key={receipt.hash} rel="noreferrer" target="_blank">
              <b>{receipt.title}</b>
              <code>{shortHex(receipt.hash)}</code>
              <i aria-hidden="true">↗</i>
            </a>
          ))}
        </div>
      ) : null}

      <p className="card-caption">
        {`Callbacks are accepted only from the ${deployment.automation.mode} callback proxy `}
        <code title={deployment.automation.callbackProxy}>{shortHex(deployment.automation.callbackProxy, 10, 6)}</code>
        {`. The RSC can only request bounded wake-ups — it cannot forge evidence, compute a fee, or block a
        swap. Circle decides which evidence is authentic; Reactive decides when eligible work runs.`}
      </p>
    </section>
  );
}
