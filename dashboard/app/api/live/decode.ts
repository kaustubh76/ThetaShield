// The ABI layer, split out of the route so it can be tested directly.
//
// These decoders carry ~30 hardcoded word offsets (and the scheduler/feeCurve
// base offsets below) which are the entire basis of the dashboard's "read the
// contracts" claim: a one-word layout drift in a redeployed lens would silently
// shift every displayed parameter with nothing to catch it. tests/live-decode
// exercises them against recorded on-chain responses.

const ABI_SIGN_BIT = BigInt("0x8000000000000000000000000000000000000000000000000000000000000000");
const ABI_UINT256_MODULUS = BigInt("0x10000000000000000000000000000000000000000000000000000000000000000");

export function words(data: string): string[] {
  const body = data.startsWith("0x") ? data.slice(2) : data;
  if (body.length === 0 || body.length % 64 !== 0) throw new Error("Invalid ABI response");
  return body.match(/.{64}/g) ?? [];
}

export function unsigned(word: string): number {
  const value = BigInt(`0x${word}`);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("ABI integer exceeds display range");
  return Number(value);
}

export function signed(word: string): string {
  const value = BigInt(`0x${word}`);
  const signedValue = value >= ABI_SIGN_BIT ? value - ABI_UINT256_MODULUS : value;
  return signedValue.toString();
}

export function decodeSingle(data: string): number {
  return unsigned(words(data)[0]);
}

export function decodeBool(data: string): boolean {
  return decodeSingle(data) !== 0;
}

export function decodeFee(data: string): { feePips: number; usedBaseline: boolean } {
  const decoded = words(data);
  return { feePips: unsigned(decoded[0]), usedBaseline: unsigned(decoded[1]) !== 0 };
}

export function decodeRecommendation(data: string) {
  const decoded = words(data);
  if (decoded.length !== 8) throw new Error("Unexpected recommendation response");

  return {
    zeroForOneFeePips: unsigned(decoded[0]),
    oneForZeroFeePips: unsigned(decoded[1]),
    zeroForOneRiskWad: signed(decoded[2]),
    oneForZeroRiskWad: signed(decoded[3]),
    confidenceBps: unsigned(decoded[4]),
    validAfter: unsigned(decoded[5]),
    validUntil: unsigned(decoded[6]),
    sequence: unsigned(decoded[7]),
  };
}

export function decodePoolConfig(data: string) {
  const decoded = words(data);
  if (decoded.length !== 7) throw new Error("Unexpected pool configuration response");
  return { baselineFeePips: unsigned(decoded[0]), poolPaused: unsigned(decoded[6]) !== 0 };
}

export function wadString(word: string): string {
  return BigInt(`0x${word}`).toString();
}

export function decodeSideState(decoded: string[], offset: number) {
  return {
    openEpochId: unsigned(decoded[offset]),
    lastFinalizedEpochId: unsigned(decoded[offset + 1]),
    epochObservationCount: unsigned(decoded[offset + 2]),
    persistenceBitmap: unsigned(decoded[offset + 6]),
    latestCoverageRatioWad: wadString(decoded[offset + 12]),
    latestRiskWad: signed(decoded[offset + 14]),
    latestConfidenceWad: wadString(decoded[offset + 15]),
    latestCalculatedFeePips: unsigned(decoded[offset + 16]),
    latestToxicPremiumPips: unsigned(decoded[offset + 17]),
    latestCoveragePremiumPips: unsigned(decoded[offset + 18]),
    persistenceActive: unsigned(decoded[offset + 19]) !== 0,
    fastPathActive: unsigned(decoded[offset + 20]) !== 0,
    epochOpen: unsigned(decoded[offset + 22]) !== 0,
  };
}

