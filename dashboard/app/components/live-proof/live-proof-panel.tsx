import type { DeploymentView } from "../../deployment-data";
import { feeBps, formatInt, shortHex } from "../format";
import AutomationCard from "./automation-card";
import EventsTicker from "./events-ticker";
import ReactiveCard from "./reactive-card";
import ReferenceSources from "./reference-sources";
import SideStateCard from "./side-state-card";
import TtlRing from "./ttl-ring";
import type { LiveProofState } from "./use-live-proof";

function formatChainTime(seconds: number) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(seconds * 1_000));
}

export default function LiveProofPanel({
  deployment,
  live,
}: {
  deployment: DeploymentView;
  live: LiveProofState;
}) {
  const originName = deployment.networks.find((network) => network.role === "origin")?.name ?? "Origin";
  const processorName =
    deployment.networks.find((network) => network.role === "processor")?.name ?? "Processor";
  const { proof, error, loading, refresh } = live;

  const paused = Boolean(proof && (proof.origin.globallyPaused || proof.origin.poolPaused));
  const pauseLabel = !proof
    ? "—"
    : proof.origin.globallyPaused && proof.origin.poolPaused
      ? "globally + pool paused"
      : proof.origin.globallyPaused
        ? "globally paused"
        : proof.origin.poolPaused
          ? "pool paused"
          : "active";

  // Every branch below is a factual claim about live chain state, so none of
  // them may render until a read has actually returned.
  const safeBaseline = proof ? proof.origin.buy.usedBaseline && proof.origin.sell.usedBaseline : false;
  const statusCopy = !proof
    ? error
      ? "Chain state unavailable"
      : "Reading chain state…"
    : proof.recommendationExpired
      ? "Safe baseline active · recommendation expired"
      : safeBaseline
        ? "Safe baseline active"
        : "Live directional recommendation active";
  const statusDetail = !proof
    ? error
      ? "No claim is made about the current fee until a read succeeds. The verified receipt trail below is permanent."
      : "Reading both public testnets before stating a fee."
    : proof.recommendationExpired
      ? `Sequence ${proof.origin.lastSequence} remains auditable, but its validity window ended. Both swap directions safely return the configured ${feeBps(proof.origin.baselineFeePips)} bps baseline.`
      : safeBaseline
        ? "Refusing to overreact is the system's first live safety decision: without shared confidence, both directions hold the configured baseline by design."
        : "A directional premium is installed. Under the operator-moved reference market this is a mechanism demonstration — not measured adverse selection.";

  return (
    <>
      <div className="live-toolbar">
        <div>
          <span className={`live-status ${proof ? "ok" : error ? "error" : ""}`}><i />{proof ? "Live read" : error ? "RPC unavailable" : "Connecting"}</span>
          <p>{proof ? `${proof.readPath === "lens" ? "Lens aggregate" : "Historical direct getters"} · read at ${new Date(proof.generatedAt).toLocaleTimeString()}` : "Reading both public testnets…"}</p>
        </div>
        <button className="refresh-button" disabled={loading} onClick={() => void refresh()} type="button">
          {loading ? "Reading on-chain state…" : "Refresh on-chain state"}
        </button>
      </div>

      {error && !proof ? <div className="rpc-error"><b>Live RPC read paused.</b><span>{error}. The verified receipt trail remains available below.</span></div> : null}

      <div className="live-grid" aria-live="polite">
        <article className="live-card origin-card">
          <div className="live-card-header"><span>ORIGIN · {originName.toUpperCase()}</span><b>{proof ? `block ${formatInt(proof.origin.blockNumber)}` : "reading…"}</b></div>
          <div className="live-fees">
            <div><span>BUY-BASE FEE</span><strong>{proof ? feeBps(proof.origin.buy.feePips) : "—"}</strong><small>bps</small></div>
            <div><span>SELL-BASE FEE</span><strong>{proof ? feeBps(proof.origin.sell.feePips) : "—"}</strong><small>bps</small></div>
          </div>
          <dl className="live-facts">
            <div><dt>Hook observations</dt><dd>{proof?.origin.observationCount ?? "—"}</dd></div>
            <div><dt>Installed sequence</dt><dd>{proof?.origin.lastSequence ?? "—"}</dd></div>
            <div><dt>Read path</dt><dd>{proof ? (proof.readPath === "lens" ? "ThetaShieldLens" : "direct fallback") : "—"}</dd></div>
            <div><dt>Contract code</dt><dd className={proof?.origin.contractsHealthy ? "healthy" : ""}>{proof ? (proof.origin.contractsHealthy ? "verified present" : "missing") : "—"}</dd></div>
            <div><dt>Circle peer</dt><dd className={proof?.origin.circlePeerSealed ? "healthy" : ""}>{proof ? (proof.origin.circlePeerSealed ? "sealed" : "open") : "—"}</dd></div>
            <div>
              <dt>Pause state</dt>
              <dd className={proof ? (paused ? "warn" : "healthy") : ""}>{proof ? pauseLabel : "—"}</dd>
            </div>
            <div><dt>Pool</dt><dd>{proof ? <code>{shortHex(proof.poolId, 10, 6)}</code> : "—"}</dd></div>
          </dl>
        </article>

        <article className="live-card processor-card">
          <div className="live-card-header"><span>PROCESSOR · {processorName.toUpperCase()}</span><b>{proof ? `block ${formatInt(proof.processor.blockNumber)}` : "reading…"}</b></div>
          <div className="processor-counts">
            <div><strong>{proof?.processor.pendingCount ?? "—"}</strong><span>pending</span></div>
            <div><strong>{proof?.processor.settledCount ?? "—"}</strong><span>settled</span></div>
            <div><strong>{proof?.processor.expiredCount ?? "—"}</strong><span>expired</span></div>
          </div>
          <dl className="live-facts">
            <div><dt>Last observation</dt><dd>{proof?.processor.lastObservationId ?? "—"}</dd></div>
            <div><dt>Recommendation sequence</dt><dd>{proof?.processor.recommendationSequence ?? "—"}</dd></div>
            <div><dt>Dropped observations</dt><dd className={proof && proof.processor.droppedCount === 0 ? "healthy" : ""}>{proof ? (proof.processor.droppedCount ?? "historical") : "—"}</dd></div>
            <div><dt>Contract code</dt><dd className={proof?.processor.contractHealthy ? "healthy" : ""}>{proof ? (proof.processor.contractHealthy ? "verified present" : "missing") : "—"}</dd></div>
            <div><dt>Chain ID</dt><dd>{proof?.processor.chainId ?? "—"}</dd></div>
          </dl>
        </article>
      </div>

      <div className={`live-proof-note ${proof && !safeBaseline ? "active" : ""}`}>
        <i />
        <div><b>{statusCopy}</b><p>{statusDetail}</p></div>
        {proof ? (
          <div className="note-side">
            {proof.processor.deployedConfig ? (
              <TtlRing
                baselineFeeBps={feeBps(proof.origin.baselineFeePips)}
                secondsUntilExpiry={proof.recommendationExpired ? 0 : proof.origin.recommendation.secondsUntilExpiry}
                windowSeconds={proof.processor.deployedConfig.scheduler.recommendationLifetimeSeconds}
              />
            ) : null}
            <span>
              {proof.origin.recommendation.sequence === 0
                ? "no recommendation installed yet"
                : `confidence ${proof.origin.recommendation.confidenceBps / 100}% · valid until ${formatChainTime(proof.origin.recommendation.validUntil)}`}
            </span>
          </div>
        ) : null}
      </div>

      {proof && (proof.processor.sides || proof.automation || proof.reactive) ? (
        <div className="live-side-grid">
          {proof.processor.sides && proof.processor.deployedConfig ? (
            <>
              <SideStateCard config={proof.processor.deployedConfig} label="BUY-BASE" side={proof.processor.sides.buy} />
              <SideStateCard config={proof.processor.deployedConfig} label="SELL-BASE" side={proof.processor.sides.sell} />
            </>
          ) : null}
          {proof.automation ? <AutomationCard automation={proof.automation} /> : null}
          {proof.reactive ? <ReactiveCard deployment={deployment} reactive={proof.reactive} /> : null}
        </div>
      ) : null}

      {proof?.referenceSources ? (
        <ReferenceSources deployment={deployment} generatedAt={proof.generatedAt} sources={proof.referenceSources} />
      ) : null}

      {proof?.events ? <EventsTicker deployment={deployment} events={proof.events} /> : null}

      <div className="receipt-heading"><span>LIVE RECEIPT TRAIL</span><b>{`${deployment.receipts.length} public transactions · open any receipt`}</b></div>
      <div className="receipt-rail">
        {deployment.receipts.map((receipt) => (
          <a className="receipt-step" href={receipt.url} key={receipt.hash} rel="noreferrer" target="_blank">
            <span className="receipt-index">{receipt.index}</span>
            <span className="receipt-copy"><b>{receipt.title}</b><small>{receipt.chainName}</small><code>{shortHex(receipt.hash)}</code></span>
            <span aria-hidden="true">↗</span>
          </a>
        ))}
      </div>

      <p className="registry-pointer">
        <a href="#registry">{`Read the contracts → all ${deployment.components.length} deployed components, with block, verification status and explorer links`}</a>
      </p>
      <p className="proof-disclosure">Read-only proof. Refreshing performs public RPC reads; it never connects a wallet, signs a message, or spends testnet funds.</p>
      <p className="proof-disclosure">{proof?.readPath === "lens" ? "G10 state is aggregated through the deployed stateless ThetaShield lenses." : "Direct audited getters are used only when the paired G10 lenses are explicitly disabled."}</p>
    </>
  );
}
