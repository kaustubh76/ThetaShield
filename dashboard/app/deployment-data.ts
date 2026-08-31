import manifestJson from "../data/deployment_manifest.json";
import gasJson from "../data/gas_snapshots.json";

type ManifestNetwork = {
  role: "origin" | "processor";
  name: string;
  chain_id: number;
  circle_domain: number;
  message_transmitter: string;
};

type ManifestComponent = {
  name: string;
  network_role: "origin" | "processor" | "reactive";
  address: string;
  transaction_hash: string;
  block_number: number;
  explorer_url: string;
  verified: boolean;
};

type ManifestCircleMessage = {
  kind: "observation" | "recommendation";
  source_domain: number;
  destination_domain: number;
  send_transaction_hash: string;
  relay_transaction_hash: string;
  message_hash: string;
  status: string;
};

type DeploymentManifest = {
  schema_version: number;
  mode: string;
  source_revision: string;
  created_at: string;
  profile: { name: string; id: string };
  reference_sampler: {
    mode: string;
    market_id: string;
    sources: { source_id: string; pool_id: string; minimum_liquidity: string }[];
  };
  reactive_automation: {
    mode: string;
    network_name: string;
    chain_id: number;
    cron_name: string;
    cron_topic: string;
    callback_proxy: string;
    executor_address: string;
    rsc_address: string;
    executor_transaction_hash: string;
    rsc_transaction_hash: string;
    callback_transaction_hash: string;
    status: string;
  };
  networks: ManifestNetwork[];
  components: ManifestComponent[];
  circle_messages: ManifestCircleMessage[];
  acceptance: {
    preflight_fingerprints: string[];
    initial_swap_transaction_hash: string;
    reference_transaction_hash: string;
    processor_transaction_hash: string;
    later_swap_transaction_hash: string;
    reactive_callback_transaction_hash: string;
    reactive_cycle_id: number;
    expected_fee_pips: number;
    observed_fee_pips: number;
    passed: boolean;
  };
  cost: {
    network_role: string;
    currency: string;
    gas_limit: number;
    estimated_maximum: string;
    actual: string;
    approved_by_owner: boolean;
  }[];
};

const manifest = manifestJson as unknown as DeploymentManifest;
const gasSnapshots = gasJson as unknown as Record<string, Record<string, number>>;

function component(name: string): ManifestComponent {
  const found = manifest.components.find((entry) => entry.name === name);
  if (!found) throw new Error(`deployment manifest is missing component: ${name}`);
  return found;
}

function explorerBase(url: string): string {
  const marker = url.indexOf("/address/");
  if (marker < 0) throw new Error(`unexpected explorer URL shape: ${url}`);
  return url.slice(0, marker);
}

function roleExplorerBase(role: ManifestComponent["network_role"]): string {
  const sample = manifest.components.find((entry) => entry.network_role === role);
  if (!sample) throw new Error(`deployment manifest has no component for role: ${role}`);
  return explorerBase(sample.explorer_url);
}

const explorerByRole = {
  origin: roleExplorerBase("origin"),
  processor: roleExplorerBase("processor"),
  reactive: roleExplorerBase("reactive"),
} as const;

function txUrl(role: ManifestComponent["network_role"], hash: string): string {
  return `${explorerByRole[role]}/tx/${hash}`;
}

const originNetwork = manifest.networks.find((network) => network.role === "origin");
const processorNetwork = manifest.networks.find((network) => network.role === "processor");
if (!originNetwork || !processorNetwork) {
  throw new Error("deployment manifest must declare origin and processor networks");
}

const networks = [
  {
    role: "origin" as const,
    name: originNetwork.name,
    chainId: originNetwork.chain_id,
    circleDomain: originNetwork.circle_domain,
    explorerBase: explorerByRole.origin,
  },
  {
    role: "processor" as const,
    name: processorNetwork.name,
    chainId: processorNetwork.chain_id,
    circleDomain: processorNetwork.circle_domain,
    explorerBase: explorerByRole.processor,
  },
  {
    role: "reactive" as const,
    name: manifest.reactive_automation.network_name,
    chainId: manifest.reactive_automation.chain_id,
    circleDomain: null,
    explorerBase: explorerByRole.reactive,
  },
];

const networkByRole = {
  origin: networks[0],
  processor: networks[1],
  reactive: networks[2],
} as const;

const components = manifest.components.map((entry) => ({
  name: entry.name,
  role: entry.network_role,
  networkName: networkByRole[entry.network_role].name,
  address: entry.address,
  txHash: entry.transaction_hash,
  txUrl: txUrl(entry.network_role, entry.transaction_hash),
  blockNumber: entry.block_number,
  explorerUrl: entry.explorer_url,
  verified: entry.verified,
}));

const coreAddressLabels = [
  ["Hook", "ThetaShieldHook"],
  ["Controller", "ThetaShieldController"],
  ["Circle transport", "ThetaShieldCircleTransport"],
  ["Processor", "ThetaShieldCircleProcessor"],
  ["Reactive RSC", "ThetaShieldAutomationRSC"],
] as const;

