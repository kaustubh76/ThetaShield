import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ORIGIN_RPC = process.env.ORIGIN_RPC_URL || "https://sepolia.unichain.org";
const PROCESSOR_RPC = process.env.PROCESSOR_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const ORIGIN_LENS =
  process.env.THETASHIELD_ORIGIN_LENS_ADDRESS?.trim() || "0xEF9C630C6977d16Dac5107fe590FB184CB593D5d";
const PROCESSOR_LENS =
  process.env.THETASHIELD_PROCESSOR_LENS_ADDRESS?.trim() || "0x4a1b453f4Ba183d7BEcd7e81bFfd8fB0682F1EAb";

const POOL_ID = "0x98cea44f9f7d6a1432b12a8a56e022758ffe447a9f2e529da7557eb788cdc2a5";
const HOOK = "0x7f5d1beB9957d94c7fc0c8FC4D8DA4A0A0b8c0c0";
const CONTROLLER = "0x23ae3E1A306824F0CBA0b6561cB7E5502f63dFb7";
const TRANSPORT = "0x4f00e3BDd224F4c4b4958D54cD774E84B9092609";
const PROCESSOR = "0x7bdF95029fd614e5FCB5C7B2D63e263a8Ca4BBF2";
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
} as const;

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

function hasCode(code: string): boolean {
  return code !== "0x" && code !== "0x0";
}

async function readOrigin() {
  const [chainIdHex, blockHex, hookCode, controllerCode, transportCode, observationData, buyData, sellData, recommendationData, sequenceData, peerData, configData, globallyPausedData] =
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

  const recommendation = decodeRecommendation(recommendationData);
  const config = decodePoolConfig(configData);

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
    buy: decodeFee(buyData),
    sell: decodeFee(sellData),
    lastSequence: decodeSingle(sequenceData),
    recommendation,
  };
}

async function readOriginLens() {
  const [chainIdHex, blockHex, lensCode, hookCode, controllerCode, transportCode, snapshotData, peerData] =
    await Promise.all([
      rpc<string>(ORIGIN_RPC, "eth_chainId", []),
      rpc<string>(ORIGIN_RPC, "eth_blockNumber", []),
      rpc<string>(ORIGIN_RPC, "eth_getCode", [ORIGIN_LENS, "latest"]),
      rpc<string>(ORIGIN_RPC, "eth_getCode", [HOOK, "latest"]),
      rpc<string>(ORIGIN_RPC, "eth_getCode", [CONTROLLER, "latest"]),
      rpc<string>(ORIGIN_RPC, "eth_getCode", [TRANSPORT, "latest"]),
      call(ORIGIN_RPC, ORIGIN_LENS, encodeOriginLensCall()),
      call(ORIGIN_RPC, CONTROLLER, selectors.circlePeerSealed),
    ]);
  const decoded = words(snapshotData);
  if (decoded.length !== 14) throw new Error("Unexpected origin lens response");

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
    buy: { feePips: unsigned(decoded[0]), usedBaseline: unsigned(decoded[2]) !== 0 },
    sell: { feePips: unsigned(decoded[1]), usedBaseline: unsigned(decoded[3]) !== 0 },
    lastSequence: unsigned(decoded[4]),
    recommendation: {
      zeroForOneFeePips: unsigned(decoded[0]),
      oneForZeroFeePips: unsigned(decoded[1]),
      zeroForOneRiskWad: "0",
      oneForZeroRiskWad: "0",
      confidenceBps: unsigned(decoded[8]),
      validAfter: unsigned(decoded[5]),
      validUntil: unsigned(decoded[6]),
      sequence: unsigned(decoded[4]),
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
    zeroForOneCoverageRatioWad: null,
    oneForZeroCoverageRatioWad: null,
  };
}

async function readProcessorLens() {
  const [chainIdHex, blockHex, lensCode, processorCode, snapshotData] = await Promise.all([
    rpc<string>(PROCESSOR_RPC, "eth_chainId", []),
    rpc<string>(PROCESSOR_RPC, "eth_blockNumber", []),
    rpc<string>(PROCESSOR_RPC, "eth_getCode", [PROCESSOR_LENS, "latest"]),
    rpc<string>(PROCESSOR_RPC, "eth_getCode", [PROCESSOR, "latest"]),
    call(PROCESSOR_RPC, PROCESSOR_LENS, encodeProcessorLensCall()),
  ]);
  const decoded = words(snapshotData);
  if (decoded.length !== 98) throw new Error("Unexpected processor lens response");
  const zeroForOneSideOffset = 10;
  const oneForZeroSideOffset = 34;

  return {
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
    zeroForOneCoverageRatioWad: BigInt(`0x${decoded[zeroForOneSideOffset + 12]}`).toString(),
    oneForZeroCoverageRatioWad: BigInt(`0x${decoded[oneForZeroSideOffset + 12]}`).toString(),
  };
}

export async function GET() {
  try {
    if (Boolean(ORIGIN_LENS) !== Boolean(PROCESSOR_LENS)) {
      throw new Error("Both ThetaShield lens addresses must be configured together");
    }
    const useLens = Boolean(ORIGIN_LENS && PROCESSOR_LENS);
    const [origin, processor] = await Promise.all(
      useLens ? [readOriginLens(), readProcessorLens()] : [readOrigin(), readProcessor()],
    );
    const now = Math.floor(Date.now() / 1_000);

    return NextResponse.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        poolId: POOL_ID,
        readPath: useLens ? "lens" : "historical-direct",
        origin,
        processor,
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