export function decodeDeployedConfig(decoded: string[]) {
  const scheduler = 58;
  const feeCurve = 88;
  return {
    scheduler: {
      markoutHorizonSeconds: unsigned(decoded[scheduler]),
      observationLifetimeSeconds: unsigned(decoded[scheduler + 1]),
      referenceSelectionWindowSeconds: unsigned(decoded[scheduler + 2]),
      epochDurationSeconds: unsigned(decoded[scheduler + 3]),
      recommendationLifetimeSeconds: unsigned(decoded[scheduler + 4]),
      maximumPendingObservations: unsigned(decoded[scheduler + 7]),
      maximumProcessPerCall: unsigned(decoded[scheduler + 8]),
      maximumEpochObservations: unsigned(decoded[scheduler + 9]),
      trailingWindow: unsigned(decoded[scheduler + 10]),
      minimumTrailingObservations: unsigned(decoded[scheduler + 11]),
      targetObservationCount: unsigned(decoded[scheduler + 12]),
      requiredToxicEpochs: unsigned(decoded[scheduler + 13]),
      persistenceWindow: unsigned(decoded[scheduler + 14]),
      fastPathHoldEpochs: unsigned(decoded[scheduler + 15]),
      maximumReferenceSamplesPerSource: unsigned(decoded[scheduler + 16]),
      minimumReferenceSources: unsigned(decoded[scheduler + 17]),
      fastPathEnabled: unsigned(decoded[scheduler + 18]) !== 0,
      deadBandKWad: wadString(decoded[scheduler + 23]),
      maximumDispersionWad: wadString(decoded[scheduler + 24]),
      confidenceCapWad: wadString(decoded[scheduler + 25]),
      toxicThresholdWad: wadString(decoded[scheduler + 26]),
      alphaWad: wadString(decoded[scheduler + 27]),
      fastPathConfidenceFloorWad: wadString(decoded[scheduler + 28]),
      fastPathToxicThresholdWad: wadString(decoded[scheduler + 29]),
    },
    feeCurve: {
      baseFeePips: unsigned(decoded[feeCurve]),
      minimumFeePips: unsigned(decoded[feeCurve + 1]),
      maximumFeePips: unsigned(decoded[feeCurve + 2]),
      gainFeePips: unsigned(decoded[feeCurve + 3]),
      coverageGainFeePips: unsigned(decoded[feeCurve + 4]),
      maximumIncreasePips: unsigned(decoded[feeCurve + 5]),
      maximumDecreasePips: unsigned(decoded[feeCurve + 6]),
      confidenceFloorWad: wadString(decoded[feeCurve + 7]),
      targetCoverageWad: wadString(decoded[feeCurve + 8]),
      minimumEstimatedLossWad: wadString(decoded[feeCurve + 9]),
    },
  };
}

export function decodeReferenceSource(sourceId: string, data: string) {
  const decoded = words(data);
  const base = 1; // word 0 is the offset to the snapshot tuple
  const recordsOffset = unsigned(decoded[base + 5]) / 32;
  const lengthIndex = base + recordsOffset;
  const length = unsigned(decoded[lengthIndex]);
  const samples = [];
  for (let index = 0; index < length; index += 1) {
    const at = lengthIndex + 1 + index * 4;
    samples.push({
      priceWad: wadString(decoded[at]),
      confidenceWad: wadString(decoded[at + 1]),
      observedAt: unsigned(decoded[at + 2]),
      sequence: unsigned(decoded[at + 3]),
    });
  }
  return {
    sourceId,
    configured: unsigned(decoded[base + 1]) !== 0,
    latestSequence: unsigned(decoded[base + 2]),
    samples,
  };
}

export function decodeCycleResult(data: string) {
  const decoded = words(data);
  if (decoded.length !== 15) throw new Error("Unexpected automation cycle response");
  return {
    cycleId: unsigned(decoded[0]),
    pendingBefore: unsigned(decoded[1]),
    pendingAfter: unsigned(decoded[2]),
    settledBefore: unsigned(decoded[3]),
    settledAfter: unsigned(decoded[4]),
    expiredBefore: unsigned(decoded[5]),
    expiredAfter: unsigned(decoded[6]),
    recommendationBefore: unsigned(decoded[7]),
    recommendationAfter: unsigned(decoded[8]),
    publishedSources: unsigned(decoded[9]),
    syncedSources: unsigned(decoded[10]),
    samplerSucceeded: unsigned(decoded[11]) !== 0,
    processSucceeded: unsigned(decoded[12]) !== 0,
    recommendationDispatched: unsigned(decoded[13]) !== 0,
    reactiveTrigger: unsigned(decoded[14]) !== 0,
  };
}

