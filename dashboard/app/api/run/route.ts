import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, unichainSepolia } from "viem/chains";
import { ADDRESSES, EVENT_TOPICS, POOL_ID, REACTIVE_RVM_ID, RPC } from "../../live-config";
import { CIRCLE_DOMAIN, fetchAttestation } from "./circle";
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
const TRANSMITTER_ABI = parseAbi(["function receiveMessage(bytes message, bytes attestation) returns (bool)"]);
const PROCESSOR_ABI = parseAbi([
  "function pendingCount() view returns (uint16)",
  "function lastObservationId() view returns (uint64)",
  "function recommendationSequence() view returns (uint64)",
]);
const HOOK_ABI = parseAbi(["function observationCount(bytes32 poolId) view returns (uint64)"]);
const CONTROLLER_ABI = parseAbi(["function lastSequence(bytes32 poolId) view returns (uint64)"]);

// Which Circle leg, if any, is outstanding. Read from counters on both chains
// rather than taken from the request: the caller chooses nothing here, the same
// way it chooses none of the swap's arguments.
//
//   outbound  the hook has observed a swap the processor has not yet received
//   return    the processor has dispatched a recommendation the origin lacks
type Leg = { name: "outbound" | "return"; sourceDomain: number; observationId?: number; sequence?: number };

async function detectLeg(): Promise<Leg | null> {
  const [observed, received, dispatched, installed] = await Promise.all([
    origin.readContract({ address: ADDRESSES.hook.toLowerCase() as `0x${string}`, abi: HOOK_ABI, functionName: "observationCount", args: [POOL_ID.toLowerCase() as `0x${string}`] }),
    processor.readContract({ address: ADDRESSES.processor.toLowerCase() as `0x${string}`, abi: PROCESSOR_ABI, functionName: "lastObservationId" }),
    processor.readContract({ address: ADDRESSES.processor.toLowerCase() as `0x${string}`, abi: PROCESSOR_ABI, functionName: "recommendationSequence" }),
    origin.readContract({ address: ADDRESSES.controller.toLowerCase() as `0x${string}`, abi: CONTROLLER_ABI, functionName: "lastSequence", args: [POOL_ID.toLowerCase() as `0x${string}`] }),
  ]);
  if (Number(observed) > Number(received)) {
    return { name: "outbound", sourceDomain: CIRCLE_DOMAIN.origin, observationId: Number(observed) };
  }
  if (Number(dispatched) > Number(installed)) {
    return { name: "return", sourceDomain: CIRCLE_DOMAIN.processor, sequence: Number(dispatched) };
  }
  return null;
}

// The transaction Circle indexed the message under. Found by a bounded scan of
// the same windows readEvents already uses, which comfortably cover a run
// started from the console minutes earlier.
//
// Retried on an empty result for the same reason readEvents retries: these
// public endpoints are load balanced and a backend with an incomplete log index
// answers an identical query with nothing. Caught live — the relay guard
// flipped from Circle's real status to "outside the log window" between two
// polls, for a swap sitting 40 blocks inside it.
async function scanWithRetries(read: () => Promise<readonly unknown[]>, attempts = 5) {
  let logs = await read().catch(() => [] as readonly unknown[]);
  for (let attempt = 1; attempt < attempts && !logs.length; attempt += 1) {
    logs = await read().catch(() => logs);
  }
  return logs;
}

async function sourceTransaction(leg: Leg): Promise<string | null> {
  if (leg.name === "outbound") {
    const head = await origin.getBlockNumber();
    const logs = (await scanWithRetries(() =>
      origin.getLogs({
        address: ADDRESSES.hook.toLowerCase() as `0x${string}`,
        fromBlock: head - 10_000n,
        toBlock: head,
      }),
    )) as { topics: string[]; transactionHash: string }[];
    const match = logs
      .filter((log) => log.topics[0] === EVENT_TOPICS.swapObserved)
      .find((log) => log.topics[2] && Number(BigInt(log.topics[2])) === leg.observationId);
    return match?.transactionHash ?? null;
  }
  const head = await processor.getBlockNumber();
  const logs = (await scanWithRetries(() =>
    processor.getLogs({
      address: ADDRESSES.executor.toLowerCase() as `0x${string}`,
      fromBlock: head - 50_000n,
      toBlock: head,
    }),
  )) as { topics: string[]; transactionHash: string }[];
  const match = logs.filter((log) => log.topics[0] === EVENT_TOPICS.automationCycleCompleted).at(-1);
  return match?.transactionHash ?? null;
}

const origin = createPublicClient({ chain: unichainSepolia, transport: http(RPC.origin) });
const processor = createPublicClient({ chain: sepolia, transport: http(RPC.processor) });

function signer() {
  const secret = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!secret) throw new Error("this deployment has no signing key configured");
  return privateKeyToAccount((secret.startsWith("0x") ? secret : `0x${secret}`) as `0x${string}`);
}

// The account the guards are evaluated against. With a key configured it is the
// signer; without one it is the deployer address from the manifest, which is the
// same account and is public. That distinction matters: it lets an unarmed
// deployment still answer "what would be permitted right now" truthfully, which
// the console claims and previously could not deliver — guardsFor returned early
// on missing config and never touched the chain.
function guardAddress(): `0x${string}` {
  try {
    return signer().address;
  } catch {
    return REACTIVE_RVM_ID.toLowerCase() as `0x${string}`;
  }
}

