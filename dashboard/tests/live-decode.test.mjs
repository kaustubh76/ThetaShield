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
  // Catches any offset change that alters a value against real chain data. It
  // cannot catch a swap between two words that both hold 0 — which is most of
  // them at cold start — so the synthetic tests below pin the offsets directly.
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

// ---------------------------------------------------------------------------
// Offset pinning.
//
// Recorded responses prove the decoders work against real chain data, but they
// cannot prove WHICH word each field read: at cold start most premiums, counters
// and flags are 0, so two fields reading each other's offsets produce identical
// output. These fixtures give every word a distinct value, so each decoded field
// is traceable to exactly one offset and any swap fails.

const WORD_BASE = 1000;

function rampResponse(length) {
  return `0x${Array.from({ length }, (_, index) =>
    BigInt(WORD_BASE + index).toString(16).padStart(64, "0")).join("")}`;
}

// All words zero except one, so a boolean that reads the wrong offset is false.
function singleWordResponse(length, hotIndex) {
  return `0x${Array.from({ length }, (_, index) =>
    (index === hotIndex ? "1" : "0").padStart(64, "0")).join("")}`;
}

test("recommendation fields read their declared word offsets", () => {
  const value = decode.decodeRecommendation(rampResponse(8));
  assert.equal(value.zeroForOneFeePips, WORD_BASE + 0);
  assert.equal(value.oneForZeroFeePips, WORD_BASE + 1);
  assert.equal(value.zeroForOneRiskWad, String(WORD_BASE + 2));
  assert.equal(value.oneForZeroRiskWad, String(WORD_BASE + 3));
  assert.equal(value.confidenceBps, WORD_BASE + 4);
  assert.equal(value.validAfter, WORD_BASE + 5);
  assert.equal(value.validUntil, WORD_BASE + 6);
  assert.equal(value.sequence, WORD_BASE + 7);
});

test("pool configuration and fee fields read their declared word offsets", () => {
  const config = decode.decodePoolConfig(rampResponse(7));
  assert.equal(config.baselineFeePips, WORD_BASE + 0);
  // poolPaused is word 6, not any of the five between it and the baseline.
  assert.equal(decode.decodePoolConfig(singleWordResponse(7, 6)).poolPaused, true);
  for (const index of [0, 1, 2, 3, 4, 5]) {
    assert.equal(decode.decodePoolConfig(singleWordResponse(7, index)).poolPaused, false);
  }

  const fee = decode.decodeFee(rampResponse(2));
  assert.equal(fee.feePips, WORD_BASE + 0);
  assert.equal(decode.decodeFee(singleWordResponse(2, 1)).usedBaseline, true);
  assert.equal(decode.decodeFee(singleWordResponse(2, 0)).usedBaseline, false);
});

test("every side-state field reads its declared word offset", () => {
  const decoded = decode.words(rampResponse(98));
  // buy ↔ oneForZero (offset 34), sell ↔ zeroForOne (offset 10).
  for (const offset of [10, 34]) {
    const side = decode.decodeSideState(decoded, offset);
    const at = (delta) => WORD_BASE + offset + delta;
    assert.equal(side.openEpochId, at(0));
    assert.equal(side.lastFinalizedEpochId, at(1));
    assert.equal(side.epochObservationCount, at(2));
    assert.equal(side.persistenceBitmap, at(6));
    assert.equal(side.latestCoverageRatioWad, String(at(12)));
    assert.equal(side.latestRiskWad, String(at(14)));
    assert.equal(side.latestConfidenceWad, String(at(15)));
    assert.equal(side.latestCalculatedFeePips, at(16));
    assert.equal(side.latestToxicPremiumPips, at(17));
    assert.equal(side.latestCoveragePremiumPips, at(18));
  }
});

test("side-state flags read their declared word offsets", () => {
  const flags = [["persistenceActive", 19], ["fastPathActive", 20], ["epochOpen", 22]];
  for (const offset of [10, 34]) {
    for (const [field, delta] of flags) {
      const side = decode.decodeSideState(decode.words(singleWordResponse(98, offset + delta)), offset);
      assert.equal(side[field], true, `${field} does not read word ${offset + delta}`);
      for (const [other] of flags) {
        if (other !== field) assert.equal(side[other], false, `${other} also read word ${offset + delta}`);
      }
    }
  }
});

