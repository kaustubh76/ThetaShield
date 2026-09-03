import type { DeploymentView } from "../../deployment-data";
import { age, formatInt } from "../format";
import type { EventsView, LiveEvent } from "./types";

function EventLane({
  label,
  events,
  explorerBase,
  windowBlocks,
  windowSeconds,
  scanned,
  hideWhenEmpty,
  generatedAt,
  wholeDeployment = false,
}: {
  label: string;
  events: LiveEvent[];
  explorerBase: string;
  windowBlocks: number;
  windowSeconds: number | null;
  scanned: boolean;
  /** Drop a successfully-scanned empty lane instead of explaining the blank. */
  hideWhenEmpty: boolean;
  generatedAt: string;
  /** The lane's scan reaches the deploy block, so an empty result is a finding
      about the deployment rather than about the window. */
  wholeDeployment?: boolean;
}) {
  // A lane whose window structurally cannot reach the activity has nothing to
  // say, and a paragraph explaining that is worse than no lane: it reads as a
  // fault. It is dropped only when the scan SUCCEEDED and was empty — a failed
  // scan is a different finding and still gets its line.
  if (hideWhenEmpty && scanned && !events.length) return null;
  // The origin chain caps eth_getLogs at 10,000 blocks, which on a one-second
  // chain is under three hours — so an empty lane is a statement about the
  // window, not about whether the system has ever run. Saying only "10,000
  // blocks" left that to be inferred, and it was inferred wrongly.
  const span =
    windowSeconds === null
      ? ""
      : windowSeconds < 5_400
        ? ` (~${Math.round(windowSeconds / 60)} minutes)`
        : ` (~${(windowSeconds / 3_600).toFixed(1)} hours)`;
  return (
    <div className="event-lane">
      <span className="event-lane-label">{label}</span>
      {events.length ? (
        <ul>
          {events.map((event) => (
            <li className={`event-${event.kind}`} key={`${event.txHash}-${event.logIndex}`}>
              <i aria-hidden="true" />
              <b>{event.summary}</b>
              <a href={`${explorerBase}/tx/${event.txHash}`} rel="noreferrer" target="_blank">
                {event.observedAt
                  ? `${age(generatedAt, event.observedAt)} · block ${formatInt(event.blockNumber)} ↗`
                  : `block ${formatInt(event.blockNumber)} ↗`}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className={scanned ? "event-empty" : "event-empty unavailable"}>
          {scanned
            ? wholeDeployment
              ? `no events in the ${formatInt(windowBlocks)} blocks${span} since this deployment — every block since it was deployed was scanned. The execution log below lists each observation and cycle.`
              : `no events in the last ${formatInt(windowBlocks)} blocks${span} — this is a bounded scan, not the full history. The proven run is dated in the trail below.`
            : "log scan unavailable this cycle — no claim is made about recent activity; the receipt trail below is permanent"}
        </p>
      )}
    </div>
  );
}

export default function EventsTicker({
  events,
  deployment,
  generatedAt,
  blockSeconds,
}: {
  events: EventsView;
  deployment: DeploymentView;
  generatedAt: string;
  /** Measured seconds per block per chain, or null when not derivable. */
  blockSeconds: { origin: number | null; processor: number | null };
}) {
  // Only drop the origin lane when the other lane is carrying the story; with
  // both empty, one honest "nothing recent" beats an empty section.
  const hasProcessorEvents = events.processor.length > 0;
  const origin = deployment.networks.find((network) => network.role === "origin");
  const processor = deployment.networks.find((network) => network.role === "processor");
  if (!origin || !processor) return null;

  return (
    <div className="events-ticker">
      <div className="card-title"><span>RECENT ON-CHAIN EVENTS</span><b>{`recent · ${formatInt(events.window.origin)} blocks / whole deployment · read-only`}</b></div>
      <div className="event-lanes">
        <EventLane
          events={events.origin}
          explorerBase={origin.explorerBase}
          generatedAt={generatedAt}
          label={`${origin.name.toUpperCase()} · SWAPS OBSERVED`}
          hideWhenEmpty={hasProcessorEvents}
          scanned={events.scanned.origin}
          windowBlocks={events.window.origin}
          windowSeconds={blockSeconds.origin === null ? null : blockSeconds.origin * events.window.origin}
        />
        <EventLane
          events={events.processor}
          explorerBase={processor.explorerBase}
          generatedAt={generatedAt}
          label={`${processor.name.toUpperCase()} · EPOCHS + AUTOMATION`}
          hideWhenEmpty={false}
          scanned={events.scanned.processor}
          wholeDeployment
          windowBlocks={events.window.processor}
          windowSeconds={blockSeconds.processor === null ? null : blockSeconds.processor * events.window.processor}
        />
      </div>
    </div>
  );
}
