type FeeState = { feePips: number; usedBaseline: boolean };

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

// Who is allowed to wake the executor, read from both sides. `rvmId` and
// `callbackProxy` are the executor's immutable guard values on the processor
// chain; `callback` is what the proven callback transaction actually presented,
// decoded from its own calldata. Equality between them is the authentication.
export type AuthenticationView = {
  rvmId: string;
  callbackProxy: string;
  transactionHash: string;
  callback: {
    to: string;
    targetArg: string;
    rvmArg: string;
    blockNumber: number | null;
    observedAt: number | null;
  } | null;
};

// The RSC's own NetworkConfig, read inside the ReactiveVM.
export type ReactiveNetworkConfigView = {
  monitoredChainId: number;
  destinationChainId: number;
  reactiveChainId: number;
  processor: string;
  executor: string;
  cronTopic: string;
  callbackGasLimit: number;
  epochDurationSeconds: number;
  retryDelaySeconds: number;
  maximumRetries: number;
};

// The earliest maturity across the processor's occupied pending slots. Present
// only when the queue is non-empty: with nothing pending the scan compares
// zero to zero and is not evidence of anything.
export type PendingMaturityView = {
  scannedSlots: number;
  activeSlots: number;
  earliestMatureAt: number | null;
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
  /** 0 Idle · 1 AwaitMaturity · 2 AwaitCycle · 3 AwaitFinalization · 4 Retry. */
  phase: number;
  /** The phase that issued the wake currently in flight. */
  triggerPhase: number;
  /** Unix seconds the next wake is due, or 0 when none is armed. */
  dueAt: number;
  /** Earliest maturity deferred behind the in-flight cycle, or 0. */
  queuedMaturityAt: number;
  networkConfig: ReactiveNetworkConfigView | null;
};

// The proven run, read back from its own six transactions. The gaps between
// them are the page's only quantitative statement about what the integration
// costs in wall-clock time.
export type RunTimelineStep = {
  index: number;
  role: "origin" | "processor";
  hash: string;
  blockNumber: number | null;
  observedAt: number | null;
  /** Seconds since the previous dated step; null where either end is missing. */
  gapSeconds: number | null;
  detail: string | null;
};

export type RunTimelineView = {
  steps: RunTimelineStep[];
  endToEndSeconds: number | null;
  /** False when any step failed to come back dated, so the total is partial. */
  complete: boolean;
};

export type LiveEvent = {
  kind: "swap" | "epoch" | "cycle" | "queued" | "expired" | "dropped" | "settled";
  blockNumber: number;
  logIndex: number;
  txHash: string;
  summary: string;
  observedAt: number | null;
};

// The most recent thing the system actually did, assembled from the queue's own
// lifecycle. The run timeline records the one run that succeeded; this records
// the latest attempt, including one that failed.
// One observation's whole life, read from the processor's own queue events:
// queued, then whichever of settled / expired / dropped it reached, with the
// transaction for each transition and the automation cycle that swept it.
export type ObservationRecordView = {
  observationId: number;
  side: "buy" | "sell";
  blockNumber: number;
  queuedAt: number | null;
  queuedTx: string;
  matureAt: number;
  expiresAt: number;
  outcome: "settled" | "expired" | "dropped" | "pending";
  outcomeAt: number | null;
  outcomeTx: string | null;
  outcomeDetail: string | null;
  sweptByCycle: number | null;
  sweptByReactive: boolean | null;
};

/** The newest record, under the name the live panel already imports. */
export type LatestAttemptView = ObservationRecordView;

// One bounded pass of the executor. Every field is rendered: a cycle that swept
// nothing is a fact about the scheduler, and the before/after pairs show it.
export type AutomationCycleRecordView = {
  cycleId: number;
  reactiveTrigger: boolean;
  publishedSources: number;
  syncedSources: number;
  pendingBefore: number;
  pendingAfter: number;
  settledBefore: number;
  settledAfter: number;
  expiredBefore: number;
  expiredAfter: number;
  recommendationBefore: number;
  recommendationAfter: number;
  samplerSucceeded: boolean;
  processSucceeded: boolean;
  recommendationDispatched: boolean;
  blockNumber: number;
  txHash: string;
  observedAt: number | null;
};

// Everything the processor has done since it was deployed. `complete` is false
// when the scan floor was the page cap rather than the deploy block, so the
// page can say "history from block N" instead of implying it covered all of it.
export type LedgerView = {
  observations: ObservationRecordView[];
  cycles: AutomationCycleRecordView[];
  totals: {
    queued: number;
    settled: number;
    expired: number;
    dropped: number;
    pending: number;
    cycles: number;
  };
  /** Terminal events whose queue event fell outside the scan. Zero is expected. */
  orphanTerminals: number;
  truncated: { observations: number; cycles: number };
  fromBlock: number;
  toBlock: number;
  complete: boolean;
};

export type EventsView = {
  origin: LiveEvent[];
  processor: LiveEvent[];
  latestAttempt: LatestAttemptView | null;
  ledger: LedgerView | null;
  window: { origin: number; processor: number };
  head: { origin: number; processor: number };
  scanned: { origin: boolean; processor: boolean };
};

export type LiveProof = {
  ok: true;
  schemaVersion?: number;
  generatedAt: string;
  poolId: string;
  readPath: "lens" | "historical-direct";
  recommendationExpired: boolean;
  /** Which clock decided `recommendationExpired`: the chain, or this host. */
  expiryBasis: "chain" | "host-clock";
  origin: {
    chainId: number;
    blockNumber: number;
    contractsHealthy: boolean;
    circlePeerSealed: boolean;
    finalizedThreshold: number;
    baselineFeePips: number;
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
  authentication: AuthenticationView | null;
  reactive: ReactiveView | null;
  pendingMaturity: PendingMaturityView | null;
  runTimeline: RunTimelineView | null;
  events: EventsView | null;
};

export function wadToNumber(value: string): number {
  return Number(value) / 1e18;
}

export function wadToBpsNumber(value: string): number {
  return Number(value) / 1e14;
}
