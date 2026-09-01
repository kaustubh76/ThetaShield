import { NextResponse } from "next/server";
import {
  ADDRESSES,
  EVENT_TOPICS,
  POOL_ID,
  READ_PATH,
  REACTIVE_CALLBACK_TX,
  REACTIVE_RVM_ID,
  RUN_RECEIPTS,
  REFERENCE_SOURCE_IDS,
  RPC,
} from "../../live-config";
import {
  addressFromWord,
  decodeBool,
  decodeCycleResult,
  decodeDeployedConfig,
  decodeFee,
  decodeNetworkConfig,
  decodePoolConfig,
  decodeReactiveCallback,
  decodeRecommendation,
  decodeReferenceSource,
  decodeSideState,
  decodeSingle,
  fillTimelineGaps,
  unsigned,
  words,
} from "./decode";

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
  finalizedThreshold: "0xbe7dd53a",
  pendingCount: "0xea70b4af",
  settledObservationCount: "0x9bd6496d",
  expiredObservationCount: "0x3886a4fa",
  lastObservationId: "0xbf076a47",
  recommendationSequence: "0xd683a5c8",
  referenceSourceState: "0x57c191ae",
  cycleCount: "0x316fda0f",
  lastCycleResult: "0xd7fe3220",
  // The executor's two immutable guard values. Its rvmIdOnly and
  // authorizedSenderOnly modifiers compare exactly these, so reading them makes
  // the callback authentication checkable instead of merely asserted.
  reactiveRvmId: "0x0c41fb9a",
  reactiveCallbackProxy: "0x566353ab",
  pendingObservation: "0x54a6e4b2",
  wakeRequestCount: "0xfcfaf7be",
  observationSignalCount: "0xb8eb92d8",
  consecutiveRetries: "0x84e35204",
  // The RSC's scheduler state. These live in the RVM like the counters, so they
  // only answer through rnk_call; a chain-side read returns constructor defaults.
  rscPhase: "0xb1c9fe6e",
  rscTriggerPhase: "0x9788376e",
  rscDueAt: "0x85f1b090",
  rscQueuedMaturityAt: "0x291e28fa",
  // The RSC's own NetworkConfig: it names the processor and executor it drives
  // and its cron topic, which is the Lasna side of the cross-plane agreement.
  rscNetworkConfig: "0x90ced421",
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
  const [chainIdHex, blockHex, hookCode, controllerCode, transportCode, observationData, zeroForOneFeeData, oneForZeroFeeData, recommendationData, sequenceData, peerData, configData, globallyPausedData, finalityData] =
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
      call(ORIGIN_RPC, CONTROLLER, selectors.finalizedThreshold),
    ]);

  const decodedRecommendation = decodeRecommendation(recommendationData);
  const config = decodePoolConfig(configData);
  const now = Math.floor(Date.now() / 1_000);

  return {
    chainId: Number(BigInt(chainIdHex)),
    blockNumber: Number(BigInt(blockHex)),
    contractsHealthy: hasCode(hookCode) && hasCode(controllerCode) && hasCode(transportCode),
    circlePeerSealed: decodeBool(peerData),
    finalizedThreshold: decodeSingle(finalityData),
    baselineFeePips: config.baselineFeePips,
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
  const [chainIdHex, blockHex, lensCode, hookCode, controllerCode, transportCode, snapshotData, peerData, recommendationData, finalityData] =
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
      callOf(CONTROLLER, selectors.finalizedThreshold),
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
    finalizedThreshold: decodeSingle(finalityData),
    baselineFeePips: unsigned(decoded[12]),
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
    authentication: null,
  };
}

function encodeReferenceSourceCall(sourceId: string): string {
  return `${selectors.referenceSourceState}${addressWord(PROCESSOR)}${sourceId.slice(2).padStart(64, "0")}`;
}

