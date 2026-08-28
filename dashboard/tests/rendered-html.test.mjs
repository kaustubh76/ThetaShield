import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the complete ThetaShield research dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>ThetaShield — Directional LP Protection<\/title>/i);
  assert.match(html, /Protect LPs from/);
  assert.match(html, /Current sample excluded from/);
  assert.match(html, /The failures stayed in the record/);
  assert.match(html, /59\.70%/);
  assert.match(html, /FAIL · historical \/ PASS · holdout/i);
  assert.match(html, /Trust surface/i);
  assert.match(html, /thetashield-dashboard-g9-v2/i);
  assert.match(html, /See the delayed fee travel/i);
  assert.match(html, /REACTIVE NETWORK/i);
  assert.match(html, /LP-benefit replay console/i);
  assert.match(html, /ObservationTransportFailed/i);
  assert.match(html, /DropReason\.EpochCapacity/i);
  assert.match(html, /Interrogate the trade-offs/i);
  assert.match(html, /Direct audited getters are used only when the paired G10 lenses are explicitly disabled/i);
  assert.match(html, /Public Circle lifecycle/);
  assert.match(html, /Reactive maturity wake/);
  assert.match(html, /Eight public transactions/i);
  assert.match(html, /Circle CCTP/);
  assert.match(html, /Live Circle \+ Reactive loop proven/);
  assert.match(html, /Risk proxy—not exact LVR/);
  assert.match(html, /Live testnet proof/i);
  assert.match(html, /Read directly from deployed contracts/i);
  assert.match(html, /Refresh on-chain state/i);
  assert.match(html, /LIVE RECEIPT TRAIL/i);
  assert.match(html, /Read-only proof/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("removes the disposable starter preview", async () => {
  await assert.rejects(access(new URL("app/_sites-preview", root)));
});

test("live API defaults to the paired G10 lenses with a named direct fallback", async () => {
  const route = await readFile(new URL("app/api/live/route.ts", root), "utf8");
  assert.match(route, /THETASHIELD_ORIGIN_LENS_ADDRESS/);
  assert.match(route, /THETASHIELD_PROCESSOR_LENS_ADDRESS/);
  assert.match(route, /Both ThetaShield lens addresses must be configured together/);
  assert.match(route, /historical-direct/);
  assert.match(route, /readOriginLens/);
  assert.match(route, /readProcessorLens/);
  assert.match(route, /0x393cBc35F3303Cbb2e83657fC2DDAd03b65Ce3A0/);
  assert.match(route, /0xf1EE0503F968E9E828eEBf258594bEF8C40d97a9/);
});
