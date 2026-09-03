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


// An ABI address occupies the low 20 bytes of its word. Returned lower-cased so
// the agreement checks in the UI compare bytes rather than checksum casing.
export function addressFromWord(word: string): string {
  if (!/^0{24}[0-9a-fA-F]{40}$/.test(word)) throw new Error("Word is not an ABI address");
  return `0x${word.slice(24).toLowerCase()}`;
}

// ThetaShieldAutomationRSC.NetworkConfig, in declaration order. This is the
// RSC's own view of the deployment: it names the processor and executor it
// drives and the cron topic it is subscribed to, so reading it inside the RVM
// is what lets the page check the two planes against each other rather than
// assert their agreement from the manifest.
export function decodeNetworkConfig(data: string) {
  const decoded = words(data);
  if (decoded.length !== 10) throw new Error("Unexpected network config response");
  return {
    monitoredChainId: unsigned(decoded[0]),
    destinationChainId: unsigned(decoded[1]),
    reactiveChainId: unsigned(decoded[2]),
    processor: addressFromWord(decoded[3]),
    executor: addressFromWord(decoded[4]),
    cronTopic: `0x${decoded[5]}`,
    callbackGasLimit: unsigned(decoded[6]),
    epochDurationSeconds: unsigned(decoded[7]),
    retryDelaySeconds: unsigned(decoded[8]),
    maximumRetries: unsigned(decoded[9]),
  };
}

// The Reactive callback proxy's entry point, and the executor entry point it
// wraps. Both are checked rather than assumed: a proxy that called anything
// else would not be evidence of an authenticated wake.
export const CALLBACK_PROXY_SELECTOR = "0x246a9512"; // callback(address,bytes)
export const EXECUTE_FROM_REACTIVE_SELECTOR = "0x997ce1d5"; // executeFromReactive(address)

type RawTransaction = {
  to?: string | null;
  input?: string;
  blockNumber?: string | null;
  blockTimestamp?: string | null;
};

// Pulls the two authenticated terms out of the proven callback's own calldata:
// which executor the proxy was asked to call, and which RVM id it presented.
// The executor's rvmIdOnly / authorizedSenderOnly guards compare exactly these
// against its immutable getters, so decoding them turns "callbacks are
// authenticated" into a comparison the page can run.
//
// Read with eth_getTransactionByHash, never eth_getTransactionReceipt: public
// Sepolia providers prune the receipt index and answer null for this hash while
// still returning the full mined transaction.
export function decodeReactiveCallback(raw: RawTransaction) {
  const input = raw.input ?? "";
  if (!raw.to || !input.startsWith(CALLBACK_PROXY_SELECTOR)) {
    throw new Error("Callback transaction is not a Reactive proxy callback");
  }
  const head = words(`0x${input.slice(10)}`.padEnd(2, "0"));
  const targetArg = addressFromWord(head[0]);
  // The payload is a dynamic bytes argument: word 1 holds its byte offset from
  // the start of the argument block, then a length word, then the payload.
  const payloadOffsetBytes = unsigned(head[1]);
  const lengthCursor = 10 + payloadOffsetBytes * 2;
  const payloadLength = unsigned(input.slice(lengthCursor, lengthCursor + 64));
  const payload = input.slice(lengthCursor + 64, lengthCursor + 64 + payloadLength * 2);
  if (!payload.startsWith(EXECUTE_FROM_REACTIVE_SELECTOR.slice(2))) {
    throw new Error("Callback payload does not call executeFromReactive");
  }
  return {
    to: raw.to.toLowerCase(),
    targetArg,
    rvmArg: addressFromWord(payload.slice(8, 72)),
    blockNumber: raw.blockNumber ? unsigned(raw.blockNumber.slice(2)) : null,
    // blockTimestamp is a provider extension, not part of the JSON-RPC spec, so
    // its absence must degrade rather than fail the whole decode.
    observedAt: raw.blockTimestamp ? unsigned(raw.blockTimestamp.slice(2)) : null,
  };
}