// Who may wake the executor, checked rather than asserted. The executor's
// rvmIdOnly and authorizedSenderOnly guards compare an incoming callback
// against these two immutable values; the proven callback transaction carries
// the values it actually presented in its own calldata. Reading both sides lets
// the page run the comparison instead of restating the manifest.
async function readCallbackAuthentication(rvmIdData: string, callbackProxyData: string) {
  const rvmId = addressFromWord(words(rvmIdData)[0]);
  const callbackProxy = addressFromWord(words(callbackProxyData)[0]);
  let callback: ReturnType<typeof decodeReactiveCallback> | null = null;
  try {
    const raw = await rpc<unknown>(PROCESSOR_RPC, "eth_getTransactionByHash", [REACTIVE_CALLBACK_TX]);
    callback = raw ? decodeReactiveCallback(raw as Parameters<typeof decodeReactiveCallback>[0]) : null;
  } catch {
    callback = null;
  }
  return { rvmId, callbackProxy, transactionHash: REACTIVE_CALLBACK_TX, callback };
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
    // The executor's immutable guard values ride the batch it was already in.
    callOf(EXECUTOR, selectors.reactiveRvmId),
    callOf(EXECUTOR, selectors.reactiveCallbackProxy),
  ])) as string[];

  const [chainIdHex, blockHex, lensCode, processorCode, snapshotData] = batched;
  const referenceData = batched.slice(5, 5 + REFERENCE_SOURCE_IDS.length);
  const [cycleCountData, cycleResultData, rvmIdData, callbackProxyData] = batched.slice(
    5 + REFERENCE_SOURCE_IDS.length,
  );

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
  // The proven callback itself. It is read separately rather than inside the
  // batch above because eth_getTransactionByHash is not an eth_call: a provider
  // that answered it badly would otherwise fail the whole lens read and push
  // the panel onto the direct path over a supplementary check.
  const authentication = await optional(readCallbackAuthentication(rvmIdData, callbackProxyData), 4_000);
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
    authentication,
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

// One decoder for the hook's SwapObserved log, shared by the recent-window scan
// and by the pinned historical scan that dates the run timeline — so the two can
// never describe the same swap differently.
function mapSwapLog(log: RpcLog) {
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
}

// The proven run, read back from its own transactions. The six receipts are
// already on the page as links; their timestamps turn them into a measured
// sequence, and the gaps are the only quantitative statement the page can make
// about what the Reactive integration buys: Circle's finality-2000 transport
// costs tens of minutes each way, the scheduler's wake costs seconds.
//
// eth_getTransactionByHash, never eth_getTransactionReceipt — public Sepolia
// providers prune the receipt index and answer null for the callback hash while
// still returning the full mined transaction.
type TimelineStep = {
  index: number;
  role: "origin" | "processor";
  hash: string;
  blockNumber: number | null;
  observedAt: number | null;
  gapSeconds: number | null;
  /** Decoded specifics from the step's own log, where the chain still has it. */
  detail: string | null;
};

let runTimelineCache: Promise<{
  steps: TimelineStep[];
  endToEndSeconds: number | null;
  complete: boolean;
} | null> | null = null;

async function loadRunTimeline() {
  const byRole = { origin: ORIGIN_RPC, processor: PROCESSOR_RPC } as const;
  const steps: TimelineStep[] = RUN_RECEIPTS.map((receipt, index) => ({
    index,
    role: receipt.role,
    hash: receipt.hash,
    blockNumber: null,
    observedAt: null,
    gapSeconds: null,
    detail: null,
  }));

  // One batch per chain for the transactions, then one batch per chain for the
  // blocks still missing a timestamp. Ethereum Sepolia via publicnode returns a
  // non-standard `blockTimestamp` on the transaction; Unichain does not, so the
  // block read is required rather than an optimisation.
  await Promise.all(
    (["origin", "processor"] as const).map(async (role) => {
      const mine = steps.filter((step) => step.role === role);
      if (!mine.length) return;
      const url = byRole[role];
      const transactions = (await batchOrSingle(
        url,
        mine.map((step) => ({ method: "eth_getTransactionByHash", params: [step.hash] })),
      )) as ({ blockNumber?: string | null; blockTimestamp?: string | null } | null)[];

      const needBlock: TimelineStep[] = [];
      transactions.forEach((transaction, position) => {
        const step = mine[position];
        if (!transaction?.blockNumber) return;
        step.blockNumber = unsigned(transaction.blockNumber.slice(2));
        if (transaction.blockTimestamp) {
          step.observedAt = unsigned(transaction.blockTimestamp.slice(2));
        } else {
          needBlock.push(step);
        }
      });
      if (!needBlock.length) return;

      const blocks = (await batchOrSingle(
        url,
        needBlock.map((step) => ({
          method: "eth_getBlockByNumber",
          params: [`0x${(step.blockNumber as number).toString(16)}`, false],
        })),
      )) as ({ timestamp?: string } | null)[];
      blocks.forEach((block, position) => {
        if (block?.timestamp) needBlock[position].observedAt = unsigned(block.timestamp.slice(2));
      });
    }),
  );

  // The recent-window scan can never reach these blocks — Unichain caps
  // eth_getLogs at 10,000 blocks, about 2.8 hours, and the run is days back — so
  // the swap steps are re-read with the range pinned to their own block. That
  // costs one narrow query each and gives the timeline the observation id, side
  // and applied fee that a bare transaction hash does not carry.
  const originSwapSteps = steps.filter((step) => step.role === "origin" && step.blockNumber !== null);
  if (originSwapSteps.length) {
    try {
      const pinned = (await batchOrSingle(
        ORIGIN_RPC,
        originSwapSteps.map((step) =>
          logsCall(HOOK, eventTopics.swapObserved, step.blockNumber as number, step.blockNumber as number),
        ),
      )) as RpcLog[][];
      pinned.forEach((logs, position) => {
        const step = originSwapSteps[position];
        const match = logs?.find((log) => log.transactionHash.toLowerCase() === step.hash.toLowerCase());
        if (match) step.detail = mapSwapLog(match).summary;
      });
    } catch {
      // Enrichment only. A provider that will not answer the pinned query leaves
      // the steps dated but undescribed, which is still the whole point.
    }
  }

  fillTimelineGaps(steps);
  const first = steps[0]?.observedAt ?? null;
  const last = steps[steps.length - 1]?.observedAt ?? null;
  const complete = steps.every((step) => step.observedAt !== null);
  return {
    steps,
    endToEndSeconds: first !== null && last !== null ? last - first : null,
    complete,
  };
}

