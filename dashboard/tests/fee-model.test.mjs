import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// app/fee-model.ts is a port of research/thetashield/model.py. This suite runs
// it against the SAME golden vectors that gate the Solidity
// (test/integration/GoldenVectors.t.sol) and the Python
// (research/tests/test_golden_vectors.py). If the port drifts from the deployed
// contract, this fails — which is the only reason the UI is allowed to compute
// a fee at all rather than only replaying recorded ones.
const model = await import("../app/fee-model.ts");
// Several vectors exceed 2^53 (execution prices are WAD-scaled), and a plain
// JSON.parse would silently turn those into lossy doubles — which is exactly the
// kind of drift this suite exists to catch. Read every integer as a bigint from
// the raw source text instead.
const vectors = JSON.parse(
  await readFile(new URL("../../research/datasets/golden_vectors.json", import.meta.url), "utf8"),
  function reviveExactIntegers(key, value, context) {
    if (typeof value === "number" && Number.isInteger(value) && context?.source) {
      return BigInt(context.source);
    }
    return value;
  },
);
const big = (value) => BigInt(value);
const num = (value) => Number(value);

test("golden vectors are the schema this port was written against", () => {
  assert.equal(num(vectors.schema_version), 2, "golden vector schema changed — re-check the port");
});

test("directional markout matches every golden vector", () => {
  assert.ok(vectors.markout.length >= 4);
  for (const vector of vectors.markout) {
    assert.equal(
      model.directionalMarkout(
        big(vector.execution_price_wad),
        big(vector.reference_price_wad),
        num(vector.direction),
      ),
      big(vector.expected_markout_wad),
      `markout d=${vector.direction} exec=${vector.execution_price_wad}`,
    );
  }
});

test("trailing sigma matches the golden vector, excluding the current index", () => {
  const vector = vectors.trailing_volatility;
  const { sigmaWad, sampleCount } = model.trailingSigma(
    vector.series_wad.map(big),
    num(vector.current_index),
    num(vector.window),
  );
  assert.equal(sigmaWad, big(vector.expected_sigma_wad));
  assert.equal(sampleCount, num(vector.expected_sample_count));
});

test("dead band filter matches every golden vector", () => {
  assert.ok(vectors.dead_band.length >= 3);
  for (const vector of vectors.dead_band) {
    assert.equal(
      model.deadBandFilter(big(vector.markout_wad), big(vector.sigma_wad), big(vector.k_wad)),
      big(vector.expected_filtered_wad),
      `dead band m=${vector.markout_wad}`,
    );
  }
});

test("confidence matches the golden vector on every intermediate", () => {
  const vector = vectors.confidence;
  const result = model.calculateConfidence({
    observationCount: big(vector.observation_count),
    targetObservationCount: big(vector.target_observation_count),
    agreeingNotionalWad: big(vector.agreeing_notional_wad),
    totalNotionalWad: big(vector.total_notional_wad),
    referenceDispersionWad: big(vector.reference_dispersion_wad),
    maximumDispersionWad: big(vector.maximum_dispersion_wad),
    confidenceCapWad: big(vector.confidence_cap_wad),
  });
  assert.equal(result.countScoreWad, big(vector.expected_count_score_wad));
  assert.equal(result.agreementScoreWad, big(vector.expected_agreement_score_wad));
  assert.equal(result.dispersionScoreWad, big(vector.expected_dispersion_score_wad));
  assert.equal(result.uncappedConfidenceWad, big(vector.expected_uncapped_confidence_wad));
  assert.equal(result.confidenceWad, big(vector.expected_confidence_wad));
});

test("persistence walks the golden bitmap sequence", () => {
  const vector = vectors.persistence;
  let bitmap = 0n;
  vector.steps.forEach((step, index) => {
    const result = model.pushPersistence(
      bitmap,
      step.toxic,
      num(vector.required_toxic_epochs),
      num(vector.window_length ?? vector.steps.length + 1),
    );
    bitmap = result.bitmap;
    assert.equal(bitmap, big(step.expected_bitmap), `bitmap after step ${index}`);
    assert.equal(result.active, step.expected_active, `active after step ${index}`);
  });
});

test("risk smoothing matches the golden vector", () => {
  const vector = vectors.smoothing;
  const result = model.smoothDirectionalRisk({
    aggregateMarkoutWad: big(vector.aggregate_markout_wad),
    previousMagnitudeWad: big(vector.previous_magnitude_wad),
    alphaWad: big(vector.alpha_wad),
    confidenceWad: big(vector.confidence_wad),
  });
  assert.equal(result.magnitudeWad, big(vector.expected_magnitude_wad));
  assert.equal(result.signedRiskWad, big(vector.expected_signed_risk_wad));
});

