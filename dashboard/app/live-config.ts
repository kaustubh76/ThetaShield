import manifestJson from "../data/deployment_manifest.json";

type ManifestShape = {
  components: { name: string; address: string }[];
  reference_sampler: { sources: { source_id: string }[] };
  reactive_automation: { rsc_address: string; chain_id: number };
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