const coreAddresses = coreAddressLabels.map(([label, name]) => {
  const entry = component(name);
  return { label, name, address: entry.address, explorerUrl: entry.explorer_url };
});

const observationMessage = manifest.circle_messages.find((entry) => entry.kind === "observation");
const recommendationMessage = manifest.circle_messages.find(
  (entry) => entry.kind === "recommendation",
);
if (!observationMessage || !recommendationMessage) {
  throw new Error("deployment manifest must record observation and recommendation messages");
}

const acceptance = manifest.acceptance;

const receiptSpecs = [
  ["Swap observed", "origin", acceptance.initial_swap_transaction_hash],
  ["Circle observation received", "processor", observationMessage.relay_transaction_hash],
  ["Authenticated processing callback", "processor", acceptance.reactive_callback_transaction_hash],
  ["Recommendation sent", "processor", recommendationMessage.send_transaction_hash],
  ["Recommendation installed", "origin", recommendationMessage.relay_transaction_hash],
  ["Hook fee proven", "origin", acceptance.later_swap_transaction_hash],
] as const;

const receipts = receiptSpecs.map(([title, role, hash], index) => ({
  index: String(index + 1).padStart(2, "0"),
  title,
  role,
  chainName: networkByRole[role].name,
  hash,
  url: txUrl(role, hash),
}));

const circleMessages = manifest.circle_messages.map((entry) => ({
  kind: entry.kind,
  sourceDomain: entry.source_domain,
  destinationDomain: entry.destination_domain,
  sendTxHash: entry.send_transaction_hash,
  sendTxUrl: txUrl(entry.kind === "observation" ? "origin" : "processor", entry.send_transaction_hash),
  relayTxHash: entry.relay_transaction_hash,
  relayTxUrl: txUrl(
    entry.kind === "observation" ? "processor" : "origin",
    entry.relay_transaction_hash,
  ),
  messageHash: entry.message_hash,
  status: entry.status,
}));

const hookGas = gasSnapshots.ThetaShieldHookGasTest ?? {};
const controllerGas = gasSnapshots.ThetaShieldControllerGasTest ?? {};
const beforeSwap = hookGas.phase5_before_swap ?? 0;
const afterSwapWarm = hookGas.phase5_after_swap_warm ?? 0;

export const deploymentView = {
  sourceRevision: manifest.source_revision,
  createdAt: manifest.created_at,
  profile: { name: manifest.profile.name, id: manifest.profile.id },
  networks,
  components,
  coreAddresses,
  receipts,
  circleMessages,
  acceptance: {
    expectedFeePips: acceptance.expected_fee_pips,
    observedFeePips: acceptance.observed_fee_pips,
    passed: acceptance.passed,
    reactiveCycleId: acceptance.reactive_cycle_id,
    preflightFingerprints: acceptance.preflight_fingerprints,
  },
  referenceSampler: {
    mode: manifest.reference_sampler.mode,
    marketId: manifest.reference_sampler.market_id,
    sources: manifest.reference_sampler.sources.map((entry) => ({
      sourceId: entry.source_id,
      poolId: entry.pool_id,
      minimumLiquidity: entry.minimum_liquidity,
    })),
  },
  automation: {
    mode: manifest.reactive_automation.mode,
    networkName: manifest.reactive_automation.network_name,
    chainId: manifest.reactive_automation.chain_id,
    cronName: manifest.reactive_automation.cron_name,
    cronTopic: manifest.reactive_automation.cron_topic,
    callbackProxy: manifest.reactive_automation.callback_proxy,
    rscAddress: manifest.reactive_automation.rsc_address,
    executorAddress: manifest.reactive_automation.executor_address,
    rscTxUrl: txUrl("reactive", manifest.reactive_automation.rsc_transaction_hash),
    executorTxUrl: txUrl("processor", manifest.reactive_automation.executor_transaction_hash),
    callbackTxUrl: txUrl("processor", manifest.reactive_automation.callback_transaction_hash),
    status: manifest.reactive_automation.status,
  },
  cost: manifest.cost.map((entry) => ({
    role: entry.network_role,
    networkName:
      entry.network_role === "origin" ? networkByRole.origin.name : networkByRole.processor.name,
    currency: entry.currency,
    gasLimit: entry.gas_limit,
    estimatedMaximum: entry.estimated_maximum,
    actual: entry.actual,
    approvedByOwner: entry.approved_by_owner,
  })),
  gas: {
    beforeSwap,
    afterSwapWarm,
    hookTotal: beforeSwap + afterSwapWarm,
    applyCold: controllerGas.phase7_apply_recommendation_cold ?? 0,
    applyWarm: controllerGas.phase7_apply_recommendation_warm ?? 0,
    feeForSwapWarm: controllerGas.phase7_fee_for_swap_warm ?? 0,
  },
};

export type DeploymentView = typeof deploymentView;
