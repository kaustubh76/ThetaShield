import type { DeploymentView } from "../../deployment-data";
import { formatInt } from "../format";
import type { EventsView, LiveEvent } from "./types";

function EventLane({
  label,
  events,
  explorerBase,
  windowBlocks,
  scanned,
}: {
  label: string;
  events: LiveEvent[];
  explorerBase: string;
  windowBlocks: number;
  scanned: boolean;
}) {
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
                {`block ${formatInt(event.blockNumber)} ↗`}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className={scanned ? "event-empty" : "event-empty unavailable"}>
          {scanned
            ? `no events in the last ${formatInt(windowBlocks)} blocks — this is a bounded scan, not the full history; the receipt trail below is permanent`
            : "log scan unavailable this cycle — no claim is made about recent activity; the receipt trail below is permanent"}
        </p>
      )}
    </div>
  );
}

export default function EventsTicker({
  events,
  deployment,
}: {
  events: EventsView;
  deployment: DeploymentView;
}) {
  const origin = deployment.networks.find((network) => network.role === "origin");
  const processor = deployment.networks.find((network) => network.role === "processor");
  if (!origin || !processor) return null;

  return (
    <div className="events-ticker">
      <div className="card-title"><span>RECENT ON-CHAIN EVENTS</span><b>{`bounded ${formatInt(events.window.processor)}-block scan · read-only`}</b></div>
      <div className="event-lanes">
        <EventLane
          events={events.origin}
          explorerBase={origin.explorerBase}
          label={`${origin.name.toUpperCase()} · SWAPS OBSERVED`}
          scanned={events.scanned.origin}
          windowBlocks={events.window.origin}
        />
        <EventLane
          events={events.processor}
          explorerBase={processor.explorerBase}
          label={`${processor.name.toUpperCase()} · EPOCHS + AUTOMATION`}
          scanned={events.scanned.processor}
          windowBlocks={events.window.processor}
        />
      </div>
    </div>
  );
}
