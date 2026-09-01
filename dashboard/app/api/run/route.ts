import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, unichainSepolia } from "viem/chains";
import { ADDRESSES, EVENT_TOPICS, RPC } from "../../live-config";
import {
  GUARDS,
  missingConfig,
  RUN_ADDRESSES,
  RUN_ENABLED,
  RUN_STEPS,
  SWAP,
  type RunStep,
} from "./config";

export const dynamic = "force-dynamic";

const SWAP_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }",
  "struct TestSettings { bool takeClaims; bool settleUsingBurn; }",
  "function swap(PoolKey key, SwapParams params, TestSettings testSettings, bytes hookData) returns (int256)",
]);
const EXECUTOR_ABI = parseAbi(["function execute()"]);
const PROCESSOR_ABI = parseAbi(["function pendingCount() view returns (uint16)"]);

const origin = createPublicClient({ chain: unichainSepolia, transport: http(RPC.origin) });
const processor = createPublicClient({ chain: sepolia, transport: http(RPC.processor) });

function signer() {
  const secret = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!secret) throw new Error("this deployment has no signing key configured");
  return privateKeyToAccount((secret.startsWith("0x") ? secret : `0x${secret}`) as `0x${string}`);
}

type Guard = { ok: boolean; reason: string };

// Every guard reads the chain. None of them trusts the request body, and none
// of them lives in process memory — a serverless instance can be replaced
// between two requests, so an in-memory counter would reset to zero and a
// cooldown held in RAM would not hold at all.
async function guardsFor(step: RunStep): Promise<Guard[]> {
  const missing = missingConfig(step);
  if (missing.length) {
    return [{ ok: false, reason: `not configured on this deployment: ${missing.join(", ")}` }];
  }
  const guards: Guard[] = [];
  const address = signer().address;

  if (step === "swap") {
    const [balance, pending, head] = await Promise.all([
      origin.getBalance({ address }),
      processor.readContract({
        address: ADDRESSES.processor as `0x${string}`,
        abi: PROCESSOR_ABI,
        functionName: "pendingCount",
      }),
      origin.getBlockNumber(),
    ]);
    guards.push({
      ok: balance > GUARDS.originFloorWei,
      reason: `origin balance ${(Number(balance) / 1e18).toFixed(5)} ETH against a ${
        Number(GUARDS.originFloorWei) / 1e18
      } ETH floor`,
    });
    guards.push({
      ok: !GUARDS.requireEmptyQueue || Number(pending) === 0,
      reason:
        Number(pending) === 0
          ? "the processor queue is empty, so a run may start"
          : `the processor still holds ${pending} queued observation(s) — one run at a time`,
    });
    // Cooldown measured from the last SwapObserved log rather than from a timer
    // this process owns, so it survives an instance being replaced.
    const logs = await origin.getLogs({
      address: ADDRESSES.hook as `0x${string}`,
      fromBlock: head - 10_000n,
      toBlock: head,
    });
    const latest = logs.filter((log) => log.topics[0] === EVENT_TOPICS.swapObserved).at(-1);
    if (latest?.blockNumber) {
      const block = await origin.getBlock({ blockNumber: latest.blockNumber });
      const since = Math.floor(Date.now() / 1_000) - Number(block.timestamp);
      const remaining = GUARDS.swapCooldownSeconds - since;
      guards.push({
        ok: remaining <= 0,
        reason:
          remaining <= 0
            ? `last swap ${Math.round(since / 60)} min ago, past the ${GUARDS.swapCooldownSeconds / 60} min cooldown`
            : `last swap ${Math.round(since / 60)} min ago — ${Math.ceil(remaining / 60)} min of cooldown remain`,
      });
    } else {
      guards.push({ ok: true, reason: "no swap inside the scan window, so no cooldown applies" });
    }
  }

  if (step === "cycle") {
    const balance = await processor.getBalance({ address });
    guards.push({
      ok: balance > GUARDS.processorFloorWei,
      reason: `processor balance ${(Number(balance) / 1e18).toFixed(5)} ETH against a ${
        Number(GUARDS.processorFloorWei) / 1e18
      } ETH floor`,
    });
  }

  if (step === "relay") {
    // Excluded on purpose. Circle's attestation only exists once the source
    // chain finalises, roughly 30 minutes after the swap, and holding a
    // serverless function open for that is not possible. The relay stays an
    // operator step run from the runbook.
    guards.push({
      ok: false,
      reason:
        "Circle's attestation only exists once the source chain finalises, ~30 min after the swap. This leg is run from the operator runbook, not the browser.",
    });
  }

  return guards;
}

