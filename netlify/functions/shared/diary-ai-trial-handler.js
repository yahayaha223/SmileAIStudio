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
    let stage = "D01";
    function denied(statusCode, error, reason) {
      if (method !== "GET") return reply(statusCode, { error });
      // Keep session existence/expiry/role classifications in server logs only.
      const diagnosticRef = crypto.randomToken(12);
      try {
        (deps.logDiagnostic || console.info)(JSON.stringify({
          event: "diary_trial_auth_denied", diagnosticRef, reason
        }));
      } catch { /* Logging must not change authentication decisions. */ }
      return reply(statusCode, { error, diagnosticRef });
    }
    try {
      // Read existing records directly with strong consistency. No touchSession,
      // audit, authSet, cookie renewal, memory cache or file-store fallback.
      const jar = cookies.parseCookies(event);
      const raw = jar[authConfig.COOKIE_SESSION];
      const csrf = header(event, "x-csrf-token");
      if (!raw) return denied(401, "owner_login_required", "INPUT_SESSION_MISSING");
      if (!jar[authConfig.COOKIE_CSRF]) return denied(401, "owner_login_required", "INPUT_CSRF_COOKIE_MISSING");
      if (!csrf) return denied(401, "owner_login_required", "INPUT_CSRF_HEADER_MISSING");
      stage = "D02";
      const stores = (deps.getStores || trial.getStores)(event, value => {
        if (["D10", "D11", "D12"].includes(value)) stage = value;
      });
      stage = "D13";
      const hash = crypto.hashToken(raw);
      stage = "D03";
      const session = await stores.auth.get("production/sessions/" + hash, { type: "json", consistency: "strong" });
      stage = "D04";
      const now = (deps.now || Date.now)();
      if (!session) return denied(401, "owner_login_required", "SESSION_ABSENT");
      if (session.sessionHash !== hash || !session.userId ||
          !Number.isFinite(session.expiresAt) || !Number.isFinite(session.absoluteExpiresAt))
        return denied(401, "owner_login_required", "SESSION_INVALID");
      if (session.revokedAt) return denied(401, "owner_login_required", "SESSION_REVOKED");
      if (now >= session.expiresAt || now >= session.absoluteExpiresAt)
        return denied(401, "owner_login_required", "SESSION_EXPIRED");
      if (session.purpose !== "full" || session.roleSnapshot !== "owner")
        return denied(401, "owner_login_required", "SESSION_NOT_OWNER_FULL");
      stage = "D05";
      if (!session.csrfToken || !crypto.constantTimeEqual(csrf, session.csrfToken) ||
          !crypto.constantTimeEqual(jar[authConfig.COOKIE_CSRF], session.csrfToken)) return denied(403, "csrf_denied", "CSRF_MISMATCH");
      stage = "D06";
      const user = await stores.auth.get("production/users/" + session.userId, { type: "json", consistency: "strong" });
      stage = "D07";
      if (!user || user.id !== session.userId || user.role !== "owner" || user.status !== "active") {
        return denied(403, "owner_required", "USER_NOT_ACTIVE_OWNER");
      }
      stage = "D08";
      const ready = trial.preflight(stamp) && env.DIARY_AI_TRIAL_ENABLED === "1" && !!env.OPENAI_API_KEY;
      if (method === "GET") {
        stage = "D09";
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
    } catch (error) {
      // Only fixed categories, never exception text, stack, context or record data.
      const categories = { MissingBlobsEnvironmentError: "C01", BlobsConsistencyError: "C02",
        BlobsInternalError: "C03", SyntaxError: "C04", URIError: "C05", TypeError: "C06", ReferenceError: "C09" };
      const category = error && ["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"].includes(error.code) ? "C07" :
        error && error.code === "ERR_REQUIRE_ESM" ? "C08" :
        error && Object.prototype.hasOwnProperty.call(categories, error.name) ? categories[error.name] : "C00";
      return reply(503, { error: "trial_unavailable_do_not_retry", retryAllowed: false,
        ...(method === "GET" ? { diagnostic: stage + "_" + category } : {}) });
    }
  };
}
exports.createHandler = createHandler;
