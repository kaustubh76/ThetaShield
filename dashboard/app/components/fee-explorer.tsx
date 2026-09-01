"use client";

import { useState } from "react";
import {
  WAD,
  calculateFee,
  deadBand,
  deadBandFilter,
  smoothDirectionalRisk,
  type FeeConfig,
} from "../fee-model";
import type { DeployedConfigView } from "./live-proof/types";

const WAD_PER_BPS = 100_000_000_000_000n; // 1e14

function bpsToWad(bps: number): bigint {
  return BigInt(Math.round(bps * 100)) * (WAD_PER_BPS / 100n);
}
function wadToBps(value: bigint): string {
  const hundredths = (value * 100n) / WAD_PER_BPS;
  return (Number(hundredths) / 100).toFixed(2);
}
function pipsToBps(pips: bigint): string {
  return (Number(pips) / 100).toFixed(2);
}
function wadToPercent(value: bigint): string {
  return ((Number(value) / Number(WAD)) * 100).toFixed(1);
}

// Every parameter comes from the deployed pool when a live read has landed, and
// from the locked research bundle otherwise. The two genuinely differ, so the
// panel says which one it used rather than blending them.
function resolveConfig(deployed: DeployedConfigView | null) {
  if (deployed) {
    return {
      source: "the deployed pool" as const,
      kWad: BigInt(deployed.scheduler.deadBandKWad),
      alphaWad: BigInt(deployed.scheduler.alphaWad),
      confidenceCapWad: BigInt(deployed.scheduler.confidenceCapWad),
      requiredToxicEpochs: deployed.scheduler.requiredToxicEpochs,
      persistenceWindow: deployed.scheduler.persistenceWindow,
      fee: {
        baseFeePips: BigInt(deployed.feeCurve.baseFeePips),
        minimumFeePips: BigInt(deployed.feeCurve.minimumFeePips),
        maximumFeePips: BigInt(deployed.feeCurve.maximumFeePips),
        gainFeePips: BigInt(deployed.feeCurve.gainFeePips),
        maximumIncreasePips: BigInt(deployed.feeCurve.maximumIncreasePips),
        maximumDecreasePips: BigInt(deployed.feeCurve.maximumDecreasePips),
        confidenceFloorWad: BigInt(deployed.feeCurve.confidenceFloorWad),
      } satisfies FeeConfig,
    };
  }
  // The research candidate, used until the chain read lands.
  return {
    source: "the research bundle" as const,
    kWad: WAD,
    alphaWad: WAD / 4n,
    confidenceCapWad: (WAD * 6n) / 10n,
    requiredToxicEpochs: 3,
    persistenceWindow: 5,
    fee: {
      baseFeePips: 500n,
      minimumFeePips: 500n,
      maximumFeePips: 10_000n,
      gainFeePips: 450_000n,
      maximumIncreasePips: 500n,
      maximumDecreasePips: 100n,
      confidenceFloorWad: WAD / 2n,
    } satisfies FeeConfig,
  };
}

