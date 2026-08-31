export type FeeState = { feePips: number; usedBaseline: boolean };

export type SideStateView = {
  openEpochId: number;
  lastFinalizedEpochId: number;
  epochObservationCount: number;
  persistenceBitmap: number;
  latestCoverageRatioWad: string;
  latestRiskWad: string;
  latestConfidenceWad: string;
  latestCalculatedFeePips: number;
  latestToxicPremiumPips: number;
  latestCoveragePremiumPips: number;
  persistenceActive: boolean;
  fastPathActive: boolean;
  epochOpen: boolean;
};

export type DeployedConfigView = {
  scheduler: {
    markoutHorizonSeconds: number;
    observationLifetimeSeconds: number;
    referenceSelectionWindowSeconds: number;
    epochDurationSeconds: number;
    recommendationLifetimeSeconds: number;
    maximumPendingObservations: number;
    maximumProcessPerCall: number;
    maximumEpochObservations: number;
    trailingWindow: number;
    minimumTrailingObservations: number;
    targetObservationCount: number;
    requiredToxicEpochs: number;
    persistenceWindow: number;
    fastPathHoldEpochs: number;
    maximumReferenceSamplesPerSource: number;
    minimumReferenceSources: number;
    fastPathEnabled: boolean;
    deadBandKWad: string;
    maximumDispersionWad: string;
    confidenceCapWad: string;
    toxicThresholdWad: string;
    alphaWad: string;
    fastPathConfidenceFloorWad: string;
    fastPathToxicThresholdWad: string;
  };
  feeCurve: {
    baseFeePips: number;
    minimumFeePips: number;
    maximumFeePips: number;
    gainFeePips: number;
    coverageGainFeePips: number;
    maximumIncreasePips: number;
    maximumDecreasePips: number;
    confidenceFloorWad: string;
    targetCoverageWad: string;
    minimumEstimatedLossWad: string;
  };
};

export type ReferenceSourceView = {
  sourceId: string;
  configured: boolean;
  latestSequence: number;
  samples: { priceWad: string; confidenceWad: string; observedAt: number; sequence: number }[];
};

export type AutomationView = {
  cycleCount: number;
  lastCycle: {
    cycleId: number;
    pendingBefore: number;
    pendingAfter: number;
    settledBefore: number;
    settledAfter: number;
    expiredBefore: number;
    expiredAfter: number;
    recommendationBefore: number;
    recommendationAfter: number;
    publishedSources: number;
    syncedSources: number;
    samplerSucceeded: boolean;
    processSucceeded: boolean;
    recommendationDispatched: boolean;
    reactiveTrigger: boolean;
  };
};

export type ReactiveView = {
  // "rvm" is the correct read (rnk_call against the deployer's ReactiveVM, where
  // react() actually writes); "chain" is the degraded fallback, whose counters
  // are structurally always zero and must be labelled rather than believed.
  source: "rvm" | "chain";
  wakeRequestCount: number;
  observationSignalCount: number;
  consecutiveRetries: number;
  lastCycleId: number;
};

export type LiveEvent = {
  kind: "swap" | "epoch" | "cycle";
  blockNumber: number;
  logIndex: number;
  txHash: string;
  summary: string;
  observedAt: number | null;
};

export type EventsView = {
  origin: LiveEvent[];
  processor: LiveEvent[];
  window: { origin: number; processor: number };
  scanned: { origin: boolean; processor: boolean };
};

export type LiveProof = {
  ok: true;
  schemaVersion?: number;
  generatedAt: string;
  poolId: string;
  readPath: "lens" | "historical-direct";
  recommendationExpired: boolean;
  origin: {
    chainId: number;
    blockNumber: number;
    contractsHealthy: boolean;
    circlePeerSealed: boolean;
    finalizedThreshold: number;
    baselineFeePips: number;
    configured: boolean;
    globallyPaused: boolean;
    poolPaused: boolean;
    observationCount: number;
    buy: FeeState;
    sell: FeeState;
    lastSequence: number;
    recommendation: {
      zeroForOneFeePips: number;
      oneForZeroFeePips: number;
      zeroForOneRiskWad: string;
      oneForZeroRiskWad: string;
      confidenceBps: number;
      validAfter: number;
      validUntil: number;
      sequence: number;
      secondsUntilExpiry: number;
    };
  };
  processor: {
    chainId: number;
    blockNumber: number;
    contractHealthy: boolean;
    pendingCount: number;
    settledCount: number;
    expiredCount: number;
    lastObservationId: number;
    recommendationSequence: number;
    droppedCount: number | null;
    referenceSourceCount: number | null;
    sides: { buy: SideStateView; sell: SideStateView } | null;
    deployedConfig: DeployedConfigView | null;
  };
  referenceSources: ReferenceSourceView[] | null;
  automation: AutomationView | null;
  reactive: ReactiveView | null;
  events: EventsView | null;
};

export function wadToNumber(value: string): number {
  return Number(value) / 1e18;
}

export function wadToBpsNumber(value: string): number {
  return Number(value) / 1e14;
}
