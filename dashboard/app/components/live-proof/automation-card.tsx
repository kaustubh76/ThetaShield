import type { AutomationView } from "./types";

export default function AutomationCard({ automation }: { automation: AutomationView }) {
  const cycle = automation.lastCycle;
  // Each check reports the counter it actually moved, so "advanced" is a
  // reading rather than a claim: a cycle that settled nothing shows 1→1.
  const checks = [
    { label: "sampler published", ok: cycle.samplerSucceeded, detail: `${cycle.publishedSources} sources` },
    { label: "references synced", ok: cycle.syncedSources > 0, detail: `${cycle.syncedSources} synced` },
    { label: "pending drained", ok: cycle.processSucceeded, detail: `${cycle.pendingBefore}→${cycle.pendingAfter}` },
    { label: "observations settled", ok: cycle.settledAfter >= cycle.settledBefore, detail: `${cycle.settledBefore}→${cycle.settledAfter}` },
    { label: "observations expired", ok: cycle.expiredAfter === cycle.expiredBefore, detail: `${cycle.expiredBefore}→${cycle.expiredAfter}` },
    { label: "recommendation dispatched", ok: cycle.recommendationDispatched, detail: `seq ${cycle.recommendationBefore}→${cycle.recommendationAfter}` },
  ];

  return (
    <article className="automation-card">
      <div className="card-title"><span>AUTOMATION · LAST CYCLE</span><b>{`cycle ${cycle.cycleId} of ${automation.cycleCount}`}</b></div>
      <ul className="cycle-checks">
        {checks.map((check) => (
          <li className={check.ok ? "ok" : ""} key={check.label}>
            <i aria-hidden="true" />
            <b>{check.label}</b>
            {/* The dot is the only visual channel, so the state is also written
                out for assistive tech and for anyone who cannot separate the
                green from the grey. */}
            <span><span className="sr-only">{check.ok ? "passed: " : "not completed: "}</span>{check.detail}</span>
          </li>
        ))}
      </ul>
      <p className={cycle.reactiveTrigger ? "cycle-trigger reactive" : "cycle-trigger"}>
        {cycle.reactiveTrigger
          ? "Triggered by an authenticated Reactive Network callback."
          : "Triggered by a permissionless keeper call."}
      </p>
      <p className="card-caption">
        Reactive schedules bounded work; Circle authenticates what crosses chains. Neither computes fees.
      </p>
    </article>
  );
}
