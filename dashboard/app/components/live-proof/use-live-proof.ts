import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveProof } from "./types";

export type LiveProofState = {
  proof: LiveProof | null;
  error: string;
  loading: boolean;
  /** A read has failed since the last success, so `proof` is a frozen snapshot. */
  stale: boolean;
  /** Epoch ms of the last successful read, or null if none has ever succeeded. */
  lastSuccessAt: number | null;
  /**
   * Epoch ms the next automatic poll is actually scheduled for. Reported rather
   * than inferred from the interval, because a failing endpoint backs off to as
   * much as ten minutes and a countdown that kept saying "60s" would assert a
   * freshness the panel is not going to have.
   */
  nextPollAt: number | null;
  failureCount: number;
  refresh: () => Promise<void>;
};

// A hung request must not leave the panel "loading" forever, and the route's own
// worst case (several sequential RPC rounds plus a lens fallback) is well inside
// this budget.
const REQUEST_TIMEOUT_MS = 20_000;
// Bumped whenever the payload shape changes in a way the page cannot render.
const SUPPORTED_SCHEMA = 2;
const MAXIMUM_INTERVAL_MS = 10 * 60_000;

// The previous check was `payload.ok === true`, so any JSON object equal to
// {"ok": true} was stored as a complete reading and every downstream field
// access became a TypeError. schemaVersion existed for exactly this and was
// never read.
function isRenderable(payload: unknown): payload is LiveProof {
  if (typeof payload !== "object" || payload === null) return false;
  const candidate = payload as Partial<LiveProof>;
  if (candidate.ok !== true) return false;
  if (candidate.schemaVersion !== SUPPORTED_SCHEMA) return false;
  return (
    typeof candidate.generatedAt === "string" &&
    typeof candidate.poolId === "string" &&
    typeof candidate.origin === "object" && candidate.origin !== null &&
    typeof candidate.origin.buy?.feePips === "number" &&
    typeof candidate.origin.sell?.feePips === "number" &&
    typeof candidate.origin.blockNumber === "number" &&
    typeof candidate.processor === "object" && candidate.processor !== null &&
    typeof candidate.processor.blockNumber === "number"
  );
}

function describe(requestError: unknown): string {
  if (requestError instanceof DOMException && requestError.name === "AbortError") {
    return "The testnet read timed out.";
  }
  if (requestError instanceof SyntaxError) {
    // A proxy or edge error page rather than the route's own JSON envelope.
    return "The testnet read returned an unreadable response.";
  }
  return requestError instanceof Error && requestError.message
    ? requestError.message
    : "Testnet RPC unavailable.";
}

// One poll for the whole page: the live panel and the registry's deployed-parameter
// table read the same snapshot instead of each issuing its own multi-chain request.
export function useLiveProof(intervalMs = 60_000): LiveProofState {
  const [proof, setProof] = useState<LiveProof | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [nextPollAt, setNextPollAt] = useState<number | null>(null);
  const [failureCount, setFailureCount] = useState(0);
  // The manual Refresh button and the scheduled poll can be in flight together;
  // without a ticket the slower response would overwrite the newer snapshot.
  const sequence = useRef(0);
  const failures = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = sequence.current + 1;
    sequence.current = ticket;
    setLoading(true);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch("/api/live", { cache: "no-store", signal: controller.signal });
      const payload: unknown = await response.json();
      if (!isRenderable(payload)) {
        const message =
          typeof payload === "object" && payload !== null && "message" in payload
            ? String((payload as { message?: unknown }).message ?? "")
            : "";
        throw new Error(message || "The testnet read returned a payload this page cannot render.");
      }
      if (ticket !== sequence.current) return;
      failures.current = 0;
      setProof(payload);
      setError("");
      setFailureCount(0);
      setLastSuccessAt(Date.now());
    } catch (requestError) {
      if (ticket !== sequence.current) return;
      failures.current += 1;
      setError(describe(requestError));
      setFailureCount(failures.current);
    } finally {
      window.clearTimeout(timeout);
      if (ticket === sequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    // Rescheduling after each completion (rather than a fixed interval) keeps
    // polls from overlapping, and backing off stops a dead endpoint being
    // hammered while still recovering on its own once it returns.
    const schedule = () => {
      const backoff = intervalMs * 2 ** Math.min(failures.current, 4);
      const delay = Math.min(backoff, MAXIMUM_INTERVAL_MS);
      setNextPollAt(Date.now() + delay);
      timer = window.setTimeout(run, delay);
    };

    const run = async () => {
      if (cancelled) return;
      setNextPollAt(null);
      await refresh();
      if (cancelled) return;
      schedule();
    };

    void run();
    return () => {
      cancelled = true;
      setNextPollAt(null);
      window.clearTimeout(timer);
    };
  }, [refresh, intervalMs]);

  return {
    proof,
    error,
    loading,
    stale: proof !== null && failureCount > 0,
    lastSuccessAt,
    nextPollAt,
    failureCount,
    refresh,
  };
}
