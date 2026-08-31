import { useEffect, useState } from "react";

const RADIUS = 44;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export default function TtlRing({
  secondsUntilExpiry,
  windowSeconds,
  baselineFeeBps,
}: {
  secondsUntilExpiry: number;
  windowSeconds: number;
  baselineFeeBps: string;
}) {
  const [baseline, setBaseline] = useState(secondsUntilExpiry);
  const [elapsed, setElapsed] = useState(0);
  if (baseline !== secondsUntilExpiry) {
    setBaseline(secondsUntilExpiry);
    setElapsed(0);
  }

  useEffect(() => {
    const interval = window.setInterval(() => setElapsed((current) => current + 1), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const remaining = Math.max(0, secondsUntilExpiry - elapsed);
  const expired = remaining <= 0;
  const fraction = expired ? 0 : Math.min(1, remaining / Math.max(1, windowSeconds));

  return (
    <div className={expired ? "ttl-ring expired" : "ttl-ring"}>
      <svg
        viewBox="0 0 104 104"
        role="img"
        aria-label={
          expired
            ? `Recommendation window expired: both directions return the ${baselineFeeBps} bps baseline.`
            : `Recommendation validity: ${clock(remaining)} remaining before the fee returns to the ${baselineFeeBps} bps baseline.`
        }
      >
        <circle className="ttl-track" cx="52" cy="52" r={RADIUS} />
        <circle
          className="ttl-progress"
          cx="52"
          cy="52"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        />
        <text className="ttl-value" x="52" y="49">{expired ? "BASELINE" : clock(remaining)}</text>
        <text className="ttl-caption" x="52" y="64">{expired ? `${baselineFeeBps} bps holds` : "until expiry"}</text>
      </svg>
      <span>{expired ? "expired → safe fallback" : "recommendation TTL"}</span>
    </div>
  );
}
