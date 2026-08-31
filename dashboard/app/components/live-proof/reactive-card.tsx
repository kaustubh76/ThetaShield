import type { DeploymentView } from "../../deployment-data";
import type { ReactiveView } from "./types";

export default function ReactiveCard({
  reactive,
  deployment,
}: {
  reactive: ReactiveView;
  deployment: DeploymentView;
}) {
  return (
    <article className="reactive-card">
      <div className="card-title">
        <span>{`REACTIVE PLANE · ${deployment.automation.networkName.toUpperCase()}`}</span>
        <b>{deployment.automation.cronName}</b>
      </div>
      <dl className="side-facts">
        <div><dt>wake requests</dt><dd>{reactive.wakeRequestCount}</dd></div>
        <div><dt>observation signals</dt><dd>{reactive.observationSignalCount}</dd></div>
        <div><dt>last cycle observed</dt><dd>{reactive.lastCycleId}</dd></div>
        <div>
          <dt>consecutive retries</dt>
          <dd className={reactive.consecutiveRetries > 0 ? "warn" : ""}>{reactive.consecutiveRetries}</dd>
        </div>
      </dl>
      <p className="card-caption">
        The RSC can only request bounded wake-ups — it cannot forge evidence, compute fees, or block a swap.
        Its cron credit is an operational liveness requirement, monitored off-chain.
      </p>
    </article>
  );
}