// Memoised for the life of the server process: these transactions are immutable
// history, so re-reading them on every 60s poll would be waste. They are still
// read from the chains rather than restated from the manifest.
function readRunTimeline() {
  if (!runTimelineCache) {
    runTimelineCache = loadRunTimeline().catch(() => {
      runTimelineCache = null;
      return null;
    });
  }
  return runTimelineCache;
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
  //
  // Measured against production on 2026-09-01, with a swap that demonstrably
  // sat inside the window: 2 of 20 reads still reported an empty origin lane
  // after 3 attempts, i.e. ~46% per attempt. (The same query run 40 times from
  // a developer machine came back empty 0 times, so this is the hosted egress
  // seeing a different pool of backends — it cannot be reproduced or tuned
  // locally.) Five attempts takes the false "no events" rate from ~10% to ~2%;
  // the extra calls only ever fire on an empty answer, and an empty answer is
  // the cheap one.
  const EMPTY_RESCANS = 4;

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

  // EpochFinalized and AutomationCycleCompleted carry no timestamp, so every
  // processor event shipped as observedAt: null and rendered undated. One
  // batched block read per distinct block fills them in; a failure leaves them
  // null, which the ticker already handles.
  const processorTimes = new Map<number, number>();
  const distinctBlocks = [
    ...new Set([...epochLogs, ...cycleLogs].map((log) => Number(BigInt(log.blockNumber)))),
  ];
  if (distinctBlocks.length) {
    try {
      const blocks = (await batchOrSingle(
        PROCESSOR_RPC,
        distinctBlocks.map((blockNumber) => ({
          method: "eth_getBlockByNumber",
          params: [`0x${blockNumber.toString(16)}`, false],
        })),
      )) as ({ timestamp?: string } | null)[];
      blocks.forEach((block, position) => {
        if (block?.timestamp) processorTimes.set(distinctBlocks[position], unsigned(block.timestamp.slice(2)));
      });
    } catch {
      // Undated events are still events; a wrong time would be worse.
    }
  }
  const timeOf = (log: RpcLog) => processorTimes.get(Number(BigInt(log.blockNumber))) ?? null;

  const origin = swapLogs.slice(-6).map(mapSwapLog);

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
        observedAt: timeOf(log),
      };
    }),
    ...cycleLogs.slice(-4).map((log) => ({
      kind: "cycle" as const,
      blockNumber: Number(BigInt(log.blockNumber)),
      logIndex: Number(BigInt(log.logIndex ?? "0x0")),
      txHash: log.transactionHash,
      summary: `Automation cycle ${Number(BigInt(log.topics[1]))} · ${BigInt(log.topics[3]) !== BigInt(0) ? "Reactive callback" : "permissionless keeper"}`,
      observedAt: timeOf(log),
    })),
  ]
    .sort((left, right) => right.blockNumber - left.blockNumber)
    .slice(0, 6);

  return {
    origin: origin.reverse(),
    processor,
    // The heads travel with the window so the page can state the scan's span in
    // wall-clock time as well as blocks — derived against a dated block from the
    // run timeline rather than an assumed block interval.
    window: { origin: ORIGIN_EVENT_WINDOW, processor: PROCESSOR_EVENT_WINDOW },
    head: { origin: originHead, processor: processorHead },
    scanned: { origin: originScanned, processor: processorScanned },
  };
}

