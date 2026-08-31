import type { CSSProperties } from "react";
import { bitmapBits, feeBps as bps, formatInt, signedFixed } from "../format";
import { wadToBpsNumber, wadToNumber, type DeployedConfigView, type SideStateView } from "./types";

export default function SideStateCard({
  label,
  side,
  config,
}: {
  label: string;
  side: SideStateView;
  config: DeployedConfigView;
}) {
  const window = Math.max(1, config.scheduler.persistenceWindow);
  const required = config.scheduler.requiredToxicEpochs;
  const bits = bitmapBits(side.persistenceBitmap, window);
  const litCount = bits.reduce((total, bit) => total + bit, 0);
  const confidencePercent = wadToNumber(side.latestConfidenceWad) * 100;
  const capPercent = wadToNumber(config.scheduler.confidenceCapWad) * 100;
  const floorPercent = wadToNumber(config.feeCurve.confidenceFloorWad) * 100;
  const riskBps = wadToBpsNumber(side.latestRiskWad);

  // The fee the processor calculated is base + the two premiums, then clamped by
  // the deployed per-update limits. The remainder is shown rather than assumed
  // away, so a clamped update is visible instead of silently rebalancing the bar.
  const basePips = config.feeCurve.baseFeePips;
  const toxicPips = side.latestToxicPremiumPips;
  const coveragePips = side.latestCoveragePremiumPips;
  const calculatedPips = side.latestCalculatedFeePips;
  const componentTotal = basePips + toxicPips + coveragePips;
  const clampPips = calculatedPips - componentTotal;
  const barTotal = Math.max(calculatedPips, componentTotal, 1);
  const width = (pips: number) => `${Math.max(0, (pips / barTotal) * 100)}%`;

  // Epoch ids are derived from block time divided by the deployed epoch
  // duration, so they are large and only meaningful as identifiers. Zero means
  // "none", which must not render as epoch number zero.
  const finalizedLabel = side.lastFinalizedEpochId
    ? `last finalized #${formatInt(side.lastFinalizedEpochId)}`
    : "none finalized yet";
  const epochLine = side.epochOpen
    ? `open epoch #${formatInt(side.openEpochId)} · ${side.epochObservationCount} of ${config.scheduler.maximumEpochObservations} observations · ${finalizedLabel}`
    : `no open epoch · ${finalizedLabel}`;

  const coverageRatioPercent = wadToNumber(side.latestCoverageRatioWad) * 100;
  const targetCoveragePercent = wadToNumber(config.feeCurve.targetCoverageWad) * 100;

  return (
    <article className="side-card">
      <div className="card-title"><span>{label} · LIVE SIDE STATE</span><b>{side.epochOpen ? "epoch open" : "epoch idle"}</b></div>
      <p className="side-epochs">{epochLine}</p>
      <div className="side-persistence">
        <span>{`persistence ${litCount} of ${required} needed · window ${window}`}</span>
        <div className="bit-cells" role="img" aria-label={`${litCount} of ${window} persistence epochs currently flagged toxic; ${required} are required for activation.`}>
          {bits.map((bit, index) => (
            <i className={bit ? "lit" : ""} key={index} />
          ))}
        </div>
        <b className={side.persistenceActive ? "flag on" : "flag"}>
          {side.persistenceActive ? "persistence active" : "persistence inactive"}
        </b>
      </div>
      <div className="conf-gauge">
        <span>{`mechanical confidence · floor ${floorPercent.toFixed(0)}% · cap ${capPercent.toFixed(0)}%`}</span>
        <div
          className="conf-track"
          style={{
            "--value": `${Math.min(100, confidencePercent).toFixed(1)}%`,
            "--floor": `${floorPercent}%`,
            "--cap": `${Math.min(100, capPercent)}%`,
          } as CSSProperties}
        >
          <i /><em className="floor-mark" /><em className="cap-mark" />
        </div>
        <b>{`${confidencePercent.toFixed(1)}%`}</b>
      </div>
      <div className="fee-stack">
        <span>{`calculated fee ${bps(calculatedPips)} bps · decomposition`}</span>
        <div
          className="fee-stack-bar"
          role="img"
          aria-label={`Calculated fee ${bps(calculatedPips)} bps: base ${bps(basePips)}, toxic premium ${bps(toxicPips)}, coverage premium ${bps(coveragePips)} bps${clampPips < 0 ? `, clamped down ${bps(-clampPips)} bps by the deployed per-update limit` : ""}.`}
        >
          <i className="seg-base" style={{ width: width(basePips) }} />
          <i className="seg-toxic" style={{ width: width(toxicPips) }} />
          <i className="seg-coverage" style={{ width: width(coveragePips) }} />
        </div>
        <ul className="fee-stack-key">
          <li className="seg-base"><b>{bps(basePips)}</b>base</li>
          <li className="seg-toxic"><b>{bps(toxicPips)}</b>toxic premium</li>
          <li className="seg-coverage"><b>{bps(coveragePips)}</b>coverage premium</li>
        </ul>
        {clampPips !== 0 ? (
          <p className="fee-stack-clamp">
            {clampPips < 0
              ? `clamped down ${bps(-clampPips)} bps · deployed limit ${bps(config.feeCurve.maximumDecreasePips)} bps per update`
              : `clamped up ${bps(clampPips)} bps · deployed limit ${bps(config.feeCurve.maximumIncreasePips)} bps per update`}
          </p>
        ) : null}
      </div>
      <dl className="side-facts">
        <div><dt>signed risk</dt><dd>{`${signedFixed(riskBps)} bps`}</dd></div>
        <div>
          <dt>coverage ratio</dt>
          <dd className={coverageRatioPercent < targetCoveragePercent ? "warn" : ""}>
            {`${coverageRatioPercent.toFixed(1)}% / ${targetCoveragePercent.toFixed(0)}% target`}
          </dd>
        </div>
        <div><dt>fast path</dt><dd>{side.fastPathActive ? "active" : "idle"}</dd></div>
      </dl>
    </article>
  );
}
