import assert from "node:assert/strict";
import test from "node:test";

// The run console signs with a real key from an endpoint with no authentication,
// so these are the functions that decide whether it broadcasts. They are pure
// and live outside route.ts precisely so they can be exercised here without a
// chain, a key, or next/server.
const guards = await import("../app/api/run/guards.ts");

const DOMAINS = { origin: 10, processor: 0 };

test("the outstanding Circle leg is read from the counters, outbound first", () => {
  const outbound = guards.legFromCounters({ observed: 4, received: 3, dispatched: 2, installed: 2 }, DOMAINS);
  assert.equal(outbound?.name, "outbound");
  assert.equal(outbound?.sourceDomain, 10);
  assert.equal(outbound?.observationId, 4);

  const back = guards.legFromCounters({ observed: 4, received: 4, dispatched: 2, installed: 1 }, DOMAINS);
  assert.equal(back?.name, "return");
  assert.equal(back?.sourceDomain, 0);
  assert.equal(back?.sequence, 2);

  assert.equal(guards.legFromCounters({ observed: 4, received: 4, dispatched: 2, installed: 2 }, DOMAINS), null);

  // Both outstanding: the observation must land before a recommendation derived
  // from it can be installed, so outbound wins. This ordering is load-bearing.
  const both = guards.legFromCounters({ observed: 4, received: 3, dispatched: 2, installed: 1 }, DOMAINS);
  assert.equal(both?.name, "outbound");
});

test("a balance floor is a balance the account keeps, not one it may spend to", () => {
  const above = guards.floorGuard({ balanceWei: 3n * 10n ** 15n, floorWei: 2n * 10n ** 15n, label: "origin", code: "origin-floor" });
  assert.equal(above.ok, true);

  // Exactly at the floor refuses — pins the strict >.
  const at = guards.floorGuard({ balanceWei: 2n * 10n ** 15n, floorWei: 2n * 10n ** 15n, label: "origin", code: "origin-floor" });
  assert.equal(at.ok, false);
  assert.match(at.reason, /cannot be run to zero/);
});

test("a cooldown is measured from a block, and survives a disagreeing clock", () => {
  const base = { nowUnix: 10_000, cooldownSeconds: 1_800, label: "swap", code: "swap-cooldown", absentReason: "none in window" };

  assert.equal(guards.cooldownGuard({ ...base, lastEventUnix: null }).ok, true);
  assert.equal(guards.cooldownGuard({ ...base, lastEventUnix: null }).reason, "none in window");

  const blocked = guards.cooldownGuard({ ...base, lastEventUnix: 9_400 });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /20 min of cooldown remain/);

  // Exactly at the boundary passes.
  assert.equal(guards.cooldownGuard({ ...base, lastEventUnix: 8_200 }).ok, true);

  // A block timestamp ahead of our clock is skew, not a negative wait: it must
  // fail closed for the full interval and never render a negative number.
  const skewed = guards.cooldownGuard({ ...base, lastEventUnix: 12_000 });
  assert.equal(skewed.ok, false);
  assert.doesNotMatch(skewed.reason, /-\d/);
});

test("the cycle cooldown sees only cycles this endpoint signed", () => {
  const signer = "0x00000000000000000000000000000000000000aa";
  const pad = (value) => `0x${value.replace(/^0x/, "").padStart(64, "0")}`;
  const log = (caller, reactive) => [pad("1"), pad("5"), pad(caller), pad(reactive ? "1" : "0")];

  assert.equal(guards.isEndpointCycleLog(log(signer, false), signer), true);
  // Checksum casing must not decide this.
  assert.equal(guards.isEndpointCycleLog(log(signer.toUpperCase().replace("0X", "0x"), false), signer), true);

  // The Reactive scheduler's own cycle must never throttle the button — that is
  // the activity the page exists to demonstrate.
  assert.equal(guards.isEndpointCycleLog(log(signer, true), signer), false);
  // Nor may a third-party keeper's, or a stranger could lock the console.
  assert.equal(guards.isEndpointCycleLog(log("0x00000000000000000000000000000000000000bb", false), signer), false);

  assert.equal(guards.isEndpointCycleLog([pad("1")], signer), false);
});

test("each step names every setting it needs", () => {
  const none = {};
  assert.deepEqual(guards.missingFrom("cycle", none), ["DEPLOYER_PRIVATE_KEY"]);
  assert.deepEqual(guards.missingFrom("swap", none), [
    "DEPLOYER_PRIVATE_KEY", "ORIGIN_SWAP_ROUTER", "DEMO_TOKEN0", "DEMO_TOKEN1",
  ]);
  // Both transmitters: the return leg delivers to the origin chain, so a relay
  // configured with only the outbound one is half-armed and fails at send time.
  assert.deepEqual(guards.missingFrom("relay", { DEPLOYER_PRIVATE_KEY: "k", PROCESSOR_CIRCLE_MESSAGE_TRANSMITTER: "t" }), [
    "ORIGIN_CIRCLE_MESSAGE_TRANSMITTER",
  ]);
  assert.deepEqual(guards.missingFrom("cycle", { DEPLOYER_PRIVATE_KEY: "k" }), []);
});

test("an error is redacted before it is truncated", () => {
  const key = "a".repeat(64);

  assert.equal(guards.redactError(new Error(`0x${key}`)), "[redacted]");
  // A key logged without its prefix is still a key.
  assert.equal(guards.redactError(new Error(key)), "[redacted]");

  // The regression: redacting after slice(0, 200) let a run starting at char
  // 250 through untouched, because truncation had already published a fragment
  // the pattern no longer matched.
  const late = guards.redactError(new Error(`${"x".repeat(250)}0x${key} tail`));
  assert.equal(late.includes(key), false);
  assert.equal(late.includes(key.slice(0, 40)), false);
  assert.ok(late.length <= 200);

  assert.equal(guards.redactError("not an error"), "transaction failed");
});
