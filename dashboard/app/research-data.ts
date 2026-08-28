import bundleJson from "../data/dashboard_bundle.json";

type Interval = {
  count: number;
  mean: number | null;
  ci95_low: number | null;
  ci95_high: number | null;
};

type PolicyMetrics = Record<string, Interval>;

type TraceEvidence = {
  aggregate_markout_wad: number | null;
  confidence_wad: number | null;
  dead_band_wad: number;
  direction: number;
  epoch_complete: boolean;
  filtered_markout_wad: number;
  persistence_active: boolean;
  persistence_bitmap: number;
  raw_markout_wad: number;
  reference_dispersion_wad: number;
  sigma_wad: number;
  status: string;
};

type TraceStep = {
  step: number;
  evidence: TraceEvidence[];
  fee_by_direction_pips: { buy: number; sell: number };
  trade: {
    direction: string;
    reference_dispersion_wad: number;
    toxic_label: boolean;
  } | null;
  transport: {
    cumulative: {
      callbacks_applied: number;
      callbacks_missing: number;
      callbacks_rejected: number;
    };
    events: { type: string }[];
  };
};

type RepresentativeTrace = {
  description: string;
  event_count: number;
  final_transport: {
    callbacks_applied: number;
    callbacks_missing: number;
    callbacks_rejected: number;
    expired_references: number;
  };
  operational_mode: string;
  scenario: string;
  seed: number;
  step_seconds: number;
  steps: TraceStep[];
};

type Hypothesis = {
  id: string;
  title: string;
  status: string;
  evidence: Record<string, unknown>;
};

type HoldoutRow = {
  id: string;
  historical_status: string;
  holdout_status: string;
  holdout_evidence: Record<string, unknown>;
};

type DashboardBundle = {
  bundle_id: string;
  evidence_kind: string;
  interpretation_boundary: string;
  source_artifacts: { path: string; sha256: string }[];
  experiment_dimensions: {
    phase5_policies: number;
    phase5_runs: number;
    phase5_scenarios: number;
    phase5_seeds: number;
  };
  research_scale: {
    phase6_raw_runs: number;
    phase6_sweep_cases: number;
    phase61_training_cases: number;
    phase61_holdout_cases: number;
    hook_gas_per_swap: number;
  };
  calibration: {
    dynamic_fee_spread_pips: number;
    mean_fee_pips: Record<string, number>;
  };
  policy_metrics: Record<string, PolicyMetrics>;
  hypotheses: Hypothesis[];
  holdout_table: HoldoutRow[];
  selected_research_config: {
    base_fee_pips: number;
    confidence_cap_wad: number;
    dead_band_k_wad: number;
    markout_delay_steps: number;
    maximum_reference_dispersion_wad: number;
    persistence_window: number;
    required_toxic_epochs: number;
  };
  representative_traces: Record<string, RepresentativeTrace>;
};

const bundle = bundleJson as unknown as DashboardBundle;
const WAD_PER_BASIS_POINT = 100_000_000_000_000;
const WAD_PER_PERCENT = 10_000_000_000_000_000;

const scenarioPresentation: Record<string, { label: string; eyebrow: string }> = {
  benign_noise: { label: "Benign noise", eyebrow: "ordinary flow" },
  persistent_informed_buying: {
    label: "Informed buying",
    eyebrow: "persistent adverse selection",
  },
  conflicting_references: {
    label: "Conflicting references",
    eyebrow: "confidence fails closed",
  },
  missing_callbacks: {
    label: "Missing callbacks",
    eyebrow: "transport degradation",
  },
};

const policyPresentation: Record<
  string,
  { label: string; signed: string; persistent: string; behavior: string }
> = {
  fixed_fee: {
    label: "Fixed fee",
    signed: "No",
    persistent: "No",
    behavior: "Reference floor",
  },
  volatility_only: {
    label: "Volatility only",
    signed: "No",
    persistent: "No",
    behavior: "Moves with market state",
  },
  raw_positive_markout: {
    label: "Raw positive markout",
    signed: "Yes",
    persistent: "No",
    behavior: "Noise-biased",
  },
  dead_band_no_persistence: {
    label: "Dead band only",
    signed: "Yes",
    persistent: "No",
    behavior: "Filters, but reacts once",
  },
  thetashield: {
    label: "ThetaShield",
    signed: "Yes",
    persistent: "Yes",
    behavior: "Directional + persistent",
  },
};

function valueAt(record: Record<string, unknown>, path: string[]): number {
  let current: unknown = record;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) return 0;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "number" ? current : 0;
}

function mean(metrics: PolicyMetrics, key: string): number {
  return metrics[key]?.mean ?? 0;
}

