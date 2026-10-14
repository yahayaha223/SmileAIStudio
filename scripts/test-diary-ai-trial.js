"use strict";
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const trial = require("../netlify/functions/shared/diary-ai-trial");
const { createHandler } = require("../netlify/functions/api-diary-ai-trial");
const crypto = require("../netlify/functions/shared/auth/crypto-util");
const stamp = require("../netlify/functions/shared/diary-ai-trial-context.json");
const { getStore } = require("netlify-blobs-trial");
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("PASS " + name); };
const now = 1791878400000;
const event = { httpMethod: "POST", path: "/.netlify/functions/api-diary-ai-trial", body: "{}",
  headers: { host: "studio.egaonokiroku.co.jp", origin: trial.ORIGIN,
    cookie: "smile_studio_session=fake-session; smile_studio_csrf=fake-csrf", "x-csrf-token": "fake-csrf" } };
function fixture(options = {}) {
  const state = { calls: 0, reads: [], writes: [], marker: null };
  const session = { sessionHash: crypto.hashToken("fake-session"), userId: "owner-1", roleSnapshot: "owner", purpose: "full",
    expiresAt: now + 60000, absoluteExpiresAt: now + 120000, csrfToken: "fake-csrf", ...options.session };
  const user = { id: "owner-1", role: "owner", status: "active", ...options.user };
  const stores = {
    auth: { get: async (key, opts) => { assert.equal(opts.consistency, "strong"); state.reads.push(key);
      if (options.authDown) throw Error("unavailable"); return key.includes("/sessions/") ? session : user; } },
    trial: { get: async () => state.marker, setJSON: async (key, value, opts) => {
      assert.equal(key, trial.TRIAL_KEY); assert.deepEqual(opts, { onlyIfNew: true });
      if (options.storeDown) throw Error("storage unavailable");
      if (state.marker) return { modified: false };
      state.marker = value; state.writes.push({ key, value }); return { modified: true, etag: options.missingEtag ? "" : "mock-etag" };
    } }
  };
  const handler = createHandler({ env: { DIARY_AI_TRIAL_ENABLED: "1", OPENAI_API_KEY: "fake-key", ...options.env },
    build: { ...stamp, production: true, ...options.build }, config: { authEnvironment: "production", rpId: "studio.egaonokiroku.co.jp", ...options.config },
    getStores: () => stores, now: () => now, send: async () => { state.calls++;
      if (options.failSend) throw Error("timeout");
      return { text: "架空のテストです。", model: trial.MODEL, usage: { input_tokens: 180, output_tokens: 12 }, estimatedModelCostUSD: 0.0000912 };
    } });
  return { handler, state };
}
function fakeTransport(data, mode) {
  let calls = 0, destroyed = 0, body;
  const request = (opts, cb) => {
    calls++; assert.equal(opts.hostname, "api.openai.com"); assert.equal(opts.path, "/v1/responses");
    const req = new EventEmitter(); req.destroy = () => { destroyed++; };
    req.end = bytes => { body = JSON.parse(bytes); if (mode === "stall") return;
      const res = new EventEmitter(); res.statusCode = mode === "http-error" ? 429 : 200;
      cb(res); queueMicrotask(() => { res.emit("data", Buffer.from(JSON.stringify(data))); res.emit("end"); }); };
    return req;
  };
  return { request, inspect: () => ({ calls, destroyed, body }) };
}
(async () => {
  await test("offline fixed-payload certificate and cost", async () => {
    assert.equal(stamp.localTextTokens, 164); assert.equal(stamp.conservativeInputTokens, 1188);
    assert(trial.preflight(stamp)); assert(!trial.preflight({ ...stamp, payloadSha256: "changed" }));
    assert.equal(Number(((2000 * 0.4 + 512 * 1.6) / 1e6).toFixed(10)), 0.0016192);
  });
  for (const [name, options, code] of [
    ["preview build", { build: { production: false } }, 403],
    ["missing build certificate", { build: { payloadSha256: "" } }, 503],
    ["wrong auth environment", { config: { authEnvironment: "staging" } }, 403],
    ["wrong RP", { config: { rpId: "localhost" } }, 403],
    ["normal AI enabled", { env: { DIARY_AI_ENABLED: "1" } }, 403],
    ["trial disabled", { env: { DIARY_AI_TRIAL_ENABLED: "0" } }, 503],
    ["key absent", { env: { OPENAI_API_KEY: "" } }, 503],
    ["staff session", { session: { roleSnapshot: "staff" } }, 401],
    ["enrollment session", { session: { purpose: "passkey_enroll" } }, 401],
    ["revoked session", { session: { revokedAt: now } }, 401],
    ["expired session", { session: { expiresAt: now - 1 } }, 401],
    ["absolute expiry", { session: { absoluteExpiresAt: now - 1 } }, 401],
    ["malformed expiry", { session: { expiresAt: null } }, 401],
    ["session hash mismatch", { session: { sessionHash: "bad" } }, 401],
    ["demoted owner", { user: { role: "admin" } }, 403],
    ["disabled owner", { user: { status: "disabled" } }, 403],
    ["missing authoritative auth storage", { authDown: true }, 503],
    ["reservation fails closed", { storeDown: true }, 503]
  ]) await test(name, async () => { const f = fixture(options); assert.equal((await f.handler(event)).statusCode, code); assert.equal(f.state.calls, 0); assert.equal(f.state.writes.length, 0); });
  for (const [name, changes, code] of [
    ["foreign origin", { headers: { ...event.headers, origin: "https://evil.invalid" } }, 403],
    ["missing origin", { headers: { ...event.headers, origin: "" } }, 403],
    ["alternate host", { headers: { ...event.headers, host: "preview.netlify.app" } }, 403],
    ["missing cookie", { headers: { ...event.headers, cookie: "" } }, 401],
    ["CSRF mismatch", { headers: { ...event.headers, "x-csrf-token": "wrong" } }, 403],
    ["CSRF cookie mismatch", { headers: { ...event.headers, cookie: "smile_studio_session=fake-session; smile_studio_csrf=wrong" } }, 403],
    ["arbitrary input", { body: '{"notes":"changed"}' }, 400],
    ["bad JSON", { body: "{" }, 400],
    ["oversized body", { body: "x".repeat(65) }, 400],
    ["base64 request", { isBase64Encoded: true }, 400],
    ["query override", { queryStringParameters: { model: "anything" } }, 400],
    ["method denied", { httpMethod: "DELETE" }, 405]
  ]) await test(name, async () => { const f = fixture(); assert.equal((await f.handler({ ...event, ...changes })).statusCode, code); assert.equal(f.state.calls, 0); assert.equal(f.state.writes.length, 0); });
  await test("GET readiness has no writes or generation", async () => {
    const f = fixture(); const response = await f.handler({ ...event, httpMethod: "GET", body: null, headers: { ...event.headers, origin: "" } });
    assert.equal(response.statusCode, 200); assert.equal(JSON.parse(response.body).owner, true);
    assert.equal(f.state.writes.length, 0); assert.equal(f.state.calls, 0);
    assert.deepEqual(f.state.reads, ["production/sessions/" + crypto.hashToken("fake-session"), "production/users/owner-1"]);
  });
  for (const body of [null, undefined, ""]) await test("empty base64-marked GET accepts owner: " + String(body), async () => {
    const f = fixture(); const response = await f.handler({ ...event, httpMethod: "GET", body, isBase64Encoded: true });
    assert.equal(response.statusCode, 200); assert.equal(f.state.calls, 0); assert.equal(f.state.writes.length, 0);
  });
  for (const [name, changes, code] of [
    ["GET empty still requires owner", { headers: { ...event.headers, cookie: "" } }, 401],
    ["GET empty still requires CSRF", { headers: { ...event.headers, "x-csrf-token": "wrong" } }, 403],
    ["GET empty still checks Origin", { headers: { ...event.headers, origin: "https://evil.invalid" } }, 403],
    ["GET empty still checks host", { headers: { ...event.headers, host: "preview.netlify.app" } }, 403],
    ["GET query still forbidden", { queryStringParameters: { probe: "1" } }, 400],
    ["GET base64 body forbidden", { body: "e30=" }, 400],
    ["GET plain body forbidden", { body: "{}", isBase64Encoded: false }, 400],
    ["GET whitespace body forbidden", { body: " " }, 400]
  ]) await test(name, async () => {
    const f = fixture(); const response = await f.handler({ ...event, httpMethod: "GET", body: null, isBase64Encoded: true, ...changes });
    assert.equal(response.statusCode, code); assert.equal(f.state.calls, 0); assert.equal(f.state.writes.length, 0);
  });
  await test("concurrent owners have one durable global attempt", async () => {
    const f = fixture(); const responses = await Promise.all(Array.from({ length: 20 }, () => f.handler(event)));
    assert.equal(responses.filter(x => x.statusCode === 200).length, 1); assert.equal(f.state.calls, 1);
    assert.equal(responses.filter(x => x.statusCode === 409).length, 19); assert.equal(f.state.writes.length, 1);
    assert.deepEqual(Object.keys(f.state.writes[0].value).sort(), ["attempted", "attemptedAt", "model", "payloadSha256"]);
    assert.equal((await f.handler(event)).statusCode, 409); assert.equal(f.state.calls, 1);
  });
  await test("failed attempt never resets marker", async () => {
    const f = fixture({ failSend: true }); assert.equal((await f.handler(event)).statusCode, 502);
    assert.equal((await f.handler(event)).statusCode, 409); assert.equal(f.state.calls, 1);
  });
  await test("unconfirmed reservation never generates", async () => {
    const f = fixture({ missingEtag: true }); assert.equal((await f.handler(event)).statusCode, 503);
    assert.equal(f.state.calls, 0); assert.equal((await f.handler(event)).statusCode, 409);
  });
  await test("installed SDK sends atomic conditional header and handles 412", async () => {
    const seen = []; const statuses = [200, 412];
    const store = getStore({ name: trial.STORE_NAME, siteID: "fake-site", token: "fake-token", apiURL: "https://example.invalid",
      fetch: trial.storageFetch(async (url, options) => {
        if (String(url) !== "https://signed.invalid/object") return new Response(JSON.stringify({ url: "https://signed.invalid/object" }), { status: 200 });
        seen.push(options); return new Response("", { status: statuses.shift(), headers: { etag: '"test-etag"' } });
      }) });
    assert.equal((await store.setJSON(trial.TRIAL_KEY, { attempted: true }, { onlyIfNew: true })).modified, true);
    assert.equal((await store.setJSON(trial.TRIAL_KEY, { attempted: true }, { onlyIfNew: true })).modified, false);
    assert.equal(seen.length, 2); seen.forEach(x => assert.equal(new Headers(x.headers).get("if-none-match"), "*"));
  });
  for (const failure of [403, 500, "network"]) await test("SDK storage failure blocks generation without network retry: " + failure, async () => {
    let requests = 0;
    const store = getStore({ name: trial.STORE_NAME, siteID: "fake-site", token: "fake-token", apiURL: "https://example.invalid",
      fetch: trial.storageFetch(async (url) => {
        if (String(url) !== "https://signed.invalid/object") return new Response(JSON.stringify({ url: "https://signed.invalid/object" }));
        requests++; if (failure === "network") throw Error("unknown storage result");
        return new Response("", { status: failure, headers: { etag: "error-etag-must-not-authorize" } });
      }) });
    const result = await store.setJSON(trial.TRIAL_KEY, { attempted: true }, { onlyIfNew: true });
    assert.equal(result.etag, ""); assert.equal(requests, 1);
  });
  const data = { model: trial.MODEL, status: "completed", usage: { input_tokens: 180, output_tokens: 20 },
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "架空のテストです。" }] }] };
  await test("transport sends only fixed bounded request without tools/history", async () => {
    const t = fakeTransport(data); const result = await trial.send("fake-key", t.request);
    assert.equal(result.text, "架空のテストです。"); assert.equal(t.inspect().calls, 1);
    assert.deepEqual(t.inspect().body, trial.payload()); assert.equal(t.inspect().body.max_output_tokens, 512);
    assert.equal(t.inspect().body.store, false); assert.equal(t.inspect().body.tools, undefined);
  });
  for (const [name, response, mode] of [["upstream error", data, "http-error"], ["incomplete response", { ...data, status: "incomplete" }],
    ["usage budget exceeded", { ...data, usage: { input_tokens: 2001, output_tokens: 20 } }],
    ["output budget exceeded", { ...data, usage: { input_tokens: 180, output_tokens: 513 } }],
    ["wrong returned model", { ...data, model: "other" }]]) await test(name, async () => {
      const t = fakeTransport(response, mode); await assert.rejects(trial.send("fake-key", t.request), /generation_failed/); assert.equal(t.inspect().calls, 1);
    });
  await test("absolute timeout destroys request without retry", async () => {
    const t = fakeTransport(null, "stall"); await assert.rejects(trial.send("fake-key", t.request, 5));
    assert.equal(t.inspect().calls, 1); assert.equal(t.inspect().destroyed, 1);
  });
  console.log(JSON.stringify({ passed, realOpenAiCalls: 0, liveStorageWrites: 0 }));
})().catch(e => { console.error(e); process.exitCode = 1; });
