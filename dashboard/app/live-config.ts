import manifestJson from "../data/deployment_manifest.json";

type ManifestShape = {
  components: { name: string; address: string }[];
  reference_sampler: { sources: { source_id: string }[] };
  circle_messages: {
    kind: string;
    send_transaction_hash: string;
    relay_transaction_hash: string;
  }[];
  acceptance: {
    initial_swap_transaction_hash: string;
    later_swap_transaction_hash: string;
    reactive_callback_transaction_hash: string;
  };
  reactive_automation: {
    rsc_address: string;
    chain_id: number;
    deployer_rvm_id: string;
    callback_proxy: string;
    callback_transaction_hash: string;
  };
};

const manifest = manifestJson as unknown as ManifestShape;

function componentAddress(name: string): string {
  const entry = manifest.components.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`deployment manifest is missing component: ${name}`);
  return entry.address;
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const ADDRESSES = {
  hook: componentAddress("ThetaShieldHook"),
  controller: componentAddress("ThetaShieldController"),
  transport: componentAddress("ThetaShieldCircleTransport"),
  processor: componentAddress("ThetaShieldCircleProcessor"),
  originLens: env("THETASHIELD_ORIGIN_LENS_ADDRESS") ?? componentAddress("ThetaShieldLens"),
  processorLens:
    env("THETASHIELD_PROCESSOR_LENS_ADDRESS") ?? componentAddress("ThetaShieldProcessorLens"),
  executor: componentAddress("ThetaShieldAutomationExecutor"),
  reactiveRsc: manifest.reactive_automation.rsc_address,
} as const;

// An RSC's counters are mutated by react(), which runs in the deployer's
// ReactiveVM — not in the Lasna chain EVM. Reading them therefore needs the
// RVM-scoped rnk_call, addressed by this id.
export const REACTIVE_RVM_ID = manifest.reactive_automation.deployer_rvm_id;

// The proven authenticated callback. Its calldata carries the two values the
// executor's guards compare against, so the route reads the transaction back
// and the page checks them rather than restating them from this manifest.
export const REACTIVE_CALLBACK_TX = manifest.reactive_automation.callback_transaction_hash;
export const REACTIVE_CALLBACK_PROXY = manifest.reactive_automation.callback_proxy;

function circleMessage(kind: string) {
  const entry = manifest.circle_messages.find((candidate) => candidate.kind === kind);
  if (!entry) throw new Error(`deployment manifest is missing circle message: ${kind}`);
  return entry;
}

// The six transactions of the proven run, in execution order. Read back from
// their chains they are not six links but a measured sequence: the gaps between
// them are what Circle's transport and Reactive's wake actually cost. The order
// and the phase keys mirror `deployment-data.ts`'s receiptSpecs, so a receipt
// cannot drift away from the timeline step that dates it.
export const RUN_RECEIPTS = [
  { role: "origin", hash: manifest.acceptance.initial_swap_transaction_hash },
  { role: "processor", hash: circleMessage("observation").relay_transaction_hash },
  { role: "processor", hash: manifest.acceptance.reactive_callback_transaction_hash },
  { role: "processor", hash: circleMessage("recommendation").send_transaction_hash },
  { role: "origin", hash: circleMessage("recommendation").relay_transaction_hash },
  { role: "origin", hash: manifest.acceptance.later_swap_transaction_hash },
] as const;

// The pool id is not part of deployment manifest schema v3; this is the single
// permitted identifier fallback in dashboard app code.
export const POOL_ID =
  env("THETASHIELD_POOL_ID") ??
  "0x98cea44f9f7d6a1432b12a8a56e022758ffe447a9f2e529da7557eb788cdc2a5";

export const RPC = {
  origin: env("ORIGIN_RPC_URL") ?? "https://sepolia.unichain.org",
  processor: env("PROCESSOR_RPC_URL") ?? "https://ethereum-sepolia-rpc.publicnode.com",
  reactive: env("REACTIVE_RPC_URL") ?? "https://lasna-rpc.rnk.dev/",
} as const;

export const REFERENCE_SOURCE_IDS = manifest.reference_sampler.sources.map(
  (source) => source.source_id,
);

// Selects the default read path. The audited getters are also used without
// this setting when a lens read fails — see the fallback in the live route.
export const READ_PATH: "lens" | "historical-direct" =
  env("THETASHIELD_READ_PATH") === "direct" ? "historical-direct" : "lens";

// keccak256 event signatures (cast sig-event) for the bounded recent-events scan.
export const EVENT_TOPICS = {
  swapObserved: "0xe1655e511781940523ba9610e292e7d027c00210b5a7daa1633bbd57743f7cb3",
  epochFinalized: "0x2301a5b7a5ad77dfa48a72a559028974252497279ea60d68583b5db1e073dfa7",
  automationCycleCompleted: "0x91a4fb0010e3103f420e1c86baa6e886e4b2c7421a6eb760de97243caac65154",
} as const;
