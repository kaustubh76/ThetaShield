import type { DeploymentView } from "../../deployment-data";
import { wadToNumber, type ReferenceSourceView } from "./types";

function shortId(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function age(generatedAt: string, observedAt: number): string {
  if (!observedAt) return "—";
  const seconds = Math.max(0, Math.floor(new Date(generatedAt).getTime() / 1_000) - observedAt);
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5_400) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 129_600) return `${Math.round(seconds / 3_600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

export default function ReferenceSources({
  sources,
  generatedAt,
  deployment,
}: {
  sources: ReferenceSourceView[];
  generatedAt: string;
  deployment: DeploymentView;
}) {
  return (
    <div className="reference-sources">
      <div className="card-title">
        <span>{`REFERENCE SOURCES · ${deployment.profile.name}`}</span>
        <b>{`${sources.length} liquidity-qualified v4 pools`}</b>
      </div>
      <div className="reference-table" role="table" aria-label="Live reference source readings">
        <div className="reference-row head" role="row">
          <span role="columnheader">source</span>
          <span role="columnheader">latest price</span>
          <span role="columnheader">confidence (constant)</span>
          <span role="columnheader">sequence</span>
          <span role="columnheader">observed</span>
        </div>
        {sources.map((source) => {
          const latest = source.samples.reduce<ReferenceSourceView["samples"][number] | null>(
            (best, sample) => (best === null || sample.sequence > best.sequence ? sample : best),
            null,
          );
          return (
            <div className="reference-row" key={source.sourceId} role="row">
              <span role="cell"><code>{shortId(source.sourceId)}</code></span>
              {/* Sources agree to ~3 decimals, so 2dp would collapse them all to "1"
                  and hide the dispersion the median and dispersion gate act on. */}
              <span role="cell">{latest ? wadToNumber(latest.priceWad).toLocaleString("en", { minimumFractionDigits: 6, maximumFractionDigits: 6 }) : "—"}</span>
              <span role="cell">{latest ? `${(wadToNumber(latest.confidenceWad) * 100).toFixed(0)}%` : "—"}</span>
              <span role="cell">{source.latestSequence}</span>
              <span role="cell">{latest ? age(generatedAt, latest.observedAt) : "—"}</span>
            </div>
          );
        })}
      </div>
      <p className="card-caption">
        The sampler publishes a fixed confidence of 1.0 per reading — it does not attenuate for depth,
        spread or age, so that column is a constant, not a quality score.
        One self-contained pair of project-issued tokens across three fee tiers, moved by the operator. It
        exercises the permissionless multi-source median, liquidity-floor, and dispersion path — it is not
        independent price discovery, and agreement between these sources is structural, not evidential.
      </p>
    </div>
  );
}
