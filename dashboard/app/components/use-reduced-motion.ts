import { useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// One reactive detector for the whole app. The launch intro previously carried a
// separate one-shot `matchMedia(...).matches` check inside an effect, which
// could not react to the setting changing and expressed the same decision the
// stylesheet was already making.
//
// The server snapshot is `false` so SSR renders the animated markup and the
// client corrects on hydration — the alternative would be a hydration mismatch.
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}
