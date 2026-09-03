import { useState } from "react";
import type { DeploymentView } from "../../deployment-data";
import { shortHex } from "../format";
import type { SchedulerHealth } from "./scheduler-health";
import { RUN_STEP_ORDER, type RunGuard, type RunStatusState, type RunStep } from "./use-run-status";

const COPY: Record<RunStep, { title: string; chain: "origin" | "processor"; detail: string }> = {
  swap: {
    title: "Start a run",
    chain: "origin",
    detail:
      "Sends one bounded swap through the protected pool. The hook observes it and dispatches the evidence over Circle, which is what puts an observation into the queue on the other chain.",
  },
  relay: {
    title: "Relay the message",
    chain: "processor",
    detail:
      "Delivers the attested Circle message to whichever chain is missing it — the observation outbound, or the recommendation on its way home. Circle holds a message until its source chain finalises, which took about half an hour on the last run, so this step waits rather than fails. Which leg is outstanding is read from both chains' counters, not chosen here.",
  },
  cycle: {
    title: "Advance the cycle",
    chain: "processor",
    detail:
      "Runs one bounded automation cycle: sample the references, sync them, process whatever is due, and dispatch a recommendation if one is warranted. This is the same call the Reactive callback makes, and it is permissionless — the scheduler has no privilege here that a keeper lacks.",
  },
};

export type ExercisedStep = { hash: string; chain: "origin" | "processor" };

type Sent = { hash: string; leg?: string; outcome: string };

function GuardList({ guards, className }: { guards: RunGuard[]; className?: string }) {
  return (
    <ul className={className ? `console-guards ${className}` : "console-guards"}>
      {guards.map((guard) => (
        // Keyed by code, not by reason: a cooldown's reason changes every minute,
        // and keying on it remounts the row on every poll and makes it flicker.
        <li className={guard.ok ? "guard ok" : "guard blocked"} key={guard.code}>
          <i aria-hidden="true">{guard.ok ? "✓" : "✕"}</i>
          {/* Several reasons state only a measurement — "origin balance 0.05 ETH
              against a 0.002 ETH floor" reads the same whether it passed or
              failed — so the verdict cannot live in the glyph and the colour
              alone. Same treatment automation-card already gives its checks. */}
          <span className="sr-only">{guard.ok ? "passed: " : "blocked: "}</span>
          {guard.reason}
        </li>
      ))}
    </ul>
  );
}

