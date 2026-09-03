import { useCallback, useEffect, useRef, useState } from "react";

export type RunStep = "swap" | "relay" | "cycle";
export const RUN_STEP_ORDER: RunStep[] = ["swap", "relay", "cycle"];

export type RunGuard = { ok: boolean; reason: string; code: string };
export type RunStepStatus = { step: RunStep; allowed: boolean; guards: RunGuard[] };
export type RunStatus = {
  ok: true;
  enabled: boolean;
  operator: string | null;
  partial?: boolean;
  steps: RunStepStatus[];
  swap: { amountWei: string; zeroForOne: boolean };
};

export type RunStatusState = {
  status: RunStatus | null;
  error: string;
  /** No read has ever succeeded yet, so the console cannot state a mode. */
  loading: boolean;
  /** A read has failed since the last success, so `status` is a frozen snapshot. */
  stale: boolean;
  refresh: (steps?: RunStep[]) => Promise<void>;
  /** Poll hard for a minute — used right after a press, when counters move. */
  boost: () => void;
};

const REQUEST_TIMEOUT_MS = 20_000;
const IDLE_INTERVAL_MS = 60_000;
// Circle holds a message until the source chain finalises, ~33 minutes on the
// last run. The route was written expecting the browser to re-check and press
// relay when the guard flips; this is that re-check.
const AWAITING_INTERVAL_MS = 20_000;
const BOOST_INTERVAL_MS = 5_000;
const BOOST_WINDOW_MS = 60_000;
const MAXIMUM_INTERVAL_MS = 5 * 60_000;

function isRenderable(payload: unknown): payload is RunStatus {
  if (typeof payload !== "object" || payload === null) return false;
  const candidate = payload as Partial<RunStatus>;
  return candidate.ok === true && Array.isArray(candidate.steps);
}

/**
 * True while a Circle message is outstanding but not yet attested — the one
 * state worth polling quickly. Read from guard codes rather than by matching
 * prose, which would break the first time a reason is reworded.
 */
function awaitingAttestation(status: RunStatus | null): boolean {
  const relay = status?.steps.find((entry) => entry.step === "relay");
  if (!relay) return false;
  const leg = relay.guards.find((guard) => guard.code === "leg");
  // Only a message Circle is genuinely still finalising is worth polling hard
  // for. An unreachable API carries its own code and is left on the idle
  // cadence, so a broken dependency does not become a 20-second loop.
  const attestation = relay.guards.find((guard) => guard.code === "attestation");
  return Boolean(leg?.ok && attestation && !attestation.ok);
}

/**
 * One poller for the run console, called once at the page root and threaded
 * down — the same contract useLiveProof carries. A second call would mean two
 * independent timers hitting an endpoint that reaches four chains, and two
 * components disagreeing during the skew.
 */
export function useRunStatus(): RunStatusState {
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [failureCount, setFailureCount] = useState(0);
  const failures = useRef(0);
  const sequence = useRef(0);
  const boostUntil = useRef(0);
  // The polling effect reads the latest status through this ref rather than
  // through a dependency. Depending on `status` would tear down and restart the
  // loop on every successful poll, which fires the next request immediately and
  // turns a 60-second cadence into a hot loop against a four-chain endpoint.
  const latest = useRef<RunStatus | null>(null);

  const refresh = useCallback(async (steps?: RunStep[]) => {
    const ticket = (sequence.current += 1);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const query = steps?.length ? `?steps=${steps.join(",")}` : "";
    try {
      // Not "no-store": the status is a shared read of public chain state and
      // the route marks it cacheable at the edge, so a request-side no-cache
      // header would opt every reader out of that for no benefit.
      const response = await fetch(`/api/run${query}`, { signal: controller.signal });
      const payload: unknown = await response.json();
      if (ticket !== sequence.current) return;
      if (!isRenderable(payload)) {
        throw new Error(
          typeof payload === "object" && payload !== null && "message" in payload
            ? String((payload as { message: unknown }).message)
            : "run status unavailable",
        );
      }
      // A filtered read answers for some steps only, so it merges rather than
      // replaces — otherwise polling the relay step would erase the other two.
      const merge = (previous: RunStatus | null): RunStatus =>
        payload.partial && previous
          ? {
              ...previous,
              enabled: payload.enabled,
              operator: payload.operator,
              swap: payload.swap,
              steps: previous.steps.map(
                (entry) => payload.steps.find((fresh) => fresh.step === entry.step) ?? entry,
              ),
            }
          : payload;
      latest.current = merge(latest.current);
      setStatus(latest.current);
      failures.current = 0;
      setFailureCount(0);
      setError("");
    } catch (requestError) {
      if (ticket !== sequence.current) return;
      failures.current += 1;
      setFailureCount(failures.current);
      setError(
        requestError instanceof DOMException && requestError.name === "AbortError"
          ? "The run status read timed out."
          : requestError instanceof Error && requestError.message
            ? requestError.message
            : "Run status unavailable.",
      );
    } finally {
      window.clearTimeout(timeout);
      if (ticket === sequence.current) setLoading(false);
    }
  }, []);

  const boost = useCallback(() => {
    boostUntil.current = Date.now() + BOOST_WINDOW_MS;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const interval = () => {
      if (Date.now() < boostUntil.current) return BOOST_INTERVAL_MS;
      return awaitingAttestation(latest.current) ? AWAITING_INTERVAL_MS : IDLE_INTERVAL_MS;
    };

    const schedule = () => {
      const backoff = interval() * 2 ** Math.min(failures.current, 4);
      // Jitter so many open tabs do not synchronise, and so this poller does not
      // fall into lockstep with the /api/live one.
      const delay = Math.min(backoff, MAXIMUM_INTERVAL_MS) * (0.85 + Math.random() * 0.3);
      timer = window.setTimeout(run, delay);
    };

    const run = async () => {
      if (cancelled) return;
      // A hidden tab is not watching the guards. Nothing is scheduled while it
      // is away — otherwise a console left open overnight costs thousands of
      // multi-chain reads for a page nobody is looking at.
      if (document.visibilityState === "hidden") return;
      await refresh(awaitingAttestation(latest.current) ? ["relay"] : undefined);
      if (cancelled) return;
      schedule();
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible" || cancelled) return;
      window.clearTimeout(timer);
      void run();
    };

    void run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return {
    status,
    error,
    loading: loading && status === null,
    stale: status !== null && failureCount > 0,
    refresh,
    boost,
  };
}