export default function FeeExplorer({ deployedConfig }: { deployedConfig: DeployedConfigView | null }) {
  const [markoutBps, setMarkoutBps] = useState(64);
  const [sigmaBps, setSigmaBps] = useState(16);
  const [confidencePercent, setConfidencePercent] = useState(60);
  const [persistenceActive, setPersistenceActive] = useState(true);

  const config = resolveConfig(deployedConfig);
  const markoutWad = bpsToWad(markoutBps);
  const sigmaWad = bpsToWad(sigmaBps);
  const bandWad = deadBand(sigmaWad, config.kWad);
  const filteredWad = deadBandFilter(markoutWad, sigmaWad, config.kWad);
  const cappedConfidence = BigInt(Math.round(confidencePercent * 100)) * (WAD / 10_000n);
  const confidenceWad = cappedConfidence < config.confidenceCapWad ? cappedConfidence : config.confidenceCapWad;

  // One observation, from rest: the epoch aggregate is the filtered signal and
  // the carried EWMA magnitude starts at zero. The contract carries that
  // magnitude between epochs; the bundle does not record it, so the panel states
  // the assumption rather than inventing a value.
  const { magnitudeWad, signedRiskWad } = smoothDirectionalRisk({
    aggregateMarkoutWad: filteredWad,
    previousMagnitudeWad: 0n,
    alphaWad: config.alphaWad,
    confidenceWad,
  });
  const previousFeePips = config.fee.baseFeePips;
  const fee = calculateFee({
    signedRiskWad,
    confidenceWad,
    persistenceActive,
    previousFeePips,
    config: config.fee,
  });

  const survives = filteredWad !== 0n;
  const clearsFloor = confidenceWad >= config.fee.confidenceFloorWad;

  return (
    <div className="fee-explorer">
      <div className="fee-explorer-head">
        <span>WHAT WOULD THE POOL CHARGE?</span>
        <b>{`parameters from ${config.source}`}</b>
      </div>

      <div className="fee-explorer-inputs">
        <label>
          <span>Signed markout · bps</span>
          <input
            max={300}
            min={-300}
            onChange={(event) => setMarkoutBps(Number(event.target.value))}
            step={1}
            type="range"
            value={markoutBps}
          />
          <b>{markoutBps.toFixed(0)}</b>
        </label>
        <label>
          <span>Trailing sigma · bps</span>
          <input
            max={100}
            min={0}
            onChange={(event) => setSigmaBps(Number(event.target.value))}
            step={1}
            type="range"
            value={sigmaBps}
          />
          <b>{sigmaBps.toFixed(0)}</b>
        </label>
        <label>
          <span>Shared confidence · %</span>
          <input
            max={100}
            min={0}
            onChange={(event) => setConfidencePercent(Number(event.target.value))}
            step={1}
            type="range"
            value={confidencePercent}
          />
          <b>{wadToPercent(confidenceWad)}</b>
        </label>
        <button
          aria-pressed={persistenceActive}
          className={persistenceActive ? "fee-persist active" : "fee-persist"}
          onClick={() => setPersistenceActive((current) => !current)}
          type="button"
        >
          {`${config.requiredToxicEpochs}-of-${config.persistenceWindow} persistence ${persistenceActive ? "met" : "not met"}`}
        </button>
      </div>

      <ol className="fee-explorer-steps">
        <li>
          <span>dead band</span>
          <b>{`±${wadToBps(bandWad)}`}</b>
          <em>{`k ${(Number(config.kWad) / Number(WAD)).toFixed(2)} × sigma`}</em>
        </li>
        <li className={survives ? "" : "muted"}>
          <span>survives the filter</span>
          <b>{wadToBps(filteredWad)}</b>
          <em>{survives ? "signal" : "filtered as noise"}</em>
        </li>
        <li className={clearsFloor ? "" : "muted"}>
          <span>signed risk</span>
          <b>{wadToBps(signedRiskWad)}</b>
          <em>{`magnitude ${wadToBps(magnitudeWad)} × confidence`}</em>
        </li>
        <li className={fee.premiumPips > 0n ? "lit" : "muted"}>
          <span>premium</span>
          <b>{pipsToBps(fee.premiumPips)}</b>
          <em>{fee.premiumPips > 0n ? "risk × gain" : !persistenceActive ? "persistence gate" : !clearsFloor ? "below confidence floor" : "no positive risk"}</em>
        </li>
        <li className="result">
          <span>fee next swap</span>
          <b>{pipsToBps(fee.nextFeePips)}</b>
          <em>{fee.nextFeePips < fee.targetFeePips ? `rate-limited from ${pipsToBps(fee.targetFeePips)}` : "bps"}</em>
        </li>
      </ol>

      <p className="fee-explorer-note">
        Computed by the same curve the pool runs — this port is checked against
        <code> research/datasets/golden_vectors.json</code>, the vectors that also gate the Solidity and the
        Python. It assumes one observation from rest, because the contract carries an EWMA magnitude between
        epochs that the bundle does not record. It is what the deployed curve would return for these inputs,
        not a live quote.
      </p>
    </div>
  );
}
