import type { DeploymentView } from "../../deployment-data";
import type { DeployedConfigView } from "../live-proof/types";
import Accordion from "../accordion";
import { formatInt, shortHex } from "../format";
import DeployedParameters from "./deployed-parameters";

const judgeQuestions = [
  {
    question: "Why use two chains?",
    answer:
      "The latency-sensitive hook stays small and deterministic on Unichain, while delayed histories, bounded queues, confidence, persistence, and reference selection live in a separate processor. Cross-chain delivery is never required for the current swap — it updates later swaps.",
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
      "No. The RESEARCH_V1 reference market is three fee tiers of a project-issued pair on Ethereum Sepolia, separate from the protected Unichain pair, seeded and moved by the operator. It exercises the full multi-source path — liquidity floors, robust median, dispersion, confidence — against a controlled market. Independent evidence needs reference tiers co-located with the protected pair; that is the next architectural step, not a claim made today.",
  },
  {
    question: "Why did the live fee not increase?",
    answer:
      "The first completed sample is deliberately cold start and has zero shared confidence. A safety mechanism that moved the fee from one observation would be easier to demo but easier to manipulate. The next public evidence milestone is a second mature cycle showing a non-baseline directional fee.",
  },
];

const glossary = [
  ["signed markout", "direction × (reference price − execution price) / execution price — the post-trade outcome with its sign preserved."],
  ["dead band", "k × trailing volatility. Movement inside the band is treated as noise; the current sample is excluded from its own band."],
  ["n-of-k persistence", "activation requires at least n toxic epochs inside a k-epoch window, so one noisy sample cannot move the fee."],
  ["fee pips", "1,000,000 pips = 100%. The 500-pip baseline equals 5 bps; the 10,000-pip cap equals 100 bps."],
  ["WAD", "fixed-point unit where 1e18 represents 1.0 — used for prices, markouts, risk, and confidence."],
  ["coverage premium", "a bounded fee component that responds to estimated-loss coverage deficits, separate from the toxic premium."],
  ["RESEARCH_V1", "the live release profile: a permissionless three-pool median sampler replaces the owner-published demo feed used by the historical Phase 8D proof."],
] as const;

function domainRoute(sourceDomain: number, destinationDomain: number): string {
  return `domain ${sourceDomain} → ${destinationDomain}`;
}

export default function RegistrySection({
  deployment,
  researchConfig,
  deployedConfig,
  liveStatus,
}: {
  deployment: DeploymentView;
  researchConfig: { key: string; value: string }[];
  deployedConfig: DeployedConfigView | null;
  liveStatus: "loading" | "ready" | "error";
}) {
  const roles: ("origin" | "processor" | "reactive")[] = ["origin", "processor", "reactive"];

  return (
    <section className="section registry" id="registry">
      <div className="section-heading split-heading">
        <div><p className="kicker">Verification registry</p><h2>Every claim opens to a receipt.</h2></div>
        <p>
          {`Deployment ${shortHex(deployment.profile.id, 10)} · profile ${deployment.profile.name} · source revision ${deployment.sourceRevision.slice(0, 12)} · recorded ${deployment.createdAt.slice(0, 10)}. Everything below is generated from the live deployment manifest.`}
        </p>
      </div>

      <Accordion badge="01" id="registry-components" meta={`${deployment.components.length} components · 3 networks`} title="Deployment registry">
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

      <Accordion badge="02" id="registry-circle" meta={`${deployment.circleMessages.length} messages · finality 2000`} title="Circle message evidence">
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

      <Accordion badge="03" id="registry-parameters" meta={`${researchConfig.length} research keys · deployed values read live`} title="Deployed parameters">
        <DeployedParameters config={deployedConfig} researchConfig={researchConfig} status={liveStatus} />
      </Accordion>

      <Accordion badge="04" id="registry-cost" meta="owner approved · actuals under estimate" title="Deployment cost">
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
      </Accordion>

      <Accordion badge="05" id="registry-qa" meta={`${judgeQuestions.length} questions`} title="Judge Q&A">
        <div className="qa-list">
          {judgeQuestions.map((entry, index) => (
            <details className="qa-item" key={entry.question} open={index === 0}>
              <summary>{entry.question}</summary>
              <p>{entry.answer}</p>
            </details>
          ))}
        </div>
      </Accordion>

      <Accordion badge="06" id="registry-glossary" meta={`${glossary.length} terms`} title="Glossary">
        <dl className="glossary">
          {glossary.map(([term, definition]) => (
            <div key={term}><dt>{term}</dt><dd>{definition}</dd></div>
          ))}
        </dl>
      </Accordion>
    </section>
  );
}
