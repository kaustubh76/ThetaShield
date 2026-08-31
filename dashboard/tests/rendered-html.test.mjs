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

  // Client-component props are serialized into an inline RSC payload script, so
  // asserting against the raw HTML would also match values that are never rendered.
  const html = (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  const manifest = JSON.parse(
    await readFile(new URL("data/deployment_manifest.json", root), "utf8"),
  );
  assert.match(html, /<title>ThetaShield — Directional LP Protection<\/title>/i);
  assert.match(html, /Protect LPs from/);
  assert.match(html, /ThetaShield protocol introduction/i);
  assert.match(html, /INITIALIZING CONTROL LOOP/i);
  assert.match(html, /01 · OBSERVE/i);
  assert.match(html, /Directional LP protection/i);
  assert.match(html, /Current sample excluded from/);
  assert.match(html, /The failures stayed in the record/);
  assert.match(html, /59\.70%/);
  assert.match(html, /FAIL · historical \/ PASS · holdout/i);
  assert.match(html, /Trust surface/i);
  assert.match(html, /thetashield-dashboard-g9-v2/i);
  // Server-rendered rather than mounted on the client, so the ambient background
  // layer is in the document at first paint and the page never flashes without it.
  assert.match(html, /<canvas\b[^>]*signal-field/);
  assert.match(html, /markout-trace/);
  assert.match(html, /Research replay from the locked evidence bundle/);
  assert.match(html, /policy-scatter/);
  assert.match(html, /Signal-blind fees tax everyone/);
  assert.match(html, /holdout-dumbbell/);
  assert.match(html, /gate-board/);
  assert.match(html, /DIRECTIONAL MEMORY/);
  assert.match(html, /registry-accordion/);
  assert.match(html, /Verification registry/i);
  assert.match(html, /Judge Q&amp;A|Judge Q&A/);
  assert.match(html, /operator-moved/);
  assert.match(html, /RESEARCH BUNDLE/);
  assert.match(html, /PROVEN BY RECEIPT/);
  assert.match(html, /pareto-frontier/);
  assert.match(html, /MEASURED GAS/);
  assert.match(html, /The pool remembers\./);
  assert.match(html, new RegExp(`CYCLE ${manifest.acceptance.reactive_cycle_id} PROVEN`, "i"));
  assert.match(html, /See the delayed fee travel/i);
  assert.match(html, /REACTIVE NETWORK/i);
  assert.match(html, /LP-benefit replay console/i);
  assert.match(html, /Pause replay/i);
  assert.match(html, /Replay cursor/i);
  assert.match(html, /CONTROL JOURNEY/i);
  assert.match(html, /ObservationTransportFailed/i);
  assert.match(html, /DropReason\.EpochCapacity/i);
  assert.match(html, /Interrogate the trade-offs/i);
  // Before any read returns, the page names the declared paths without claiming
  // which one answered. The lens/direct claims themselves are client-side.
  assert.match(html, /with the audited getters as the declared fallback path/i);
  assert.match(html, /Public Circle lifecycle/);
  assert.match(html, /Authenticated processing callback/);

  assert.match(html, /6 public transactions/i);
  assert.match(html, new RegExp(manifest.acceptance.initial_swap_transaction_hash));
  assert.match(html, new RegExp(manifest.acceptance.later_swap_transaction_hash));
  assert.match(html, new RegExp(manifest.acceptance.reactive_callback_transaction_hash));
  for (const message of manifest.circle_messages) {
    assert.match(html, new RegExp(message.relay_transaction_hash));
  }
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

test("renders each canonical metric in exactly one widget", async () => {
  const response = await render();
  const html = await response.text();
  // Strip the RSC payload: client-component props are serialised there, so
  // scanning raw HTML would match values the page never renders.
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");

  // A metric may appear several times inside ONE widget (visible label, svg
  // <title> tooltip, aria-label). It must not appear in a second widget.
  const widgetsRendering = (value) => {
    let index = -1;
    let count = 0;
    while ((index = markup.indexOf(value, index + 1)) !== -1) {
      const before = markup.slice(Math.max(0, index - 260), index);
      const isAria = /aria-label="[^"]*$/.test(before);
      const isTitle = /<title>[^<]*$/.test(before);
      if (!isAria && !isTitle) count += 1;
    }
    return count;
  };

  for (const value of ["−0.727", "59.70%", "0.49 bps"]) {
    assert.ok(
      widgetsRendering(value) <= 1,
      `${value} is rendered in ${widgetsRendering(value)} widgets; it should have exactly one canonical home`,
    );
  }
});

test("removes the disposable starter preview", async () => {
  await assert.rejects(access(new URL("app/_sites-preview", root)));
});

test("live API defaults to the paired G10 lenses with a named direct fallback", async () => {
  const route = await readFile(new URL("app/api/live/route.ts", root), "utf8");
  assert.match(route, /THETASHIELD_ORIGIN_LENS_ADDRESS/);
  assert.match(route, /THETASHIELD_PROCESSOR_LENS_ADDRESS/);
  assert.match(route, /Both ThetaShield lens addresses must be configured together/);
  assert.match(route, /readOriginLens/);
  assert.match(route, /readProcessorLens/);
  // The fallback the README promises has to exist, not just be named: a lens
  // fault must degrade to the audited getters and say so in readPath. Asserted
  // by structure rather than exact formatting, which a reformat would break
  // while proving nothing.
  assert.match(route, /catch\s*\{[\s\S]{0,200}readPath = "historical-direct"/);
  assert.match(route, /readOrigin\(\), readProcessor\(\)/);
  // The Reactive counters live in the ReactiveVM, so they must be read with the
  // RVM-scoped call, not eth_call.
  assert.match(route, /rnk_call/);
  assert.match(route, /from "\.\.\/\.\.\/live-config"/);

  const config = await readFile(new URL("app/live-config.ts", root), "utf8");
  assert.match(config, /deployment_manifest\.json/);
  assert.match(config, /THETASHIELD_POOL_ID/);
  assert.match(config, /THETASHIELD_READ_PATH/);
  assert.match(config, /historical-direct/);
});
