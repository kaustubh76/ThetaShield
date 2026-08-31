import type { DeploymentView } from "../../deployment-data";
import { shortHex } from "../format";
import type { AutomationView, ReactiveView } from "./types";

export default function ReactiveCard({
  reactive,
  automation,
  deployment,
}: {
  reactive: ReactiveView;
  automation: AutomationView | null;
  deployment: DeploymentView;
}) {
  const rvm = reactive.source === "rvm";
  // The RSC observes cycles from its own side; the executor counts them from the
  // processor chain. Agreement is the evidence that the two planes are the same
  // loop, so it is stated rather than left for the reader to notice.
  const executorCycle = automation?.lastCycle.cycleId ?? null;
  const cyclesAgree = executorCycle !== null && executorCycle === reactive.lastCycleId;

  return (
    <article className="reactive-card">
      <div className="card-title">
        <span>{`REACTIVE PLANE · ${deployment.automation.networkName.toUpperCase()}`}</span>
        <b>{deployment.automation.cronName}</b>
      </div>
      <p className={rvm ? "rvm-source" : "rvm-source degraded"}>
        {rvm
          ? "read from the deployer’s ReactiveVM"
          : "RVM read unavailable — chain-side copy shown, which react() never writes"}
      </p>
      <dl className="side-facts">
        <div><dt>wake requests</dt><dd>{rvm ? reactive.wakeRequestCount : "—"}</dd></div>
        <div><dt>observation signals</dt><dd>{rvm ? reactive.observationSignalCount : "—"}</dd></div>
        <div><dt>last cycle observed</dt><dd>{rvm ? reactive.lastCycleId : "—"}</dd></div>
        <div>
          <dt>consecutive retries</dt>
          <dd className={rvm && reactive.consecutiveRetries > 0 ? "warn" : ""}>
            {rvm ? reactive.consecutiveRetries : "—"}
          </dd>
        </div>
      </dl>
      {rvm && executorCycle !== null ? (
        <p className={cyclesAgree ? "cycle-match" : "cycle-match mismatch"}>
          {cyclesAgree
            ? `matches the executor’s cycle ${executorCycle} on ${deployment.networks.find((network) => network.role === "processor")?.name ?? "the processor chain"}`
            : `RSC observed cycle ${reactive.lastCycleId}; the executor reports cycle ${executorCycle}`}
        </p>
      ) : null}
      <p className="card-caption">
        {`Callbacks are accepted only from the ${deployment.automation.mode} callback proxy `}
        <code title={deployment.automation.callbackProxy}>{shortHex(deployment.automation.callbackProxy, 10, 6)}</code>
        {`, woken by cron topic `}
        <code title={deployment.automation.cronTopic}>{shortHex(deployment.automation.cronTopic, 10, 6)}</code>
        {`. The RSC can only request bounded wake-ups — it cannot forge evidence, compute fees, or block a swap.
        Its cron credit is an operational liveness requirement, monitored off-chain.`}
      </p>
    </article>
  );
}