export async function GET() {
  try {
    const steps = await Promise.all(
      RUN_STEPS.map(async (step) => {
        const guards = await guardsFor(step).catch((error) => [
          { ok: false, reason: error instanceof Error ? error.message : "guard check failed" },
        ]);
        return { step, allowed: guards.every((guard) => guard.ok), guards };
      }),
    );
    return NextResponse.json(
      {
        ok: true,
        enabled: RUN_ENABLED,
        steps,
        swap: { amountWei: SWAP.amountSpecified.toString(), zeroForOne: SWAP.zeroForOne },
      },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "run status unavailable" },
      { status: 503, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }
}

export async function POST(request: Request) {
  let step: RunStep;
  try {
    const body = (await request.json()) as { step?: string };
    if (!body.step || !RUN_STEPS.includes(body.step as RunStep)) {
      return NextResponse.json({ ok: false, message: "unknown step" }, { status: 400 });
    }
    step = body.step as RunStep;
  } catch {
    return NextResponse.json({ ok: false, message: "invalid request" }, { status: 400 });
  }

  const guards = await guardsFor(step).catch((error) => [
    { ok: false, reason: error instanceof Error ? error.message : "guard check failed" },
  ]);
  if (!guards.every((guard) => guard.ok)) {
    return NextResponse.json(
      { ok: false, message: "refused by a guard", guards },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const account = signer();
    if (step === "cycle") {
      const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC.processor) });
      const hash = await wallet.sendTransaction({
        to: ADDRESSES.executor as `0x${string}`,
        data: encodeFunctionData({ abi: EXECUTOR_ABI, functionName: "execute" }),
      });
      return NextResponse.json({ ok: true, step, hash }, { headers: { "cache-control": "no-store" } });
    }
    if (step === "swap") {
      const wallet = createWalletClient({ account, chain: unichainSepolia, transport: http(RPC.origin) });
      // Every argument is fixed in config.ts. A caller-supplied amount or
      // direction would turn a bounded demo action into an arbitrary trade
      // signed by the deployer.
      const hash = await wallet.sendTransaction({
        to: RUN_ADDRESSES.swapRouter as `0x${string}`,
        data: encodeFunctionData({
          abi: SWAP_ABI,
          functionName: "swap",
          args: [
            {
              currency0: RUN_ADDRESSES.token0 as `0x${string}`,
              currency1: RUN_ADDRESSES.token1 as `0x${string}`,
              fee: SWAP.fee,
              tickSpacing: SWAP.tickSpacing,
              hooks: RUN_ADDRESSES.hook as `0x${string}`,
            },
            {
              zeroForOne: SWAP.zeroForOne,
              amountSpecified: SWAP.amountSpecified,
              sqrtPriceLimitX96: SWAP.sqrtPriceLimitX96,
            },
            { takeClaims: false, settleUsingBurn: false },
            "0x",
          ],
        }),
      });
      return NextResponse.json({ ok: true, step, hash }, { headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json(
      { ok: false, message: "this step is not available from the browser" },
      { status: 409 },
    );
  } catch (error) {
    // Never echo an error verbatim: some client stacks include the signing
    // payload, and a 32-byte hex run in an error string is indistinguishable
    // from key material at this point.
    const message = error instanceof Error ? error.message.slice(0, 200) : "transaction failed";
    return NextResponse.json(
      { ok: false, message: message.replace(/0x[0-9a-fA-F]{64}/g, "[redacted]") },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