function signedFixed(value: number, digits: number): string {
  const formatted = Math.abs(value).toFixed(digits);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

function wadToBps(value: number): string {
  return `${signedFixed(value / WAD_PER_BASIS_POINT, 2)} bps`;
}

function wadToPercent(value: number, digits = 2): string {
  return `${(value / WAD_PER_PERCENT).toFixed(digits)}%`;
}

function pipsToBps(value: number): string {
  return (value / 100).toFixed(2);
}

function bitmapBits(bitmap: number, window: number): number[] {
  return Array.from({ length: window }, (_, index) =>
    Math.floor(bitmap / 2 ** (window - index - 1)) % 2,
  );
}

function traceSnapshot(trace: RepresentativeTrace): TraceStep {
  const epochSteps = trace.steps.filter((step) =>
    step.evidence.some((evidence) => evidence.epoch_complete),
  );
  if (!epochSteps.length) return trace.steps[0];

  if (trace.scenario === "conflicting_references") {
    return epochSteps.reduce((selected, candidate) => {
      const selectedDispersion = selected.evidence[0]?.reference_dispersion_wad ?? 0;
      const candidateDispersion = candidate.evidence[0]?.reference_dispersion_wad ?? 0;
      return candidateDispersion >= selectedDispersion ? candidate : selected;
    });
  }

  return epochSteps.reduce((selected, candidate) => {
    const selectedSpread = Math.abs(
      selected.fee_by_direction_pips.buy - selected.fee_by_direction_pips.sell,
    );
    const candidateSpread = Math.abs(
      candidate.fee_by_direction_pips.buy - candidate.fee_by_direction_pips.sell,
    );
    return candidateSpread >= selectedSpread ? candidate : selected;
  });
}

function scenarioVerdict(trace: RepresentativeTrace, step: TraceStep): string {
  const baseline = bundle.selected_research_config.base_fee_pips;
  if (trace.scenario === "conflicting_references") return "Dispersion suppresses confidence";
  if (trace.final_transport.callbacks_missing > 0) return "Delivery loss remains visible";
  if (step.fee_by_direction_pips.buy > baseline) return "Buy protection active";
  if (step.fee_by_direction_pips.sell > baseline) return "Sell protection active";
  return "Baseline held";
}

export const scenarios = Object.values(bundle.representative_traces).map((trace) => {
  const selected = traceSnapshot(trace);
  const evidence = selected.evidence.find((entry) => entry.epoch_complete) ?? selected.evidence[0];
  const presentation = scenarioPresentation[trace.scenario];
  const totalCallbacks =
    trace.final_transport.callbacks_applied +
    trace.final_transport.callbacks_missing +
    trace.final_transport.callbacks_rejected;
  const deliveryRate = totalCallbacks
    ? (trace.final_transport.callbacks_applied * 100) / totalCallbacks
    : 100;
  const maximumDispersion = bundle.selected_research_config.maximum_reference_dispersion_wad;
  const referenceCohesion = Math.max(
    0,
    100 - ((evidence?.reference_dispersion_wad ?? 0) * 100) / maximumDispersion,
  );

  return {
    id: trace.scenario,
    label: presentation.label,
    eyebrow: presentation.eyebrow,
    summary: trace.description,
    buyFee: pipsToBps(selected.fee_by_direction_pips.buy),
    sellFee: pipsToBps(selected.fee_by_direction_pips.sell),
    markout: wadToBps(evidence?.raw_markout_wad ?? 0),
    sigma: wadToBps(evidence?.sigma_wad ?? 0),
    band: `±${Math.abs((evidence?.dead_band_wad ?? 0) / WAD_PER_BASIS_POINT).toFixed(2)} bps`,
    filtered: wadToBps(evidence?.filtered_markout_wad ?? 0),
    confidence: (evidence?.confidence_wad ?? 0) / WAD_PER_PERCENT,
    referenceCohesion,
    deliveryRate,
    callbacks: trace.final_transport,
    persistence: bitmapBits(
      evidence?.persistence_bitmap ?? 0,
      bundle.selected_research_config.persistence_window,
    ),
    evidenceStep: selected.step,
    eventCount: trace.event_count,
    verdict: scenarioVerdict(trace, selected),
  };
});

const holdoutById = Object.fromEntries(bundle.holdout_table.map((row) => [row.id, row]));

function hypothesisEvidence(hypothesis: Hypothesis): string {
  if (hypothesis.id === "H1") {
    const value = valueAt(hypothesis.evidence, [
      "paired_lp_net_improvement_quote_wad",
      "mean",
    ]);
    return `${signedFixed(value / 1e18, 4)} quote paired improvement`;
  }
  if (hypothesis.id === "H2") {
    return `${wadToPercent(valueAt(hypothesis.evidence, ["false_positive_rate_wad", "mean"]))} benign false positives`;
  }
  if (hypothesis.id === "H3") {
    return `${wadToPercent(valueAt(hypothesis.evidence, ["raw_minus_thetashield_false_positive_rate_wad", "mean"]))} fewer false positives`;
  }
  if (hypothesis.id === "H4") {
    const value = valueAt(holdoutById.H4.holdout_evidence, ["rank_correlation_wad"]);
    return `${signedFixed(value / 1e18, 3)} rank correlation on holdout`;
  }
  if (hypothesis.id === "H5") {
    const value = valueAt(holdoutById.H5.holdout_evidence, ["retained_coverage_ratio_wad"]);
    return `${wadToPercent(value)} toxic coverage retained on holdout`;
  }
  const value = valueAt(hypothesis.evidence, [
    "thetashield_minus_volatility_directional_rate_wad",
    "mean",
  ]);
  return `${wadToPercent(value)} directional advantage`;
}

export const hypotheses = bundle.hypotheses.map((hypothesis) => {
  const holdout = holdoutById[hypothesis.id];
  return {
    id: hypothesis.id,
    title: hypothesis.title,
    status: holdout
      ? `${hypothesis.status.toUpperCase()} · historical / ${holdout.holdout_status.toUpperCase()} · holdout`
      : hypothesis.status.toUpperCase(),
    evidence: hypothesisEvidence(hypothesis),
  };
});

export const policyRows = Object.entries(bundle.policy_metrics).map(([policy, metrics]) => ({
  id: policy,
  ...policyPresentation[policy],
  meanFeeBps: pipsToBps(mean(metrics, "mean_applied_fee_pips")),
  falsePositiveRate: wadToPercent(mean(metrics, "false_positive_rate_wad")),
  detectionLatency: mean(metrics, "detection_latency_steps") || null,
}));

const h4Holdout = holdoutById.H4.holdout_evidence;
const h5Holdout = holdoutById.H5.holdout_evidence;

export const evidenceStats = {
  h4Correlation: signedFixed(valueAt(h4Holdout, ["rank_correlation_wad"]) / 1e18, 3),
  paretoPoints: valueAt(h4Holdout, ["pareto_point_count"]),
  latencySpan: valueAt(h4Holdout, ["latency_span_steps"]),
  h5RetainedCoverage: wadToPercent(valueAt(h5Holdout, ["retained_coverage_ratio_wad"])),
  h5NoiseReduction: `${(valueAt(h5Holdout, ["fpr_reduction_mean_wad"]) / WAD_PER_PERCENT).toFixed(2)} pp`,
  h5OscillationReduction: valueAt(h5Holdout, ["oscillation_reduction_mean_pips"]),
};

export const researchScale = {
  ...bundle.research_scale,
  ...bundle.experiment_dimensions,
};

export const controllerConfig = {
  baselineFeeBps: pipsToBps(bundle.selected_research_config.base_fee_pips),
  confidenceCapPercent: bundle.selected_research_config.confidence_cap_wad / WAD_PER_PERCENT,
  deadBandK: bundle.selected_research_config.dead_band_k_wad / 1e18,
  evidenceDelaySeconds:
    bundle.selected_research_config.markout_delay_steps *
    bundle.representative_traces.benign_noise.step_seconds,
  persistenceRequired: bundle.selected_research_config.required_toxic_epochs,
  persistenceWindow: bundle.selected_research_config.persistence_window,
};

export const heroScenario = scenarios.find(
  (scenario) => scenario.id === "persistent_informed_buying",
) ?? scenarios[0];

export const trustBands = [
  {
    id: "proven",
    badge: "PROVEN · LOCAL",
    title: "Executable safety boundary",
    items: [
      "Python ↔ Solidity golden-vector parity",
      "Stateful controller invariants",
      "Real Uniswap v4 local lifecycle",
      "Research-profile directional regression",
    ],
  },
  {
    id: "simulated",
    badge: "SIMULATED · REPRODUCIBLE",
    title: "Economic evidence boundary",
    items: [
      `${bundle.experiment_dimensions.phase5_runs.toLocaleString()} locked policy runs`,
      `${bundle.experiment_dimensions.phase5_scenarios} scenarios × ${bundle.experiment_dimensions.phase5_seeds} seeds`,
      `${Object.keys(bundle.representative_traces).length} deterministic control traces`,
      "Coverage feedback with fee-elastic flow",
    ],
  },
  {
    id: "live",
    badge: "LIVE · HISTORICAL DEMO",
    title: "Public-chain acceptance boundary",
    items: [
      "Circle observation and recommendation receipts",
      "Single-source demo profile currently deployed",
      "Research sampler, lens, and Reactive plane await G10",
      "Unaudited testnet prototype",
    ],
  },
];

export const bundleMeta = {
  id: bundle.bundle_id,
  boundary: bundle.interpretation_boundary,
  sourceCount: bundle.source_artifacts.length,
  calibrationSpreadBps: pipsToBps(bundle.calibration.dynamic_fee_spread_pips),
};

export const dashboardView = {
  bundleMeta,
  controllerConfig,
  evidenceStats,
  heroScenario,
  hypotheses,
  policyRows,
  researchScale,
  scenarios,
  trustBands,
};

export type DashboardView = typeof dashboardView;
