import type { ReactNode } from "react";

// Wide charts have fixed viewBoxes (640–720). Scaling them to a phone shrank
// their axis labels to 3–4px, and the values were only reachable through hover
// <title> tooltips that touch cannot open. Scrolling preserves the chart at a
// legible size, matching what .policy-table and .control-journey already do.
export default function ChartScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="chart-scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
