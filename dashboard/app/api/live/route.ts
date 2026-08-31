import { NextResponse } from "next/server";
import {
  ADDRESSES,
  EVENT_TOPICS,
  POOL_ID,
  READ_PATH,
  REACTIVE_RVM_ID,
  REFERENCE_SOURCE_IDS,
  RPC,
} from "../../live-config";

export const dynamic = "force-dynamic";

const ORIGIN_RPC = RPC.origin;
const PROCESSOR_RPC = RPC.processor;
const REACTIVE_RPC = RPC.reactive;
const EXECUTOR = ADDRESSES.executor;
const REACTIVE_RSC = ADDRESSES.reactiveRsc;
const ORIGIN_LENS = ADDRESSES.originLens;
const PROCESSOR_LENS = ADDRESSES.processorLens;
const HOOK = ADDRESSES.hook;
const CONTROLLER = ADDRESSES.controller;
const TRANSPORT = ADDRESSES.transport;
const PROCESSOR = ADDRESSES.processor;
const ABI_SIGN_BIT = BigInt("0x8000000000000000000000000000000000000000000000000000000000000000");
const ABI_UINT256_MODULUS = BigInt("0x10000000000000000000000000000000000000000000000000000000000000000");

const selectors = {
  observationCount: "0x2ed9666f",
  feeForSwap: "0xc5ce25d1",
  currentRecommendation: "0xda3ec87d",
  globallyPaused: "0x08ce3fb5",
  lastSequence: "0x4462f69c",
  originLensState: "0x79ea5ae6",
  poolConfig: "0x0885f732",
  processorLensState: "0xb26921c5",
  circlePeerSealed: "0x136f296d",
  pendingCount: "0xea70b4af",
  settledObservationCount: "0x9bd6496d",
  expiredObservationCount: "0x3886a4fa",
  lastObservationId: "0xbf076a47",
  recommendationSequence: "0xd683a5c8",
  referenceSourceState: "0x57c191ae",
  cycleCount: "0x316fda0f",
  lastCycleResult: "0xd7fe3220",
  wakeRequestCount: "0xfcfaf7be",
  observationSignalCount: "0xb8eb92d8",
  consecutiveRetries: "0x84e35204",
  lastCycleId: "0x74a12a33",
} as const;

const eventTopics = EVENT_TOPICS;

// Per-chain eth_getLogs range caps, verified against the deployed public RPCs:
// Unichain Sepolia rejects anything over 10,000 blocks ("block range greater
// than 10000 max"); Ethereum Sepolia via publicnode accepts 50,000.
const ORIGIN_EVENT_WINDOW = 10_000;
const PROCESSOR_EVENT_WINDOW = 50_000;

function addressWord(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`Invalid contract address: ${address}`);
  return address.slice(2).padStart(64, "0");
}

type JsonRpcEnvelope<T> = {
  result?: T;
  error?: { code: number; message: string };
};

function encodeBytes32Call(selector: string, value: string): string {
  return `${selector}${value.slice(2).padStart(64, "0")}`;
}

function encodeFeeCall(zeroForOne: boolean): string {
  return `${selectors.feeForSwap}${POOL_ID.slice(2)}${(zeroForOne ? "1" : "0").padStart(64, "0")}`;
}

function encodeOriginLensCall(): string {
  return `${selectors.originLensState}${addressWord(CONTROLLER)}${addressWord(HOOK)}${POOL_ID.slice(2)}`;
}

function encodeProcessorLensCall(): string {
  return `${selectors.processorLensState}${addressWord(PROCESSOR)}`;
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const envelope = (await response.json()) as JsonRpcEnvelope<T>;
    if (envelope.error) throw new Error(envelope.error.message);
    if (envelope.result === undefined) throw new Error("RPC result missing");
    return envelope.result;
  } finally {
    clearTimeout(timeout);
  }
}

function call(url: string, to: string, data: string): Promise<string> {
  return rpc<string>(url, "eth_call", [{ to, data }, "latest"]);
}

type BatchCall = { method: string; params: unknown[] };

