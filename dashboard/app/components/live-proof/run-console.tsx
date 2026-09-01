import { useCallback, useEffect, useState } from "react";
import type { DeploymentView } from "../../deployment-data";
import { shortHex } from "../format";

type Guard = { ok: boolean; reason: string };
type StepState = { step: "swap" | "relay" | "cycle"; allowed: boolean; guards: Guard[] };
type RunStatus = { ok: true; enabled: boolean; steps: StepState[]; swap: { amountWei: string } };

const COPY: Record<StepState["step"], { title: string; chain: "origin" | "processor"; detail: string }> = {
  swap: {
    title: "Start a run",
    chain: "origin",
    detail:
      "Sends one bounded swap through the protected pool. The hook observes it and dispatches the evidence over Circle, which is what puts an observation into the queue on the other chain.",
  },
  relay: {
    title: "Relay the evidence",
    chain: "processor",
    detail:
      "Delivers the attested Circle message to the processor. Circle only issues the attestation once the source chain finalises, so this leg is run from the operator runbook rather than the browser.",
  },
  cycle: {
    title: "Advance the cycle",
    chain: "processor",
    detail:
      "Runs one bounded automation cycle: sample the references, sync them, process whatever is due, and dispatch a recommendation if one is warranted. This is the same call the Reactive callback makes, and it is permissionless — the scheduler has no privilege here that a keeper lacks.",
  },
};

export default function RunConsole({ deployment, onRan }: { deployment: DeploymentView; onRan: () => void }) {
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ step: string; hash: string } | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/run", { cache: "no-store" });
      const payload = (await response.json()) as RunStatus | { ok: false; message: string };
      if (!("ok" in payload) || !payload.ok) throw new Error("message" in payload ? payload.message : "unavailable");
      setStatus(payload);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "run status unavailable");
    }
  }, []);

  // Wrapped rather than called directly: fetch can throw synchronously, which
  // would put the catch's setState on the effect's own synchronous path. The
  // cancelled flag also stops a late response updating an unmounted console —
  // the same discipline useLiveProof uses for its poll.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      await Promise.resolve();
      if (cancelled) return;
      await refresh();
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Two presses, never one. The first arms a specific step and the second
  // sends it, so a real transaction against a live deployment cannot be fired
  // by a stray click on a page the reader is only scrolling through.
  const run = useCallback(
    async (step: string) => {
      if (armed !== step) {
        setArmed(step);
        return;
      }
      setBusy(step);
      setArmed(null);
      setResult(null);
      try {
        const response = await fetch("/api/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ step }),
        });
        const payload = (await response.json()) as { ok: boolean; hash?: string; message?: string };
        if (!payload.ok || !payload.hash) throw new Error(payload.message ?? "the step was refused");
        setResult({ step, hash: payload.hash });
        setError("");
        onRan();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "the step failed");
      } finally {
        setBusy(null);
        void refresh();
      }
    },
    [armed, onRan, refresh],
  );

  const explorer = (chain: "origin" | "processor") =>
    deployment.networks.find((network) => network.role === chain)?.explorerBase ?? "";

  return (
    <section aria-labelledby="run-console-heading" className="run-console">
      <div className="console-head">
        <div>
          <p className="kicker">Run the loop · live testnets</p>
          <h3 id="run-console-heading">Drive the protocol from here</h3>
        </div>
        <span className={status?.enabled ? "console-state live" : "console-state off"}>
          {status?.enabled ? "SIGNING KEY CONFIGURED · BUTTONS SEND REAL TRANSACTIONS" : "READ-ONLY ON THIS DEPLOYMENT"}
        </span>
      </div>

      <p className="console-warning">
        {status?.enabled
          ? "These buttons broadcast real transactions to Unichain Sepolia and Ethereum Sepolia and change deployed contract state. They are open to anyone, so every step is bounded: the arguments are fixed in the source, one run may be in flight at a time, a cooldown separates runs, and each chain has a balance floor the endpoint refuses to spend below."
          : "No signing key is configured here, so every step below is refused. The guards still evaluate against live chain state, so you can see exactly what would and would not be permitted right now."}
      </p>

      <ol className="console-steps">
        {(status?.steps ?? []).map((entry) => {
          const copy = COPY[entry.step];
          const isArmed = armed === entry.step;
          return (
            <li className={entry.allowed ? "console-step" : "console-step blocked"} key={entry.step}>
              <div className="console-step-head">
                <b>{copy.title}</b>
                <span>{deployment.networks.find((network) => network.role === copy.chain)?.name}</span>
              </div>
              <p>{copy.detail}</p>
              <ul className="console-guards">
                {entry.guards.map((guard) => (
                  <li className={guard.ok ? "guard ok" : "guard blocked"} key={guard.reason}>
                    <i aria-hidden="true">{guard.ok ? "✓" : "✕"}</i>
                    {guard.reason}
                  </li>
                ))}
              </ul>
              <button
                className={isArmed ? "console-action armed" : "console-action"}
                disabled={!entry.allowed || busy !== null}
                onClick={() => void run(entry.step)}
                type="button"
              >
                {busy === entry.step
                  ? "broadcasting…"
                  : isArmed
                    ? "press again to broadcast"
                    : entry.allowed
                      ? copy.title
                      : "blocked"}
              </button>
              {result?.step === entry.step ? (
                <a
                  className="console-receipt"
                  href={`${explorer(copy.chain)}/tx/${result.hash}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  {`sent · ${shortHex(result.hash)} ↗`}
                </a>
              ) : null}
            </li>
          );
        })}
      </ol>

      {error ? <p className="console-error">{error}</p> : null}
    </section>
  );
}
