export function shortHex(value: string, left = 8, right = 6): string {
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

export function feeBps(feePips: number): string {
  return (feePips / 100).toFixed(2);
}

// Renders the low `window` bits of a persistence bitmap, most significant first.
// Both the research replay and the live side card draw this strip; they used to
// carry byte-identical copies of it.
export function bitmapBits(bitmap: number, window: number): number[] {
  return Array.from({ length: window }, (_, index) =>
    Math.floor(bitmap / 2 ** (window - index - 1)) % 2,
  );
}

// Signed to two decimals with a true minus sign, used wherever a directional
// quantity is shown. Zero renders unsigned.
export function signedFixed(value: number, digits = 2): string {
  if (value === 0) return value.toFixed(digits);
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;
}

// Pinned locale: these values render during SSR and again at hydration, so the
// visitor's locale must not change the grouping separators.
export function formatInt(value: number): string {
  return value.toLocaleString("en-US");
}

// Chain timestamps are humanised against the read's own generatedAt rather than
// the visitor's clock, so a skewed local clock cannot invent or erase an age.
export function age(generatedAt: string, observedAt: number | null): string {
  if (!observedAt) return "—";
  const seconds = Math.max(0, Math.floor(new Date(generatedAt).getTime() / 1_000) - observedAt);
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5_400) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 129_600) return `${Math.round(seconds / 3_600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

// Chart geometry rounding: keeps SVG path data short without visible change.
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
