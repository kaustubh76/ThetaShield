import { useEffect, useState } from "react";
import type { DeploymentView } from "../../deployment-data";
import type { JourneyPhaseId } from "../../journey-phases";
import Accordion from "../accordion";
import { feeBps, formatInt, shortHex } from "../format";
import AutomationCard from "./automation-card";
import EventsTicker from "./events-ticker";
import ReactivePanel from "./reactive-panel";
import LatestAttempt from "./latest-attempt";
import RunConsole from "./run-console";
import { schedulerHealth } from "./scheduler-health";
import ReferenceSources from "./reference-sources";
import RunTimeline from "./run-timeline";
import SideStateCard from "./side-state-card";
import TtlRing from "./ttl-ring";
import { wadToBpsNumber } from "./types";
import type { LiveProofState } from "./use-live-proof";

// Intl throws RangeError beyond ~8.64e12 seconds, and unsigned() only rejects
// above MAX_SAFE_INTEGER — so a malformed word in that band would take the whole
// route to the error boundary rather than rendering one odd cell.
const MAXIMUM_RENDERABLE_SECONDS = 8_640_000_000_000;

function formatChainTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAXIMUM_RENDERABLE_SECONDS) {
    return "an out-of-range timestamp";
  }
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
  onOpenPhase,
}: {
  deployment: DeploymentView;
  live: LiveProofState;
  onOpenPhase: (id: JourneyPhaseId) => void;
}) {
  const originName = deployment.networks.find((network) => network.role === "origin")?.name ?? "Origin";
  const processorName =
    deployment.networks.find((network) => network.role === "processor")?.name ?? "Processor";
  const { proof, error, loading, refresh, stale, lastSuccessAt, nextPollAt, failureCount } = live;
  // A snapshot that stopped refreshing is not the same finding as a live read.
  // Presenting it as one is the mirror image of claiming a fee before any read
  // returns, so it gets its own state rather than inheriting the green one.
  // Ticks once a second so the countdown moves. Date.now() is impure, so the
  // clock is kept in state and advanced by the timer rather than read during
  // render. Derived from the last SUCCESS, so a failing read counts past zero
  // instead of pretending a refresh landed.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);
  // Read from the hook's own schedule rather than assumed to be 60s: a failing
  // endpoint backs off to as much as ten minutes, and a countdown that kept
  // promising a refresh within the minute would be the same false currency the
  // stale banner exists to prevent.
  const untilNextRead =
    nextPollAt === null || nowMs === null ? null : Math.max(0, Math.ceil((nextPollAt - nowMs) / 1_000));
  const backingOff = untilNextRead !== null && untilNextRead > 75;

  // Seconds per block, measured rather than assumed: a dated block from the run
  // timeline against the head the scan actually used. Chain block intervals
  // drift and differ by orders of magnitude between these two chains, so a
  // hardcoded constant would misstate how far back the window reaches.
  const blockSecondsFor = (role: "origin" | "processor"): number | null => {
    if (!proof?.events || !proof.runTimeline) return null;
    const dated = proof.runTimeline.steps.find(
      (step) => step.role === role && step.observedAt !== null && step.blockNumber !== null,
    );
    if (!dated) return null;
    const head = proof.events.head[role];
    const blocks = head - (dated.blockNumber as number);
    const seconds = Math.floor(new Date(proof.generatedAt).getTime() / 1_000) - (dated.observedAt as number);
    return blocks > 0 && seconds > 0 ? seconds / blocks : null;
  };
  const blockSeconds = { origin: blockSecondsFor("origin"), processor: blockSecondsFor("processor") };

  const withheld: string[] = [];
  if (proof) {
    if (proof.readPath === "historical-direct") {
      withheld.push("per-side state, deployed configuration, reference table, automation cycle and the recommendation TTL — the direct-getter path does not carry the lens aggregate");
    }
    if (!proof.referenceSources && proof.readPath === "lens") {
      withheld.push(
        proof.processor.referenceSourceCount
          ? `the reference table — ${proof.processor.referenceSourceCount} sources are registered but none returned a readable, configured state`
          : "the reference table — no sources are registered",
      );
    }
    if (!proof.automation && proof.readPath === "lens") withheld.push("the automation cycle — the executor returned no readable cycle");
    if (!proof.events) withheld.push("recent on-chain events — the bounded scan did not complete, which is not a finding that nothing happened");
    if (!proof.reactive) withheld.push("the Reactive counters — that plane did not answer within the read budget");
  }
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
  // The signed directional risk the controller carries for each side. This is
  // the quantity the fee curve is a function of, so a recommendation shown
  // without it is a number with its cause withheld. Positive means adverse
  // pressure in that direction; the sign is what makes the protection
  // directional rather than a blanket surcharge.
  const riskFor = (direction: "buy" | "sell"): string => {
    if (!proof || proof.origin.recommendation.sequence === 0) return "—";
    const wad =
      direction === "buy"
        ? proof.origin.recommendation.oneForZeroRiskWad
        : proof.origin.recommendation.zeroForOneRiskWad;
    const bps = wadToBpsNumber(wad);
    return `${bps > 0 ? "+" : ""}${bps.toFixed(2)} bps signed risk`;
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
  // What the pool is charging is stated from the controller's own usedBaseline
  // flags — the same words the fee numbers above come from — never from an
  // expiry computation. Ordering it the other way round let a clock decide a
  // sentence about a fee, and on the direct path that clock is this host's.
  const statusCopy = !proof
    ? error
      ? "Chain state unavailable"
      : "Reading chain state…"
    : safeBaseline
      ? proof.recommendationExpired
        ? "Safe baseline active · recommendation expired"
        : "Safe baseline active"
      : "Live directional recommendation active";
  const expiryNote =
    proof && proof.expiryBasis === "host-clock"
      ? " Expiry is inferred from this server's clock on the direct-getter path, not read from the chain."
      : "";
  const statusDetail = !proof
    ? error
      ? "No claim is made about the current fee until a read succeeds. The verified receipt trail below is permanent."
      : "Reading both public testnets before stating a fee."
    : safeBaseline
      ? proof.recommendationExpired
        ? `Both swap directions return the configured ${feeBps(proof.origin.baselineFeePips)} bps baseline, as the controller reports. Sequence ${proof.origin.lastSequence} remains auditable, but its validity window has ended.${expiryNote}`
        : "Refusing to overreact is the system's first live safety decision: without shared confidence, both directions hold the configured baseline by design."
      : proof.recommendationExpired
        // The chain still reports a premium applied while the window reads as
        // ended. Saying "baseline" here would contradict the fees rendered above.
        ? `The controller still reports a directional premium applied while sequence ${proof.origin.lastSequence} reads as past its validity window — the next swap settles which holds.${expiryNote}`
        : "A directional premium is installed. Under the operator-moved reference market this is a mechanism demonstration — not measured adverse selection.";

  return (
    <>
      <div className="live-toolbar">
        <div>
          <span aria-live="polite" className={`live-status ${statusTone}`}><i />{statusLabel}</span>
          <p>
            {proof
              ? `${proof.readPath === "lens" ? "Lens aggregate" : "Historical direct getters"} · read at ${new Date(lastSuccessAt ?? proof.generatedAt).toLocaleTimeString()}${
                  stale ? ` · ${failureCount} refresh${failureCount === 1 ? "" : "es"} failed since` : ""
                }`
              : "Reading both public testnets…"}
          </p>
        </div>
        <div className="refresh-group">
          {untilNextRead !== null ? (
            <span className="poll-countdown">
              {loading
                ? "reading…"
                : untilNextRead <= 0
                  ? "reading shortly"
                  : backingOff
                    ? `backing off · next read in ${Math.ceil(untilNextRead / 60)}m`
                    : `next read in ${untilNextRead}s`}
            </span>
          ) : null}
          <button className="refresh-button" disabled={loading} onClick={() => void refresh()} type="button">
            {loading ? "Reading on-chain state…" : "Refresh on-chain state"}
          </button>
        </div>
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

      {/* aria-live sat on the whole grid, so a screen reader re-read ~30 values
          on every poll. The status line above is the part that changes
          meaningfully; the cards are read on demand. */}
      <div className="live-grid">
        <article className="live-card origin-card">
          <div className="live-card-header"><span>ORIGIN · {originName.toUpperCase()}</span><b>{proof ? `block ${formatInt(proof.origin.blockNumber)}` : "reading…"}</b></div>
          <div className="live-fees">
            <div>
              <span>BUY-BASE FEE</span><strong>{proof ? feeBps(proof.origin.buy.feePips) : "—"}</strong><small>bps</small>
              <em>{recommendedFor("buy")}</em>
              <i>{riskFor("buy")}</i>
            </div>
            <div>
              <span>SELL-BASE FEE</span><strong>{proof ? feeBps(proof.origin.sell.feePips) : "—"}</strong><small>bps</small>
              <em>{recommendedFor("sell")}</em>
              <i>{riskFor("sell")}</i>
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
                confirmedExpired={proof.recommendationExpired}
                secondsUntilExpiry={proof.recommendationExpired ? 0 : proof.origin.recommendation.secondsUntilExpiry}
                windowSeconds={proof.processor.deployedConfig.scheduler.recommendationLifetimeSeconds}
              />
            ) : null}
            <span>{validityLabel()}</span>
          </div>
        ) : null}
      </div>

      {proof?.reactive ? (
        <ReactivePanel
          authentication={proof.authentication}
          automation={proof.automation}
          deployment={deployment}
          generatedAt={proof.generatedAt}
          lastRunAt={proof.runTimeline?.steps[proof.runTimeline.steps.length - 1]?.observedAt ?? null}
          pendingCount={proof.processor.pendingCount}
          pendingMaturity={proof.pendingMaturity}
          referenceWindowSeconds={proof.processor.deployedConfig?.scheduler.referenceSelectionWindowSeconds ?? null}
          reactive={proof.reactive}
        />
      ) : null}

      {proof ? (
        <Accordion
          badge="⌗"
          id="live-chain-state"
          meta="per-side state · automation · reference sources · recent events"
          title="Full chain state"
        >
        <div className="live-side-grid">
          {proof.processor.sides && proof.processor.deployedConfig ? (
            <>
              <SideStateCard config={proof.processor.deployedConfig} label="BUY-BASE" side={proof.processor.sides.buy} />
              <SideStateCard config={proof.processor.deployedConfig} label="SELL-BASE" side={proof.processor.sides.sell} />
            </>
          ) : null}
          {proof.automation ? <AutomationCard automation={proof.automation} /> : null}
        </div>

        {/* One line instead of five. A withheld card and an empty one are still
            different findings, so what is missing is still named — the route's
            own "a failed scan is not an empty scan" rule depends on it. */}
        {withheld.length ? (
          <p className="path-note">
            {`Withheld from this read, rather than shown as zero: ${withheld.join("; ")}.`}
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
        <EventsTicker
          blockSeconds={blockSeconds}
          deployment={deployment}
          events={proof.events}
          generatedAt={proof.generatedAt}
        />
      ) : null}
        </Accordion>
      ) : null}

      <RunConsole deployment={deployment} health={schedulerHealth(proof)} onRan={() => void refresh()} />

      <LatestAttempt
        attempt={proof?.events?.latestAttempt ?? null}
        deployment={deployment}
        referenceWindowSeconds={proof?.processor.deployedConfig?.scheduler.referenceSelectionWindowSeconds ?? null}
      />

      <RunTimeline deployment={deployment} onOpenPhase={onOpenPhase} timeline={proof?.runTimeline ?? null} />

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
