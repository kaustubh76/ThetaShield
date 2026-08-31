import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The route's ABI layer is tested against responses recorded from the live
// testnets. These decoders carry ~30 hardcoded word offsets and are the entire
// basis of the "read the contracts" claim: a one-word layout drift in a
// redeployed lens would silently shift every displayed parameter, and until now
// nothing would have caught it.
const decode = await import("../app/api/live/decode.ts");
const fixtures = JSON.parse(
  await readFile(new URL("fixtures/live-responses.json", import.meta.url), "utf8"),
);
const snapshot = JSON.parse(
  await readFile(new URL("fixtures/decoded-snapshot.json", import.meta.url), "utf8"),
);

test("word splitting rejects responses that are not whole ABI words", () => {
  assert.deepEqual(decode.words(`0x${"11".repeat(32)}`), ["11".repeat(32)]);
  assert.throws(() => decode.words("0x"), /Invalid ABI response/);
  assert.throws(() => decode.words("0xabc"), /Invalid ABI response/);
});

test("signed decoding round-trips two's complement", () => {
  const negativeOne = "f".repeat(64);
  assert.equal(decode.signed(negativeOne), "-1");
  assert.equal(decode.signed("0".repeat(64)), "0");
  assert.equal(decode.signed("0".repeat(62) + "2a"), "42");
});

test("unsigned decoding refuses values it cannot render exactly", () => {
  assert.equal(decode.unsigned("0".repeat(62) + "ff"), 255);
  // 2^64: beyond Number.MAX_SAFE_INTEGER, so silently lossy if accepted.
  assert.throws(() => decode.unsigned("0".repeat(48) + "1" + "0".repeat(15)), /exceeds display range/);
});

test("origin lens response decodes to the shape the panel renders", () => {
  const decoded = decode.words(fixtures.originLensState);
  assert.equal(decoded.length, 14, "origin lens layout changed");
  const baselineFeePips = decode.unsigned(decoded[12]);
  assert.ok(baselineFeePips > 0 && baselineFeePips <= 1_000_000, "baseline fee outside pip range");
  // Words 0-3 are the two directional fees and their usedBaseline flags.
  for (const index of [0, 1]) {
    const feePips = decode.unsigned(decoded[index]);
    assert.ok(feePips > 0 && feePips <= 1_000_000, `fee word ${index} outside pip range`);
  }
  for (const index of [2, 3, 9, 10, 13]) {
    assert.ok([0, 1].includes(decode.unsigned(decoded[index])), `word ${index} is not a boolean`);
  }
});

test("recommendation decodes with a coherent validity window", () => {
  const recommendation = decode.decodeRecommendation(fixtures.recommendation);
  assert.equal(typeof recommendation.zeroForOneFeePips, "number");
  assert.equal(typeof recommendation.oneForZeroFeePips, "number");
  assert.ok(recommendation.validUntil > recommendation.validAfter, "validity window is inverted");
  assert.match(recommendation.zeroForOneRiskWad, /^-?\d+$/);
  assert.throws(() => decode.decodeRecommendation(fixtures.poolConfig), /Unexpected recommendation/i);
});

test("pool configuration and fee reads decode", () => {
  const config = decode.decodePoolConfig(fixtures.poolConfig);
  assert.equal(typeof config.baselineFeePips, "number");
  assert.equal(typeof config.poolPaused, "boolean");
  assert.throws(() => decode.decodePoolConfig(fixtures.recommendation), /Unexpected pool configuration/i);

  const fee = decode.decodeFee(fixtures.feeForSwap);
  assert.equal(typeof fee.feePips, "number");
  assert.equal(typeof fee.usedBaseline, "boolean");

  // FINALIZED_THRESHOLD is rendered in the registry, so it must decode as a
  // plain number rather than being typed into the page as prose.
  assert.equal(decode.decodeSingle(fixtures.finalizedThreshold), 2000);
});