test("every deployed-config field reads its declared word offset", () => {
  const decoded = decode.words(rampResponse(98));
  const config = decode.decodeDeployedConfig(decoded);
  const scheduler = (delta) => WORD_BASE + 58 + delta;
  const feeCurve = (delta) => WORD_BASE + 88 + delta;

  assert.equal(config.scheduler.markoutHorizonSeconds, scheduler(0));
  assert.equal(config.scheduler.observationLifetimeSeconds, scheduler(1));
  assert.equal(config.scheduler.referenceSelectionWindowSeconds, scheduler(2));
  assert.equal(config.scheduler.epochDurationSeconds, scheduler(3));
  assert.equal(config.scheduler.recommendationLifetimeSeconds, scheduler(4));
  assert.equal(config.scheduler.maximumPendingObservations, scheduler(7));
  assert.equal(config.scheduler.maximumProcessPerCall, scheduler(8));
  assert.equal(config.scheduler.maximumEpochObservations, scheduler(9));
  assert.equal(config.scheduler.trailingWindow, scheduler(10));
  assert.equal(config.scheduler.minimumTrailingObservations, scheduler(11));
  assert.equal(config.scheduler.targetObservationCount, scheduler(12));
  assert.equal(config.scheduler.requiredToxicEpochs, scheduler(13));
  assert.equal(config.scheduler.persistenceWindow, scheduler(14));
  assert.equal(config.scheduler.fastPathHoldEpochs, scheduler(15));
  assert.equal(config.scheduler.maximumReferenceSamplesPerSource, scheduler(16));
  assert.equal(config.scheduler.minimumReferenceSources, scheduler(17));
  assert.equal(config.scheduler.deadBandKWad, String(scheduler(23)));
  assert.equal(config.scheduler.maximumDispersionWad, String(scheduler(24)));
  assert.equal(config.scheduler.confidenceCapWad, String(scheduler(25)));
  assert.equal(config.scheduler.toxicThresholdWad, String(scheduler(26)));
  assert.equal(config.scheduler.alphaWad, String(scheduler(27)));
  assert.equal(config.scheduler.fastPathConfidenceFloorWad, String(scheduler(28)));
  assert.equal(config.scheduler.fastPathToxicThresholdWad, String(scheduler(29)));

  assert.equal(config.feeCurve.baseFeePips, feeCurve(0));
  assert.equal(config.feeCurve.minimumFeePips, feeCurve(1));
  assert.equal(config.feeCurve.maximumFeePips, feeCurve(2));
  assert.equal(config.feeCurve.gainFeePips, feeCurve(3));
  assert.equal(config.feeCurve.coverageGainFeePips, feeCurve(4));
  assert.equal(config.feeCurve.maximumIncreasePips, feeCurve(5));
  assert.equal(config.feeCurve.maximumDecreasePips, feeCurve(6));
  assert.equal(config.feeCurve.confidenceFloorWad, String(feeCurve(7)));
  assert.equal(config.feeCurve.targetCoverageWad, String(feeCurve(8)));
  assert.equal(config.feeCurve.minimumEstimatedLossWad, String(feeCurve(9)));

  // fastPathEnabled is word scheduler+18 and nothing else.
  assert.equal(
    decode.decodeDeployedConfig(decode.words(singleWordResponse(98, 58 + 18))).scheduler.fastPathEnabled,
    true,
  );
  assert.equal(
    decode.decodeDeployedConfig(decode.words(singleWordResponse(98, 58 + 19))).scheduler.fastPathEnabled,
    false,
  );
});

test("every automation cycle field reads its declared word offset", () => {
  const cycle = decode.decodeCycleResult(rampResponse(15));
  const counters = ["cycleId", "pendingBefore", "pendingAfter", "settledBefore", "settledAfter",
    "expiredBefore", "expiredAfter", "recommendationBefore", "recommendationAfter",
    "publishedSources", "syncedSources"];
  counters.forEach((field, index) => {
    assert.equal(cycle[field], WORD_BASE + index, `${field} does not read word ${index}`);
  });

  const flags = [["samplerSucceeded", 11], ["processSucceeded", 12],
    ["recommendationDispatched", 13], ["reactiveTrigger", 14]];
  for (const [field, index] of flags) {
    const value = decode.decodeCycleResult(singleWordResponse(15, index));
    assert.equal(value[field], true, `${field} does not read word ${index}`);
    for (const [other] of flags) {
      if (other !== field) assert.equal(value[other], false, `${other} also read word ${index}`);
    }
  }
});

// Address words: the low 20 bytes of the word, and nothing else. A decoder that
// sliced from the wrong end would silently produce a plausible-looking address.
test("address words decode from the low 20 bytes and reject anything else", () => {
  const address = "1a3a275df6658ab96151480d920d58cea5ab9707";
  assert.equal(decode.addressFromWord(`${"0".repeat(24)}${address}`), `0x${address}`);
  assert.equal(decode.addressFromWord(`${"0".repeat(24)}${address.toUpperCase()}`), `0x${address}`);
  // A dirty upper word is a layout error, not an address with leading noise.
  assert.throws(() => decode.addressFromWord(`${"0".repeat(23)}1${address}`), /not an ABI address/);
  // The zero word is a well-formed address, so the decoder returns it. Refusing
  // to treat it as agreement is the comparison's job, not the decoder's —
  // otherwise two failed reads would "agree" with each other.
  assert.equal(decode.addressFromWord("0".repeat(64)), `0x${"0".repeat(40)}`);
});

