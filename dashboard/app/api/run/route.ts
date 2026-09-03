import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, unichainSepolia } from "viem/chains";
import { ADDRESSES, EVENT_TOPICS, POOL_ID, REACTIVE_RVM_ID, RPC } from "../../live-config";
import { CIRCLE_DOMAIN, fetchAttestation } from "./circle";
import type { Leg } from "./guards";
import {
  GUARDS,
  missingConfig,
  RUN_ADDRESSES,
  RUN_ENABLED,
  RUN_STEPS,
  SWAP,
  type RunStep,
} from "./config";
import {
  cooldownGuard,
  floorGuard,
  isEndpointCycleLog,
  legFromCounters,
  redactError,
  type Guard,
} from "./guards";

export const dynamic = "force-dynamic";
// A press can wait on five bounded log scans, an 8s Circle call and a receipt.
// Declared on the segment rather than in vercel.json so it travels with the
// file: a wildcard glob there would also silently change /api/live, which runs
// on the platform default while its client waits 20s.
export const maxDuration = 60;

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
async function detectLeg(): Promise<Leg | null> {
  const [observed, received, dispatched, installed] = (await Promise.all([
    origin.readContract({ address: ADDRESSES.hook.toLowerCase() as `0x${string}`, abi: HOOK_ABI, functionName: "observationCount", args: [POOL_ID.toLowerCase() as `0x${string}`] }),
    processor.readContract({ address: ADDRESSES.processor.toLowerCase() as `0x${string}`, abi: PROCESSOR_ABI, functionName: "lastObservationId" }),
    processor.readContract({ address: ADDRESSES.processor.toLowerCase() as `0x${string}`, abi: PROCESSOR_ABI, functionName: "recommendationSequence" }),
    origin.readContract({ address: ADDRESSES.controller.toLowerCase() as `0x${string}`, abi: CONTROLLER_ABI, functionName: "lastSequence", args: [POOL_ID.toLowerCase() as `0x${string}`] }),
  ])) as [bigint, bigint, bigint, bigint];
  return legFromCounters(
    {
      observed: Number(observed),
      received: Number(received),
      dispatched: Number(dispatched),
      installed: Number(installed),
    },
    CIRCLE_DOMAIN,
  );
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

// The leg -> source transaction mapping is immutable once known: the message
// Circle indexed is the one that was sent. Memoised because finding it is the
// expensive half of the relay guard (up to five 10k/50k-block scans) and the
// console re-reads that guard every 20 seconds for half an hour while Circle
// finalises. Per-isolate, bounded and best effort, the same contract
// runTimelineCache carries — a cold isolate simply rescans.
//
// The ATTESTATION is deliberately not memoised: it is the thing being polled.
const sourceTxCache = new Map<string, string>();

async function sourceTransaction(leg: Leg): Promise<string | null> {
  const key = `${leg.name}:${leg.observationId ?? leg.sequence ?? ""}`;
  const cached = sourceTxCache.get(key);
  if (cached) return cached;
  const remember = (hash: string | null) => {
    if (!hash) return null;
    if (sourceTxCache.size > 32) sourceTxCache.clear();
    sourceTxCache.set(key, hash);
    return hash;
  };
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
    return remember(match?.transactionHash ?? null);
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
  return remember(match?.transactionHash ?? null);
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

// A transaction already in the mempool from this account. Serialises presses
// without any server state: a single EOA cannot land two transactions on one
// nonce, so this makes an existing accidental defence legible and turns what
// used to surface as viem's "replacement transaction underpriced" 502 into a
// plain refusal.
//
// It fails OPEN by construction. Unichain Sepolia's public RPC answers the
// pending tag unreliably (see nextNonce above); a broken tag returns 0, which
// is <= latest, which passes. A wrong answer disables the guard rather than
// bricking the console.
async function inFlightGuard(client: typeof origin | typeof processor, address: `0x${string}`): Promise<Guard> {
  const [latest, pending] = await Promise.all([
    client.getTransactionCount({ address, blockTag: "latest" }).catch(() => 0),
    client.getTransactionCount({ address, blockTag: "pending" }).catch(() => 0),
  ]);
  return {
    ok: pending <= latest,
    code: "in-flight",
    reason:
      pending <= latest
        ? "no transaction from this account is waiting to be mined"
        : "a transaction from this account is already in the mempool — one at a time",
  };
}

// The fee ceiling. Also fails open: an unavailable estimate is not evidence of
// an expensive network, and refusing on it would make the console look broken
// for a reason that has nothing to do with the chain.
async function feeGuard(client: typeof origin | typeof processor, label: string): Promise<Guard> {
  const fees = await client.estimateFeesPerGas().catch(() => null);
  const suggested = fees?.maxFeePerGas ?? null;
  if (suggested === null) {
    return { ok: true, code: "gas-ceiling", reason: `${label} fee estimate unavailable, so the ceiling is not enforced on this read` };
  }
  return {
    ok: suggested <= GUARDS.maximumFeePerGasWei,
    code: "gas-ceiling",
    reason: `${label} suggests ${(Number(suggested) / 1e9).toFixed(2)} gwei against the ${
      Number(GUARDS.maximumFeePerGasWei) / 1e9
    } gwei ceiling this endpoint will pay`,
  };
}

/** The unix timestamp of a log's block, or null when there is no such log. */
async function blockTimeOf(
  client: typeof origin | typeof processor,
  blockNumber: bigint | null | undefined,
): Promise<number | null> {
  if (!blockNumber) return null;
  const block = await client.getBlock({ blockNumber }).catch(() => null);
  return block ? Number(block.timestamp) : null;
}

// Every guard reads the chain. None of them trusts the request body, and none
// of them lives in process memory — a serverless instance can be replaced
// between two requests, so an in-memory counter would reset to zero and a
// cooldown held in RAM would not hold at all.
async function guardsFor(step: RunStep): Promise<Guard[]> {
  const guards: Guard[] = [];
  const address = guardAddress();
  const nowUnix = Math.floor(Date.now() / 1_000);
  // Reported as one more guard rather than as an early return, so the chain
  // conditions below are still evaluated and shown on an unarmed deployment.
  const missing = missingConfig(step);
  if (missing.length) {
    guards.push({ ok: false, code: "config", reason: `this deployment cannot sign: ${missing.join(", ")}` });
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
    guards.push(floorGuard({ balanceWei: balance, floorWei: GUARDS.originFloorWei, label: "origin", code: "origin-floor" }));
    guards.push({
      ok: !GUARDS.requireEmptyQueue || Number(pending) === 0,
      code: "queue",
      reason:
        Number(pending) === 0
          ? "the processor queue is empty, so a run may start"
          : `the processor still holds ${pending} queued observation(s) — one run at a time`,
    });
    // Cooldown measured from the last SwapObserved log rather than from a timer
    // this process owns, so it survives an instance being replaced. Unscoped on
    // purpose: any swap through the protected pool starts a run, whoever sent it.
    const logs = await origin.getLogs({
      address: ADDRESSES.hook.toLowerCase() as `0x${string}`,
      fromBlock: head - GUARDS.swapScanBlocks,
      toBlock: head,
    });
    const latest = logs.filter((log) => log.topics[0] === EVENT_TOPICS.swapObserved).at(-1);
    guards.push(
      cooldownGuard({
        lastEventUnix: await blockTimeOf(origin, latest?.blockNumber),
        nowUnix,
        cooldownSeconds: GUARDS.swapCooldownSeconds,
        label: "swap",
        code: "swap-cooldown",
        absentReason: "no swap inside the scan window, so no cooldown applies",
      }),
    );
    guards.push(await inFlightGuard(origin, address));
    guards.push(await feeGuard(origin, "Unichain Sepolia"));
  }

  if (step === "cycle") {
    const [balance, pending, head] = await Promise.all([
      processor.getBalance({ address }),
      processor.readContract({
        address: ADDRESSES.processor.toLowerCase() as `0x${string}`,
        abi: PROCESSOR_ABI,
        functionName: "pendingCount",
      }),
      processor.getBlockNumber(),
    ]);
    guards.push(
      floorGuard({ balanceWei: balance, floorWei: GUARDS.processorFloorWei, label: "processor", code: "processor-floor" }),
    );
    // Scoped to cycles THIS endpoint signed, so neither the Reactive scheduler
    // nor a third-party keeper can throttle the button — see isEndpointCycleLog.
    // An empty queue draws the longer interval: a cycle with nothing to advance
    // only refreshes the samplers, so that is where rate limiting belongs.
    const idle = Number(pending) === 0;
    const logs = await processor.getLogs({
      address: ADDRESSES.executor.toLowerCase() as `0x${string}`,
      fromBlock: head - GUARDS.cycleScanBlocks,
      toBlock: head,
    });
    const mine = logs
      .filter(
        (log) =>
          log.topics[0] === EVENT_TOPICS.automationCycleCompleted && isEndpointCycleLog(log.topics, address),
      )
      .at(-1);
    guards.push(
      cooldownGuard({
        lastEventUnix: await blockTimeOf(processor, mine?.blockNumber),
        nowUnix,
        cooldownSeconds: idle ? GUARDS.idleCycleCooldownSeconds : GUARDS.cycleCooldownSeconds,
        label: idle ? "cycle from here against an empty queue" : "cycle from here",
        code: "cycle-cooldown",
        absentReason: "no cycle from this endpoint inside the scan window, so no cooldown applies",
      }),
    );
    guards.push(await inFlightGuard(processor, address));
    guards.push(await feeGuard(processor, "Ethereum Sepolia"));
  }

  if (step === "relay") {
    // The wait for an attestation is long; the check is not. Circle answers in
    // well under a second, so the browser polls this and presses relay when it
    // flips — no request tries to hold itself open for half an hour.
    const leg = await detectLeg();
    if (!leg) {
      guards.push({
        ok: false,
        code: "leg",
        reason: "no Circle message is outstanding — both chains agree on what has been delivered",
      });
      return guards;
    }
    guards.push({
      ok: true,
      code: "leg",
      reason:
        leg.name === "outbound"
          ? `observation ${leg.observationId} is observed on the origin but not yet received by the processor`
          : `recommendation ${leg.sequence} is dispatched but not yet installed on the origin`,
    });

    const destination = leg.name === "outbound" ? processor : origin;
    const floor = leg.name === "outbound" ? GUARDS.processorFloorWei : GUARDS.originFloorWei;
    const balance = await destination.getBalance({ address });
    guards.push(floorGuard({ balanceWei: balance, floorWei: floor, label: "destination", code: "destination-floor" }));

    const sourceTx = await sourceTransaction(leg);
    if (!sourceTx) {
      guards.push({
        ok: false,
        code: "source-window",
        reason: "the source transaction is outside the bounded log window, so the attestation cannot be looked up",
      });
      return guards;
    }
    const attestation = await fetchAttestation(leg.sourceDomain, sourceTx);
    const unreachable = !attestation.ready && UNREACHABLE_ATTESTATION.test(attestation.status);
    guards.push({
      ok: attestation.ready,
      // A distinct code, so the console can tell a message that is still
      // finalising from an API it could not reach, and decline to poll the
      // second one at the fast attestation cadence.
      code: unreachable ? "attestation-unreachable" : "attestation",
      reason: attestation.ready
        ? "Circle has attested the message and it is ready to deliver"
        : // An unreachable API is not a reading of the message. Saying Circle
          // "holds the message until the source chain finalises" asserts a fact
          // that was never fetched, and reads as an ordinary wait rather than a
          // broken dependency — which also kept the console polling at the fast
          // attestation cadence indefinitely.
          unreachable
          ? `Circle's attestation API could not be reached on this read (${attestation.status}), so no claim is made about the message.`
          : `Circle reports "${attestation.status}"${attestation.detail ? ` — ${attestation.detail}` : ""}; it holds the message until the source chain finalises`,
    });
    guards.push(await inFlightGuard(destination, address));
    guards.push(await feeGuard(destination, leg.name === "outbound" ? "Ethereum Sepolia" : "Unichain Sepolia"));
  }

  return guards;
}

// The status is a pure read of public chain state with no per-caller variation,
// so the edge may share it: N concurrent readers cost one round of RPC instead
// of N. Ten seconds of staleness is invisible against a half-hour Circle wait.
// If a per-caller field is ever added here, this must go back to no-store.
const STATUS_CACHE = "public, max-age=0, s-maxage=10, stale-while-revalidate=50";

export async function GET(request: Request) {
  try {
    // ?steps=relay is the poll path. The console re-checks only the relay guard
    // while Circle holds a message, and the swap and cycle branches each cost a
    // bounded log scan that cannot have changed in the meantime.
    const requested = new URL(request.url).searchParams.get("steps");
    const selected = requested
      ? RUN_STEPS.filter((step) => requested.split(",").includes(step))
      : RUN_STEPS;
    const steps = await Promise.all(
      (selected.length ? selected : RUN_STEPS).map(async (step) => {
        const guards = await guardsFor(step).catch((error) => [
          { ok: false, code: "config" as const, reason: error instanceof Error ? error.message : "guard check failed" },
        ]);
        return { step, allowed: guards.every((guard) => guard.ok), guards };
      }),
    );
    return NextResponse.json(
      {
        ok: true,
        enabled: RUN_ENABLED,
        // The account the guards were evaluated against. Without it there is no
        // way to confirm a configured key parsed to the address expected — the
        // balances read identically either way, because an unarmed deployment
        // falls back to the same public deployer address. A runtime value, so
        // the phase-9 hex-literal gate never sees it.
        operator: RUN_ENABLED ? guardAddress() : null,
        /** True when this response covers only some steps, so the client merges. */
        partial: steps.length !== RUN_STEPS.length,
        steps,
        swap: { amountWei: SWAP.amountSpecified.toString(), zeroForOne: SWAP.zeroForOne },
      },
      { headers: { "cache-control": STATUS_CACHE } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "run status unavailable" },
      { status: 503, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }
}

// Statuses fetchAttestation returns when it never got an answer, as opposed to
// a status Circle itself reported about the message. "not found" and "unknown"
// are Circle answering — the message is simply not ready — so they stay on the
// ordinary waiting path.
const UNREACHABLE_ATTESTATION = /^(unavailable|circle http )/;

const NO_STORE = { "cache-control": "no-store" } as const;

// POST returns as soon as the transaction is broadcast, which used to mean a
// mined-and-reverted transaction reported ok:true. Waiting one confirmation
// makes the outcome truthful; a reverted swap in particular emits no
// SwapObserved, so it would also leave the swap cooldown silently disengaged.
// The wait fails soft — a slow block must not turn a successful broadcast into
// an error, so a timeout reports "pending" and the receipt link still resolves.
async function settle(
  client: typeof origin | typeof processor,
  hash: `0x${string}`,
  step: RunStep,
  extra: Record<string, unknown> = {},
) {
  const receipt = await client
    .waitForTransactionReceipt({ hash, confirmations: 1, timeout: 20_000 })
    .catch(() => null);
  return NextResponse.json(
    { ok: true, step, hash, outcome: receipt ? receipt.status : "pending", ...extra },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  // This endpoint holds a signing key and deliberately has no auth, so these
  // shape checks are the CSRF boundary and nothing else is.
  //
  // A cross-site <form> can send only text/plain, multipart/form-data or
  // x-www-form-urlencoded without triggering a preflight — and request.json()
  // parses the first of those quite happily. Requiring a JSON content type is
  // therefore what stops any page on the internet from making a visitor's
  // browser spend this key on their behalf.
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return NextResponse.json(
      { ok: false, message: "expected content-type: application/json" },
      { status: 415, headers: NO_STORE },
    );
  }
  // Every current browser sends this; curl does not, and curl is not the CSRF
  // vector. Enforced only when present, so a non-browser client still works.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return NextResponse.json(
      { ok: false, message: "cross-site requests are refused" },
      { status: 403, headers: NO_STORE },
    );
  }
  if (Number(request.headers.get("content-length") ?? "0") > 1_024) {
    return NextResponse.json({ ok: false, message: "request too large" }, { status: 413, headers: NO_STORE });
  }

  let step: RunStep;
  try {
    const body = (await request.json()) as { step?: string };
    if (!body.step || !RUN_STEPS.includes(body.step as RunStep)) {
      return NextResponse.json({ ok: false, message: "unknown step" }, { status: 400, headers: NO_STORE });
    }
    step = body.step as RunStep;
  } catch {
    return NextResponse.json({ ok: false, message: "invalid request" }, { status: 400, headers: NO_STORE });
  }

  const guards = await guardsFor(step).catch((error) => [
    { ok: false, code: "config" as const, reason: error instanceof Error ? error.message : "guard check failed" },
  ]);
  if (!guards.every((guard) => guard.ok)) {
    return NextResponse.json({ ok: false, message: "refused by a guard", guards }, { status: 409, headers: NO_STORE });
  }

  try {
    const account = signer();
    // Explicit on every send, so what a press costs is arithmetic rather than
    // whatever the network charges that minute. The gas-ceiling guard above
    // refuses when the suggested fee is over this, so a transaction is never
    // broadcast that the ceiling would underprice into the mempool forever.
    const fees = {
      maxFeePerGas: GUARDS.maximumFeePerGasWei,
      maxPriorityFeePerGas: GUARDS.maximumPriorityFeePerGasWei,
    };

    if (step === "cycle") {
      const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC.processor) });
      const hash = await wallet.sendTransaction({
        to: ADDRESSES.executor.toLowerCase() as `0x${string}`,
        data: encodeFunctionData({ abi: EXECUTOR_ABI, functionName: "execute" }),
        nonce: await nextNonce(processor, account.address),
        gas: GUARDS.gasLimit.cycle,
        ...fees,
      });
      return settle(processor, hash, step);
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
        gas: GUARDS.gasLimit.swap,
        ...fees,
      });
      return settle(origin, hash, step);
    }

    if (step === "relay") {
      // Re-derived and re-fetched at send time rather than carried from the
      // guard pass: between the poll and the press, the leg can change or a
      // newer message can supersede this one, and broadcasting a stale
      // message/attestation pair would revert on the transmitter.
      const leg = await detectLeg();
      if (!leg) {
        return NextResponse.json(
          { ok: false, message: "no Circle message is outstanding" },
          { status: 409, headers: NO_STORE },
        );
      }
      const sourceTx = await sourceTransaction(leg);
      if (!sourceTx) {
        return NextResponse.json(
          { ok: false, message: "the source transaction is outside the log window" },
          { status: 409, headers: NO_STORE },
        );
      }
      const attestation = await fetchAttestation(leg.sourceDomain, sourceTx);
      if (!attestation.ready) {
        return NextResponse.json(
          { ok: false, message: `Circle has not attested this message yet (${attestation.status})` },
          { status: 409, headers: NO_STORE },
        );
      }
      const outbound = leg.name === "outbound";
      const destination = outbound ? processor : origin;
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
        nonce: await nextNonce(destination, account.address),
        gas: GUARDS.gasLimit.relay,
        ...fees,
      });
      return settle(destination, hash, step, { leg: leg.name });
    }

    return NextResponse.json(
      { ok: false, message: "this step is not available from the browser" },
      { status: 409, headers: NO_STORE },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, message: redactError(error) }, { status: 502, headers: NO_STORE });
  }
}