// A run-timeline gap belongs to exactly one pair of ADJACENT steps, and is
// stated only when both ends came back dated. Carrying the last known time
// forward across an undated step would label a connector with an interval that
// skips a step the reader can see it skipping — a measurement of something
// other than what it sits between.
export function fillTimelineGaps<T extends { observedAt: number | null; gapSeconds: number | null }>(
  steps: T[],
): T[] {
  for (let index = 1; index < steps.length; index += 1) {
    const previous = steps[index - 1].observedAt;
    const current = steps[index].observedAt;
    steps[index].gapSeconds = previous !== null && current !== null ? current - previous : null;
  }
  return steps;
}

// ---------------------------------------------------------------------------
// The execution log.
//
// The processor's queue events are the only durable record of what the system
// has actually done: the manifest records the one run that succeeded, these
// record every run, including the ones that died unscored. Correlation lives
// here rather than in the route so it can be tested without a chain.

export type EventLog = {
  topics: string[];
  data: string;
  blockNumber: string;
  logIndex?: string;
  transactionHash: string;
};

// DropReason in declaration order (Capacity, InvalidMarkout, EpochCapacity).
// An unknown index is named rather than dropped: a reason we cannot read is a
// different finding from a reason that does not exist.
export const DROP_REASONS = ["queue capacity", "markout out of bounds", "epoch capacity"] as const;

export function dropReason(word: string): string {
  return DROP_REASONS[unsigned(word)] ?? "unknown reason";
}

// zeroForOne is the sell side. Named here once so the ledger's rows and the
// ticker's summaries cannot disagree about which direction an id belongs to.
function sideOf(topic: string): "buy" | "sell" {
  return BigInt(topic) !== BigInt(0) ? "sell" : "buy";
}

const blockOf = (log: EventLog) => Number(BigInt(log.blockNumber));
const idOf = (log: EventLog) => Number(BigInt(log.topics[1]));

// ObservationQueued(uint64 indexed, uint16 indexed, bool indexed, uint128,
// uint128, uint64 matureAt, uint64 expiresAt) — the two deadlines are words
// 2 and 3, after the price and notional.
export function decodeQueuedLog(log: EventLog) {
  const body = words(log.data);
  return {
    observationId: idOf(log),
    side: sideOf(log.topics[3]),
    matureAt: unsigned(body[2]),
    expiresAt: unsigned(body[3]),
    blockNumber: blockOf(log),
    queuedTx: log.transactionHash,
  };
}

// AutomationCycleCompleted(uint64 indexed, address indexed, bool indexed, then
// 13 non-indexed words). Every one is rendered: a cycle that swept nothing is
// a fact about the scheduler, and the before/after pairs are what show it.
export function decodeCycleLog(log: EventLog) {
  const body = words(log.data);
  return {
    cycleId: idOf(log),
    // topic_3 == 1 means the cycle came through executeFromReactive; 0 means a
    // permissionless keeper advanced the same bounded work instead.
    reactiveTrigger: BigInt(log.topics[3]) !== BigInt(0),
    publishedSources: unsigned(body[0]),
    syncedSources: unsigned(body[1]),
    pendingBefore: unsigned(body[2]),
    pendingAfter: unsigned(body[3]),
    settledBefore: unsigned(body[4]),
    settledAfter: unsigned(body[5]),
    expiredBefore: unsigned(body[6]),
    expiredAfter: unsigned(body[7]),
    recommendationBefore: unsigned(body[8]),
    recommendationAfter: unsigned(body[9]),
    samplerSucceeded: unsigned(body[10]) !== 0,
    processSucceeded: unsigned(body[11]) !== 0,
    recommendationDispatched: unsigned(body[12]) !== 0,
    blockNumber: blockOf(log),
    txHash: log.transactionHash,
  };
}

// Bounded so the payload cannot grow without limit as the deployment runs —
// there is no persistence layer to prune it later.
export const LEDGER_MAX_OBSERVATIONS = 100;
export const LEDGER_MAX_CYCLES = 100;

