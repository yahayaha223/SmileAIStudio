/**
 * Node runtime check: Netlify host must not call fetch; localhost may.
 * Usage: node scripts/test-ftp-netlify-local-only-node.js <repoRoot>
 */
"use strict";
const fs = require("fs");
const path = require("path");
const root = process.argv[2] || path.join(__dirname, "..");
const msg = "FTP公開機能はローカル版でのみ利用できます";
let fetchCalls = 0;

function loadWithHost(host, fetchImpl) {
  const code = fs.readFileSync(path.join(root, "js", "smile-ftp-probe.js"), "utf8");
  const sandbox = {
    location: { hostname: host },
    fetch: fetchImpl || function () {
      fetchCalls += 1;
      return Promise.reject(new Error("fetch should not run off-local"));
    }
  };
  const fn = new Function("globalThis", code + "\n;return globalThis.SmileFtpProbe;");
  return fn(sandbox);
}

async function main() {
  fetchCalls = 0;
  const netlify = loadWithHost("develop--smile-ai-studio.netlify.app");
  if (netlify.isLocalFtpRuntime()) throw new Error("netlify should be non-local");
  if (netlify.LOCAL_ONLY_MSG !== msg) throw new Error("msg mismatch");
  const cfg = await netlify.loadConfig();
  const probe = await netlify.runProbe();
  const save = await netlify.saveConfig({ host: "x", username: "y", password: "z" });
  if (fetchCalls !== 0) throw new Error("fetchCalls=" + fetchCalls);
  if (!cfg.localOnly || cfg.userMessage !== msg) throw new Error("loadConfig");
  if (!probe.localOnly || probe.userMessage !== msg) throw new Error("runProbe");
  if (!save.localOnly || save.userMessage !== msg) throw new Error("saveConfig");

  const local = loadWithHost("localhost");
  if (!local.isLocalFtpRuntime()) throw new Error("localhost should be local");
  const local127 = loadWithHost("127.0.0.1");
  if (!local127.isLocalFtpRuntime()) throw new Error("127.0.0.1 should be local");

  fetchCalls = 0;
  const localFetch = function () {
    fetchCalls += 1;
    return Promise.resolve({
      status: 200,
      json: async function () {
        return { ok: true, config: { configured: true, host: "h" } };
      }
    });
  };
  const local2 = loadWithHost("127.0.0.1", localFetch);
  await local2.loadConfig();
  if (fetchCalls < 1) throw new Error("localhost must still call API");
  console.log(JSON.stringify({ ok: true, fetchOffLocal: 0, fetchOnLocal: fetchCalls }));
}

main().catch(function (e) {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
