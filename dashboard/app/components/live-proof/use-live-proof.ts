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
  failureCount: number;
  refresh: () => Promise<void>;
};

// A hung request must not leave the panel "loading" forever, and the route's own
// worst case (several sequential RPC rounds plus a lens fallback) is well inside
// this budget.
const REQUEST_TIMEOUT_MS = 20_000;
const MAXIMUM_INTERVAL_MS = 10 * 60_000;

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
      const payload = (await response.json()) as LiveProof | { message?: string };
      if (!response.ok || !("ok" in payload) || payload.ok !== true) {
        throw new Error("message" in payload && payload.message ? payload.message : "Testnet RPC unavailable.");
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
      timer = window.setTimeout(run, Math.min(backoff, MAXIMUM_INTERVAL_MS));
    };

    const run = async () => {
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      schedule();
    };

    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [refresh, intervalMs]);

  return {
    proof,
    error,
    loading,
    stale: proof !== null && failureCount > 0,
    lastSuccessAt,
    failureCount,
    refresh,
  };
}