// One HTTP round trip per chain instead of one per getter: the panel issues a
// dozen reads and the providers all accept JSON-RPC 2.0 batches.
async function rpcBatch(url: string, calls: BatchCall[]): Promise<unknown[]> {
  if (!calls.length) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(calls.map((entry, index) => ({ jsonrpc: "2.0", id: index, ...entry }))),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const payload = (await response.json()) as JsonRpcEnvelope<unknown>[] | JsonRpcEnvelope<unknown>;
    if (!Array.isArray(payload)) throw new Error("RPC batch response was not an array");
    const ordered = new Array<unknown>(calls.length);
    for (const [index, entry] of payload.entries()) {
      const slot = typeof (entry as { id?: number }).id === "number" ? (entry as { id: number }).id : index;
      if (entry.error) throw new Error(entry.error.message);
      if (entry.result === undefined) throw new Error("RPC result missing");
      ordered[slot] = entry.result;
    }
    return ordered;
  } finally {
    clearTimeout(timeout);
  }
}

// Falls back to individual requests if a provider ever rejects batching.
async function batchOrSingle(url: string, calls: BatchCall[]): Promise<unknown[]> {
  try {
    return await rpcBatch(url, calls);
  } catch {
    return Promise.all(calls.map((entry) => rpc<unknown>(url, entry.method, entry.params)));
  }
}

function callOf(to: string, data: string): BatchCall {
  return { method: "eth_call", params: [{ to, data }, "latest"] };
}

// Reactive Network runs an RSC's react() inside the deployer's ReactiveVM, so
// every counter react() touches lives in RVM state. A plain eth_call against the
// contract's Lasna address reads the chain-side copy, which those writes never
// reach and which therefore answers zero forever. rnk_call is the RVM-scoped
// equivalent and returns what the RSC actually recorded.
function rvmCallOf(to: string, data: string): BatchCall {
  return { method: "rnk_call", params: [REACTIVE_RVM_ID, { to, data }, "latest"] };
}

function words(data: string): string[] {
  const body = data.startsWith("0x") ? data.slice(2) : data;
  if (body.length === 0 || body.length % 64 !== 0) throw new Error("Invalid ABI response");
  return body.match(/.{64}/g) ?? [];
}

function unsigned(word: string): number {
  const value = BigInt(`0x${word}`);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("ABI integer exceeds display range");
  return Number(value);
}

function signed(word: string): string {
  const value = BigInt(`0x${word}`);
  const signedValue = value >= ABI_SIGN_BIT ? value - ABI_UINT256_MODULUS : value;
  return signedValue.toString();
}

function decodeSingle(data: string): number {
  return unsigned(words(data)[0]);
}

function decodeBool(data: string): boolean {
  return decodeSingle(data) !== 0;
}

function decodeFee(data: string): { feePips: number; usedBaseline: boolean } {
  const decoded = words(data);
  return { feePips: unsigned(decoded[0]), usedBaseline: unsigned(decoded[1]) !== 0 };
}

