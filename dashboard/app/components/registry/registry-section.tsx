import type { DeploymentView } from "../../deployment-data";
import type { DeployedConfigView } from "../live-proof/types";
import Accordion from "../accordion";
import { formatInt, shortHex } from "../format";
import DeployedParameters from "./deployed-parameters";

// Both lists are built from the manifest and the live deployed configuration
// rather than typed as prose: every count and chain name below also renders
// dynamically elsewhere on this page, and a hand-typed copy would be the one
// that goes stale.
function buildJudgeQuestions(deployment: DeploymentView) {
  const origin = deployment.networks.find((network) => network.role === "origin")?.name ?? "the origin chain";
  const processor = deployment.networks.find((network) => network.role === "processor")?.name ?? "the processor chain";
  const tierCount = deployment.referenceSampler.sources.length;
  return [
  {
    question: "Why split the system across chains?",
    answer:
      `The latency-sensitive hook stays small and deterministic on ${origin}, while delayed histories, bounded queues, confidence, persistence, and reference selection live on ${processor}. ${deployment.automation.networkName} runs only the automation plane, which schedules bounded work and holds no fee authority. Cross-chain delivery is never required for the current swap — it updates later swaps.`,
  },
  {
    question: "Why would a trader use it?",
    answer:
      "Routers choose pools by the all-in quote. ThetaShield aims to let LPs keep a low baseline for ordinary flow instead of charging every trader a permanent volatility premium. The commercial claim still requires real-market routing, depth, and elasticity evidence.",
  },
  {
    question: "Can an operator label a wallet toxic?",
    answer:
      "No. The mechanism evaluates delayed directional price outcomes and never uses a wallet blacklist or identity score.",
  },
  {
    question: "What if Circle or Reactive stops?",
    answer:
      "The current swap continues. Existing recommendations expire and the controller returns to the bounded baseline. Reactive is outside the critical path.",
    },
  {
    question: "Is the live reference price real market data?",
    answer:
      `No. The ${deployment.profile.name} reference market is ${tierCount} fee tiers of a project-issued pair on ${processor}, separate from the protected ${origin} pair, seeded and moved by the operator. It exercises the full multi-source path — liquidity floors, robust median, dispersion, confidence — against a controlled market. Independent evidence needs reference tiers co-located with the protected pair; that is the next architectural step, not a claim made today.`,
  },
  {
    question: "Why did the live fee not increase?",
    answer:
      "The completed samples are deliberately cold start and carry zero shared confidence, so both directions hold the configured baseline. A safety mechanism that moved the fee off one observation would be easier to demo but easier to manipulate. A non-baseline directional fee needs a mature trailing window and shared confidence above the deployed floor; the local end-to-end lifecycle proves that transition, and the live panel above reports the current cycle count and confidence.",
  },
  ] as const;
}

// The fee-curve numbers are read live one accordion above and are allowed to
// differ from the research bundle, so the glossary defines the units and defers
// the values rather than restating them as fixed facts.
function buildGlossary(deployment: DeploymentView, deployedConfig: DeployedConfigView | null) {
  const baselinePips = deployedConfig?.feeCurve.baseFeePips ?? null;
  const capPips = deployedConfig?.feeCurve.maximumFeePips ?? null;
  const feePipsDefinition = baselinePips !== null && capPips !== null
    ? `1,000,000 pips = 100%. This pool's deployed baseline of ${formatInt(baselinePips)} pips is ${baselinePips / 100} bps and its cap of ${formatInt(capPips)} pips is ${capPips / 100} bps, both read live above.`
    : "1,000,000 pips = 100%, so 100 pips is 1 bp. The deployed baseline and cap for this pool are read live in the deployed-parameters table above.";
  return [
  ["signed markout", "direction × (reference price − execution price) / execution price — the post-trade outcome with its sign preserved."],
  ["dead band", "k × trailing volatility. Movement inside the band is treated as noise; the current sample is excluded from its own band."],
  ["n-of-k persistence", "activation requires at least n toxic epochs inside a k-epoch window, so one noisy sample cannot move the fee."],
  ["fee pips", feePipsDefinition],
  ["WAD", "fixed-point unit where 1e18 represents 1.0 — used for prices, markouts, risk, and confidence."],
  ["coverage premium", "a bounded fee component that responds to estimated-loss coverage deficits, separate from the toxic premium."],
  [deployment.profile.name, `the live release profile: a permissionless ${deployment.referenceSampler.mode} sampler over ${deployment.referenceSampler.sources.length} liquidity-qualified pools replaces the owner-published demo feed used by the historical Phase 8D proof.`],
  ] as const;
}

