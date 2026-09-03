// The run console's decidable logic, split out of the route so it can be tested
// directly. Nothing here imports next/server, viem, or live-config (which pulls
// a JSON module) — tests/run-guards.test.mjs imports this file under
// --experimental-strip-types the same way the live decoders are tested.
//
// These are the functions that decide whether an open, key-holding endpoint
// signs a transaction, so each one is written to be readable on its own terms
// rather than inlined at its single call site.

export type GuardCode =
  | "config"
  | "origin-floor"
  | "processor-floor"
  | "destination-floor"
  | "queue"
  | "swap-cooldown"
  | "cycle-cooldown"
  | "in-flight"
  | "gas-ceiling"
  | "leg"
  | "source-window"
  | "attestation"
  | "attestation-unreachable";

export type Guard = { ok: boolean; reason: string; code: GuardCode };

export type RunStep = "swap" | "relay" | "cycle";
export const RUN_STEPS: RunStep[] = ["swap", "relay", "cycle"];

export type Leg = {
  name: "outbound" | "return";
  sourceDomain: number;
  observationId?: number;
  sequence?: number;
};

/**
 * Which Circle leg is outstanding, from four counters read across both chains.
 *
 * Outbound is checked first and wins when both are outstanding: a recommendation
 * cannot be installed against evidence the processor has not received, so
 * delivering the observation is always the earlier half of the loop.
 */
export function legFromCounters(
  counters: { observed: number; received: number; dispatched: number; installed: number },
  domains: { origin: number; processor: number },
): Leg | null {
  if (counters.observed > counters.received) {
    return { name: "outbound", sourceDomain: domains.origin, observationId: counters.observed };
  }
  if (counters.dispatched > counters.installed) {
    return { name: "return", sourceDomain: domains.processor, sequence: counters.dispatched };
  }
  return null;
}

const eth = (wei: bigint) => (Number(wei) / 1e18).toFixed(5);

/**
 * A balance floor. Strictly greater: at exactly the floor the endpoint refuses,
 * so the floor is a balance the account keeps rather than one it may spend to.
 */
export function floorGuard(input: {
  balanceWei: bigint;
  floorWei: bigint;
  label: string;
  code: GuardCode;
}): Guard {
  const ok = input.balanceWei > input.floorWei;
  return {
    ok,
    code: input.code,
    reason: `${input.label} balance ${eth(input.balanceWei)} ETH against a ${eth(input.floorWei)} ETH floor${
      ok ? "" : " — it refuses below this floor so the account cannot be run to zero"
    }`,
  };
}

/**
 * A cooldown measured from a block timestamp rather than from a timer this
 * process owns, so it survives a serverless instance being replaced.
 *
 * A `lastEventUnix` in the future means the node's clock and ours disagree; it
 * is treated as "just now" so the reason never reads a negative number of
 * minutes, and the guard fails closed for the full interval.
 */
export function cooldownGuard(input: {
  lastEventUnix: number | null;
  nowUnix: number;
  cooldownSeconds: number;
  label: string;
  code: GuardCode;
  absentReason: string;
}): Guard {
  if (input.lastEventUnix === null) return { ok: true, code: input.code, reason: input.absentReason };
  const since = Math.max(0, input.nowUnix - input.lastEventUnix);
  const remaining = input.cooldownSeconds - since;
  const minutes = Math.round(since / 60);
  return {
    ok: remaining <= 0,
    code: input.code,
    reason:
      remaining <= 0
        ? `last ${input.label} ${minutes} min ago, past the ${Math.round(input.cooldownSeconds / 60)} min cooldown`
        : `last ${input.label} ${minutes} min ago — ${Math.ceil(remaining / 60)} min of cooldown remain`,
  };
}

/**
 * Whether an AutomationCycleCompleted log is one THIS endpoint signed.
 *
 * The event indexes cycleId, caller and reactiveTrigger, so topics[2] is the
 * caller and topics[3] the trigger flag. Scoping the cycle cooldown this way is
 * deliberate and asymmetric with the swap cooldown: any swap through the
 * protected pool starts a run, so an unscoped swap cooldown is right — but a
 * cycle advanced by the Reactive scheduler or by a third-party keeper is not a
 * run this console started, and throttling on it would let a stranger lock the
 * button, or worse, rate-limit the scheduler the page exists to demonstrate.
 */
export function isEndpointCycleLog(topics: readonly string[], signer: string): boolean {
  if (topics.length < 4) return false;
  const caller = `0x${topics[2].slice(-40)}`.toLowerCase();
  const reactiveTrigger = BigInt(topics[3]) !== BigInt(0);
  return !reactiveTrigger && caller === signer.toLowerCase();
}

/** Names of every setting a step needs, so the status can say what is missing. */
export function missingFrom(step: RunStep, present: Record<string, string | undefined>): string[] {
  const need: Record<RunStep, string[]> = {
    swap: ["DEPLOYER_PRIVATE_KEY", "ORIGIN_SWAP_ROUTER", "DEMO_TOKEN0", "DEMO_TOKEN1"],
    // Both legs are reachable from the browser, so both transmitters are
    // required — the return leg delivers to the origin chain.
    relay: [
      "DEPLOYER_PRIVATE_KEY",
      "PROCESSOR_CIRCLE_MESSAGE_TRANSMITTER",
      "ORIGIN_CIRCLE_MESSAGE_TRANSMITTER",
    ],
    cycle: ["DEPLOYER_PRIVATE_KEY"],
  };
  return need[step].filter((name) => !present[name]);
}

/**
 * Never echo an error verbatim: some client stacks include the signing payload,
 * and a 32-byte hex run in an error string is indistinguishable from key
 * material at this point.
 *
 * Redaction runs BEFORE truncation. The other order — which this replaced —
 * could cut a 64-character run in half, leaving a fragment the pattern no
 * longer matched and the truncation had already published. The `0x` is optional
 * because a key logged without its prefix is still a key.
 */
export function redactError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "transaction failed";
  return raw.replace(/(?:0x)?[0-9a-fA-F]{64}/g, "[redacted]").slice(0, 200);
}
