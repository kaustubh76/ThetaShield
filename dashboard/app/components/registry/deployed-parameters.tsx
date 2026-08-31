import type { DeployedConfigView } from "../live-proof/types";
import {
  formatParamBool,
  formatParamCount,
  formatParamPips,
  formatParamSeconds,
  formatParamWad,
} from "./param-format";

type ConfigRow = { key: string; value: string };

function deployedRows(config: DeployedConfigView): ConfigRow[] {
  const rows: ConfigRow[] = [];
  for (const [key, value] of Object.entries(config.scheduler)) {
    rows.push({
      key: `scheduler.${key}`,
      value:
        typeof value === "boolean"
          ? formatParamBool(value)
          : typeof value === "string"
            ? formatParamWad(Number(value))
            : key.endsWith("Seconds")
              ? formatParamSeconds(value)
              : formatParamCount(value),
    });
  }
  for (const [key, value] of Object.entries(config.feeCurve)) {
    rows.push({
      key: `feeCurve.${key}`,
      value:
        typeof value === "string"
          ? formatParamWad(Number(value))
          : key.endsWith("Pips")
            ? formatParamPips(value)
            : formatParamCount(value),
    });
  }
  return rows;
}

export default function DeployedParameters({
  researchConfig,
  config,
  status,
  readPath,
}: {
  researchConfig: ConfigRow[];
  config: DeployedConfigView | null;
  status: "loading" | "ready" | "stale" | "error";
  readPath: "lens" | "historical-direct" | null;
}) {
  // A read that SUCCEEDED without carrying this group is neither loading nor
  // failing. Without this third case the column showed "Reading…" forever on the
  // direct path — a progress message for a request that had already returned.
  const unavailable = config === null && (status === "ready" || status === "stale");

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
              <p className={status === "error" || unavailable ? "param-error" : undefined}>
                {status === "error"
                  ? "Testnet RPC unavailable — the deployed scheduler and fee-curve values could not be read. The audited getters remain readable on the explorer."
                  : unavailable
                    ? `The read succeeded on the ${readPath === "historical-direct" ? "direct getter" : "current"} path, which does not carry the aggregated scheduler and fee-curve configuration. These values are read through the deployed processor lens; the audited getters remain readable on the explorer.`
                    : "Reading the scheduler and fee-curve configuration from the deployed processor…"}
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