function domainRoute(sourceDomain: number, destinationDomain: number): string {
  return `domain ${sourceDomain} → ${destinationDomain}`;
}

export default function RegistrySection({
  deployment,
  researchConfig,
  deployedConfig,
  liveStatus,
  readPath,
  finalizedThreshold,
}: {
  deployment: DeploymentView;
  researchConfig: { key: string; value: string }[];
  deployedConfig: DeployedConfigView | null;
  liveStatus: "loading" | "ready" | "stale" | "error";
  readPath: "lens" | "historical-direct" | null;
  finalizedThreshold: number | null;
}) {
  const roles: ("origin" | "processor" | "reactive")[] = ["origin", "processor", "reactive"];
  const judgeQuestions = buildJudgeQuestions(deployment);
  const glossary = buildGlossary(deployment, deployedConfig);

  return (
    <section className="section registry" id="registry">
      <div className="section-heading split-heading">
        <div><p className="kicker">Verification registry</p><h2>Every claim opens to a receipt.</h2></div>
        <p>
          {`Deployment ${shortHex(deployment.profile.id, 10)} · profile ${deployment.profile.name} · source revision ${deployment.sourceRevision.slice(0, 12)} · recorded ${deployment.createdAt.slice(0, 10)}. Everything below is generated from that recorded manifest; the deployed-parameter table reads the chain directly.`}
        </p>
      </div>

      <Accordion badge="01" id="registry-components" meta={`${deployment.components.length} components · ${deployment.networks.length} networks`} title="Deployment registry">
        {roles.map((role) => {
          const rows = deployment.components.filter((component) => component.role === role);
          const network = deployment.networks.find((entry) => entry.role === role);
          if (!rows.length || !network) return null;
          return (
            <div className="component-group" key={role}>
              <h4>{`${network.name} · chain ${network.chainId}${network.circleDomain !== null ? ` · Circle domain ${network.circleDomain}` : ""}`}</h4>
              <div className="component-rows">
                {rows.map((component) => (
                  <div className="component-row" key={component.name}>
                    <b>{component.name}</b>
                    <code>{shortHex(component.address)}</code>
                    <span>{`block ${formatInt(component.blockNumber)}`}</span>
                    <em className={component.verified ? "verified" : "unverified"}>
                      {component.verified ? "source verified" : "unverified · proven by receipts"}
                    </em>
                    <span className="component-links">
                      <a href={component.txUrl} rel="noreferrer" target="_blank">deploy tx ↗</a>
                      <a href={component.explorerUrl} rel="noreferrer" target="_blank">explorer ↗</a>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </Accordion>

      <Accordion
        badge="02"
        id="registry-circle"
        meta={`${deployment.circleMessages.length} messages${finalizedThreshold === null ? "" : ` · finality ${formatInt(finalizedThreshold)}`}`}
        title="Circle message evidence"
      >
        <div className="component-rows">
          {deployment.circleMessages.map((message) => (
            <div className="component-row circle-row" key={message.messageHash}>
              <b>{message.kind}</b>
              <span>{domainRoute(message.sourceDomain, message.destinationDomain)}</span>
              <code title={message.messageHash}>{shortHex(message.messageHash, 12, 8)}</code>
              <em className={message.status === "complete" ? "verified" : "unverified"}>{message.status}</em>
              <span className="component-links">
                <a href={message.sendTxUrl} rel="noreferrer" target="_blank">send tx ↗</a>
                <a href={message.relayTxUrl} rel="noreferrer" target="_blank">relay tx ↗</a>
              </span>
            </div>
          ))}
        </div>
        <p className="card-caption">
          Generic CCTP V2 messages — no USDC burn. Delivery is permissionless; the receiving contract authenticates
          transmitter, source domain, sealed peer, and finality before any state changes.
        </p>
      </Accordion>

      <Accordion
        badge="03"
        id="registry-parameters"
        meta={`${researchConfig.length} research keys · ${
          liveStatus === "ready" || liveStatus === "stale" ? "deployed values read from chain" : "reading deployed values"
        }`}
        title="Deployed parameters"
      >
        <DeployedParameters
          config={deployedConfig}
          readPath={readPath}
          researchConfig={researchConfig}
          status={liveStatus}
        />
      </Accordion>

      <Accordion
        badge="04"
        id="registry-reference"
        meta="cost · gas · judge Q&A · glossary"
        title="Reference"
      >
        <h4 className="reference-heading">Deployment cost</h4>
          <div className="cost-rows">
            {deployment.cost.map((entry) => {
              const actual = Number.parseFloat(entry.actual);
              const estimated = Number.parseFloat(entry.estimatedMaximum);
              const share = estimated > 0 ? Math.min(100, (actual / estimated) * 100) : 0;
              return (
                <div className="cost-row" key={entry.role}>
                  <div className="cost-head">
                    <b>{entry.networkName}</b>
                    <span>{`gas limit ${formatInt(entry.gasLimit)}`}</span>
                    <em className={entry.approvedByOwner ? "verified" : "unverified"}>{entry.approvedByOwner ? "owner approved" : "not approved"}</em>
                  </div>
                  <div className="cost-bar" role="img" aria-label={`${entry.networkName}: actual spend ${entry.actual} of approved maximum ${entry.estimatedMaximum} ${entry.currency}`}>
                    <i style={{ width: `${Math.max(1.5, share)}%` }} />
                  </div>
                  <div className="cost-figures">
                    <span>{`actual ${actual} `}</span>
                    <span>{`approved max ${estimated} ${entry.currency}`}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="fingerprints">
            <h4>Preflight fingerprints</h4>
            {deployment.acceptance.preflightFingerprints.map((fingerprint) => (
              <code key={fingerprint}>{fingerprint}</code>
            ))}
          </div>
        <h4 className="reference-heading">Measured gas</h4>
          <div className="gas-panel">
            <div className="card-title"><span>MEASURED GAS · ISOLATED LOCAL EVM</span><b>{`hook total ${formatInt(deployment.gas.hookTotal)} per swap`}</b></div>
            <div className="gas-rows">
              <div className="gas-row">
                <span>hook · beforeSwap + afterSwap (warm)</span>
                <div className="gas-bar" role="img" aria-label={`Hook gas: beforeSwap ${formatInt(deployment.gas.beforeSwap)} plus warm afterSwap ${formatInt(deployment.gas.afterSwapWarm)} equals ${formatInt(deployment.gas.hookTotal)} per swap.`}>
                  <i className="seg-a" style={{ width: `${(deployment.gas.beforeSwap / deployment.gas.hookTotal) * 100}%` }} />
                  <i className="seg-b" style={{ width: `${(deployment.gas.afterSwapWarm / deployment.gas.hookTotal) * 100}%` }} />
                </div>
                <b>{`${formatInt(deployment.gas.beforeSwap)} + ${formatInt(deployment.gas.afterSwapWarm)}`}</b>
              </div>
              <div className="gas-row">
                <span>controller · apply recommendation cold / warm</span>
                <div className="gas-bar">
                  <i className="seg-a" style={{ width: `${(deployment.gas.applyCold / deployment.gas.hookTotal) * 100}%` }} />
                </div>
                <b>{`${formatInt(deployment.gas.applyCold)} / ${formatInt(deployment.gas.applyWarm)}`}</b>
              </div>
              <div className="gas-row">
                <span>controller · feeForSwap (warm read)</span>
                <div className="gas-bar">
                  <i className="seg-a" style={{ width: `${Math.max(1, (deployment.gas.feeForSwapWarm / deployment.gas.hookTotal) * 100)}%` }} />
                </div>
                <b>{formatInt(deployment.gas.feeForSwapWarm)}</b>
              </div>
            </div>
            <p className="card-caption">
              Isolated local EVM call measurements under the pinned compiler profile. They exclude the
              PoolManager and router transaction and are not a live-chain cost quote.
            </p>
          </div>
        <h4 className="reference-heading">Judge Q&A</h4>
          <div className="qa-list">
            {judgeQuestions.map((entry, index) => (
              <details className="qa-item" key={entry.question} open={index === 0}>
                <summary>{entry.question}</summary>
                <p>{entry.answer}</p>
              </details>
            ))}
          </div>
        <h4 className="reference-heading">Glossary</h4>
          <dl className="glossary">
            {glossary.map(([term, definition]) => (
              <div key={term}><dt>{term}</dt><dd>{definition}</dd></div>
            ))}
          </dl>
      </Accordion>
    </section>
  );
}
