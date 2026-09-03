import { useState } from "react";
import type { DeploymentView } from "../../deployment-data";
import { shortHex } from "../format";
import type { AuthenticationView, ReactiveNetworkConfigView } from "./types";

const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

// Addresses arrive lower-cased from the route and checksum-cased from the
// manifest, so every comparison is on bytes, never on rendering. The zero
// address never counts as agreement: it is what a reverted or empty read
// decodes to, and two failed reads matching each other is not evidence.
function sameAddress(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  const normalised = left.toLowerCase();
  if (normalised === ZERO_ADDRESS) return false;
  return normalised === right.toLowerCase();
}

type Check = {
  id: string;
  claim: string;
  left: { label: string; value: string; provenance: string };
  right: { label: string; value: string; provenance: string };
  agrees: boolean;
};

export default function CallbackAuthentication({
  authentication,
  networkConfig,
  deployment,
}: {
  authentication: AuthenticationView | null;
  networkConfig: ReactiveNetworkConfigView | null;
  deployment: DeploymentView;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const processorChain = deployment.networks.find((network) => network.role === "processor");
  const reactiveChain = deployment.networks.find((network) => network.role === "reactive");
  const callback = authentication?.callback ?? null;
  const callbackUrl = authentication
    ? `${processorChain?.explorerBase}/tx/${authentication.transactionHash}`
    : null;

  // Nothing is claimed from a read that did not happen. The direct-getter path
  // never touches the executor, so this whole block withholds rather than
  // falling back to the manifest values it exists to check.
  if (!authentication || !callback) {
    return (
      <div className="auth-check unavailable">
        <p className="kicker">Callback authentication</p>
        <p>
          {authentication
            ? "The proven callback transaction did not come back from this read, so its calldata could not be compared against the executor’s guards."
            : "Not checked on this read — the direct-getter path does not touch the executor, and the manifest’s own copy of these addresses is what the check exists to verify."}
        </p>
      </div>
    );
  }

  const checks: Check[] = [
    {
      id: "proxy",
      claim: "the callback arrived from the sender the executor accepts",
      left: {
        label: "callback transaction was sent to",
        value: callback.to,
        provenance: `${processorChain?.name} · eth_getTransactionByHash · field "to"`,
      },
      right: {
        label: "executor accepts calls from",
        value: authentication.callbackProxy,
        provenance: `${processorChain?.name} · eth_call · reactiveCallbackProxy() 0x566353ab`,
      },
      agrees: sameAddress(callback.to, authentication.callbackProxy),
    },
    {
      id: "rvm",
      claim: "it presented the ReactiveVM id the executor is bound to",
      left: {
        label: "callback payload presented",
        value: callback.rvmArg,
        provenance: `${processorChain?.name} · executeFromReactive(address) 0x997ce1d5, decoded from the transaction’s own calldata`,
      },
      right: {
        label: "executor’s bound RVM id",
        value: authentication.rvmId,
        provenance: `${processorChain?.name} · eth_call · reactiveRvmId() 0x0c41fb9a`,
      },
      agrees: sameAddress(callback.rvmArg, authentication.rvmId),
    },
  ];

  // The third check is the one that crosses chains: the scheduler on Lasna
  // names the executor it drives, read inside the ReactiveVM, and that is the
  // contract the proven callback was actually pointed at on Ethereum Sepolia.
  if (networkConfig) {
    checks.push({
      id: "executor",
      claim: "it targeted the executor the scheduler on the other chain names",
      left: {
        label: "callback was pointed at",
        value: callback.targetArg,
        provenance: `${processorChain?.name} · callback(address,bytes) 0x246a9512, first argument`,
      },
      right: {
        label: "scheduler drives",
        value: networkConfig.executor,
        provenance: `${reactiveChain?.name} · rnk_call inside the ReactiveVM · networkConfig() 0x90ced421`,
      },
      agrees: sameAddress(callback.targetArg, networkConfig.executor),
    });

    // The scheduler's own view of the deployment names more than the executor.
    // Comparing the processor and the subscribed topic too is what makes this
    // agreement in both directions rather than a single term checked twice —
    // these were decoded for exactly this and never compared.
    const deployedProcessor = deployment.components.find(
      (component) => component.role === "processor" && /Processor$/.test(component.name),
    );
    if (deployedProcessor) {
      checks.push({
        id: "processor",
        claim: "the scheduler drives the processor this page reads",
        left: {
          label: "deployed processor",
          value: deployedProcessor.address,
          provenance: `${processorChain?.name} · deployment registry`,
        },
        right: {
          label: "scheduler names",
          value: networkConfig.processor,
          provenance: `${reactiveChain?.name} · rnk_call inside the ReactiveVM · networkConfig()`,
        },
        agrees: sameAddress(deployedProcessor.address, networkConfig.processor),
      });
    }

    checks.push({
      id: "cron-topic",
      claim: `it is subscribed to the ${deployment.automation.cronName} topic the deployment records`,
      left: {
        label: "recorded topic",
        value: deployment.automation.cronTopic,
        provenance: "deployment registry",
      },
      right: {
        label: "scheduler subscribes to",
        value: networkConfig.cronTopic,
        provenance: `${reactiveChain?.name} · rnk_call inside the ReactiveVM · networkConfig()`,
      },
      agrees:
        deployment.automation.cronTopic.toLowerCase() === networkConfig.cronTopic.toLowerCase() &&
        BigInt(networkConfig.cronTopic) !== BigInt(0),
    });
  }

  const failing = checks.filter((check) => !check.agrees);

  return (
    <div className={failing.length ? "auth-check failing" : "auth-check"}>
      <div className="auth-head">
        <p className="kicker">Callback authentication · checked on this read</p>
        <span className={failing.length ? "auth-verdict fail" : "auth-verdict pass"}>
          {failing.length
            ? `${failing.length} of ${checks.length} disagree`
            : `${checks.length} of ${checks.length} agree`}
        </span>
      </div>
      <ul className="auth-rows">
        {checks.map((check) => (
          <li className={check.agrees ? "auth-row" : "auth-row is-failing"} key={check.id}>
            <button
              aria-expanded={open === check.id}
              className="auth-toggle"
              onClick={() => setOpen((current) => (current === check.id ? null : check.id))}
              type="button"
            >
              <b>{check.agrees ? "AGREES" : "MISMATCH"}</b>
              <span>{check.claim}</span>
              <code>{shortHex(check.left.value, 8, 6)}</code>
              <i aria-hidden="true">{open === check.id ? "−" : "+"}</i>
            </button>
            {open === check.id ? (
              <dl className="auth-detail">
                {[check.left, check.right].map((term) => (
                  <div key={term.label}>
                    <dt>{term.label}</dt>
                    <dd>
                      <code>{term.value}</code>
                      <span>{term.provenance}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="card-caption">
        {`The executor’s rvmIdOnly and authorizedSenderOnly guards compare exactly these values, so a
        mismatch on any row would make every callback revert. Proven callback `}
        {callbackUrl ? (
          <a href={callbackUrl} rel="noreferrer" target="_blank">
            <code>{shortHex(authentication.transactionHash)}</code>
          </a>
        ) : (
          <code>{shortHex(authentication.transactionHash)}</code>
        )}
        {callback.blockNumber ? ` · block ${callback.blockNumber.toLocaleString("en")}` : ""}
        {callback.observedAt ? ` · ${new Date(callback.observedAt * 1_000).toISOString().replace("T", " ").slice(0, 19)}Z` : ""}
        {"."}
        {networkConfig
          ? ` The scheduler is configured to watch chain ${networkConfig.monitoredChainId}, act on chain ${networkConfig.destinationChainId}, and run on chain ${networkConfig.reactiveChainId}.`
          : ""}
      </p>
    </div>
  );
}
