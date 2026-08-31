import { formatInt } from "../format";
import { wadToNumber, type DeployedConfigView } from "../live-proof/types";

type ConfigRow = { key: string; value: string };

function formatWadValue(value: string): string {
  const scaled = wadToNumber(value);
  if (scaled !== 0 && Math.abs(scaled) < 0.01) return `${scaled} (${(Number(value) / 1e14).toFixed(2)} bps)`;
  return `${Math.round(scaled * 10_000) / 10_000}`;
}

function deployedRows(config: DeployedConfigView): ConfigRow[] {
  const rows: ConfigRow[] = [];
  for (const [key, value] of Object.entries(config.scheduler)) {
    rows.push({
      key: `scheduler.${key}`,
      value:
        typeof value === "boolean"
          ? value
            ? "enabled"
            : "disabled"
          : typeof value === "string"
            ? formatWadValue(value)
            : key.endsWith("Seconds")
              ? `${formatInt(value)} s`
              : formatInt(value),
    });
  }
  for (const [key, value] of Object.entries(config.feeCurve)) {
    rows.push({
      key: `feeCurve.${key}`,
      value:
        typeof value === "string"
          ? formatWadValue(value)
          : key.endsWith("Pips")
            ? `${formatInt(value)} pips (${formatInt(value / 100)} bps)`
            : formatInt(value),
    });
  }
  return rows;
}

export default function DeployedParameters({
  researchConfig,
  config,
  status,
}: {
  researchConfig: ConfigRow[];
  config: DeployedConfigView | null;
  status: "loading" | "ready" | "error";
}) {
  return (
    <div>
      <div className="param-columns">
        <div className="param-column">
          <h4><i className="prov-chip live" />DEPLOYED · READ LIVE</h4>
          {config ? (
            <dl className="param-rows">
              {deployedRows(config).map((row) => (
                <div key={row.key}><dt><code>{row.key}</code></dt><dd>{row.value}</dd></div>
              ))}
            </dl>
          ) : (
            <div className="param-loader">
              <p>
                {status === "error"
                  ? "Testnet RPC unavailable — the deployed scheduler and fee-curve values could not be read. The audited getters remain readable on the explorer."
                  : "Reading the scheduler and fee-curve configuration from the deployed processor on Ethereum Sepolia…"}
              </p>
            </div>
          )}
        </div>
        <div className="param-column">
          <h4><i className="prov-chip bundle" />RESEARCH BUNDLE</h4>
          <dl className="param-rows">
            {researchConfig.map((row) => (
              <div key={row.key}><dt><code>{row.key}</code></dt><dd>{row.value}</dd></div>
            ))}
          </dl>
        </div>
      </div>
      <p className="card-caption">
        The research bundle locks the simulated candidate; the deployed pool answers live. The two columns are
        allowed to differ (the deployed confidence cap and fee gain do) — provenance is labeled so neither is
        mistaken for the other.
      </p>
    </div>
  );
}
