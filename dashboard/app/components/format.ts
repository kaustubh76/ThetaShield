export function shortHex(value: string, left = 8, right = 6): string {
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

export function feeBps(feePips: number): string {
  return (feePips / 100).toFixed(2);
}

// Pinned locale: these values render during SSR and again at hydration, so the
// visitor's locale must not change the grouping separators.
export function formatInt(value: number): string {
  return value.toLocaleString("en-US");
}
