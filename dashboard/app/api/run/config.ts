// Configuration and guards for the operator run console.
//
// This endpoint signs with the deployer key and is deliberately open, so the
// guards below are the ONLY thing standing between it and a drained account.
// They are therefore derived from chain state rather than from process memory:
// a serverless instance can be replaced between two requests, so an in-memory
// counter would reset and a cooldown held in RAM would not hold at all.
//
// It also ships INERT. With no DEPLOYER_PRIVATE_KEY in the environment the
// endpoint reports "not configured" and refuses every write, so deploying this
// code does not by itself expose anything.

import { ADDRESSES, POOL_ID } from "../../live-config";
import { missingFrom, RUN_STEPS, type RunStep } from "./guards";

// One definition, re-exported: the step names are shared with the pure
// guard logic, which cannot import this file (it reaches the chain config).
export { RUN_STEPS, type RunStep };

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

// viem enforces EIP-55: a mixed-case address whose checksum does not match is
// rejected outright, which is how the swap router in the environment was found
// to be mis-cased. An all-lowercase address has no checksum to disagree with,
// so every address is normalised on the way in rather than trusted as written.
function address(name: string): string | undefined {
  const value = env(name);
  if (!value) return undefined;
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : undefined;
}

export const RUN_ENABLED = Boolean(env("DEPLOYER_PRIVATE_KEY"));

export const RUN_ADDRESSES = {
  swapRouter: address("ORIGIN_SWAP_ROUTER"),
  originTransmitter: address("ORIGIN_CIRCLE_MESSAGE_TRANSMITTER"),
  processorTransmitter: address("PROCESSOR_CIRCLE_MESSAGE_TRANSMITTER"),
  token0: address("DEMO_TOKEN0"),
  token1: address("DEMO_TOKEN1"),
  hook: ADDRESSES.hook.toLowerCase(),
  executor: ADDRESSES.executor.toLowerCase(),
  poolId: POOL_ID,
} as const;

/** Names of every setting a step needs, so the status can say what is missing. */
export function missingConfig(step: RunStep): string[] {
  return missingFrom(step, {
    DEPLOYER_PRIVATE_KEY: env("DEPLOYER_PRIVATE_KEY"),
    ORIGIN_SWAP_ROUTER: RUN_ADDRESSES.swapRouter,
    DEMO_TOKEN0: RUN_ADDRESSES.token0,
    DEMO_TOKEN1: RUN_ADDRESSES.token1,
    PROCESSOR_CIRCLE_MESSAGE_TRANSMITTER: RUN_ADDRESSES.processorTransmitter,
    ORIGIN_CIRCLE_MESSAGE_TRANSMITTER: RUN_ADDRESSES.originTransmitter,
  });
}

// The swap is fixed here, never taken from the request: a caller-supplied
// amount or direction would turn a bounded demo action into an arbitrary
// trade signed by the deployer.
export const SWAP = {
  /** Negative = exact input, matching CircleAcceptance.runSwap()'s requirement. */
  amountSpecified: -1_000_000_000_000_000n,
  zeroForOne: true,
  /** TickMath.MIN_SQRT_PRICE + 1, the zeroForOne limit. */
  sqrtPriceLimitX96: 4_295_128_740n,
  /** LPFeeLibrary.DYNAMIC_FEE_FLAG */
  fee: 8_388_608,
  tickSpacing: 60,
} as const;

// Hard caps. Balance floors are absolute: below them the endpoint refuses
// regardless of anything else, so the account cannot be run to zero.
// The floors are the only hard cap on loss, and it is worth being plain about
// why. executor.execute() is permissionless by design — anyone can call it from
// their own wallet forever — so a cooldown here protects the CONTRACT from
// nothing. What this endpoint is, is a gas faucet shaped like a button: it
// spends the deployer's testnet ETH on an anonymous caller's behalf. Cooldowns
// change the rate; only `balance - floor` changes the total.
//
// Measured 2026-09-03 at the prices of the day: a cycle costs ~0.0016 ETH on
// Ethereum Sepolia and a swap ~0.000001 ETH on Unichain, whose gas is 0.0015
// gwei. So the origin side is bounded by its cooldown rather than its balance,
// and the whole real exposure is the cycle step.
export const GUARDS = {
  originFloorWei: 2_000_000_000_000_000n, // 0.002 ETH
  processorFloorWei: 60_000_000_000_000_000n, // 0.06 ETH
  /** Minimum seconds between swaps, measured from the last SwapObserved log. */
  swapCooldownSeconds: 1_800,
  /**
   * Minimum seconds between cycles THIS endpoint signed, when the queue holds
   * work. Short on purpose: after a relay the visitor has about an hour of
   * referenceSelectionWindow to get the observation scored, and blocking them
   * would manufacture the exact ObservationExpired outcome the page documents
   * as a failure.
   */
  cycleCooldownSeconds: 120,
  /**
   * ...and when the queue is empty. Griefing is by definition cycling an empty
   * queue — such a cycle only refreshes the samplers — so the idle interval is
   * where the rate limit actually lives.
   */
  idleCycleCooldownSeconds: 900,
  /** Refuse a new swap while the processor still holds queued work. */
  requireEmptyQueue: true,
  /** Scan windows for the two cooldowns, kept together so they cannot drift. */
  swapScanBlocks: 10_000n,
  cycleScanBlocks: 2_000n,
  /**
   * Fee ceiling and per-step gas, so the cost of a press is arithmetic rather
   * than whatever the network charges that minute. Generous enough that an
   * ordinary Sepolia fee spike does not make the console look broken.
   */
  maximumFeePerGasWei: 5_000_000_000n, // 5 gwei
  maximumPriorityFeePerGasWei: 1_000_000_000n, // 1 gwei
  gasLimit: { swap: 900_000n, cycle: 1_500_000n, relay: 400_000n },
} as const;