export default function RunConsole({
  deployment,
  health,
  exercised,
  onRan,
  run,
}: {
  deployment: DeploymentView;
  health: SchedulerHealth;
  /**
   * The transaction that last exercised each step, read from live payload data
   * rather than written into the source — the gate forbids hex literals outside
   * live-config, and a hardcoded receipt would rot the moment a run happens.
   */
  exercised: Partial<Record<RunStep, ExercisedStep>>;
  onRan: () => void;
  run: RunStatusState;
}) {
  const [busy, setBusy] = useState<RunStep | null>(null);
  const [armedStep, setArmedStep] = useState<RunStep | null>(null);
  // Keyed by step rather than held in one slot each, so pressing a second step
  // does not erase the receipt or the refusal from the first.
  const [sent, setSent] = useState<Partial<Record<RunStep, Sent>>>({});
  const [refusals, setRefusals] = useState<Partial<Record<RunStep, RunGuard[]>>>({});
  const [failures, setFailures] = useState<Partial<Record<RunStep, string>>>({});

  const { status, error, loading, stale, refresh, boost } = run;

  // Three situations used to render the same "READ-ONLY" badge: a first read in
  // flight, a read that failed, and a deployment that genuinely holds no key.
  // Only the third is read-only, and saying so about the other two is how the
  // console came to look broken when it was merely uninformed.
  const phase = status ? (status.enabled ? "armed" : "read-only") : loading ? "loading" : "unavailable";

  async function press(step: RunStep) {
    // Two presses, never one, so a real transaction against a live deployment
    // cannot be fired by a stray click.
    if (armedStep !== step) {
      setArmedStep(step);
      return;
    }
    setBusy(step);
    setArmedStep(null);
    let timeout = 0;
    setSent((previous) => ({ ...previous, [step]: undefined }));
    setRefusals((previous) => ({ ...previous, [step]: undefined }));
    setFailures((previous) => ({ ...previous, [step]: undefined }));
    try {
      // Both pollers abort; this did not, so a connection dropped mid-broadcast
      // left the promise pending, `busy` set, and all three buttons disabled
      // reading "broadcasting…" with no recovery short of a reload. The budget
      // is just over the route's own maxDuration of 60.
      const controller = new AbortController();
      timeout = window.setTimeout(() => controller.abort(), 70_000);
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        hash?: string;
        leg?: string;
        outcome?: string;
        message?: string;
        guards?: RunGuard[];
      };
      if (response.status === 409 && payload.guards?.length) {
        // A refusal is a finding, not a failure: the endpoint re-ran the guards
        // and one of them said no. Showing which one is the whole point.
        setRefusals((previous) => ({ ...previous, [step]: payload.guards }));
        return;
      }
      if (!payload.ok || !payload.hash) throw new Error(payload.message ?? "the run endpoint refused");
      setSent((previous) => ({
        ...previous,
        [step]: { hash: payload.hash!, leg: payload.leg, outcome: payload.outcome ?? "pending" },
      }));
    } catch (pressError) {
      setFailures((previous) => ({
        ...previous,
        [step]: pressError instanceof DOMException && pressError.name === "AbortError"
          ? "The broadcast did not answer in time. It may still have been sent — check the explorer before pressing again."
          : pressError instanceof Error
            ? pressError.message
            : "the run endpoint refused",
      }));
    } finally {
      window.clearTimeout(timeout);
      setBusy(null);
      boost();
      void refresh();
      onRan();
    }
  }

  const explorer = (chain: "origin" | "processor") =>
    deployment.networks.find((network) => network.role === chain)?.explorerBase ?? "";

  const badge = {
    armed: { className: "live", text: "SIGNING KEY CONFIGURED · BUTTONS SEND REAL TRANSACTIONS" },
    "read-only": { className: "off", text: "READ-ONLY ON THIS DEPLOYMENT" },
    loading: { className: "pending", text: "CHECKING THIS DEPLOYMENT…" },
    unavailable: { className: "failed", text: "RUN STATUS UNAVAILABLE" },
  }[phase];

  const warning = {
    armed:
      "These buttons broadcast real transactions to Unichain Sepolia and Ethereum Sepolia and change deployed contract state. They are open to anyone, so every step is bounded: the arguments are fixed in the source, one run may be in flight at a time, a cooldown separates runs, a fee ceiling caps what a press can cost, and each chain has a balance floor the endpoint refuses to spend below.",
    "read-only":
      "Each step below has been run against the live testnets — the receipts are linked. This deployment holds no signing key, so the endpoint refuses to broadcast and the buttons stay inert; adding the operator environment arms them. The guards still evaluate against live chain state either way, which is the part worth reading.",
    loading: "Reading the guards from both chains to see what this deployment will currently permit.",
    unavailable:
      "The guard status could not be read, so no claim is made about what this deployment would permit right now. The receipts linked below are permanent and unaffected.",
  }[phase];

  return (
    <section aria-labelledby="run-console-heading" className="run-console">
      <div className="console-head">
        <div>
          <p className="kicker">Run the loop · live testnets</p>
          <h3 id="run-console-heading">Drive the protocol from here</h3>
        </div>
        <span className={`console-state ${badge.className}`}>{badge.text}</span>
      </div>
      {/* The signing account, so a reader can check the configured key resolved
          to the address they expect. Without it the balance guards look
          identical either way, because an unarmed deployment evaluates them
          against the same public deployer address. */}
      {status?.operator ? (
        <p className="console-operator">
          {"signing as "}
          <a href={`${explorer("processor")}/address/${status.operator}`} rel="noreferrer" target="_blank">
            <code>{shortHex(status.operator)}</code> ↗
          </a>
        </p>
      ) : null}

      <p className="console-warning">{warning}</p>
      {stale ? (
        <p className="console-stale">
          The guards below are the last successful read — the status endpoint is not answering right now.
        </p>
      ) : null}

      <ol className="console-steps">
        {/* Iterated from a fixed order rather than from the response, so the
            three steps and their receipts still render when the status read
            fails. Previously this list emptied itself and left the paragraph
            above pointing at nothing. */}
        {RUN_STEP_ORDER.map((step) => {
          const copy = COPY[step];
          const entry = status?.steps.find((candidate) => candidate.step === step) ?? null;
          const isArmed = armedStep === step;
          const canPress = phase === "armed" && Boolean(entry?.allowed);
          // Arming survives a poll, but permission may not: if a guard closed
          // between the two presses the button is disabled, and leaving it
          // labelled "press again to broadcast" invites a press that cannot land.
          const isArmedAndPressable = isArmed && canPress;
          const receipt = sent[step];
          const refused = refusals[step];
          return (
            <li className={entry?.allowed ? "console-step" : "console-step blocked"} key={step}>
              <div className="console-step-head">
                <b>{copy.title}</b>
                <span>{deployment.networks.find((network) => network.role === copy.chain)?.name}</span>
              </div>
              <p>{copy.detail}</p>
              {/* The bound the copy above claims, stated rather than asserted:
                  the amount and direction are fixed in the source and are not
                  chosen by whoever presses the button. */}
              {step === "swap" && status?.swap ? (
                <p className="console-bound">
                  {`fixed at ${(Number(BigInt(status.swap.amountWei) < 0n ? -BigInt(status.swap.amountWei) : BigInt(status.swap.amountWei)) / 1e18).toFixed(3)} token exact input · ${status.swap.zeroForOne ? "sell" : "buy"} side`}
                </p>
              ) : null}
              {/* Only on the step that starts a run: the reader is about to
                  spend gas on something whose outcome is already predictable
                  from what happened to the last one. */}
              {step === "swap" && health && !health.waking ? (
                <p className="console-health">{health.headline}</p>
              ) : null}

              {entry ? (
                <GuardList guards={entry.guards} />
              ) : phase === "unavailable" ? (
                <ul className="console-guards">
                  <li className="guard blocked">
                    <i aria-hidden="true">✕</i>
                    {`the guard status could not be read: ${error}`}
                  </li>
                </ul>
              ) : (
                <ul className="console-guards">
                  <li className="guard">
                    <i aria-hidden="true">·</i>
                    reading the chain…
                  </li>
                </ul>
              )}

              {exercised[step] ? (
                <p className="console-proven">
                  {"last run against the live testnets · "}
                  <a
                    href={`${explorer(exercised[step]!.chain)}/tx/${exercised[step]!.hash}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <code>{shortHex(exercised[step]!.hash)}</code> ↗
                  </a>
                </p>
              ) : null}

              <button
                className={isArmedAndPressable ? "console-action armed" : "console-action"}
                disabled={busy !== null || !canPress}
                onClick={() => void press(step)}
                type="button"
              >
                {busy === step
                  ? "broadcasting…"
                  : isArmedAndPressable
                    ? "press again to broadcast"
                    : phase === "loading"
                      ? "checking…"
                      : phase === "unavailable"
                        ? "status unavailable"
                        : canPress
                          ? copy.title
                          : phase === "armed"
                            ? "held by a guard"
                            : "not armed here"}
              </button>

              {/* The console is the page's only state-changing control, and a
                  refusal or a receipt was appearing silently under a button
                  that had already changed label. */}
              <div aria-live="polite">
              {refused?.length ? (
                <>
                  <p className="console-refusal-head">refused when you pressed it — the chain said:</p>
                  <GuardList className="console-refusal" guards={refused.filter((guard) => !guard.ok)} />
                </>
              ) : null}
              {failures[step] ? <p className="console-step-error">{failures[step]}</p> : null}

              {receipt ? (
                <a
                  className="console-receipt"
                  href={`${explorer(receipt.leg === "return" ? "origin" : copy.chain)}/tx/${receipt.hash}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  {`${receipt.outcome === "reverted" ? "REVERTED" : receipt.outcome === "success" ? "mined" : "sent"} · ${shortHex(receipt.hash)} ↗`}
                </a>
              ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {phase === "unavailable" ? (
        <button className="console-retry" onClick={() => void refresh()} type="button">
          try the status read again
        </button>
      ) : null}
    </section>
  );
}
