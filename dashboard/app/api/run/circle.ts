// Circle CCTP attestation lookup.
//
// The wait for an attestation is long — Circle holds the message until the
// source chain finalises, which was ~33 minutes on the 2026-09-01 run — but the
// CHECK is cheap: measured at ~0.5s against the sandbox API. That distinction is
// what lets the relay be driven from a browser at all: the page polls a fast
// endpoint and presses relay when it flips, instead of a request trying to hold
// itself open for half an hour.

const API_ROOT = "https://iris-api-sandbox.circle.com/v2/messages";

/** Circle domain ids. Not addresses, so they are safe to name here. */
export const CIRCLE_DOMAIN = { origin: 10, processor: 0 } as const;

export type Attestation =
  | { ready: true; message: string; attestation: string; status: string }
  | { ready: false; status: string; detail: string | null };

export async function fetchAttestation(domain: number, transactionHash: string): Promise<Attestation> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${API_ROOT}/${domain}?transactionHash=${transactionHash}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ready: false, status: `circle http ${response.status}`, detail: null };
    }
    const payload = (await response.json()) as {
      messages?: { status?: string; message?: string; attestation?: string; delayReason?: string | null }[];
    };
    const entry = payload.messages?.[0];
    if (!entry) return { ready: false, status: "not found", detail: "Circle has no message for this transaction yet" };
    // Both fields must be present, not just the status: a "complete" status with
    // a placeholder attestation would be broadcast as a malformed relay.
    if (entry.status === "complete" && entry.message && entry.attestation) {
      return { ready: true, message: entry.message, attestation: entry.attestation, status: entry.status };
    }
    return {
      ready: false,
      status: entry.status ?? "unknown",
      detail: entry.delayReason ?? null,
    };
  } catch (error) {
    return {
      ready: false,
      status: "unavailable",
      detail: error instanceof Error && error.name === "AbortError" ? "Circle did not answer in time" : null,
    };
  } finally {
    clearTimeout(timeout);
  }
}
