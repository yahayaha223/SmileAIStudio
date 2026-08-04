"use strict";

var http = require("../http");
var config = require("./config");
var cookies = require("./cookies");
var sessions = require("./sessions");
var users = require("./users");
var permissions = require("./permissions");
var audit = require("./audit");
var cryptoUtil = require("./crypto-util");

function getHeader(event, name) {
  var h = (event && event.headers) || {};
  var lower = name.toLowerCase();
  for (var k in h) {
    if (Object.prototype.hasOwnProperty.call(h, k) && k.toLowerCase() === lower) {
      return h[k];
    }
  }
  return "";
}

function enforceCsrf(event, session) {
  var method = String(event.httpMethod || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return { ok: true };
  }
  if (!session) return { ok: false, reasonCode: "csrf_no_session" };
  var headerToken = getHeader(event, "x-csrf-token");
  var jar = cookies.parseCookies(event);
  var cookieToken = jar[config.COOKIE_CSRF] || "";
  if (!headerToken || !cookieToken || !session.csrfToken) {
    return { ok: false, reasonCode: "csrf_missing" };
  }
  if (!cryptoUtil.constantTimeEqual(headerToken, session.csrfToken)) {
    return { ok: false, reasonCode: "csrf_mismatch" };
  }
  if (!cryptoUtil.constantTimeEqual(cookieToken, session.csrfToken)) {
    return { ok: false, reasonCode: "csrf_cookie_mismatch" };
  }
  return { ok: true };
}

function enforceOrigin(event) {
  var origin = http.requestOrigin(event);
  var method = String(event.httpMethod || "GET").toUpperCase();
  // Same-origin navigations may omit Origin; for credentialed API prefer Origin on mutating
  if (!origin) {
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return { ok: true, origin: "" };
    // Allow missing Origin only for non-browser tools in off mode; otherwise require
    if (config.getEnforcementMode() === "off") return { ok: true, origin: "" };
    return { ok: false, reasonCode: "origin_missing" };
  }
  if (!config.isOriginAllowed(origin)) {
    return { ok: false, reasonCode: "origin_denied" };
  }
  return { ok: true, origin: origin };
}

async function loadSessionFromEvent(event) {
  var jar = cookies.parseCookies(event);
  var raw = jar[config.COOKIE_SESSION] || "";
  if (!raw) return null;
  try { raw = decodeURIComponent(raw); } catch (e) { /* keep */ }
  var session = await sessions.getSessionByRawId(raw);
  return session ? { raw: raw, session: session } : null;
}

/**
 * requireSession / role / step-up with AUTH_ENFORCEMENT_MODE.
 */