export type ObservationRecord = ReturnType<typeof decodeQueuedLog> & {
  queuedAt: number | null;
  outcome: "settled" | "expired" | "dropped" | "pending";
  outcomeAt: number | null;
  outcomeTx: string | null;
  outcomeDetail: string | null;
  sweptByCycle: number | null;
  sweptByReactive: boolean | null;
};

export type CycleRecord = ReturnType<typeof decodeCycleLog> & { observedAt: number | null };

export function correlateObservations(
  logs: {
    queued: EventLog[];
    settled: EventLog[];
    expired: EventLog[];
    dropped: EventLog[];
    cycles: EventLog[];
  },
  timeOf: (log: EventLog) => number | null,
) {
  const cycles: CycleRecord[] = logs.cycles
    .map((log) => ({ ...decodeCycleLog(log), observedAt: timeOf(log) }))
    .sort((left, right) => right.cycleId - left.cycleId);

  const observations: ObservationRecord[] = logs.queued
    .map((log) => {
      const queued = decodeQueuedLog(log);
      const sameId = (candidate: EventLog) => idOf(candidate) === queued.observationId;
      const expired = logs.expired.find(sameId) ?? null;
      const dropped = logs.dropped.find(sameId) ?? null;
      // ObservationSettled names the observation directly. Inferring success
      // from EpochFinalized was wrong: one observation settles into an OPEN
      // epoch without finalising one, so a scored observation reported as still
      // pending — seen live on 2026-09-01 with observation 4.
      const settled = logs.settled.find(sameId) ?? null;
      const outcomeLog = expired ?? dropped ?? settled;
      // Matched on transaction, not block: the executor emits its cycle event
      // in the same transaction that sweeps the observation, whereas two
      // transactions sharing a block would attribute the sweep to whichever
      // cycle happened to land alongside it.
      const sweep = outcomeLog
        ? cycles.find((cycle) => cycle.txHash === outcomeLog.transactionHash) ?? null
        : null;
      return {
        ...queued,
        queuedAt: timeOf(log),
        outcome: expired ? "expired" : dropped ? "dropped" : settled ? "settled" : "pending",
        outcomeAt: outcomeLog ? timeOf(outcomeLog) : null,
        outcomeTx: outcomeLog?.transactionHash ?? null,
        outcomeDetail: dropped ? dropReason(words(dropped.data)[0]) : null,
        sweptByCycle: sweep ? sweep.cycleId : null,
        sweptByReactive: sweep ? sweep.reactiveTrigger : null,
      } satisfies ObservationRecord;
    })
    .sort((left, right) => right.observationId - left.observationId);

  // A terminal event whose queue event fell outside the scan is counted, not
  // synthesised: matureAt and expiresAt exist only on the queued log, so a
  // half-record would render deadlines it never read.
  const queuedIds = new Set(observations.map((record) => record.observationId));
  const orphanTerminals = [...logs.settled, ...logs.expired, ...logs.dropped].filter(
    (log) => !queuedIds.has(idOf(log)),
  ).length;

  const totals = {
    queued: observations.length,
    settled: observations.filter((record) => record.outcome === "settled").length,
    expired: observations.filter((record) => record.outcome === "expired").length,
    dropped: observations.filter((record) => record.outcome === "dropped").length,
    pending: observations.filter((record) => record.outcome === "pending").length,
    cycles: cycles.length,
  };

  return {
    observations: observations.slice(0, LEDGER_MAX_OBSERVATIONS),
    cycles: cycles.slice(0, LEDGER_MAX_CYCLES),
    totals,
    orphanTerminals,
    truncated: {
      observations: Math.max(0, observations.length - LEDGER_MAX_OBSERVATIONS),
      cycles: Math.max(0, cycles.length - LEDGER_MAX_CYCLES),
    },
  };
}

// eth_getLogs ranges are inclusive at both ends, so a page spans `window`
// blocks, not window + 1. Pages run oldest-first so a partial failure is a hole
// at a known depth rather than an unlabelled gap.
export function pageRanges(from: number, to: number, window: number): [number, number][] {
  const pages: [number, number][] = [];
  for (let start = from; start <= to; start += window) {
    pages.push([start, Math.min(start + window - 1, to)]);
  }
  return pages;
}