test("processor lens response decodes both side states and the deployed config", () => {
  const decoded = decode.words(fixtures.processorLensState);
  assert.equal(decoded.length, 98, "processor lens layout changed");

  // buy ↔ oneForZero (offset 34), sell ↔ zeroForOne (offset 10).
  for (const offset of [10, 34]) {
    const side = decode.decodeSideState(decoded, offset);
    assert.equal(typeof side.openEpochId, "number");
    assert.equal(typeof side.persistenceBitmap, "number");
    assert.equal(typeof side.persistenceActive, "boolean");
    assert.equal(typeof side.epochOpen, "boolean");
    assert.match(side.latestCoverageRatioWad, /^\d+$/);
    assert.match(side.latestRiskWad, /^-?\d+$/);
    // The card renders these as a fee decomposition, so they must be pip-scaled.
    for (const pips of [side.latestCalculatedFeePips, side.latestToxicPremiumPips, side.latestCoveragePremiumPips]) {
      assert.ok(Number.isInteger(pips) && pips >= 0 && pips <= 1_000_000, "premium outside pip range");
    }
  }

  const config = decode.decodeDeployedConfig(decoded);
  assert.ok(config.scheduler.epochDurationSeconds > 0, "epoch duration must be positive");
  assert.ok(config.scheduler.recommendationLifetimeSeconds > 0, "TTL ring divides by this");
  assert.ok(config.scheduler.persistenceWindow >= config.scheduler.requiredToxicEpochs);
  assert.ok(config.feeCurve.maximumFeePips >= config.feeCurve.baseFeePips);
  assert.ok(config.feeCurve.minimumFeePips <= config.feeCurve.baseFeePips);
  assert.equal(typeof config.scheduler.fastPathEnabled, "boolean");
  for (const wad of [config.scheduler.deadBandKWad, config.feeCurve.targetCoverageWad]) {
    assert.match(wad, /^\d+$/);
  }
});

test("reference source response decodes its dynamic sample array", () => {
  const source = decode.decodeReferenceSource(fixtures.referenceSourceId, fixtures.referenceSourceState);
  assert.equal(source.sourceId, fixtures.referenceSourceId);
  assert.equal(typeof source.configured, "boolean");
  assert.ok(Array.isArray(source.samples));
  for (const sample of source.samples) {
    assert.match(sample.priceWad, /^\d+$/);
    assert.match(sample.confidenceWad, /^\d+$/);
    assert.ok(sample.observedAt > 0, "sample carries no chain timestamp");
  }
  assert.ok(source.latestSequence >= 0);
});

test("automation cycle result decodes its before/after counters", () => {
  const cycle = decode.decodeCycleResult(fixtures.lastCycleResult);
  assert.equal(typeof cycle.cycleId, "number");
  assert.equal(typeof cycle.reactiveTrigger, "boolean");
  // The card renders these as before→after pairs, so both halves must decode.
  for (const key of ["pendingBefore", "pendingAfter", "settledBefore", "settledAfter", "expiredBefore", "expiredAfter", "recommendationBefore", "recommendationAfter"]) {
    assert.equal(typeof cycle[key], "number", `${key} missing from cycle result`);
  }
  assert.throws(() => decode.decodeCycleResult(fixtures.poolConfig), /Unexpected automation cycle/i);
});

test("decoded output matches the recorded snapshot word for word", () => {
  // The strongest guard available: any offset change that alters a value shows
  // up here as a diff. Its honest limit is that several premiums and counters
  // are 0 at cold start, so swapping two words that both hold 0 is invisible to
  // a value comparison — the length assertions above and the offset map in
  // decode.ts are what cover that case.
  const decoded = decode.words(fixtures.processorLensState);
  assert.deepEqual(decode.decodeRecommendation(fixtures.recommendation), snapshot.recommendation);
  assert.deepEqual(decode.decodePoolConfig(fixtures.poolConfig), snapshot.poolConfig);
  assert.deepEqual(decode.decodeFee(fixtures.feeForSwap), snapshot.feeForSwap);
  assert.deepEqual(decode.decodeSideState(decoded, 10), snapshot.sides.sell);
  assert.deepEqual(decode.decodeSideState(decoded, 34), snapshot.sides.buy);
  assert.deepEqual(decode.decodeDeployedConfig(decoded), snapshot.deployedConfig);
  assert.deepEqual(
    decode.decodeReferenceSource(fixtures.referenceSourceId, fixtures.referenceSourceState),
    snapshot.referenceSource,
  );
  assert.deepEqual(decode.decodeCycleResult(fixtures.lastCycleResult), snapshot.lastCycle);
});