async function enforceAccess(event, opts) {
  opts = opts || {};
  var mode = config.getEnforcementMode();
  var permKey = opts.permissionKey || "";
  var perm = permKey ? permissions.resolvePermission(permKey) : null;
  var requiredRoles = opts.roles || (perm && perm.roles) || null;
  var needStepUp = opts.stepUp != null ? opts.stepUp : !!(perm && perm.stepUp);
  var now = Date.now();
  var cfgEnv = config.getAuthConfig();

  // Hard deny production-only ops outside production (ignores AUTH_ENFORCEMENT_MODE)
  if (permKey && config.isProductionOnlyPermission(permKey) && !cfgEnv.isProductionEnvironment) {
    await audit.recordAudit({
      event: "env_blocked",
      success: false,
      reasonCode: "non_production_hard_deny",
      target: permKey,
      ipHash: audit.ipHashForEvent(event),
      uaBrief: audit.uaBrief(event),
      meta: { authEnvironment: cfgEnv.authEnvironment }
    });
    return {
      ok: false,
      response: http.json(403, { ok: false, error: "forbidden", reason: "env_blocked" }, event)
    };
  }

  var originCheck = enforceOrigin(event);
  if (!originCheck.ok && mode === "enforce") {
    await audit.recordAudit({
      event: "access_denied",
      success: false,
      reasonCode: originCheck.reasonCode,
      target: permKey || opts.action || null,
      ipHash: audit.ipHashForEvent(event),
      uaBrief: audit.uaBrief(event)
    });
    return {
      ok: false,
      response: http.json(403, { ok: false, error: "forbidden" }, event)
    };
  }

  var loaded = await loadSessionFromEvent(event);
  var session = loaded && loaded.session;

  if (!session) {
    await audit.recordAudit({
      event: "unauthenticated_access",
      success: false,
      reasonCode: "no_session",
      target: permKey || opts.action || null,
      ipHash: audit.ipHashForEvent(event),
      uaBrief: audit.uaBrief(event),
      meta: { mode: mode }
    });
    if (mode === "off" || mode === "observe") {
      return { ok: true, bypass: true, session: null, user: null, mode: mode };
    }
    return {
      ok: false,
      response: http.json(401, { ok: false, error: "unauthorized" }, event)
    };
  }

  var active = sessions.isSessionActive(session, now);
  if (!active.ok) {
    await audit.recordAudit({
      event: "session_rejected",
      success: false,
      reasonCode: active.code,
      actorUserId: session.userId,
      role: session.roleSnapshot,
      target: permKey,
      ipHash: audit.ipHashForEvent(event)
    });
    if (mode === "off" || mode === "observe") {
      return { ok: true, bypass: true, session: null, user: null, mode: mode };
    }
    return {
      ok: false,
      response: http.json(401, { ok: false, error: "unauthorized" }, event)
    };
  }

  if (session.purpose === "passkey_enroll" && !opts.allowEnrollSession) {
    if (mode === "enforce") {
      return {
        ok: false,
        response: http.json(403, { ok: false, error: "forbidden" }, event)
      };
    }
  }

  var csrf = enforceCsrf(event, session);
  if (!csrf.ok) {
    await audit.recordAudit({
      event: "csrf_rejected",
      success: false,
      reasonCode: csrf.reasonCode,
      actorUserId: session.userId,
      role: session.roleSnapshot,
      target: permKey,
      ipHash: audit.ipHashForEvent(event)
    });
    if (mode === "enforce") {
      return {
        ok: false,
        response: http.json(403, { ok: false, error: "forbidden" }, event)
      };
    }
  }

  var user = await users.getUser(session.userId);
  if (!user || user.status === "disabled") {
    if (mode === "enforce") {
      return {
        ok: false,
        response: http.json(401, { ok: false, error: "unauthorized" }, event)
      };
    }
    return { ok: true, bypass: true, session: null, user: null, mode: mode };
  }

  if (requiredRoles && !permissions.roleAllowed(session.roleSnapshot, requiredRoles)) {
    await audit.recordAudit({
      event: "role_denied",
      success: false,
      reasonCode: "role_forbidden",
      actorUserId: user.id,
      role: session.roleSnapshot,
      target: permKey,
      ipHash: audit.ipHashForEvent(event)
    });
    if (mode === "enforce") {
      return {
        ok: false,
        response: http.json(403, { ok: false, error: "forbidden" }, event)
      };
    }
  }

  // admin publish gate (default disabled)
  if (perm && perm.adminPublishGate && session.roleSnapshot === "admin") {
    var cfg = config.getAuthConfig();
    var allow = cfg.adminPublishEnabled ||
      (Array.isArray(user.adminPublishAllowlist) &&
        user.adminPublishAllowlist.indexOf(opts.publishFeature || "production-publish") !== -1);
    if (!allow && mode === "enforce") {
      return {
        ok: false,
        response: http.json(403, { ok: false, error: "forbidden" }, event)
      };
    }
  }

  if (needStepUp) {
    if (!session.stepUpUntil || now > session.stepUpUntil) {
      await audit.recordAudit({
        event: "step_up_required",
        success: false,
        reasonCode: "step_up_required",
        actorUserId: user.id,
        role: session.roleSnapshot,
        target: permKey,
        ipHash: audit.ipHashForEvent(event)
      });
      if (mode === "enforce") {
        return {
          ok: false,
          response: http.json(401, { ok: false, error: "step_up_required" }, event)
        };
      }
    }
  }

  await sessions.touchSession(session, now);
  return {
    ok: true,
    bypass: false,
    session: session,
    user: user,
    mode: mode,
    rawSessionId: loaded.raw
  };
}

async function protectHandler(event, opts, handler) {
  if (event.httpMethod === "OPTIONS") return http.options(event);
  var guard = await enforceAccess(event, opts);
  if (!guard.ok) return guard.response;
  return handler(event, guard);
}

module.exports = {
  enforceCsrf: enforceCsrf,
  enforceOrigin: enforceOrigin,
  loadSessionFromEvent: loadSessionFromEvent,
  enforceAccess: enforceAccess,
  protectHandler: protectHandler,
  getHeader: getHeader
};