function decodeRecommendation(data: string) {
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

function decodePoolConfig(data: string) {
  const decoded = words(data);
  if (decoded.length !== 7) throw new Error("Unexpected pool configuration response");
  return { baselineFeePips: unsigned(decoded[0]), poolPaused: unsigned(decoded[6]) !== 0 };
}

function wadString(word: string): string {
  return BigInt(`0x${word}`).toString();
}

function decodeSideState(decoded: string[], offset: number) {
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

function decodeDeployedConfig(decoded: string[]) {
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

function decodeReferenceSource(sourceId: string, data: string) {
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

function decodeCycleResult(data: string) {
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

function hasCode(code: string): boolean {
  return code !== "0x" && code !== "0x0";
}

function optional<T>(work: Promise<T>, timeoutMs: number): Promise<T | null> {
  return Promise.race([
    work.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

// The deployed TokenConfig sets baseIsToken0 = true, so a zeroForOne swap SELLS
// the base token (processor traderDirection −1) and oneForZero BUYS it. The
// "buy"/"sell" fields exposed below use base-buy / base-sell semantics:
// buy ↔ oneForZero, sell ↔ zeroForOne.
async function readOrigin() {
  const [chainIdHex, blockHex, hookCode, controllerCode, transportCode, observationData, zeroForOneFeeData, oneForZeroFeeData, recommendationData, sequenceData, peerData, configData, globallyPausedData] =
    await Promise.all([
      rpc<string>(ORIGIN_RPC, "eth_chainId", []),
      rpc<string>(ORIGIN_RPC, "eth_blockNumber", []),
      rpc<string>(ORIGIN_RPC, "eth_getCode", [HOOK, "latest"]),
      rpc<string>(ORIGIN_RPC, "eth_getCode", [CONTROLLER, "latest"]),
      rpc<string>(ORIGIN_RPC, "eth_getCode", [TRANSPORT, "latest"]),
      call(ORIGIN_RPC, HOOK, encodeBytes32Call(selectors.observationCount, POOL_ID)),
      call(ORIGIN_RPC, CONTROLLER, encodeFeeCall(true)),
      call(ORIGIN_RPC, CONTROLLER, encodeFeeCall(false)),
      call(ORIGIN_RPC, CONTROLLER, encodeBytes32Call(selectors.currentRecommendation, POOL_ID)),
      call(ORIGIN_RPC, CONTROLLER, encodeBytes32Call(selectors.lastSequence, POOL_ID)),
      call(ORIGIN_RPC, CONTROLLER, selectors.circlePeerSealed),
      call(ORIGIN_RPC, CONTROLLER, encodeBytes32Call(selectors.poolConfig, POOL_ID)),
      call(ORIGIN_RPC, CONTROLLER, selectors.globallyPaused),
    ]);

  const decodedRecommendation = decodeRecommendation(recommendationData);
  const config = decodePoolConfig(configData);
  const now = Math.floor(Date.now() / 1_000);

  return {
    chainId: Number(BigInt(chainIdHex)),
    blockNumber: Number(BigInt(blockHex)),
    contractsHealthy: hasCode(hookCode) && hasCode(controllerCode) && hasCode(transportCode),
    circlePeerSealed: decodeBool(peerData),
    baselineFeePips: config.baselineFeePips,
    configured: true,
    globallyPaused: decodeBool(globallyPausedData),
    poolPaused: config.poolPaused,
    observationCount: decodeSingle(observationData),
    buy: decodeFee(oneForZeroFeeData),
    sell: decodeFee(zeroForOneFeeData),
    lastSequence: decodeSingle(sequenceData),
    recommendation: {
      ...decodedRecommendation,
      secondsUntilExpiry: Math.max(0, decodedRecommendation.validUntil - now),
    },
  };
}

async function readOriginLens() {
  const [chainIdHex, blockHex, lensCode, hookCode, controllerCode, transportCode, snapshotData, peerData, recommendationData] =
    (await batchOrSingle(ORIGIN_RPC, [
      { method: "eth_chainId", params: [] },
      { method: "eth_blockNumber", params: [] },
      { method: "eth_getCode", params: [ORIGIN_LENS, "latest"] },
      { method: "eth_getCode", params: [HOOK, "latest"] },
      { method: "eth_getCode", params: [CONTROLLER, "latest"] },
      { method: "eth_getCode", params: [TRANSPORT, "latest"] },
      callOf(ORIGIN_LENS, encodeOriginLensCall()),
      callOf(CONTROLLER, selectors.circlePeerSealed),
      callOf(CONTROLLER, encodeBytes32Call(selectors.currentRecommendation, POOL_ID)),
    ])) as string[];
  const decoded = words(snapshotData);
  if (decoded.length !== 14) throw new Error("Unexpected origin lens response");
  const decodedRecommendation = decodeRecommendation(recommendationData);

  return {
    chainId: Number(BigInt(chainIdHex)),
    blockNumber: Number(BigInt(blockHex)),
    contractsHealthy:
      hasCode(lensCode) && hasCode(hookCode) && hasCode(controllerCode) && hasCode(transportCode),
    circlePeerSealed: decodeBool(peerData),
    baselineFeePips: unsigned(decoded[12]),
    configured: unsigned(decoded[13]) !== 0,
    globallyPaused: unsigned(decoded[9]) !== 0,
    poolPaused: unsigned(decoded[10]) !== 0,
    observationCount: unsigned(decoded[11]),
    // buy ↔ oneForZero (words 1/3), sell ↔ zeroForOne (words 0/2) — see TokenConfig note above.
    buy: { feePips: unsigned(decoded[1]), usedBaseline: unsigned(decoded[3]) !== 0 },
    sell: { feePips: unsigned(decoded[0]), usedBaseline: unsigned(decoded[2]) !== 0 },
    lastSequence: unsigned(decoded[4]),
    recommendation: {
      zeroForOneFeePips: decodedRecommendation.zeroForOneFeePips,
      oneForZeroFeePips: decodedRecommendation.oneForZeroFeePips,
      zeroForOneRiskWad: decodedRecommendation.zeroForOneRiskWad,
      oneForZeroRiskWad: decodedRecommendation.oneForZeroRiskWad,
      confidenceBps: unsigned(decoded[8]),
      validAfter: unsigned(decoded[5]),
      validUntil: unsigned(decoded[6]),
      sequence: unsigned(decoded[4]),
      secondsUntilExpiry: unsigned(decoded[7]),
    },
  };
}

async function readProcessor() {
  const [chainIdHex, blockHex, code, pendingData, settledData, expiredData, lastObservationData, sequenceData] =
    await Promise.all([
      rpc<string>(PROCESSOR_RPC, "eth_chainId", []),
      rpc<string>(PROCESSOR_RPC, "eth_blockNumber", []),
      rpc<string>(PROCESSOR_RPC, "eth_getCode", [PROCESSOR, "latest"]),
      call(PROCESSOR_RPC, PROCESSOR, selectors.pendingCount),
      call(PROCESSOR_RPC, PROCESSOR, selectors.settledObservationCount),
      call(PROCESSOR_RPC, PROCESSOR, selectors.expiredObservationCount),
      call(PROCESSOR_RPC, PROCESSOR, selectors.lastObservationId),
      call(PROCESSOR_RPC, PROCESSOR, selectors.recommendationSequence),
    ]);

  return {
    processor: {
      chainId: Number(BigInt(chainIdHex)),
      blockNumber: Number(BigInt(blockHex)),
      contractHealthy: hasCode(code),
      pendingCount: decodeSingle(pendingData),
      settledCount: decodeSingle(settledData),
      expiredCount: decodeSingle(expiredData),
      lastObservationId: decodeSingle(lastObservationData),
      recommendationSequence: decodeSingle(sequenceData),
      droppedCount: null,
      referenceSourceCount: null,
      sides: null,
      deployedConfig: null,
    },
    referenceSources: null,
    automation: null,
  };
}

function encodeReferenceSourceCall(sourceId: string): string {
  return `${selectors.referenceSourceState}${addressWord(PROCESSOR)}${sourceId.slice(2).padStart(64, "0")}`;
}

async function readProcessorLens() {
  // Core state, per-source reference history and the executor cycle all live on
  // the processor chain, so they travel as one batch. Reference and automation
  // decodes stay individually recoverable: a bad slice degrades that card to null.
  const batched = (await batchOrSingle(PROCESSOR_RPC, [
    { method: "eth_chainId", params: [] },
    { method: "eth_blockNumber", params: [] },
    { method: "eth_getCode", params: [PROCESSOR_LENS, "latest"] },
    { method: "eth_getCode", params: [PROCESSOR, "latest"] },
    callOf(PROCESSOR_LENS, encodeProcessorLensCall()),
    ...REFERENCE_SOURCE_IDS.map((sourceId) => callOf(PROCESSOR_LENS, encodeReferenceSourceCall(sourceId))),
    callOf(EXECUTOR, selectors.cycleCount),
    callOf(EXECUTOR, selectors.lastCycleResult),
  ])) as string[];

  const [chainIdHex, blockHex, lensCode, processorCode, snapshotData] = batched;
  const referenceData = batched.slice(5, 5 + REFERENCE_SOURCE_IDS.length);
  const [cycleCountData, cycleResultData] = batched.slice(5 + REFERENCE_SOURCE_IDS.length);

  const references = REFERENCE_SOURCE_IDS.map((sourceId, index) => {
    try {
      return decodeReferenceSource(sourceId, referenceData[index]);
    } catch {
      return null;
    }
  });
  let automation: { cycleCount: number; lastCycle: ReturnType<typeof decodeCycleResult> } | null = null;
  try {
    automation = {
      cycleCount: decodeSingle(cycleCountData),
      lastCycle: decodeCycleResult(cycleResultData),
    };
  } catch {
    automation = null;
  }
  const decoded = words(snapshotData);
  if (decoded.length !== 98) throw new Error("Unexpected processor lens response");
  const zeroForOneSideOffset = 10;
  const oneForZeroSideOffset = 34;
  // The UI calls these "liquidity-qualified", so an unconfigured source must
  // not be counted among them.
  const configuredReferences = references.filter(
    (entry): entry is NonNullable<typeof entry> => entry !== null && entry.configured,
  );

  return {
    processor: {
      chainId: Number(BigInt(chainIdHex)),
      blockNumber: Number(BigInt(blockHex)),
      contractHealthy: hasCode(lensCode) && hasCode(processorCode),
      pendingCount: unsigned(decoded[0]),
      settledCount: unsigned(decoded[3]),
      expiredCount: unsigned(decoded[4]),
      droppedCount: unsigned(decoded[5]),
      lastObservationId: unsigned(decoded[2]),
      recommendationSequence: unsigned(decoded[6]),
      referenceSourceCount: unsigned(decoded[9]),
      sides: {
        // buy ↔ oneForZero side, sell ↔ zeroForOne side — see TokenConfig note above.
        buy: decodeSideState(decoded, oneForZeroSideOffset),
        sell: decodeSideState(decoded, zeroForOneSideOffset),
      },
      deployedConfig: decodeDeployedConfig(decoded),
    },
    referenceSources: configuredReferences.length ? configuredReferences : null,
    automation,
  };
}

type RpcLog = { topics: string[]; data: string; blockNumber: string; logIndex?: string; transactionHash: string };

// toBlock is pinned to the height we already read rather than "latest": these
// chains advance during the request, which would push the span past the
// provider's range cap and get the whole query rejected.
function logsCall(address: string, topic: string, fromBlock: number, toBlock: number): BatchCall {
  return {
    method: "eth_getLogs",
    params: [
      {
        address,
        topics: [topic],
        fromBlock: `0x${Math.max(0, fromBlock).toString(16)}`,
        toBlock: `0x${Math.max(0, toBlock).toString(16)}`,
      },
    ],
  };
}

function getLogs(
  url: string,
  address: string,
  topic: string,
  fromBlock: number,
  toBlock: number,
): Promise<RpcLog[]> {
  return rpc<RpcLog[]>(url, "eth_getLogs", [logsCall(address, topic, fromBlock, toBlock).params[0]]);
}

async function readEvents() {
  const [originBlockHex, processorBlockHex] = (await Promise.all([
    rpc<string>(ORIGIN_RPC, "eth_blockNumber", []),
    rpc<string>(PROCESSOR_RPC, "eth_blockNumber", []),
  ])) as string[];
  const originHead = Number(BigInt(originBlockHex));
  const processorHead = Number(BigInt(processorBlockHex));
  const originFrom = originHead - ORIGIN_EVENT_WINDOW;
  const processorFrom = processorHead - PROCESSOR_EVENT_WINDOW;
  // A failed scan is NOT the same finding as an empty scan: the UI states
  // "no events in the last N blocks" as fact, so a thrown query must be
  // reported as unavailable rather than silently degraded to zero results.
  //
  // The public processor RPC is load balanced across backends with uneven log
  // indexes, so an identical query intermittently returns zero logs. Retrying
  // once on an empty result makes a false "no events" far less likely; a
  // genuinely empty window (the origin lane today) just costs one extra call.
  let originScanned = true;
  let processorScanned = true;

  // The retry is best effort: only the FIRST attempt decides `scanned`, so a
  // failed second opinion never downgrades a successful empty scan to
  // "unavailable" (which would otherwise happen constantly on the genuinely
  // empty origin lane, since it retries every time).
  // Second opinions are best effort: only the FIRST attempt decides `scanned`,
  // so a failed re-ask never downgrades a successful empty scan to
  // "unavailable". The public processor node answers this query from a pool of
  // backends with uneven log indexes and returns nothing roughly half the time,
  // so an empty answer is re-asked a bounded number of times before it is
  // reported as a genuine "no events" finding.
  const EMPTY_RESCANS = 2;

  async function scanOrigin(): Promise<RpcLog[]> {
    const read = () => getLogs(ORIGIN_RPC, HOOK, eventTopics.swapObserved, originFrom, originHead);
    let logs = await read();
    for (let attempt = 0; attempt < EMPTY_RESCANS && !logs.length; attempt += 1) {
      logs = await read().catch(() => logs);
    }
    return logs;
  }

  async function scanProcessor(): Promise<RpcLog[][]> {
    const calls = [
      logsCall(PROCESSOR, eventTopics.epochFinalized, processorFrom, processorHead),
      logsCall(EXECUTOR, eventTopics.automationCycleCompleted, processorFrom, processorHead),
    ];
    const read = () => batchOrSingle(PROCESSOR_RPC, calls) as Promise<RpcLog[][]>;
    let logs = await read();
    for (let attempt = 0; attempt < EMPTY_RESCANS && !logs.some((entry) => entry.length); attempt += 1) {
      logs = await read().catch(() => logs);
    }
    return logs;
  }

  const [swapLogs, processorLogs] = await Promise.all([
    scanOrigin().catch(() => {
      originScanned = false;
      return [] as RpcLog[];
    }),
    scanProcessor().catch(() => {
      processorScanned = false;
      return [[], []] as RpcLog[][];
    }),
  ]);
  const [epochLogs, cycleLogs] = processorLogs as RpcLog[][];

  const origin = swapLogs.slice(-6).map((log) => {
    const body = words(log.data);
    const zeroForOne = BigInt(log.topics[3]) !== BigInt(0);
    return {
      kind: "swap" as const,
      blockNumber: Number(BigInt(log.blockNumber)),
      logIndex: Number(BigInt(log.logIndex ?? "0x0")),
      txHash: log.transactionHash,
      summary: `Swap ${Number(BigInt(log.topics[2]))} observed · ${zeroForOne ? "sell" : "buy"} side · ${(unsigned(body[3]) / 100).toFixed(2)} bps applied${unsigned(body[4]) !== 0 ? " (baseline)" : ""}`,
      observedAt: unsigned(body[5]),
    };
  });

  const processor = [
    ...epochLogs.slice(-4).map((log) => {
      const body = words(log.data);
      const zeroForOne = BigInt(log.topics[1]) !== BigInt(0);
      return {
        kind: "epoch" as const,
        blockNumber: Number(BigInt(log.blockNumber)),
        logIndex: Number(BigInt(log.logIndex ?? "0x0")),
        txHash: log.transactionHash,
        summary: `Epoch ${Number(BigInt(log.topics[2]))} finalized · ${zeroForOne ? "sell" : "buy"} side · fee ${(unsigned(body[6]) / 100).toFixed(2)} bps`,
        observedAt: null,
      };
    }),
    ...cycleLogs.slice(-4).map((log) => ({
      kind: "cycle" as const,
      blockNumber: Number(BigInt(log.blockNumber)),
      logIndex: Number(BigInt(log.logIndex ?? "0x0")),
      txHash: log.transactionHash,
      summary: `Automation cycle ${Number(BigInt(log.topics[1]))} · ${BigInt(log.topics[3]) !== BigInt(0) ? "Reactive callback" : "permissionless keeper"}`,
      observedAt: null,
    })),
  ]
    .sort((left, right) => right.blockNumber - left.blockNumber)
    .slice(0, 6);

  return {
    origin: origin.reverse(),
    processor,
    window: { origin: ORIGIN_EVENT_WINDOW, processor: PROCESSOR_EVENT_WINDOW },
    scanned: { origin: originScanned, processor: processorScanned },
  };
}

const REACTIVE_COUNTER_SELECTORS = [
  selectors.wakeRequestCount,
  selectors.observationSignalCount,
  selectors.consecutiveRetries,
  selectors.lastCycleId,
] as const;

async function readReactive() {
  // The RVM read is the correct one; the chain-side read is kept only as a
  // last resort, and is reported as such so a zero from it is never mistaken
  // for "the RSC did nothing".
  let source: "rvm" | "chain" = "rvm";
  let counters: string[];
  try {
    counters = (await batchOrSingle(
      REACTIVE_RPC,
      REACTIVE_COUNTER_SELECTORS.map((selector) => rvmCallOf(REACTIVE_RSC, selector)),
    )) as string[];
  } catch {
    source = "chain";
    counters = (await batchOrSingle(
      REACTIVE_RPC,
      REACTIVE_COUNTER_SELECTORS.map((selector) => callOf(REACTIVE_RSC, selector)),
    )) as string[];
  }

  const [wakeData, signalData, retriesData, lastCycleData] = counters;
  return {
    source,
    wakeRequestCount: decodeSingle(wakeData),
    observationSignalCount: decodeSingle(signalData),
    consecutiveRetries: decodeSingle(retriesData),
    lastCycleId: decodeSingle(lastCycleData),
  };
}

export async function GET() {
  try {
    const originLensOverride = process.env.THETASHIELD_ORIGIN_LENS_ADDRESS?.trim();
    const processorLensOverride = process.env.THETASHIELD_PROCESSOR_LENS_ADDRESS?.trim();
    if (Boolean(originLensOverride) !== Boolean(processorLensOverride)) {
      throw new Error("Both ThetaShield lens addresses must be configured together");
    }
    // Supplementary telemetry must never hold the proof panel open: a slow log
    // scan or a third-chain hiccup degrades that card to null instead.
    const reactivePromise = optional(readReactive(), 5_000);
    const eventsPromise = optional(readEvents(), 5_000);
    // The lenses are a convenience aggregate; the audited getters on the hook,
    // controller and processor are the contract of record. A lens fault
    // therefore degrades the read to those getters rather than the whole panel,
    // and readPath reports which one actually answered.
    let readPath: "lens" | "historical-direct" = READ_PATH;
    let origin: Awaited<ReturnType<typeof readOriginLens>> | Awaited<ReturnType<typeof readOrigin>>;
    let processorBundle:
      | Awaited<ReturnType<typeof readProcessorLens>>
      | Awaited<ReturnType<typeof readProcessor>>;
    if (readPath === "lens") {
      try {
        [origin, processorBundle] = await Promise.all([readOriginLens(), readProcessorLens()]);
      } catch {
        readPath = "historical-direct";
        [origin, processorBundle] = await Promise.all([readOrigin(), readProcessor()]);
      }
    } else {
      [origin, processorBundle] = await Promise.all([readOrigin(), readProcessor()]);
    }
    const [reactive, events] = await Promise.all([reactivePromise, eventsPromise]);
    const now = Math.floor(Date.now() / 1_000);

    return NextResponse.json(
      {
        ok: true,
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        poolId: POOL_ID,
        readPath,
        origin,
        processor: processorBundle.processor,
        referenceSources: processorBundle.referenceSources,
        automation: processorBundle.automation,
        reactive,
        events,
        recommendationExpired: origin.recommendation.validUntil <= now,
      },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read testnet state";
    return NextResponse.json(
      { ok: false, generatedAt: new Date().toISOString(), message },
      { status: 503, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }
}
