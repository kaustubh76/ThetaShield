// Interactive regression suite: 26 checks over the controls the SSR tests cannot
// reach — the failure-mode switches, the mechanism player, the journey phases,
// the scenario/policy/sensitivity selects, the replay transport, the signal-lab
// tabs, the registry accordions, the live refresh and the nav anchors.
//
// Deliberately NOT part of `npm test` or `make verify`: it needs a running
// server and a headless Chrome on the CDP port, and neither belongs in the
// release gate. Run it by hand:
//
//   npm run build && npx vinext start -p 3100 &
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/cdp &
//   npm run test:interaction
//
// Override the target with DASHBOARD_URL / CDP_URL.

const ep = await (await fetch(`${process.env.CDP_URL ?? "http://localhost:9222"}/json/version`)).json();
const ws = new WebSocket(ep.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) { p.reject(new Error(JSON.stringify(m.error))); } else { p.resolve(m.result); } } };
const send = (method, params = {}, s) => { id += 1; ws.send(JSON.stringify({ id, method, params, ...(s ? { sessionId: s } : {}) })); return new Promise((resolve, reject) => pending.set(id, { resolve, reject })); };

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
const consoleErrors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") consoleErrors.push((m.params.exceptionDetails?.exception?.description ?? "exception").slice(0, 160));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 160));
});
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 950, deviceScaleFactor: 1, mobile: false }, sessionId);
await send("Page.navigate", { url: process.env.DASHBOARD_URL ?? "http://localhost:3100/" }, sessionId);
await new Promise((r) => setTimeout(r, 9000));

const evaluate = async (expression) => {
  const out = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? "eval failed");
  return out.result.value;
};
await evaluate(`
  window.__set = (el, value, proto) => { Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('input', { bubbles: true })); };
  window.__q = (s) => document.querySelector(s);
  window.__txt = (s) => document.querySelector(s)?.textContent?.trim() ?? null; true;
`);

const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });
const wait = (ms = 600) => new Promise((r) => setTimeout(r, ms));

// The mechanism status owns the Solidity identifier; panel 05 shows the human
// label. Asserting they DIFFER is asserting the de-duplication holds.
for (const [index, expected, label] of [[1, "ObservationTransportFailed", "CCTP outage"], [4, "DropReason.Capacity", "Queue full"], [0, "bounded success path", "Healthy loop"]]) {
  await evaluate(`document.querySelectorAll('.failure-switches button')[${index}].click(); true;`);
  await wait(400);
  const code = await evaluate(`__txt('.mechanism-status .failed code') || __txt('.mechanism-status .healthy code')`);
  const transport = await evaluate(`__txt('.transport-path code')`);
  check(`failure switch -> ${expected}`, code === expected && transport === label, `status=${code} transport=${transport}`);
}
const beforePause = await evaluate(`__txt('.play-control')`);
await evaluate(`__q('.play-control').click(); true;`); await wait(300);
check("mechanism play/pause toggles", beforePause !== (await evaluate(`__txt('.play-control')`)), beforePause);
await evaluate(`document.querySelectorAll('.journey-phases button')[3].click(); true;`); await wait(400);
const phaseStep = await evaluate(`__txt('.journey-detail span')`);
check("phase click jumps to stage", /ACTIVE STEP 07/.test(phaseStep ?? ""), `${phaseStep} receipts=${await evaluate(`document.querySelectorAll('.journey-receipts a').length`)}`);

await evaluate(`__set(document.querySelectorAll('.simulator-controls select')[0], 'benign_noise', HTMLSelectElement); true;`); await wait(700);
check("scenario select changes stream", (await evaluate(`__txt('.simulator-context div:first-child b')`)) === "Benign Noise", await evaluate(`__txt('.simulator-context div:first-child b')`));
await evaluate(`__set(document.querySelectorAll('.simulator-controls select')[1], 'volatility_only', HTMLSelectElement); true;`); await wait(700);
check("policy select changes panels", (await evaluate(`__txt('.flow-fee-panel .panel-heading b')`)) === "Volatility only", await evaluate(`__txt('.frontier-panel p')`));
const sensBefore = await evaluate(`__txt('.sensitivity-audit span')`);
await evaluate(`const s = document.querySelectorAll('.simulator-controls select')[2]; __set(s, s.options[s.options.length-1].value, HTMLSelectElement); true;`); await wait(700);
check("sensitivity select changes case", sensBefore !== (await evaluate(`__txt('.sensitivity-audit span')`)), `${sensBefore} -> ${await evaluate(`__txt('.sensitivity-audit span')`)}`);

