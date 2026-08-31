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
  const { proof, error, loading, refresh, stale, lastSuccessAt, failureCount } = live;
  // A snapshot that stopped refreshing is not the same finding as a live read.
  // Presenting it as one is the mirror image of claiming a fee before any read
  // returns, so it gets its own state rather than inheriting the green one.
  const statusTone = stale ? "stale" : proof ? "ok" : error ? "error" : "";
  const statusLabel = stale ? "Last known state" : proof ? "Live read" : error ? "RPC unavailable" : "Connecting";

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
  // buy ↔ oneForZero, sell ↔ zeroForOne (see the direction note in the live route).
  const recommendedFor = (direction: "buy" | "sell"): string => {
    if (!proof) return "—";
    const recommendation = proof.origin.recommendation;
    if (recommendation.sequence === 0) return "no recommendation installed";
    const recommended = feeBps(
      direction === "buy" ? recommendation.oneForZeroFeePips : recommendation.zeroForOneFeePips,
    );
    const usedBaseline = direction === "buy" ? proof.origin.buy.usedBaseline : proof.origin.sell.usedBaseline;
    return usedBaseline ? `recommended ${recommended} · baseline applied` : `recommendation ${recommended} applied`;
  };
  // A recommendation can be installed and not yet valid; rendering it as live
  // would overstate what the hook is currently charging.
  const validityLabel = (): string => {
    if (!proof) return "—";
    const recommendation = proof.origin.recommendation;
    if (recommendation.sequence === 0) return "no recommendation installed yet";
    if (proof.recommendationExpired) return `expired · sequence ${recommendation.sequence} remains auditable`;
    // Compared against the read's own timestamp, not the visitor's clock: the
    // validity window is chain state, so a skewed browser must not restate it.
    if (Math.floor(new Date(proof.generatedAt).getTime() / 1_000) < recommendation.validAfter) {
      return `installed · not yet valid, starts ${formatChainTime(recommendation.validAfter)}`;
    }
    return `confidence ${recommendation.confidenceBps / 100}% · valid until ${formatChainTime(recommendation.validUntil)}`;
  };
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
          <span className={`live-status ${statusTone}`}><i />{statusLabel}</span>
          <p>
            {proof
              ? `${proof.readPath === "lens" ? "Lens aggregate" : "Historical direct getters"} · read at ${new Date(lastSuccessAt ?? proof.generatedAt).toLocaleTimeString()}${
                  stale ? ` · ${failureCount} refresh${failureCount === 1 ? "" : "es"} failed since` : ""
                }`
              : "Reading both public testnets…"}
          </p>
        </div>
        <button className="refresh-button" disabled={loading} onClick={() => void refresh()} type="button">
          {loading ? "Reading on-chain state…" : "Refresh on-chain state"}
        </button>
      </div>

      {error ? (
        <div className={proof ? "rpc-error stale" : "rpc-error"} title={error}>
          <b>{proof ? "Refresh failed — showing the last successful read." : "Live RPC read paused."}</b>
          <span>
            {proof
              ? "The values below are a snapshot, not current chain state. The verified receipt trail below is permanent."
              : "No claim is made about current chain state. The verified receipt trail below is permanent."}
          </span>
        </div>
      ) : null}

      <div className="live-grid" aria-live="polite">
        <article className="live-card origin-card">
          <div className="live-card-header"><span>ORIGIN · {originName.toUpperCase()}</span><b>{proof ? `block ${formatInt(proof.origin.blockNumber)}` : "reading…"}</b></div>
          <div className="live-fees">
            <div>
              <span>BUY-BASE FEE</span><strong>{proof ? feeBps(proof.origin.buy.feePips) : "—"}</strong><small>bps</small>
              <em>{recommendedFor("buy")}</em>
            </div>
            <div>
              <span>SELL-BASE FEE</span><strong>{proof ? feeBps(proof.origin.sell.feePips) : "—"}</strong><small>bps</small>
              <em>{recommendedFor("sell")}</em>
            </div>
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
            <div><dt>Chain ID</dt><dd>{proof?.origin.chainId ?? "—"}</dd></div>
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
            <span>{validityLabel()}</span>
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
          {proof.reactive ? (
            <ReactiveCard automation={proof.automation} deployment={deployment} reactive={proof.reactive} />
          ) : null}
        </div>
      ) : null}

      {proof && proof.readPath === "historical-direct" ? (
        <p className="path-note">
          Direct getter path: per-side state, the deployed configuration, the reference table and the
          recommendation TTL are aggregated by the processor lens and are not part of this read, so those
          cards are withheld rather than guessed. Fees, counters and the receipt trail below are unaffected.
        </p>
      ) : null}

      {proof?.referenceSources ? (
        <ReferenceSources
          deployment={deployment}
          generatedAt={proof.generatedAt}
          registeredCount={proof.processor.referenceSourceCount}
          sources={proof.referenceSources}
        />
      ) : null}

      {proof?.events ? (
        <EventsTicker deployment={deployment} events={proof.events} generatedAt={proof.generatedAt} />
      ) : null}

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
      {/* Three states, because the direct path is now reachable two ways: the
          lenses can be disabled by configuration, or they can fail and be
          fallen back from. Neither may be asserted before a read returns. */}
      <p className="proof-disclosure">
        {!proof
          ? "State is read through the deployed stateless ThetaShield lenses, with the audited getters as the declared fallback path."
          : proof.readPath === "lens"
            ? "G10 state is aggregated through the deployed stateless ThetaShield lenses."
            : "Read through the audited getters directly this cycle: the paired G10 lenses are either disabled by configuration or did not answer, and the read fell back."}
      </p>
    </>
  );
}
