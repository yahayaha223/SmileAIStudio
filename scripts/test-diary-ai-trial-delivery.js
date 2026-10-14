"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const esbuild = require("esbuild");
const root = path.join(__dirname, "..");
const stampPath = path.join(root, "netlify/functions/shared/diary-ai-trial-context.json");
const saved = fs.readFileSync(stampPath);
const output = path.join(os.tmpdir(), "diary-ai-trial-bundle-" + process.pid + ".cjs");
let passed = 0;
function build(context) {
  const r = spawnSync(process.execPath, ["scripts/build-diary-ai-trial.js"], { cwd: root,
    env: { ...process.env, CONTEXT: context }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr); return JSON.parse(fs.readFileSync(stampPath));
}
async function ui(owner, enabled, cancel) {
  const nodes = Object.fromEntries(["status", "run", "controls", "memo", "result"].map(id => [id, { hidden: true, disabled: true, textContent: "", addEventListener: (_, cb) => { nodes[id].click = cb; } }]));
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(root, "js/diary-ai-trial.js"), "utf8"), {
    document: { cookie: "smile_studio_csrf=csrf", getElementById: id => nodes[id] }, window: { confirm: () => !cancel },
    fetch: async (_, options) => { calls.push(options);
      return { ok: owner, json: async () => options.method === "GET" ? { owner, enabled, consumed: false, memo: "fixed" } :
        { text: "<script>untrusted output</script>", model: "fixed", usage: { input_tokens: 180, output_tokens: 12 }, estimatedModelCostUSD: 0.0001 } }; }
  });
  await new Promise(resolve => setImmediate(resolve));
  return { nodes, calls };
}
(async () => {
  try {
    assert.equal(build("deploy-preview").production, false); passed++;
    assert.equal(build("").production, false); passed++;
    assert.equal(build("production").production, true); passed++;
    esbuild.buildSync({ entryPoints: [path.join(root, "netlify/functions/api-diary-ai-trial.mjs")], outfile: output,
      nodePaths: (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean),
      bundle: true, platform: "node", target: "node18", format: "cjs", external: ["@netlify/blobs", "@simplewebauthn/server", "@simplewebauthn/browser", "basic-ftp"] });
    const bundled = require(output);
    assert.equal(typeof bundled.default, "function");
    assert.equal(bundled.handler, undefined);
    assert.equal((await bundled.createNativeHandler({ config: { authEnvironment: "local" } })(new Request("https://studio.egaonokiroku.co.jp/.netlify/functions/api-diary-ai-trial"))).status, 403); passed++;
    const denied = await ui(false, false); assert.equal(denied.nodes.controls.hidden, true); assert.equal(denied.calls.length, 1); passed++;
    const off = await ui(true, false); assert.equal(off.nodes.run.disabled, true); await off.nodes.run.click(); assert.equal(off.calls.length, 1); passed++;
    const cancelled = await ui(true, true, true); await cancelled.nodes.run.click(); assert.equal(cancelled.calls.length, 1); passed++;
    const ready = await ui(true, true); await ready.nodes.run.click(); await ready.nodes.run.click();
    assert.equal(ready.calls.length, 2); assert.equal(ready.calls[1].body, "{}");
    assert(ready.nodes.result.textContent.startsWith("<script>")); assert.equal(ready.nodes.result.innerHTML, undefined); passed++;
    console.log(JSON.stringify({ deliveryChecksPassed: passed, bundleBytes: fs.statSync(output).size, realNetworkCalls: 0 }));
  } finally { fs.writeFileSync(stampPath, saved); if (fs.existsSync(output)) fs.unlinkSync(output); }
})().catch(e => { console.error(e); process.exitCode = 1; });
