import { useCallback, useEffect, useState } from "react";
import type { LiveProof } from "./types";

export type LiveProofState = {
  proof: LiveProof | null;
  error: string;
  loading: boolean;
  refresh: () => Promise<void>;
};

// One poll for the whole page: the live panel and the registry's deployed-parameter
// table read the same snapshot instead of each issuing its own multi-chain request.
export function useLiveProof(intervalMs = 60_000): LiveProofState {
  const [proof, setProof] = useState<LiveProof | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/live", { cache: "no-store" });
      const payload = (await response.json()) as LiveProof | { message?: string };
      if (!response.ok || !("ok" in payload) || payload.ok !== true) {
        throw new Error("message" in payload && payload.message ? payload.message : "Testnet RPC unavailable");
      }
      setProof(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Testnet RPC unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), intervalMs);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refresh, intervalMs]);

  return { proof, error, loading, refresh };
}
