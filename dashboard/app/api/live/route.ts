import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ORIGIN_RPC = "https://sepolia.unichain.org";
const PROCESSOR_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

const POOL_ID = "0xa5eae55c727913799f7fc1eadd98f4c67b5c0da5417b5fe0adfafd12e9e93ca4";
const HOOK = "0xC53d57f4778E67B73B5535dEb2B841D56CBE40C0";
const CONTROLLER = "0x6db44e172C7E1bae468A6e1e3683f34D7f3fD791";
const TRANSPORT = "0x24daf359bA811c9dd6903649b968eC6D76C3e568";
const PROCESSOR = "0x10970CC15d1DF81bA6c8968F87036b21c694d744";
const ABI_SIGN_BIT = BigInt("0x8000000000000000000000000000000000000000000000000000000000000000");
const ABI_UINT256_MODULUS = BigInt("0x10000000000000000000000000000000000000000000000000000000000000000");

const selectors = {
  observationCount: "0x2ed9666f",
  feeForSwap: "0xc5ce25d1",
  currentRecommendation: "0xda3ec87d",
  lastSequence: "0x4462f69c",
  circlePeerSealed: "0x136f296d",
  pendingCount: "0xea70b4af",
  settledObservationCount: "0x9bd6496d",
  expiredObservationCount: "0x3886a4fa",
  lastObservationId: "0xbf076a47",
  recommendationSequence: "0xd683a5c8",
} as const;

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

function hasCode(code: string): boolean {
  return code !== "0x" && code !== "0x0";
}

async function readOrigin() {
  const [chainIdHex, blockHex, hookCode, controllerCode, transportCode, observationData, buyData, sellData, recommendationData, sequenceData, peerData] =
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
    ]);

  const recommendation = decodeRecommendation(recommendationData);

  return {
    chainId: Number(BigInt(chainIdHex)),
    blockNumber: Number(BigInt(blockHex)),
    contractsHealthy: hasCode(hookCode) && hasCode(controllerCode) && hasCode(transportCode),
    circlePeerSealed: decodeBool(peerData),
    observationCount: decodeSingle(observationData),
    buy: decodeFee(buyData),
    sell: decodeFee(sellData),
    lastSequence: decodeSingle(sequenceData),
    recommendation,
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
  };
}

export async function GET() {
  try {
    const [origin, processor] = await Promise.all([readOrigin(), readProcessor()]);
    const now = Math.floor(Date.now() / 1_000);

    return NextResponse.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        poolId: POOL_ID,
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
