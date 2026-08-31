"use client";

// The whole page is one client tree, so without this any throw renders a blank
// document. This boundary is route-scoped: it replaces every section including
// the receipt trail, so what it buys is an explanation instead of a white
// screen — not continuity of the trail.
export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="route-error">
      <h1>The dashboard failed to render.</h1>
      <p>
        This is a fault in the page, not a statement about chain state — no claim is made about current
        fees. The deployed contracts and the public receipt trail are unaffected and remain readable on
        the block explorers.
      </p>
      <button onClick={() => reset()} type="button">Reload the dashboard</button>
    </main>
  );
}
