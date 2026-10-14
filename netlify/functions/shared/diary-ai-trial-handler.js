"use strict";
const trial = require("./diary-ai-trial");
const build = require("./diary-ai-trial-context.json");
const authConfig = require("./auth/config");
const cookies = require("./auth/cookies");
const crypto = require("./auth/crypto-util");

function header(event, name) {
  const key = Object.keys(event.headers || {}).find(k => k.toLowerCase() === name);
  return key ? String(event.headers[key]) : "";
}
function reply(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff" }, body: JSON.stringify(body) };
}
function createHandler(deps = {}) {
  const env = deps.env || process.env;
  return async event => {
    const stamp = deps.build || build;
    const cfg = deps.config || authConfig.getAuthConfig();
    const method = String(event.httpMethod || "");
    if (!stamp.production || cfg.authEnvironment !== "production" || cfg.rpId !== "studio.egaonokiroku.co.jp" ||
        env.DIARY_AI_ENABLED === "1") return reply(403, { error: "trial_environment_blocked" });
    if (method !== "GET" && method !== "POST") return reply(405, { error: "method_not_allowed" });
    const origin = header(event, "origin");
    if (header(event, "host") !== "studio.egaonokiroku.co.jp" ||
        (method === "POST" && origin !== trial.ORIGIN) || (origin && origin !== trial.ORIGIN)) {
      return reply(403, { error: "origin_denied" });
    }
    // Netlify can mark an empty GET as base64 when Content-Type is absent.
    // There is no payload to decode; still reject every GET body and query.
    if (Object.keys(event.queryStringParameters || {}).length ||
        (method === "POST" && event.isBase64Encoded) ||
        (method === "GET" && event.body != null && event.body !== "")) return reply(400, { error: "invalid_request" });
    if (method === "POST") {
      try {
        if (Buffer.byteLength(event.body || "") > 64) throw Error();
        const body = JSON.parse(event.body || "{}");
        if (!body || Array.isArray(body) || typeof body !== "object" || Object.keys(body).length) throw Error();
      } catch { return reply(400, { error: "fixed_memo_only" }); }
    }
    try {
      // Read existing records directly with strong consistency. No touchSession,
      // audit, authSet, cookie renewal, memory cache or file-store fallback.
      const jar = cookies.parseCookies(event);
      const raw = jar[authConfig.COOKIE_SESSION];
      const csrf = header(event, "x-csrf-token");
      if (!raw || !csrf || !jar[authConfig.COOKIE_CSRF]) return reply(401, { error: "owner_login_required" });
      const stores = (deps.getStores || trial.getStores)(event);
      const hash = crypto.hashToken(raw);
      const session = await stores.auth.get("production/sessions/" + hash, { type: "json", consistency: "strong" });
      const now = (deps.now || Date.now)();
      if (!session || session.sessionHash !== hash || session.purpose !== "full" || session.roleSnapshot !== "owner" ||
          session.revokedAt || !Number.isFinite(session.expiresAt) || !Number.isFinite(session.absoluteExpiresAt) ||
          now >= session.expiresAt || now >= session.absoluteExpiresAt || !session.userId) {
        return reply(401, { error: "owner_login_required" });
      }
      if (!session.csrfToken || !crypto.constantTimeEqual(csrf, session.csrfToken) ||
          !crypto.constantTimeEqual(jar[authConfig.COOKIE_CSRF], session.csrfToken)) return reply(403, { error: "csrf_denied" });
      const user = await stores.auth.get("production/users/" + session.userId, { type: "json", consistency: "strong" });
      if (!user || user.id !== session.userId || user.role !== "owner" || user.status !== "active") {
        return reply(403, { error: "owner_required" });
      }
      const ready = trial.preflight(stamp) && env.DIARY_AI_TRIAL_ENABLED === "1" && !!env.OPENAI_API_KEY;
      if (method === "GET") {
        const marker = await stores.trial.get(trial.TRIAL_KEY, { type: "json", consistency: "strong" });
        return reply(200, { owner: true, enabled: ready, consumed: marker !== null && marker !== undefined,
          memo: trial.MEMO, model: trial.MODEL, maximumModelCostUSD: 0.0016192 });
      }
      if (!ready) return reply(503, { error: "trial_disabled" });
      const reserved = await stores.trial.setJSON(trial.TRIAL_KEY,
        { attempted: true, attemptedAt: new Date(now).toISOString(), payloadSha256: trial.digest(), model: trial.MODEL },
        { onlyIfNew: true });
      if (!reserved || reserved.modified !== true) return reply(409, { error: "trial_already_consumed" });
      if (typeof reserved.etag !== "string" || !reserved.etag) return reply(503, { error: "trial_reservation_unconfirmed", retryAllowed: false });
      try {
        const result = await (deps.send || trial.send)(env.OPENAI_API_KEY);
        return reply(200, { ok: true, ...result });
      } catch { return reply(502, { error: "trial_failed_consumed", retryAllowed: false }); }
    } catch {
      return reply(503, { error: "trial_unavailable_do_not_retry", retryAllowed: false });
    }
  };
}
exports.createHandler = createHandler;
