// The deployed and research columns sit side by side and exist to be compared,
// so both are rendered through these functions. A divergence between the two
// columns must mean the values differ, never that the formatters do.
import { feeBps } from "../format";

const WAD = 1e18;
const WAD_PER_BASIS_POINT = 1e14;

export function formatParamWad(value: number): string {
  const scaled = value / WAD;
  if (scaled !== 0 && Math.abs(scaled) < 0.01) {
    return `${scaled} (${(value / WAD_PER_BASIS_POINT).toFixed(2)} bps)`;
  }
  return `${Math.round(scaled * 10_000) / 10_000}`;
}

export function formatParamPips(value: number): string {
  return `${value.toLocaleString("en-US")} pips (${feeBps(value)} bps)`;
}

export function formatParamSeconds(value: number): string {
  return `${value.toLocaleString("en-US")} s`;
}

export function formatParamCount(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatParamBool(value: boolean): string {
  return value ? "enabled" : "disabled";
}