test("every RSC network-config field reads its declared word offset", () => {
  const config = decode.decodeNetworkConfig(rampResponse(10));
  assert.equal(config.monitoredChainId, WORD_BASE + 0);
  assert.equal(config.destinationChainId, WORD_BASE + 1);
  assert.equal(config.reactiveChainId, WORD_BASE + 2);
  // Words 3 and 4 are addresses: the check the panel runs compares these two
  // against the executor's own getters, so a swapped pair would report
  // agreement between the wrong contracts.
  assert.equal(config.processor, `0x${(WORD_BASE + 3).toString(16).padStart(40, "0")}`);
  assert.equal(config.executor, `0x${(WORD_BASE + 4).toString(16).padStart(40, "0")}`);
  assert.equal(config.cronTopic, `0x${(WORD_BASE + 5).toString(16).padStart(64, "0")}`);
  assert.equal(config.callbackGasLimit, WORD_BASE + 6);
  assert.equal(config.epochDurationSeconds, WORD_BASE + 7);
  assert.equal(config.retryDelaySeconds, WORD_BASE + 8);
  assert.equal(config.maximumRetries, WORD_BASE + 9);
  assert.throws(() => decode.decodeNetworkConfig(rampResponse(9)), /Unexpected network config/);
});

// The proven callback's calldata is the historical half of the authentication
// check. If it decoded loosely, the page would compare the executor's guards
// against values it had invented rather than read.
const CALLBACK_TX = {
  to: "0xC9F36411C9897e7F959D99ffca2a0Ba7ee0D7bDA",
  blockNumber: "0xb0dd60",
  blockTimestamp: "0x6a92a8f0",
  input:
    "0x246a9512" +
    "0000000000000000000000001a3a275df6658ab96151480d920d58cea5ab9707" +
    "0000000000000000000000000000000000000000000000000000000000000040" +
    "0000000000000000000000000000000000000000000000000000000000000024" +
    "997ce1d5" +
    "00000000000000000000000033189c643774ed2713ebff5a6923e5fa42b96ee8" +
    "00000000000000000000000000000000000000000000000000000000",
};

test("the proven callback decodes the two values the executor's guards compare", () => {
  const callback = decode.decodeReactiveCallback(CALLBACK_TX);
  assert.equal(callback.to, "0xc9f36411c9897e7f959d99ffca2a0ba7ee0d7bda");
  assert.equal(callback.targetArg, "0x1a3a275df6658ab96151480d920d58cea5ab9707");
  assert.equal(callback.rvmArg, "0x33189c643774ed2713ebff5a6923e5fa42b96ee8");
  assert.equal(callback.blockNumber, 11_591_008);
  assert.equal(callback.observedAt, 1_787_996_400);
});

test("the callback decoder refuses transactions that are not authenticated wakes", () => {
  assert.throws(
    () => decode.decodeReactiveCallback({ ...CALLBACK_TX, input: `0xdeadbeef${CALLBACK_TX.input.slice(10)}` }),
    /not a Reactive proxy callback/,
  );
  assert.throws(() => decode.decodeReactiveCallback({ ...CALLBACK_TX, to: null }), /not a Reactive proxy callback/);
  // Right proxy entry point, wrong inner call: still not evidence of a wake.
  assert.throws(
    () => decode.decodeReactiveCallback({ ...CALLBACK_TX, input: CALLBACK_TX.input.replace("997ce1d5", "12345678") }),
    /does not call executeFromReactive/,
  );
});

// blockTimestamp is a provider extension rather than part of the JSON-RPC spec,
// and the receipt for this hash is pruned on the public Sepolia endpoints, so
// the decode has to survive a transaction that carries neither.
test("the callback decoder degrades when the provider omits block metadata", () => {
  const callback = decode.decodeReactiveCallback({ ...CALLBACK_TX, blockNumber: null, blockTimestamp: null });
  assert.equal(callback.blockNumber, null);
  assert.equal(callback.observedAt, null);
  assert.equal(callback.rvmArg, "0x33189c643774ed2713ebff5a6923e5fa42b96ee8");
});

// The run timeline's connectors are its content, so the rule for when a gap may
// be stated is worth a gate of its own: only between two adjacent steps that
// both came back dated.
test("timeline gaps are stated only between adjacent dated steps", () => {
  const step = (observedAt) => ({ observedAt, gapSeconds: null });
  const filled = decode.fillTimelineGaps([step(100), step(160), step(null), step(400), step(410)]);
  assert.deepEqual(filled.map((entry) => entry.gapSeconds), [null, 60, null, null, 10]);

  // Carrying the last known time across the hole would have produced 240 here,
  // labelling the 3rd→4th connector with an interval that spans three steps.
  assert.equal(filled[3].gapSeconds, null);

  // A stale gap from an earlier pass must be cleared, not left standing.
  const stale = [{ observedAt: 1, gapSeconds: 5 }, { observedAt: null, gapSeconds: 99 }];
  assert.deepEqual(decode.fillTimelineGaps(stale).map((entry) => entry.gapSeconds), [5, null]);

  assert.deepEqual(decode.fillTimelineGaps([]), []);
});