const REACTIVE_COUNTER_SELECTORS = [
  selectors.wakeRequestCount,
  selectors.observationSignalCount,
  selectors.consecutiveRetries,
  selectors.lastCycleId,
  selectors.rscPhase,
  selectors.rscTriggerPhase,
  selectors.rscDueAt,
  selectors.rscQueuedMaturityAt,
  selectors.rscNetworkConfig,
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

  const [
    wakeData,
    signalData,
    retriesData,
    lastCycleData,
    phaseData,
    triggerData,
    dueAtData,
    queuedData,
    networkConfigData,
  ] = counters;
  let networkConfig: ReturnType<typeof decodeNetworkConfig> | null = null;
  try {
    networkConfig = decodeNetworkConfig(networkConfigData);
  } catch {
    networkConfig = null;
  }
  return {
    source,
    wakeRequestCount: decodeSingle(wakeData),
    observationSignalCount: decodeSingle(signalData),
    consecutiveRetries: decodeSingle(retriesData),
    lastCycleId: decodeSingle(lastCycleData),
    // Scheduler state: which of the five phases the RSC is in, which phase
    // issued the wake now in flight, when the next wake is due, and whether an
    // observation is queued behind the current cycle.
    phase: decodeSingle(phaseData),
    triggerPhase: decodeSingle(triggerData),
    dueAt: decodeSingle(dueAtData),
    queuedMaturityAt: decodeSingle(queuedData),
    // The RSC's own deployment view: the retry budget and epoch cadence it
    // actually runs on, and the executor address the other plane must agree
    // with. Decoded separately so a layout drift degrades this one group.
    networkConfig,
  };
}

// The processor preallocates 32 pending slots, so pendingObservation(slot)
// answers for 0-31 without reverting. The earliest maturity across the active
// slots is when work is genuinely due on the Ethereum Sepolia side, and in
// AwaitMaturity the RSC's dueAt on Lasna should equal it.
//
// Gated on pendingCount by the caller: while the queue is empty every slot is
// zero and the comparison says nothing, so the 32-entry batch is not spent.
const PENDING_SLOT_COUNT = 32;

async function readPendingMaturity() {
  const slots = (await batchOrSingle(
    PROCESSOR_RPC,
    Array.from({ length: PENDING_SLOT_COUNT }, (_, slot) =>
      callOf(PROCESSOR, `${selectors.pendingObservation}${slot.toString(16).padStart(64, "0")}`),
    ),
  )) as string[];

  let earliestMatureAt: number | null = null;
  let active = 0;
  for (const slot of slots) {
    const decoded = words(slot);
    if (decoded.length < 3 || unsigned(decoded[0]) === 0) continue;
    active += 1;
    const matureAt = unsigned(decoded[2]);
    if (earliestMatureAt === null || matureAt < earliestMatureAt) earliestMatureAt = matureAt;
  }
  return { scannedSlots: PENDING_SLOT_COUNT, activeSlots: active, earliestMatureAt };
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
    // Immutable history, memoised after the first read, so this resolves
    // instantly on every poll but the second.
    const timelinePromise = optional(readRunTimeline(), 6_000);
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
    const [reactive, events, runTimeline] = await Promise.all([
      reactivePromise,
      eventsPromise,
      timelinePromise,
    ]);
    // The sharper cross-plane check only exists when there is work outstanding:
    // with an empty queue both planes read zero and agree about nothing. So the
    // 32-slot scan is spent only when the processor says a slot is occupied.
    const pendingMaturity =
      processorBundle.processor.pendingCount > 0 ? await optional(readPendingMaturity(), 4_000) : null;
    // Expiry is chain state, so it is read from the chain wherever possible.
    // The origin lens computes secondsUntilExpiry against block.timestamp
    // inside the contract; only the direct-getter fallback has to fall back to
    // this host's clock, and the response says which was used so the page never
    // presents a host-clock inference as a chain reading.
    const expiryBasis = readPath === "lens" ? "chain" : "host-clock";
    const now = Math.floor(Date.now() / 1_000);
    const recommendationExpired =
      expiryBasis === "chain"
        ? origin.recommendation.secondsUntilExpiry <= 0
        : origin.recommendation.validUntil <= now;

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
        authentication: processorBundle.authentication,
        reactive,
        pendingMaturity,
        runTimeline,
        events,
        recommendationExpired,
        expiryBasis,
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
