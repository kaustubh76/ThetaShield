import type { DashboardView } from "../research-data";

type PolicyRows = DashboardView["policyRows"];

const storyline: Record<string, { eyebrow: string; line: string }> = {
  fixed_fee: {
    eyebrow: "STATIC",
    line: "A flat floor. It never overcharges benign flow — and never protects against informed flow.",
  },
  volatility_only: {
    eyebrow: "VOLATILITY-REACTIVE",
    line: "Raises fees on every burst of movement, so ordinary two-sided flow pays the premium.",
  },
  thetashield: {
    eyebrow: "DIRECTIONAL MEMORY",
    line: "Raises only the fee direction backed by persistent post-trade evidence, then decays to baseline.",
  },
};

export default function DistinctionStrip({ policies }: { policies: PolicyRows }) {
  const featured = ["fixed_fee", "volatility_only", "thetashield"]
    .map((id) => policies.find((policy) => policy.id === id))
    .filter((policy): policy is PolicyRows[number] => Boolean(policy));

  return (
    <section className="distinction-strip" aria-label="Static, volatility-reactive, and directional fee policies compared">
      <div className="distinction-grid">
        {featured.map((policy) => (
          <article className={policy.id === "thetashield" ? "distinction-card active" : "distinction-card"} key={policy.id}>
            <span>{storyline[policy.id]?.eyebrow}</span>
            <h3>{policy.label}</h3>
            <div className="distinction-fee"><strong>{policy.meanFeeBps}</strong><small>bps mean fee</small></div>
            <p>{storyline[policy.id]?.line}</p>
          </article>
        ))}
      </div>
      <div className="distinction-caption">
        <b>Same streams · identical event counts</b>
        <span>Trailing — a trade cannot widen its own noise band</span>
        <span>Persistent — one neutral epoch cannot erase toxic history</span>
        <span>Directional — buy and sell fees evolve independently</span>
        <span>Portable — Circle CCTP V2 carries the finalized evidence</span>
      </div>
    </section>
  );
}