test("the fee curve matches the golden vector on premium, target and next", () => {
  const vector = vectors.fee;
  const result = model.calculateFee({
    signedRiskWad: big(vector.signed_risk_wad),
    confidenceWad: big(vector.confidence_wad),
    persistenceActive: vector.persistence_active,
    previousFeePips: big(vector.previous_fee_pips),
    config: {
      baseFeePips: big(vector.base_fee_pips),
      minimumFeePips: big(vector.minimum_fee_pips),
      maximumFeePips: big(vector.maximum_fee_pips),
      gainFeePips: big(vector.gain_fee_pips),
      maximumIncreasePips: big(vector.maximum_increase_pips),
      maximumDecreasePips: big(vector.maximum_decrease_pips),
      confidenceFloorWad: big(vector.confidence_floor_wad),
    },
  });
  assert.equal(result.premiumPips, big(vector.expected_premium_pips));
  assert.equal(result.targetFeePips, big(vector.expected_target_fee_pips));
  assert.equal(result.nextFeePips, big(vector.expected_next_fee_pips));
});

test("the fee curve refuses to raise a fee without persistence or confidence", () => {
  const vector = vectors.fee;
  const config = {
    baseFeePips: big(vector.base_fee_pips),
    minimumFeePips: big(vector.minimum_fee_pips),
    maximumFeePips: big(vector.maximum_fee_pips),
    gainFeePips: big(vector.gain_fee_pips),
    maximumIncreasePips: big(vector.maximum_increase_pips),
    maximumDecreasePips: big(vector.maximum_decrease_pips),
    confidenceFloorWad: big(vector.confidence_floor_wad),
  };
  const base = {
    signedRiskWad: big(vector.signed_risk_wad),
    confidenceWad: big(vector.confidence_wad),
    previousFeePips: big(vector.previous_fee_pips),
    config,
  };
  // The spec's headline safety property: "negative or zero signed risk cannot
  // raise the fee", and neither can a sub-floor confidence or an inactive window.
  assert.equal(model.calculateFee({ ...base, persistenceActive: false }).premiumPips, 0n);
  assert.equal(
    model.calculateFee({ ...base, persistenceActive: true, confidenceWad: 0n }).premiumPips,
    0n,
  );
  assert.equal(
    model.calculateFee({ ...base, persistenceActive: true, signedRiskWad: -1n }).premiumPips,
    0n,
  );
});

test("the premium cannot exceed maximum minus base, and the fee stays in bounds", () => {
  // The golden fee vector's premium (2000) never reaches the cap
  // (maximum 10000 − base 500 = 9500), so removing the cap in the port would
  // not fail any vector. This exercises the bound directly: it is stated in
  // model.py's calculate_fee and FeeCurve.sol:94-95.
  const vector = vectors.fee;
  const config = {
    baseFeePips: big(vector.base_fee_pips),
    minimumFeePips: big(vector.minimum_fee_pips),
    maximumFeePips: big(vector.maximum_fee_pips),
    gainFeePips: big(vector.gain_fee_pips),
    maximumIncreasePips: big(vector.maximum_increase_pips),
    maximumDecreasePips: big(vector.maximum_decrease_pips),
    confidenceFloorWad: big(vector.confidence_floor_wad),
  };
  const cap = config.maximumFeePips - config.baseFeePips;

  // A risk far past the cap: gain 500000 pips × 1.0 WAD risk = 500000 pips raw.
  const capped = model.calculateFee({
    signedRiskWad: model.WAD,
    confidenceWad: big(vector.confidence_wad),
    persistenceActive: true,
    previousFeePips: big(vector.previous_fee_pips),
    config,
  });
  assert.equal(capped.premiumPips, cap, "premium must be capped at maximum − base");
  assert.equal(capped.targetFeePips, config.maximumFeePips, "target must clamp to the maximum");
  assert.ok(
    capped.nextFeePips <= big(vector.previous_fee_pips) + config.maximumIncreasePips,
    "next fee must still respect the per-update increase limit",
  );
  assert.ok(capped.nextFeePips <= config.maximumFeePips);
});

test("a falling target is rate-limited downward and floored at the minimum", () => {
  const vector = vectors.fee;
  const config = {
    baseFeePips: big(vector.base_fee_pips),
    minimumFeePips: big(vector.minimum_fee_pips),
    maximumFeePips: big(vector.maximum_fee_pips),
    gainFeePips: big(vector.gain_fee_pips),
    maximumIncreasePips: big(vector.maximum_increase_pips),
    maximumDecreasePips: big(vector.maximum_decrease_pips),
    confidenceFloorWad: big(vector.confidence_floor_wad),
  };
  // No premium, and a previous fee well above base: the fee walks down by at
  // most maximumDecreasePips and never below the configured minimum.
  const previous = config.baseFeePips + config.maximumDecreasePips * 3n;
  const result = model.calculateFee({
    signedRiskWad: 0n,
    confidenceWad: big(vector.confidence_wad),
    persistenceActive: true,
    previousFeePips: previous,
    config,
  });
  assert.equal(result.premiumPips, 0n);
  assert.equal(result.targetFeePips, config.baseFeePips);
  assert.equal(result.nextFeePips, previous - config.maximumDecreasePips);
  assert.ok(result.nextFeePips >= config.minimumFeePips);
});
