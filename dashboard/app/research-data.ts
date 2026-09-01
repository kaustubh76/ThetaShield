import bundleJson from "../data/dashboard_bundle.json";
import { feeBps as pipsToBps, formatInt, signedFixed } from "./components/format";
import {
  formatParamBool,
  formatParamCount,
  formatParamPips,
  formatParamWad,
} from "./components/registry/param-format";

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
  pass_rule: string;
  evidence: Record<string, unknown>;
};

type HoldoutRow = {
  id: string;
  historical_status: string;
  holdout_status: string;
  holdout_evidence: Record<string, unknown>;
};

type SensitivityCase = {
  case_id: string;
  dimension: string;
  value_label: string;
  benign_false_positive_rate_wad: number;
  overall_false_negative_rate_wad: number;
  persistent_effective_detection_latency_steps: number;
  persistent_lp_improvement_quote_wad: number;
  directionally_correct_toxic_rate_wad: number;
  fee_oscillation_pips: number;
  pareto_optimal: boolean;
};

type CompactReplay = {
  scenario: string;
  description: string;
  operational_mode: string;
  event_count: number;
  step_seconds: number;
  stride: number;
  points: {
    step: number;
    buy_fee_pips: number;
    sell_fee_pips: number;
    callbacks_applied: number;
    callbacks_missing: number;
    callbacks_rejected: number;
  }[];
  final_transport: RepresentativeTrace["final_transport"];
  interpretation: string;
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
  scenario_lp_outcomes: Record<string, Record<string, Interval>>;
  hypotheses: Hypothesis[];
  holdout_table: HoldoutRow[];
  phase6_sensitivity: Record<string, SensitivityCase>;
  selected_research_config: {
    alpha_wad: number;
    base_fee_pips: number;
    confidence_cap_wad: number;
    dead_band_k_wad: number;
    markout_delay_steps: number;
    maximum_fee_pips: number;
    maximum_reference_dispersion_wad: number;
    persistence_window: number;
    required_toxic_epochs: number;
  } & Record<string, number | boolean>;
  representative_traces: Record<string, RepresentativeTrace>;
  compact_scenario_replays: Record<string, CompactReplay>;
  trace_configuration: {
    research_config: {
      alpha_wad: number;
      dead_band_k_wad: number;
      maximum_fee_pips: number;
      persistence_window: number;
      required_toxic_epochs: number;
    };
  };
  closed_loop: {
    overall_status: string;
    interpretation: string;
    interpretation_boundary: string;
    gates: Record<string, { rule: string; status: string }>;
    elastic_fee_revenue_delta_quote_wad: number;
    aggregates: {
      elastic: Record<string, {
        benign_volume_retained_rate_wad: number;
        toxic_volume_retained_rate_wad: number;
        volume_retained_rate_wad: number;
        lp_fee_revenue_quote_wad: number;
        lp_net_pnl_quote_wad: number;
      }>;
    };
  };
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

function wadToPercent(value: number, digits = 2): string {
  return `${(value / WAD_PER_PERCENT).toFixed(digits)}%`;
}

function presentationFor<T>(map: Record<string, T>, key: string, kind: string): T {
  const entry = map[key];
  if (!entry) throw new Error(`dashboard bundle has an unpresented ${kind}: ${key}`);
  return entry;
}

const holdoutById = Object.fromEntries(bundle.holdout_table.map((row) => [row.id, row]));

function hypothesisEvidence(hypothesis: Hypothesis): string {
  if (hypothesis.id === "H1") {
    return "measured as the paired LP figure at the top of the page";
  }
  if (hypothesis.id === "H2") {
    return `${wadToPercent(valueAt(hypothesis.evidence, ["false_positive_rate_wad", "mean"]))} benign false positives`;
  }
  if (hypothesis.id === "H3") {
    return `${wadToPercent(valueAt(hypothesis.evidence, ["raw_minus_thetashield_false_positive_rate_wad", "mean"]))} fewer false positives`;
  }
  if (hypothesis.id === "H4" || hypothesis.id === "H5") {
    return "re-scored on reserved holdout — see the chart";
  }
  const value = valueAt(hypothesis.evidence, [
    "thetashield_minus_volatility_directional_rate_wad",
    "mean",
  ]);
  return `${wadToPercent(value)} directional advantage`;
}

const hypotheses = bundle.hypotheses.map((hypothesis) => {
  const holdout = holdoutById[hypothesis.id];
  return {
    id: hypothesis.id,
    title: hypothesis.title,
    status: holdout
      ? `${hypothesis.status.toUpperCase()} · historical / ${holdout.holdout_status.toUpperCase()} · holdout`
      : hypothesis.status.toUpperCase(),
    // The rule each hypothesis was actually tested against was already loaded
    // and never shown; the expandable row is where it belongs.
    passRule: hypothesis.pass_rule,
    passed: holdout ? holdout.holdout_status === "pass" : hypothesis.status === "pass",
    evidence: hypothesisEvidence(hypothesis),
  };
});

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// A missing interval bound collapses to the mean, so a whisker degenerates to its
// point instead of being drawn from a coerced zero.
function ciBound(
  interval: Interval | undefined,
  key: "ci95_low" | "ci95_high",
  scale: number,
  fallback: number,
): number {
  const bound = interval?.[key];
  return bound === null || bound === undefined ? fallback : round(bound / scale);
}

function scatterPoint(metrics: PolicyMetrics) {
  const feeBps = round(mean(metrics, "mean_applied_fee_pips") / 100);
  const fprPercent = round(mean(metrics, "false_positive_rate_wad") / WAD_PER_PERCENT);
  return {
    feeBps,
    feeLowBps: ciBound(metrics.mean_applied_fee_pips, "ci95_low", 100, feeBps),
    feeHighBps: ciBound(metrics.mean_applied_fee_pips, "ci95_high", 100, feeBps),
    fprPercent,
    fprLowPercent: ciBound(metrics.false_positive_rate_wad, "ci95_low", WAD_PER_PERCENT, fprPercent),
    fprHighPercent: ciBound(metrics.false_positive_rate_wad, "ci95_high", WAD_PER_PERCENT, fprPercent),
    fnrPercent: round(mean(metrics, "false_negative_rate_wad") / WAD_PER_PERCENT),
  };
}

const policyRows = Object.entries(bundle.policy_metrics).map(([policy, metrics]) => ({
  id: policy,
  ...presentationFor(policyPresentation, policy, "policy"),
  meanFeeBps: pipsToBps(mean(metrics, "mean_applied_fee_pips")),
  falsePositiveRate: wadToPercent(mean(metrics, "false_positive_rate_wad")),
  detectionLatency: mean(metrics, "detection_latency_steps") || null,
  scatter: scatterPoint(metrics),
}));

const h4Holdout = holdoutById.H4.holdout_evidence;
const h5Holdout = holdoutById.H5.holdout_evidence;

// The LP outcome the page leads with. Two halves, because one alone would
// mislead: ThetaShield beats the FIXED-FEE baseline on matched streams (H1's
// actual pass rule), but it does NOT beat volatility-only on absolute LP net —
// it loses to it in 13 of 15 scenarios. Where it wins against volatility-only is
// that it charges less and cries wolf far less often on benign flow.
//
// Absolute LP net is negative for every policy here, so nothing in this object
// may be presented as profit; the bundle's own interpretation_boundary travels
// with it.
const lpOutcome = (() => {
  const h1 = bundle.hypotheses.find((entry) => entry.id === "H1");
  const h3 = bundle.hypotheses.find((entry) => entry.id === "H3");
  const h6 = bundle.hypotheses.find((entry) => entry.id === "H6");
  if (!h1 || !h3 || !h6) throw new Error("dashboard bundle is missing H1, H3 or H6");

  const paired = h1.evidence.paired_lp_net_improvement_quote_wad as Interval;
  const mine = bundle.policy_metrics.thetashield;
  const rival = bundle.policy_metrics.volatility_only;
  const fixed = bundle.policy_metrics.fixed_fee;

  const feeBpsOf = (metrics: PolicyMetrics) => (metrics.mean_applied_fee_pips.mean ?? 0) / 100;
  const fprOf = (metrics: PolicyMetrics) => (metrics.false_positive_rate_wad.mean ?? 0) / WAD_PER_PERCENT;
  const pooledGap =
    ((mine.lp_net_pnl_quote_wad.mean ?? 0) - (fixed.lp_net_pnl_quote_wad.mean ?? 0)) / 1e18;

  return {
    // Half one: the paired comparison H1 actually tests.
    paired: {
      mean: signedFixed((paired.mean ?? 0) / 1e18, 4),
      low: signedFixed((paired.ci95_low ?? 0) / 1e18, 4),
      high: signedFixed((paired.ci95_high ?? 0) / 1e18, 4),
      pairs: paired.count,
      status: h1.status.toUpperCase(),
    },
    // Half two: the fairness comparison, where the gap is large.
    fairness: {
      feeBps: feeBpsOf(mine).toFixed(2),
      rivalFeeBps: feeBpsOf(rival).toFixed(2),
      falsePositivePercent: fprOf(mine).toFixed(2),
      rivalFalsePositivePercent: fprOf(rival).toFixed(2),
      falsePositiveGap: (fprOf(rival) - fprOf(mine)).toFixed(2),
      noiseRobustness: round(
        valueAt(h3.evidence, ["raw_minus_thetashield_false_positive_rate_wad", "mean"]) / WAD_PER_PERCENT,
      ),
      directionalAdvantage: round(
        valueAt(h6.evidence, ["thetashield_minus_volatility_directional_rate_wad", "mean"]) / WAD_PER_PERCENT,
      ),
    },
    // The paired figure and the pooled table are different populations. Stating
    // one without the other is how a reader ends up with the wrong number.
    pooledGap: signedFixed(pooledGap, 4),
    pooledRuns: mine.lp_net_pnl_quote_wad.count,
    boundary: bundle.interpretation_boundary,
  };
})();

const controllerConfig = {
  baselineFeeBps: pipsToBps(bundle.selected_research_config.base_fee_pips),
  confidenceCapPercent: bundle.selected_research_config.confidence_cap_wad / WAD_PER_PERCENT,
  evidenceDelaySeconds:
    bundle.selected_research_config.markout_delay_steps *
    bundle.representative_traces.benign_noise.step_seconds,
  persistenceRequired: bundle.selected_research_config.required_toxic_epochs,
  persistenceWindow: bundle.selected_research_config.persistence_window,
  maximumFeeBps: bundle.selected_research_config.maximum_fee_pips / 100,
};

function scenarioLabel(scenario: string): string {
  return scenario
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// One table of display names for every dimension the bundle can carry. The
// simulator's curated shortlist below reads its labels from here, so a rename
// cannot make the same dimension appear under two names on one page.
const sensitivityDimensionLabels: Record<string, string> = {
  confidence_threshold: "Confidence threshold",
  dead_band_k: "Dead-band k",
  epoch_duration: "Epoch duration",
  ewma_alpha: "EWMA alpha",
  fee_gain: "Fee gain",
  fee_step_limits: "Fee step limits",
  markout_horizon: "Horizon",
  maximum_fee: "Fee cap",
  persistence_n_of_k: "Persistence n/K",
  toxicity_threshold: "Toxicity threshold",
  trailing_window: "Trailing window",
};

function dimensionLabel(id: string): string {
  return sensitivityDimensionLabels[id] ?? scenarioLabel(id);
}

// A deliberate 4-of-11 shortlist, in a curated order: these are the dimensions
// the replay console exposes as controls. The full sweep renders all 11.
// `defaultLabel` describes the trace configuration the replay runs under, which
// is a different config block from `selected_research_config` and is allowed to
// differ from it — see the note on controllerConfig.
const sensitivityDimensions = [
  {
    id: "dead_band_k",
    label: dimensionLabel("dead_band_k"),
    defaultLabel: (bundle.trace_configuration.research_config.dead_band_k_wad / 1e18).toFixed(1),
  },
  {
    id: "persistence_n_of_k",
    label: dimensionLabel("persistence_n_of_k"),
    defaultLabel: `${bundle.trace_configuration.research_config.required_toxic_epochs}-of-${bundle.trace_configuration.research_config.persistence_window}`,
  },
  {
    id: "ewma_alpha",
    label: dimensionLabel("ewma_alpha"),
    defaultLabel: (bundle.trace_configuration.research_config.alpha_wad / 1e18).toFixed(2),
  },
  {
    id: "maximum_fee",
    label: dimensionLabel("maximum_fee"),
    defaultLabel: `${formatInt(bundle.trace_configuration.research_config.maximum_fee_pips)} pips`,
  },
] as const;

function sensitivityOption(entry: SensitivityCase, label = entry.value_label) {
  return {
    id: entry.case_id,
    label,
    falsePositivePercent: entry.benign_false_positive_rate_wad / WAD_PER_PERCENT,
    falseNegativePercent: entry.overall_false_negative_rate_wad / WAD_PER_PERCENT,
    detectionLatency: entry.persistent_effective_detection_latency_steps,
    lpImprovementQuote: entry.persistent_lp_improvement_quote_wad / 1e18,
    directionalAccuracyPercent:
      entry.directionally_correct_toxic_rate_wad / WAD_PER_PERCENT,
    oscillationBps: entry.fee_oscillation_pips / 100,
    paretoOptimal: entry.pareto_optimal,
  };
}

const simulator = {
  policies: Object.entries(bundle.policy_metrics).map(([policy, metrics]) => ({
    id: policy,
    label: presentationFor(policyPresentation, policy, "policy").label,
    meanFeeBps: mean(metrics, "mean_applied_fee_pips") / 100,
    benignFeeQuote: mean(metrics, "benign_trader_fees_quote_wad") / 1e18,
    toxicFeeQuote: mean(metrics, "toxic_trader_fees_quote_wad") / 1e18,
    feeRevenueQuote: mean(metrics, "lp_fee_revenue_quote_wad") / 1e18,
    inventoryPnlQuote: mean(metrics, "inventory_pnl_quote_wad") / 1e18,
    lpNetQuote: mean(metrics, "lp_net_pnl_quote_wad") / 1e18,
    specificityPercent: 100 - mean(metrics, "false_positive_rate_wad") / WAD_PER_PERCENT,
    recallPercent: 100 - mean(metrics, "false_negative_rate_wad") / WAD_PER_PERCENT,
    detectionLatency: mean(metrics, "detection_latency_steps") || null,
  })),
  scenarios: Object.entries(bundle.compact_scenario_replays).map(([scenario, replay]) => ({
    id: scenario,
    label: scenarioLabel(scenario),
    description: replay.description,
    operationalMode: replay.operational_mode,
    eventCount: replay.event_count,
    stepSeconds: replay.step_seconds,
    stride: replay.stride,
    points: replay.points.map((point) => ({
      step: point.step,
      buyFeeBps: point.buy_fee_pips / 100,
      sellFeeBps: point.sell_fee_pips / 100,
      callbacksApplied: point.callbacks_applied,
      callbacksMissing: point.callbacks_missing,
      callbacksRejected: point.callbacks_rejected,
    })),
    finalTransport: replay.final_transport,
    lpOutcomes: Object.fromEntries(
      Object.entries(bundle.scenario_lp_outcomes[scenario]).map(([policy, interval]) => [
        policy,
        {
          mean: (interval.mean ?? 0) / 1e18,
          low: (interval.ci95_low ?? 0) / 1e18,
          high: (interval.ci95_high ?? 0) / 1e18,
        },
      ]),
    ),
  })),
  sensitivity: sensitivityDimensions.map((dimension) => ({
    id: dimension.id,
    label: dimension.label,
    options: [
      sensitivityOption(
        {
          ...bundle.phase6_sensitivity.default,
          case_id: "default",
        },
        `${dimension.defaultLabel} · default`,
      ),
      ...Object.values(bundle.phase6_sensitivity)
        .filter((entry) => entry.dimension === dimension.id)
        .map((entry) => sensitivityOption(entry)),
    ],
  })),
  closedLoop: {
    status: bundle.closed_loop.overall_status,
    interpretation: bundle.closed_loop.interpretation,
    boundary: bundle.closed_loop.interpretation_boundary,
    feeRevenueDeltaQuote: bundle.closed_loop.elastic_fee_revenue_delta_quote_wad / 1e18,
    coveragePolicyId:
      Object.keys(bundle.closed_loop.aggregates.elastic).find((key) =>
        key.startsWith("coverage_"),
      ) ?? Object.keys(bundle.closed_loop.aggregates.elastic)[0],
    gates: Object.entries(bundle.closed_loop.gates).map(([id, gate]) => ({
      id,
      label: scenarioLabel(id),
      rule: gate.rule,
      status: gate.status,
    })),
    coverage: Object.fromEntries(
      Object.entries(bundle.closed_loop.aggregates.elastic).map(([policy, metrics]) => [
        policy,
        {
          benignRetainedPercent:
            metrics.benign_volume_retained_rate_wad / WAD_PER_PERCENT,
          toxicRetainedPercent:
            metrics.toxic_volume_retained_rate_wad / WAD_PER_PERCENT,
          totalRetainedPercent:
            metrics.volume_retained_rate_wad / WAD_PER_PERCENT,
          feeRevenueQuote: metrics.lp_fee_revenue_quote_wad / 1e18,
          lpNetQuote: metrics.lp_net_pnl_quote_wad / 1e18,
        },
      ]),
    ),
  },
};

const heroTraceSource =
  bundle.representative_traces.persistent_informed_buying ??
  Object.values(bundle.representative_traces)[0];

const heroTracePoints = heroTraceSource.steps
    .filter((step) => step.evidence.length > 0)
    .map((step) => {
      const evidence = step.evidence[0];
      return {
        step: step.step,
        markoutBps: round(evidence.raw_markout_wad / WAD_PER_BASIS_POINT),
        bandBps: round(evidence.dead_band_wad / WAD_PER_BASIS_POINT),
        filteredBps: round(evidence.filtered_markout_wad / WAD_PER_BASIS_POINT),
        buyFeeBps: round(step.fee_by_direction_pips.buy / 100),
        sellFeeBps: round(step.fee_by_direction_pips.sell / 100),
        toxic: step.trade?.toxic_label ?? false,
      };
    });

// The single observation the animated loop carries. Picked from the locked
// trace, not composed: the first step whose epoch completed with real
// confidence, so every stage of the loop has a genuine value to report rather
// than a cold-start zero.
const mechanismStep = (() => {
  const step = heroTraceSource.steps.find((entry) => {
    const evidence = entry.evidence[0] as (typeof entry.evidence)[number] & {
      epoch_complete?: boolean;
      confidence_wad?: number | null;
      calculated_fee_pips?: number;
      previous_fee_pips?: number;
    } | undefined;
    // Not merely a completed epoch: one where the fee actually moved. Otherwise
    // the loop ends on "fee curve → the baseline", which demonstrates nothing.
    return Boolean(
      evidence?.epoch_complete &&
        (evidence.confidence_wad ?? 0) > 0 &&
        (evidence.calculated_fee_pips ?? 0) > (evidence.previous_fee_pips ?? 0),
    );
  });
  if (!step) throw new Error("locked trace has no completed epoch that moved the fee");
  return step;
})();

const mechanismTrace = (() => {
  const evidence = mechanismStep.evidence[0] as (typeof mechanismStep.evidence)[number] & {
    calculated_fee_pips?: number;
    previous_fee_pips?: number;
  };
  const entry = heroTracePoints[0];
  return {
    eventCount: heroTraceSource.event_count,
    seed: heroTraceSource.seed,
    entryBuyBps: entry.buyFeeBps.toFixed(2),
    entrySellBps: entry.sellFeeBps.toFixed(2),
    markoutBps: round(evidence.raw_markout_wad / WAD_PER_BASIS_POINT, 2).toFixed(2),
    bandBps: round(evidence.dead_band_wad / WAD_PER_BASIS_POINT, 2).toFixed(2),
    filteredBps: round(evidence.filtered_markout_wad / WAD_PER_BASIS_POINT, 2).toFixed(2),
    calculatedBps: ((evidence.calculated_fee_pips ?? 0) / 100).toFixed(2),
  };
})();

const heroFinal = heroTracePoints[heroTracePoints.length - 1];

// The readout reports the end of the very series the chart draws. Deriving it
// any other way (e.g. a max-spread snapshot step) makes the number under the
// chart disagree with where the chart's line stops.
const heroTrace = {
  label: scenarioPresentation[heroTraceSource.scenario]?.label ?? heroTraceSource.scenario,
  eventCount: heroTraceSource.event_count,
  seed: heroTraceSource.seed,
  finalBuyBps: heroFinal.buyFeeBps.toFixed(2),
  finalSellBps: heroFinal.sellFeeBps.toFixed(2),
  points: heroTracePoints,
};

const h4Historical = bundle.hypotheses.find((entry) => entry.id === "H4")?.evidence ?? {};
const h5Historical = bundle.hypotheses.find((entry) => entry.id === "H5")?.evidence ?? {};

const hypothesisById = Object.fromEntries(bundle.hypotheses.map((row) => [row.id, row]));

const holdoutStory = [
  {
    id: "H4",
    title: hypothesisById.H4.title,
    metricLabel: "rank correlation",
    target: "pass ≤ −0.35",
    targetValue: -0.35,
    passRule: hypothesisById.H4.pass_rule,
    supporting: [
      `${valueAt(h4Holdout, ["pareto_point_count"])} Pareto points (≥ 3 required)`,
      `${wadToPercent(valueAt(h4Holdout, ["false_positive_span_wad"]))} false-positive span (≥ 5.00% required)`,
      `${valueAt(h4Holdout, ["latency_span_steps"])} step latency span (≥ 5 required)`,
    ],
    historicalStatus: holdoutById.H4.historical_status.toUpperCase(),
    holdoutStatus: holdoutById.H4.holdout_status.toUpperCase(),
    historicalValue: round(valueAt(h4Historical, ["rank_correlation_wad"]) / 1e18, 3),
    holdoutValue: round(valueAt(h4Holdout, ["rank_correlation_wad"]) / 1e18, 3),
    historicalLabel: signedFixed(valueAt(h4Historical, ["rank_correlation_wad"]) / 1e18, 3),
    holdoutLabel: signedFixed(valueAt(h4Holdout, ["rank_correlation_wad"]) / 1e18, 3),
    unit: "",
    domain: [-1, 1] as const,
  },
  {
    id: "H5",
    title: hypothesisById.H5.title,
    metricLabel: "toxic coverage retained",
    target: "pass ≥ 50%",
    targetValue: 50,
    passRule: hypothesisById.H5.pass_rule,
    supporting: [
      `false-positive reduction ${wadToPercent(valueAt(h5Holdout, ["fpr_reduction_ci95_low_wad"]))}–${wadToPercent(valueAt(h5Holdout, ["fpr_reduction_ci95_high_wad"]))} (95% interval above zero required)`,
      `oscillation reduction ${formatInt(valueAt(h5Holdout, ["oscillation_reduction_ci95_low_pips"]))}–${formatInt(valueAt(h5Holdout, ["oscillation_reduction_ci95_high_pips"]))} fee pips (95% interval above zero required)`,
    ],
    historicalStatus: holdoutById.H5.historical_status.toUpperCase(),
    holdoutStatus: holdoutById.H5.holdout_status.toUpperCase(),
    historicalValue: round(valueAt(h5Historical, ["retained_coverage_ratio_wad"]) / WAD_PER_PERCENT),
    holdoutValue: round(valueAt(h5Holdout, ["retained_coverage_ratio_wad"]) / WAD_PER_PERCENT),
    historicalLabel: wadToPercent(valueAt(h5Historical, ["retained_coverage_ratio_wad"])),
    holdoutLabel: wadToPercent(valueAt(h5Holdout, ["retained_coverage_ratio_wad"])),
    unit: "%",
    domain: [0, 100] as const,
  },
];

const sensitivityAll = {
  dimensions: [...new Set(
    Object.values(bundle.phase6_sensitivity)
      .filter((entry) => entry.dimension !== "default")
      .map((entry) => entry.dimension),
  )]
    .sort()
    .map((dimension) => ({
      id: dimension,
      label: dimensionLabel(dimension),
      cases: Object.values(bundle.phase6_sensitivity)
        .filter((entry) => entry.dimension === dimension)
        .map((entry) => ({
          id: entry.case_id,
          valueLabel: entry.value_label,
          fprPercent: round(entry.benign_false_positive_rate_wad / WAD_PER_PERCENT),
          latencySteps: entry.persistent_effective_detection_latency_steps,
          pareto: entry.pareto_optimal,
        })),
    })),
  defaultCase: (() => {
    const entry = bundle.phase6_sensitivity.default;
    return entry
      ? {
          fprPercent: round(entry.benign_false_positive_rate_wad / WAD_PER_PERCENT),
          latencySteps: entry.persistent_effective_detection_latency_steps,
        }
      : null;
  })(),
};

// Shared with the deployed column so the two are comparable by construction.
function formatConfigValue(key: string, value: number | boolean): string {
  if (typeof value === "boolean") return formatParamBool(value);
  if (key.endsWith("_wad")) return formatParamWad(value);
  if (key.endsWith("_pips")) return formatParamPips(value);
  if (key.endsWith("_steps")) return `${value} steps`;
  return formatParamCount(value);
}

const researchConfigRows = Object.entries(bundle.selected_research_config)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, value]) => ({ key, value: formatConfigValue(key, value) }));

const bundleMeta = {
  id: bundle.bundle_id,
  boundary: bundle.interpretation_boundary,
  sourceCount: bundle.source_artifacts.length,
  calibrationSpreadBps: pipsToBps(bundle.calibration.dynamic_fee_spread_pips),
};

export const dashboardView = {
  bundleMeta,
  controllerConfig,
  heroTrace,
  holdoutStory,
  hypotheses,
  lpOutcome,
  mechanismTrace,
  policyRows,
  researchConfigRows,
  sensitivityAll,
  simulator,
};

export type DashboardView = typeof dashboardView;
