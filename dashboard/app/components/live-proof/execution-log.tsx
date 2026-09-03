import type { DeploymentView } from "../../deployment-data";
import { formatInt, shortHex } from "../format";
import { txUrlFor } from "./explorer";
import { AttemptSteps, OUTCOME, attemptHeadline, clock } from "./observation-record";
import type { LiveProofState } from "./use-live-proof";
import type { AutomationCycleRecordView, LedgerView } from "./types";

// Every automation cycle carries its own before/after counters, so a cycle that
// found nothing to do says so in its own numbers rather than rendering as a
// blank row. Six cycles against four observations means most of them swept
// nothing, and that is a fact about the scheduler worth showing.
function cycleSummary(cycle: AutomationCycleRecordView): string {
  const moved: string[] = [];
  if (cycle.settledAfter > cycle.settledBefore) {
    moved.push(`scored ${cycle.settledAfter - cycle.settledBefore}`);
  }
  if (cycle.expiredAfter > cycle.expiredBefore) {
    moved.push(`swept ${cycle.expiredAfter - cycle.expiredBefore} expired`);
  }
  if (cycle.recommendationAfter > cycle.recommendationBefore) moved.push("dispatched a recommendation");
  if (moved.length) return moved.join(" · ");
  if (!cycle.processSucceeded) return "the processing call did not succeed";
  return "found no work due — the queue held nothing it could advance";
}

function CycleRow({
  cycle,
  txUrl,
}: {
  cycle: AutomationCycleRecordView;
  txUrl: (hash: string) => string;
}) {
  return (
    <li className="cycle-row">
      <b>{`Cycle ${cycle.cycleId}`}</b>
      <span className={cycle.reactiveTrigger ? "cycle-trigger reactive" : "cycle-trigger keeper"}>
        {cycle.reactiveTrigger ? "REACTIVE NETWORK callback" : "permissionless keeper"}
      </span>
      <span className="cycle-note">{cycleSummary(cycle)}</span>
      <span className="cycle-counts">
        {`pending ${cycle.pendingBefore}→${cycle.pendingAfter} · scored ${cycle.settledBefore}→${cycle.settledAfter} · expired ${cycle.expiredBefore}→${cycle.expiredAfter} · sources ${cycle.syncedSources}/${cycle.publishedSources}`}
      </span>
      {/* The three sub-calls report separately, and a cycle can succeed at one
          and not another — the executor wraps each in its own try/catch. Shown
          because a cycle that sampled but could not process is a different
          finding from one that found no work. */}
      <span className="cycle-flags">
        <b className={cycle.samplerSucceeded ? "ok" : "bad"}>{`sampler ${cycle.samplerSucceeded ? "ok" : "failed"}`}</b>
        <b className={cycle.processSucceeded ? "ok" : "bad"}>{`process ${cycle.processSucceeded ? "ok" : "failed"}`}</b>
        <b className={cycle.recommendationDispatched ? "ok" : "idle"}>
          {cycle.recommendationDispatched ? "recommendation sent" : "no recommendation"}
        </b>
      </span>
      <time dateTime={cycle.observedAt !== null ? new Date(cycle.observedAt * 1_000).toISOString() : undefined}>
        {cycle.observedAt !== null ? clock(cycle.observedAt) : "—"}
        <small>{`block ${formatInt(cycle.blockNumber)}`}</small>
      </time>
      <a href={txUrl(cycle.txHash)} rel="noreferrer" target="_blank">
        <code>{shortHex(cycle.txHash)}</code> ↗
      </a>
    </li>
  );
}

type ContractCounters = { settled: number; expired: number; dropped: number | null };

function Summary({ ledger, contract }: { ledger: LedgerView; contract: ContractCounters | null }) {
  const { totals } = ledger;
  // The scan and the contract's own counters are two independent readings of
  // the same history. When they agree that is worth saying; when they do not,
  // saying so is worth more than quietly showing one of them.
  const agrees =
    contract !== null &&
    contract.settled === totals.settled &&
    contract.expired === totals.expired &&
    // A counter the lens withheld is not a disagreement; it is simply unread.
    (contract.dropped === null || contract.dropped === totals.dropped);

  return (
    <>
      <dl className="ledger-summary">
        <div><dt>Observations</dt><dd>{formatInt(totals.queued)}</dd></div>
        <div><dt>Scored</dt><dd>{formatInt(totals.settled)}</dd></div>
        <div><dt>Expired unscored</dt><dd>{formatInt(totals.expired)}</dd></div>
        <div><dt>Dropped</dt><dd>{formatInt(totals.dropped)}</dd></div>
        <div><dt>In flight</dt><dd>{formatInt(totals.pending)}</dd></div>
        <div><dt>Automation cycles</dt><dd>{formatInt(totals.cycles)}</dd></div>
      </dl>
      <p className={agrees ? "ledger-crosscheck" : "ledger-crosscheck disagrees"}>
        {contract === null
          ? "The processor's own lifetime counters were not read this cycle, so these totals stand unchecked."
          : agrees
            ? "These totals were rebuilt from the queue's events and match the processor's own lifetime counters."
            : `These totals were rebuilt from the queue's events and do NOT match the processor's own counters (scored ${contract.settled}, expired ${contract.expired}, dropped ${contract.dropped ?? "not read"}). One of the two readings is incomplete.`}
      </p>
    </>
  );
}

