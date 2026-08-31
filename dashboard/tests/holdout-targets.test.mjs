import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The dumbbell needs a single number to place its threshold marker, so the H4
// and H5 targets are hand-set on the axis. The full criterion is rendered from
// the bundle's own pass_rule right beneath them. These must not be able to drift
// apart: a bundle regeneration that moved a threshold would otherwise leave the
// marker pointing at the old one while the sentence stated the new one.
const bundle = JSON.parse(
  await readFile(new URL("../data/dashboard_bundle.json", import.meta.url), "utf8"),
);
const ruleFor = (id) => bundle.hypotheses.find((entry) => entry.id === id).pass_rule;

test("the plotted H4 threshold is the one its pass rule states", () => {
  const rule = ruleFor("H4");
  assert.match(rule, /-0\.35/, `H4 marker is set to -0.35 but its rule reads: ${rule}`);
  assert.match(rule, /at least three Pareto points/, `H4 supporting terms changed: ${rule}`);
  assert.match(rule, /5 percentage points and 5 steps/, `H4 supporting terms changed: ${rule}`);
});

test("the plotted H5 threshold is the one its pass rule states", () => {
  const rule = ruleFor("H5");
  assert.match(rule, /at least 50%/, `H5 marker is set to 50% but its rule reads: ${rule}`);
});

test("holdout titles come from the bundle, not from prose", () => {
  assert.equal(bundle.hypotheses.find((entry) => entry.id === "H4").title, "Detection trade-off");
  assert.equal(bundle.hypotheses.find((entry) => entry.id === "H5").title, "Manipulation resistance");
});