// Nonce selection, the hard way, because both obvious answers are wrong here.
//
// The default lands on whichever load-balanced backend answers, and one that is
// a block behind hands back a nonce already spent. The usual remedy — asking
// for the "pending" tag — is worse on Unichain Sepolia's public RPC, which
// answered pending = 0 in 9 of 12 consecutive samples while latest correctly
// answered 20. So: sample "latest" a few times and take the highest, which
// discards a stale backend without trusting a tag this provider does not
// implement.
async function nextNonce(
  client: typeof origin | typeof processor,
  address: `0x${string}`,
): Promise<number> {
  const samples = await Promise.all(
    [0, 1, 2].map(() => client.getTransactionCount({ address, blockTag: "latest" }).catch(() => 0)),
  );
  return Math.max(...samples);
}

type Guard = { ok: boolean; reason: string };

// Every guard reads the chain. None of them trusts the request body, and none
// of them lives in process memory — a serverless instance can be replaced
// between two requests, so an in-memory counter would reset to zero and a
// cooldown held in RAM would not hold at all.
async function guardsFor(step: RunStep): Promise<Guard[]> {
  const guards: Guard[] = [];
  const address = guardAddress();
  // Reported as one more guard rather than as an early return, so the chain
  // conditions below are still evaluated and shown on an unarmed deployment.
  const missing = missingConfig(step);
  if (missing.length) {
    guards.push({ ok: false, reason: `this deployment cannot sign: ${missing.join(", ")}` });
  }

  if (step === "swap") {
    const [balance, pending, head] = await Promise.all([
      origin.getBalance({ address }),
      processor.readContract({
        address: ADDRESSES.processor.toLowerCase() as `0x${string}`,
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
      address: ADDRESSES.hook.toLowerCase() as `0x${string}`,
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
    // The wait for an attestation is long; the check is not. Circle answers in
    // well under a second, so the browser polls this and presses relay when it
    // flips — no request tries to hold itself open for half an hour.
    const leg = await detectLeg();
    if (!leg) {
      guards.push({ ok: false, reason: "no Circle message is outstanding — both chains agree on what has been delivered" });
      return guards;
    }
    guards.push({
      ok: true,
      reason:
        leg.name === "outbound"
          ? `observation ${leg.observationId} is observed on the origin but not yet received by the processor`
          : `recommendation ${leg.sequence} is dispatched but not yet installed on the origin`,
    });

    const destination = leg.name === "outbound" ? processor : origin;
    const floor = leg.name === "outbound" ? GUARDS.processorFloorWei : GUARDS.originFloorWei;
    const balance = await destination.getBalance({ address });
    guards.push({
      ok: balance > floor,
      reason: `destination balance ${(Number(balance) / 1e18).toFixed(5)} ETH against a ${Number(floor) / 1e18} ETH floor`,
    });

    const sourceTx = await sourceTransaction(leg);
    if (!sourceTx) {
      guards.push({ ok: false, reason: "the source transaction is outside the bounded log window, so the attestation cannot be looked up" });
      return guards;
    }
    const attestation = await fetchAttestation(leg.sourceDomain, sourceTx);
    guards.push({
      ok: attestation.ready,
      reason: attestation.ready
        ? "Circle has attested the message and it is ready to deliver"
        : `Circle reports "${attestation.status}"${attestation.detail ? ` — ${attestation.detail}` : ""}; it holds the message until the source chain finalises`,
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
        to: ADDRESSES.executor.toLowerCase() as `0x${string}`,
        data: encodeFunctionData({ abi: EXECUTOR_ABI, functionName: "execute" }),
        nonce: await nextNonce(processor, account.address),
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
              hooks: RUN_ADDRESSES.hook.toLowerCase() as `0x${string}`,
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
        nonce: await nextNonce(origin, account.address),
      });
      return NextResponse.json({ ok: true, step, hash }, { headers: { "cache-control": "no-store" } });
    }
    if (step === "relay") {
      // Re-derived and re-fetched at send time rather than carried from the
      // guard pass: between the poll and the press, the leg can change or a
      // newer message can supersede this one, and broadcasting a stale
      // message/attestation pair would revert on the transmitter.
      const leg = await detectLeg();
      if (!leg) {
        return NextResponse.json({ ok: false, message: "no Circle message is outstanding" }, { status: 409 });
      }
      const sourceTx = await sourceTransaction(leg);
      if (!sourceTx) {
        return NextResponse.json({ ok: false, message: "the source transaction is outside the log window" }, { status: 409 });
      }
      const attestation = await fetchAttestation(leg.sourceDomain, sourceTx);
      if (!attestation.ready) {
        return NextResponse.json(
          { ok: false, message: `Circle has not attested this message yet (${attestation.status})` },
          { status: 409 },
        );
      }
      const outbound = leg.name === "outbound";
      const wallet = createWalletClient({
        account,
        chain: outbound ? sepolia : unichainSepolia,
        transport: http(outbound ? RPC.processor : RPC.origin),
      });
      const hash = await wallet.sendTransaction({
        to: (outbound ? RUN_ADDRESSES.processorTransmitter : RUN_ADDRESSES.originTransmitter) as `0x${string}`,
        data: encodeFunctionData({
          abi: TRANSMITTER_ABI,
          functionName: "receiveMessage",
          args: [attestation.message as `0x${string}`, attestation.attestation as `0x${string}`],
        }),
        nonce: await nextNonce(outbound ? processor : origin, account.address),
      });
      return NextResponse.json({ ok: true, step, leg: leg.name, hash }, { headers: { "cache-control": "no-store" } });
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
