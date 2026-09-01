import type { LiveProof } from "./types";

/**
 * Whether the autonomous scheduler is actually picking work up, judged from
 * what happened to the last observation rather than from the scheduler's own
 * counters. An RSC that never receives a log looks identical to an idle one
 * from the inside — phase Idle, nothing armed, no retries — so the only honest
 * evidence is the fate of the work it was supposed to act on.
 */
export type SchedulerHealth = {
  waking: boolean;
  headline: string;
  detail: string;
} | null;

export function schedulerHealth(proof: LiveProof | null): SchedulerHealth {
  const attempt = proof?.events?.latestAttempt;
  if (!attempt) return null;

  // Expired unscored, and cleared by a keeper rather than by an authenticated
  // callback: the scheduler had the whole observation lifetime to wake and did
  // not. `sweptByReactive === null` means no sweep was found, which is not
  // evidence either way, so it is not treated as a failure.
  if (attempt.outcome === "expired" && attempt.sweptByReactive === false) {
    return {
      waking: false,
      headline: "The scheduler did not wake for the last observation",
      detail:
        "It expired unscored and a permissionless keeper cleared it. A run started now will queue an observation the same way; unless a keeper advances the cycle inside the reference selection window, it will expire the same way too. The run is still real and still worth doing — this is what to expect from it.",
    };
  }
  if (attempt.outcome === "settled") {
    // Scored is not the same as scored BY THE SCHEDULER. A keeper cycle reaches
    // the identical result, so a settled observation says nothing about whether
    // the scheduler is waking — and treating it as good news would hide a
    // scheduler that has stopped delivering, which is the live case here.
    if (attempt.sweptByReactive) {
      return {
        waking: true,
        headline: "The scheduler carried the last observation through",
        detail: "The last queued observation was scored under an authenticated Reactive callback.",
      };
    }
    return {
      waking: false,
      headline: "The last observation was scored, but not by the scheduler",
      detail:
        "A permissionless keeper advanced the cycle that scored it. The loop closed, which is the point of the keeper being permissionless — but the scheduler did not wake, so a run started now still depends on someone advancing the cycle inside the reference selection window.",
    };
  }
  if (attempt.outcome === "pending") {
    return {
      waking: true,
      headline: "An observation is in flight",
      detail: "The last queued observation has not resolved yet, so nothing can be concluded about the scheduler.",
    };
  }
  return null;
}
