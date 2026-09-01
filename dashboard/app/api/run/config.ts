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

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const RUN_ENABLED = Boolean(env("DEPLOYER_PRIVATE_KEY"));

export const RUN_ADDRESSES = {
  swapRouter: env("ORIGIN_SWAP_ROUTER"),
  originTransmitter: env("ORIGIN_CIRCLE_MESSAGE_TRANSMITTER"),
  processorTransmitter: env("PROCESSOR_CIRCLE_MESSAGE_TRANSMITTER"),
  token0: env("DEMO_TOKEN0"),
  token1: env("DEMO_TOKEN1"),
  hook: ADDRESSES.hook,
  executor: ADDRESSES.executor,
  poolId: POOL_ID,
} as const;

/** Names of every setting a step needs, so the status can say what is missing. */
export function missingConfig(step: RunStep): string[] {
  const need: Record<RunStep, [string, string | undefined][]> = {
    swap: [
      ["DEPLOYER_PRIVATE_KEY", env("DEPLOYER_PRIVATE_KEY")],
      ["ORIGIN_SWAP_ROUTER", RUN_ADDRESSES.swapRouter],
      ["DEMO_TOKEN0", RUN_ADDRESSES.token0],
      ["DEMO_TOKEN1", RUN_ADDRESSES.token1],
    ],
    relay: [
      ["DEPLOYER_PRIVATE_KEY", env("DEPLOYER_PRIVATE_KEY")],
      ["PROCESSOR_CIRCLE_MESSAGE_TRANSMITTER", RUN_ADDRESSES.processorTransmitter],
    ],
    cycle: [["DEPLOYER_PRIVATE_KEY", env("DEPLOYER_PRIVATE_KEY")]],
  };
  return need[step].filter(([, value]) => !value).map(([name]) => name);
}

export type RunStep = "swap" | "relay" | "cycle";
export const RUN_STEPS: RunStep[] = ["swap", "relay", "cycle"];

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
export const GUARDS = {
  originFloorWei: 2_000_000_000_000_000n, // 0.002 ETH
  processorFloorWei: 10_000_000_000_000_000n, // 0.01 ETH
  /** Minimum seconds between swaps, measured from the last SwapObserved log. */
  swapCooldownSeconds: 1_800,
  /** Refuse a new swap while the processor still holds queued work. */
  requireEmptyQueue: true,
} as const;
