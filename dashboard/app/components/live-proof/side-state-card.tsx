import type { CSSProperties } from "react";
import { wadToBpsNumber, wadToNumber, type DeployedConfigView, type SideStateView } from "./types";

function bitmapBits(bitmap: number, window: number): number[] {
  return Array.from({ length: window }, (_, index) =>
    Math.floor(bitmap / 2 ** (window - index - 1)) % 2,
  );
}

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

  return (
    <article className="side-card">
      <div className="card-title"><span>{label} · LIVE SIDE STATE</span><b>{side.epochOpen ? "epoch open" : "epoch idle"}</b></div>
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
      <dl className="side-facts">
        <div><dt>signed risk</dt><dd>{`${riskBps >= 0 ? "+" : "−"}${Math.abs(riskBps).toFixed(2)} bps`}</dd></div>
        <div><dt>calculated fee</dt><dd>{`${(side.latestCalculatedFeePips / 100).toFixed(2)} bps`}</dd></div>
        <div><dt>toxic premium</dt><dd>{`${(side.latestToxicPremiumPips / 100).toFixed(2)} bps`}</dd></div>
        <div><dt>fast path</dt><dd>{side.fastPathActive ? "active" : "idle"}</dd></div>
      </dl>
    </article>
  );
}