await evaluate(`__set(__q('.replay-scrubber input'), '40', HTMLInputElement); true;`); await wait(500);
const readout = await evaluate(`__txt('.replay-readout span')`);
check("replay scrubber moves cursor", /EVENT 41 \//.test(readout ?? ""), readout);
await evaluate(`document.querySelectorAll('.replay-speeds button')[2].click(); true;`); await wait(300);
check("replay speed selectable", (await evaluate(`document.querySelectorAll('.replay-speeds button')[2].getAttribute('aria-pressed')`)) === "true", "4x");
await evaluate(`__q('.replay-reset-control').click(); true;`); await wait(400);
check("replay reset", /EVENT 1 \//.test((await evaluate(`__txt('.replay-readout span')`)) ?? ""), await evaluate(`__txt('.replay-readout span')`));

await evaluate(`__q('#registry-components').open = false; __q('#registry-components > summary').click(); true;`); await wait(300);
check("accordion opens", (await evaluate(`__q('#registry-components').open`)) === true && (await evaluate(`document.querySelectorAll('#registry-components .component-row').length`)) > 0, `rows=${await evaluate(`document.querySelectorAll('#registry-components .component-row').length`)}`);

await evaluate(`__q('.refresh-button').click(); true;`); await wait(7000);
check("live refresh completes", /Live read/.test((await evaluate(`__txt('.live-status')`)) ?? "") && (await evaluate(`__txt('.live-fees strong')`)) !== "—", `${await evaluate(`__txt('.live-status')`)} fee=${await evaluate(`__txt('.live-fees strong')`)}`);
await evaluate(`__q('#registry-parameters').open = true; true;`); await wait(600);
const paramRows = await evaluate(`document.querySelectorAll('#registry-parameters .param-rows > div').length`);
check("deployed parameters populate from shared poll (no click)", paramRows > 50, `rows=${paramRows}`);
check("no lingering read-parameters button", (await evaluate(`[...document.querySelectorAll('button')].some(b => /Read deployed parameters/.test(b.textContent))`)) === false, "button removed");
await evaluate(`document.querySelectorAll('.distinction-card')[1].click(); true;`); await wait(400);
check("policy card selects a policy", (await evaluate(`document.querySelectorAll('.distinction-card')[1].getAttribute('aria-pressed')`)) === "true", await evaluate(`__txt('.distinction-card.active h3')`));

await evaluate(`document.querySelectorAll('.policy-table .policy-pick')[0].click(); true;`); await wait(400);
check("policy table row selects", (await evaluate(`document.querySelector('.policy-table tr.is-selected') !== null`)) === true, await evaluate(`__txt('.policy-table tr.is-selected .policy-pick')`));

await evaluate(`document.querySelectorAll('.hypothesis-row')[0].querySelector('summary').click(); true;`); await wait(300);
check("hypothesis row opens its rule", (await evaluate(`document.querySelectorAll('.hypothesis-row')[0].hasAttribute('open')`)) === true, (await evaluate(`__txt('.hypothesis-row[open] .hypothesis-rule')`)).slice(0, 46));

await evaluate(`__q('.run-action').click(); true;`); await wait(2200);
check("run control starts the guided run", (await evaluate(`__q('.run-progress') !== null && __q('.run-action').className.includes('is-running')`)) === true, await evaluate(`__txt('.run-progress')`));
await evaluate(`__q('.run-action').click(); true;`); await wait(400);
check("run control stops cleanly", (await evaluate(`__q('.run-action').className.includes('is-running')`)) === false, "stopped");

// The Reactive surface. The authentication rows and the receipt trail are the
// two things on this page that are interactive rather than merely rendered, so
// both are driven here rather than trusted to the SSR assertions.
await evaluate(`__q('#live-proof').scrollIntoView(); true;`); await wait(1200);
const authRows = await evaluate(`document.querySelectorAll('.auth-row').length`);
check("callback authentication renders its checks", authRows >= 2, `rows=${authRows} verdict=${await evaluate(`__txt('.auth-verdict')`)}`);
check("every authentication check agrees", (await evaluate(`document.querySelectorAll('.auth-row.is-failing').length`)) === 0, await evaluate(`__txt('.auth-verdict')`));
if (authRows) {
  await evaluate(`document.querySelectorAll('.auth-toggle')[0].click(); true;`); await wait(300);
  check(
    "authentication row expands to its read provenance",
    (await evaluate(`__q('.auth-detail') !== null`)) === true && /eth_call|rnk_call|eth_getTransactionByHash/.test((await evaluate(`__txt('.auth-detail')`)) ?? ""),
    (await evaluate(`__txt('.auth-detail')`))?.slice(0, 70),
  );
}
check("cross-plane agreement states which planes it compared", /pending/.test((await evaluate(`__txt('.plane-agreement')`)) ?? ""), (await evaluate(`__txt('.plane-agreement')`))?.slice(0, 60));

const runSteps = await evaluate(`document.querySelectorAll('.run-step').length`);
const runGaps = await evaluate(`JSON.stringify([...document.querySelectorAll('.run-gap span')].map(e => e.textContent))`);
check("run timeline renders every step dated", runSteps === 6 && (await evaluate(`[...document.querySelectorAll('.run-body > time')].every(t => t.textContent !== '—')`)) === true, `${runSteps} steps`);
check("run timeline measures the interval between steps", JSON.parse(runGaps).length === 5 && !JSON.parse(runGaps).includes("interval not read"), runGaps);
check("run timeline states the end-to-end figure once", /end to end/i.test((await evaluate(`__txt('.receipt-heading')`)) ?? ""), (await evaluate(`__txt('.receipt-heading b')`))?.slice(0, 40));

await evaluate(`document.querySelectorAll('.receipt-jump')[2].click(); true;`); await wait(700);
check(
  "receipt jumps to the journey phase it evidences",
  /ACTIVE STEP/.test((await evaluate(`__txt('.journey-detail span')`)) ?? "") && (await evaluate(`__q('.journey-phases button.active') !== null`)) === true,
  `${await evaluate(`__txt('.journey-detail span')`)} -> ${await evaluate(`__txt('.journey-phases button.active b')`)}`,
);

check("nav anchors resolve", (await evaluate(`JSON.stringify([...document.querySelectorAll('.site-header nav a')].filter(a => !document.querySelector(a.getAttribute('href'))).map(a=>a.getAttribute('href')))`)) === "[]", "ok");
check("external links https", (await evaluate(`JSON.stringify([...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).filter(h => !h.startsWith('#') && !/^https:\\/\\//.test(h)))`)) === "[]", "ok");

const failures = results.filter((entry) => !entry.pass);
const errors = [...new Set(consoleErrors)].slice(0, 8);
console.log(JSON.stringify({ results, consoleErrors: errors }));
ws.close();
// Exit non-zero so this is usable in a pipeline even though the release gate
// deliberately does not run it.
if (failures.length || errors.length) process.exitCode = 1;
