import assert from "node:assert/strict";
import { access } from "node:fs/promises";
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
  assert.match(html, /Public Circle lifecycle/);
  assert.match(html, /Circle CCTP/);
  assert.match(html, /Live Circle loop proven/);
  assert.match(html, /Risk proxy—not exact LVR/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton|Reactive Network|Lasna/i);
});

test("removes the disposable starter preview", async () => {
  await assert.rejects(access(new URL("app/_sites-preview", root)));
});
