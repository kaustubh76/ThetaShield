import type { DeploymentView } from "../../deployment-data";
import { age, shortHex } from "../format";
import { wadToNumber, type ReferenceSourceView } from "./types";

export default function ReferenceSources({
  sources,
  generatedAt,
  deployment,
  registeredCount,
}: {
  sources: ReferenceSourceView[];
  generatedAt: string;
  deployment: DeploymentView;
  registeredCount: number | null;
}) {
  const floors = [...new Set(deployment.referenceSampler.sources.map((source) => source.minimumLiquidity))];
  const liquidityFloor = floors
    .map((value) => `${Number(value) / 1e18}`)
    .join(" / ");

  return (
    <div className="reference-sources">
      <div className="card-title">
        <span>{`REFERENCE SOURCES · ${deployment.profile.name}`}</span>
        <b>
          {registeredCount === null || registeredCount === sources.length
            ? `${sources.length} liquidity-qualified v4 pools`
            : `${sources.length} readable of ${registeredCount} registered v4 pools`}
        </b>
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
              <span role="cell"><code>{shortHex(source.sourceId, 10, 6)}</code></span>
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
        {`${deployment.referenceSampler.mode} sampler · market `}
        <code title={deployment.referenceSampler.marketId}>{shortHex(deployment.referenceSampler.marketId, 10, 6)}</code>
        {` · liquidity floor ${liquidityFloor} per source, which is what "liquidity-qualified" means here.`}
      </p>
      <p className="card-caption">
        The sampler publishes a fixed confidence of 1.0 per reading — it does not attenuate for depth,
        spread or age, so that column is a constant, not a quality score.
        {` One self-contained pair of project-issued tokens across ${deployment.referenceSampler.sources.length} fee tiers, moved by the operator. It`}
        exercises the permissionless multi-source median, liquidity-floor, and dispersion path — it is not
        independent price discovery, and agreement between these sources is structural, not evidential.
      </p>
    </div>
  );
}
