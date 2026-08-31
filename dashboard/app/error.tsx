"use client";

// Without this the whole page is one client tree: any throw below it renders a
// blank document, taking the permanent receipt trail down with the live panel.
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