export default function ExecutionLog({
  deployment,
  live,
}: {
  deployment: DeploymentView;
  live: LiveProofState;
}) {
  const { proof, stale } = live;
  const processorName =
    deployment.networks.find((network) => network.role === "processor")?.name ?? "Processor";
  const txUrl = txUrlFor(deployment, "processor");
  const ledger = proof?.events?.ledger ?? null;
  const referenceWindowSeconds =
    proof?.processor.deployedConfig?.scheduler.referenceSelectionWindowSeconds ?? null;
  const contract = proof
    ? {
        settled: proof.processor.settledCount,
        expired: proof.processor.expiredCount,
        dropped: proof.processor.droppedCount,
      }
    : null;
  // The processor's own lifetime counters are read separately from the log
  // scan, so they are the check on it: if they report finished work and the
  // scan found no observations at all, the scan is incomplete and the history
  // is not empty. Reporting that as "nothing has ever run" is the exact error
  // this file's scan warns about — a failed read is not a finding of zero.
  // Terminal counters alone were not enough: for the ~30 minutes an
  // observation is in flight nothing has settled, expired or dropped yet, so a
  // queue scan that came back empty during a live run still read as "nothing
  // has ever run" while the panel above showed it pending. The queue depth and
  // the highest id ever issued close that window.
  const terminalCount = contract ? contract.settled + contract.expired + (contract.dropped ?? 0) : 0;
  const contractSaysRan =
    terminalCount > 0 ||
    (proof?.processor.pendingCount ?? 0) > 0 ||
    (proof?.processor.lastObservationId ?? 0) > 0;
  const agreesWithContract =
    contract !== null &&
    ledger !== null &&
    contract.settled === ledger.totals.settled &&
    contract.expired === ledger.totals.expired &&
    (contract.dropped === null || contract.dropped === ledger.totals.dropped);

  // This section never returns null. The component it replaces did, and that is
  // precisely why the page could look as though nothing had ever run: with a
  // quiet scan window it deleted itself rather than reporting a quiet window.
  let body: React.ReactNode;
  if (!proof && !ledger) {
    body = <p className="ledger-empty">Reading the queue’s lifecycle from {processorName}…</p>;
  } else if (!ledger) {
    body = (
      <p className="ledger-empty unavailable">
        The queue scan did not complete on this read, so no claim is made about what has run. The
        receipt trail in Live proof above is permanent and unaffected.
      </p>
    );
  } else if (!ledger.observations.length) {
    body = contractSaysRan ? (
      <p className="ledger-empty unavailable">
        {`The queue scan returned nothing on this read, but the processor's own counters report ${formatInt(contract?.settled ?? 0)} scored, ${formatInt(contract?.expired ?? 0)} expired and ${formatInt(proof?.processor.pendingCount ?? 0)} still queued, against ${formatInt(proof?.processor.lastObservationId ?? 0)} observations issued. So this is an incomplete read, not an empty history — no claim is made about what has run until the two agree.`}
      </p>
    ) : (
      <p className="ledger-empty">
        {ledger.complete
          ? `No observation has reached the processor since it was deployed. This is a finding, not a gap: the scan covers every block from ${formatInt(ledger.fromBlock)} to ${formatInt(ledger.toBlock)}.`
          : `No observation appears in blocks ${formatInt(ledger.fromBlock)} to ${formatInt(ledger.toBlock)}. That span does not reach the deployment, so this is a finding about the window rather than about the history.`}
      </p>
    );
  } else {
    body = (
      <>
        <Summary contract={contract} ledger={ledger} />
        <ol className="ledger-entries">
          {ledger.observations.map((record) => (
            <li className={`ledger-entry ${OUTCOME[record.outcome].tone}`} key={record.observationId}>
              <div className="ledger-entry-head">
                <h3>{attemptHeadline(record)}</h3>
                <span className={`attempt-verdict ${OUTCOME[record.outcome].tone}`}>
                  {OUTCOME[record.outcome].label}
                </span>
              </div>
              <p className="ledger-entry-side">{`${record.side} side · queued in block ${formatInt(record.blockNumber)}`}</p>
              <AttemptSteps
                attempt={record}
                processorName={processorName}
                referenceWindowSeconds={referenceWindowSeconds}
                txUrl={txUrl}
              />
            </li>
          ))}
        </ol>

        <div className="card-title">
          <span>Automation cycles</span>
          <b>{`${formatInt(ledger.cycles.length)} bounded passes of the executor`}</b>
        </div>
        <ul className="ledger-cycles">
          {ledger.cycles.map((cycle) => (
            <CycleRow cycle={cycle} key={cycle.cycleId} txUrl={txUrl} />
          ))}
        </ul>

        <p className="ledger-foot">
          {`Read from blocks ${formatInt(ledger.fromBlock)}–${formatInt(ledger.toBlock)} on ${processorName}${ledger.complete && agreesWithContract ? ", the whole life of the deployment" : ledger.complete ? ", though this read disagrees with the processor's counters" : ", a bounded span rather than the whole deployment"}.`}
          {ledger.orphanTerminals
            ? ` ${formatInt(ledger.orphanTerminals)} outcome event(s) had no queue event inside the scan and are counted but not listed.`
            : ""}
          {ledger.truncated.observations || ledger.truncated.cycles
            ? ` ${formatInt(ledger.truncated.observations)} older observation(s) and ${formatInt(ledger.truncated.cycles)} cycle(s) are elided.`
            : ""}
          {stale ? " Showing the last successful read — refreshes are not currently landing." : ""}
        </p>
      </>
    );
  }

  return (
    <section className="section execution-log" id="execution-log">
      <div className="section-heading split-heading">
        <div>
          <p className="kicker">Execution log · DEPLOYED · READ LIVE</p>
          <h2>Everything the queue has done.</h2>
        </div>
        <p>
          Every observation the processor has queued on {processorName} and every automation cycle
          that ran, rebuilt from the contracts’ own events rather than from a recorded run. CIRCLE
          CCTP carries the evidence and REACTIVE NETWORK schedules the sweep; neither computes a
          fee.
        </p>
      </div>
      {body}
    </section>
  );
}
