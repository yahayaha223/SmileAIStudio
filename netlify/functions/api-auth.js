"use strict";

/**
 * Auth API router.
 * Paths (via redirect /api/auth/* or /.netlify/functions/api-auth?path=...):
 *   POST email/start|verify
 *   POST passkey/register|login|step-up options|verify
 *   POST logout
 *   GET  session|devices
 *   DELETE devices/:sessionId
 */

var http = require("./shared/http");
var kv = require("./shared/kv-store");
var authKv = require("./shared/auth/auth-kv");
var config = require("./shared/auth/config");
var cookies = require("./shared/auth/cookies");
var users = require("./shared/auth/users");
var sessions = require("./shared/auth/sessions");
var emailTokens = require("./shared/auth/email-tokens");
var emailSender = require("./shared/auth/email");
var webauthn = require("./shared/auth/webauthn-service");
var rateLimit = require("./shared/auth/rate-limit");
var audit = require("./shared/auth/audit");
var middleware = require("./shared/auth/middleware");

function parseBody(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch (e) {
    return null;
  }
}

function routePath(event) {
  var qs = event.queryStringParameters || {};
  if (qs.path) return String(qs.path).replace(/^\/+/, "");
  var p = String(event.path || "");
  var markers = ["/api/auth/", "/.netlify/functions/api-auth/"];
  for (var i = 0; i < markers.length; i++) {
    var idx = p.indexOf(markers[i]);
    if (idx !== -1) return p.slice(idx + markers[i].length).replace(/^\/+/, "");
  }
  if (p.endsWith("/api-auth")) return "";
  return p.replace(/^\/+/, "");
}

function appBase(event, body) {
  var cfg = config.getAuthConfig();
  if (body && body.appUrl && config.isOriginAllowed(String(body.appUrl))) {
    return String(body.appUrl).replace(/\/$/, "");
  }
  if (cfg.appPublicUrl) return cfg.appPublicUrl.replace(/\/$/, "");
  var origin = http.requestOrigin(event);
  if (origin && config.isOriginAllowed(origin)) return origin;
  return "http://127.0.0.1:8888";
}

async function handleEmailStart(event) {
  var body = parseBody(event) || {};
  var email = config.normalizeEmail(body.email);
  var ipHash = audit.ipHashForEvent(event);
  var rl = await rateLimit.rateLimit("email-start:" + ipHash, 8, 10 * 60 * 1000);
  if (!rl.ok) {
    await audit.recordAudit({
      event: "email_start_rate_limited",
      success: false,
      reasonCode: "rate_limited",
      ipHash: ipHash
    });
    return http.json(200, { ok: true, message: config.genericAuthMessage() }, event);
  }
  if (email) {
    var rl2 = await rateLimit.rateLimit("email-start-mail:" + email, 5, 10 * 60 * 1000);
    if (!rl2.ok) {
      return http.json(200, { ok: true, message: config.genericAuthMessage() }, event);
    }
  }

  var allowed = email ? await users.isEmailAllowedForRegistration(email) : false;
  var sendResult = { ok: true, skipped: true };
  if (allowed) {
    var user = await users.getUserByEmail(email);
    if (!user) {
      var boot = await users.ensureBootstrapOwner();
      if (boot.ok) user = boot.user;
      else user = (await users.getUserByEmail(email)) || null;
    }
    if (user) {
      var issued = await emailTokens.issueEmailToken({
        email: email,
        purpose: "login_or_enroll",
        userId: user.id
      });
      var base = appBase(event, body);
      // Fragment avoids Referer leakage of token
      var url = base + "/auth-local/login.html#auth_token=" + encodeURIComponent(issued.raw);
      sendResult = await emailSender.sendLoginLink({
        to: email,
        url: url,
        expiresAt: issued.row.expiresAt,
        debugToken: issued.raw
      });
      if (!sendResult.ok) {
        await audit.recordAudit({
          event: "email_start",
          success: false,
          reasonCode: sendResult.reasonCode || "email_send_failed",
          actorUserId: user.id,
          target: "email",
          ipHash: ipHash
        });
      } else {
        await audit.recordAudit({
          event: "email_start",
          success: true,
          reasonCode: "sent",
          actorUserId: user.id,
          target: "email",
          ipHash: ipHash,
          meta: { provider: sendResult.provider || null }
        });
      }
    }
  } else {
    await audit.recordAudit({
      event: "email_start",
      success: true,
      reasonCode: "generic_no_reveal",
      ipHash: ipHash
    });
  }

  var resp = { ok: true, message: config.genericAuthMessage() };
  var cfg = config.getAuthConfig();
  if (cfg.exposeTestEmailToken && sendResult.debugToken) {
    resp.debugToken = sendResult.debugToken;
  }
  // Still generic HTTP — never reveal whether email exists when send failed due to config in user message
  return http.json(200, resp, event);
}

async function handleEmailVerify(event) {
  var body = parseBody(event) || {};
  var token = String(body.token || "").trim();
  var consumed = await emailTokens.consumeEmailToken(token);
  if (!consumed.ok) {
    await audit.recordAudit({
      event: "email_verify",
      success: false,
      reasonCode: consumed.reasonCode,
      ipHash: audit.ipHashForEvent(event)
    });
    return http.json(401, { ok: false, error: config.genericLoginFail() }, event);
  }
  var user = consumed.row.userId
    ? await users.getUser(consumed.row.userId)
    : await users.getUserByEmail(consumed.row.emailNormalized);
  if (!user) {
    return http.json(401, { ok: false, error: config.genericLoginFail() }, event);
  }
  var created = await sessions.createSession(user, {
    purpose: "passkey_enroll",
    deviceName: String(body.deviceName || "Enrollment session").slice(0, 80),
    uaBrief: audit.uaBrief(event),
    ipHash: audit.ipHashForEvent(event)
  });
  await audit.recordAudit({
    event: "email_verify",
    success: true,
    actorUserId: user.id,
    role: user.role,
    ipHash: audit.ipHashForEvent(event)
  });
  var cfg = config.getAuthConfig();
  var maxAge = Math.floor(cfg.absoluteSessionMs / 1000);
  return http.jsonWithCookies(200, {
    ok: true,
    enrollRequired: true,
    role: user.role,
    emailMasked: maskEmail(user.emailNormalized)
  }, event, [
    cookies.sessionCookie(created.rawId, maxAge),
    cookies.csrfCookie(created.session.csrfToken, maxAge)
  ]);
}

function maskEmail(email) {
  var parts = String(email).split("@");
  if (parts.length !== 2) return "***";
  var u = parts[0];
  var shown = u.slice(0, Math.min(2, u.length));
  return shown + "***@" + parts[1];
}

async function handleRegisterOptions(event) {
  var origin = http.requestOrigin(event);
  if (!config.isOriginAllowed(origin)) {
    return http.json(403, { ok: false, error: "forbidden" }, event);
  }
  var loaded = await middleware.loadSessionFromEvent(event);
  if (!loaded || !loaded.session) {
    return http.json(401, { ok: false, error: "unauthorized" }, event);
  }
  var active = sessions.isSessionActive(loaded.session);
  if (!active.ok) return http.json(401, { ok: false, error: "unauthorized" }, event);
  var user = await users.getUser(loaded.session.userId);
  if (!user) return http.json(401, { ok: false, error: "unauthorized" }, event);
  var result = await webauthn.registrationOptions(user, origin);
  if (!result.ok) return http.json(400, { ok: false, error: result.reasonCode }, event);
  return http.json(200, { ok: true, options: result.options }, event);
}

async function handleRegisterVerify(event) {
  var origin = http.requestOrigin(event);
  if (!config.isOriginAllowed(origin)) {
    return http.json(403, { ok: false, error: "forbidden" }, event);
  }
  var body = parseBody(event);
  if (!body || !body.credential) {
    return http.json(400, { ok: false, error: "invalid_json" }, event);
  }
  var loaded = await middleware.loadSessionFromEvent(event);
  if (!loaded || !loaded.session) {
    return http.json(401, { ok: false, error: "unauthorized" }, event);
  }
  var user = await users.getUser(loaded.session.userId);
  if (!user) return http.json(401, { ok: false, error: "unauthorized" }, event);
  var verified = await webauthn.verifyRegistration(user, body.credential, origin);
  if (!verified.ok) {
    await audit.recordAudit({
      event: "passkey_register",
      success: false,
      reasonCode: verified.reasonCode,
      actorUserId: user.id,
      ipHash: audit.ipHashForEvent(event)
    });
    return http.json(400, { ok: false, error: config.genericLoginFail() }, event);
  }
  user.status = "active";
  await users.saveUser(user);
  // Upgrade to full session (regenerate id)
  await sessions.revokeSession(loaded.session.sessionHash, "enroll_complete");
  var created = await sessions.createSession(user, {
    purpose: "full",
    deviceName: String(body.deviceName || verified.credential.deviceName || "Passkey").slice(0, 80),
    uaBrief: audit.uaBrief(event),
    ipHash: audit.ipHashForEvent(event)
  });
  await audit.recordAudit({
    event: "passkey_register",
    success: true,
    actorUserId: user.id,
    role: user.role,
    target: verified.credential.credentialId.slice(0, 16),
    ipHash: audit.ipHashForEvent(event)
  });
  var cfg = config.getAuthConfig();
  var maxAge = Math.floor(cfg.absoluteSessionMs / 1000);
  return http.jsonWithCookies(200, {
    ok: true,
    registered: true,
    role: user.role
  }, event, [
    cookies.sessionCookie(created.rawId, maxAge),
    cookies.csrfCookie(created.session.csrfToken, maxAge)
  ]);
}

async function handleLoginOptions(event) {
  var origin = http.requestOrigin(event);
  if (!config.isOriginAllowed(origin)) {
    return http.json(403, { ok: false, error: "forbidden" }, event);
  }
  var ipHash = audit.ipHashForEvent(event);
  var rl = await rateLimit.rateLimit("login-options:" + ipHash, 30, 10 * 60 * 1000);
  if (!rl.ok) return http.json(429, { ok: false, error: "rate_limited" }, event);
  var result = await webauthn.authenticationOptions(origin);
  if (!result.ok) return http.json(400, { ok: false, error: result.reasonCode }, event);
  return http.json(200, { ok: true, options: result.options }, event);
}

async function handleLoginVerify(event) {
  var origin = http.requestOrigin(event);
  if (!config.isOriginAllowed(origin)) {
    return http.json(403, { ok: false, error: "forbidden" }, event);
  }
  var body = parseBody(event);
  if (!body || !body.credential) {
    return http.json(400, { ok: false, error: "invalid_json" }, event);
  }
  var ipHash = audit.ipHashForEvent(event);
  var rl = await rateLimit.rateLimit("login-verify:" + ipHash, 20, 10 * 60 * 1000);
  if (!rl.ok) return http.json(429, { ok: false, error: "rate_limited" }, event);

  var verified = await webauthn.verifyAuthentication(body.credential, origin, "passkey_login");
  if (!verified.ok) {
    await audit.recordAudit({
      event: "passkey_login",
      success: false,
      reasonCode: verified.reasonCode,
      ipHash: ipHash
    });
    return http.json(401, { ok: false, error: config.genericLoginFail() }, event);
  }
  var user = await users.getUser(verified.userId);
  if (!user || user.status === "disabled") {
    return http.json(401, { ok: false, error: config.genericLoginFail() }, event);
  }
  // Regenerate session on login
  var created = await sessions.createSession(user, {
    purpose: "full",
    deviceName: String(body.deviceName || "Passkey device").slice(0, 80),
    uaBrief: audit.uaBrief(event),
    ipHash: ipHash
  });
  await audit.recordAudit({
    event: "passkey_login",
    success: true,
    actorUserId: user.id,
    role: user.role,
    ipHash: ipHash
  });
  var cfg = config.getAuthConfig();
  var maxAge = Math.floor(cfg.absoluteSessionMs / 1000);
  return http.jsonWithCookies(200, {
    ok: true,
    role: user.role,
    displayName: user.displayName || null
  }, event, [
    cookies.sessionCookie(created.rawId, maxAge),
    cookies.csrfCookie(created.session.csrfToken, maxAge)
  ]);
}

async function handleStepUpOptions(event) {
  var origin = http.requestOrigin(event);
  var loaded = await middleware.loadSessionFromEvent(event);
  if (!loaded || !loaded.session) return http.json(401, { ok: false, error: "unauthorized" }, event);
  if (loaded.session.purpose !== "full") {
    return http.json(403, { ok: false, error: "forbidden" }, event);
  }
  var user = await users.getUser(loaded.session.userId);
  if (!user) return http.json(401, { ok: false, error: "unauthorized" }, event);
  var result = await webauthn.stepUpOptions(user, origin);
  if (!result.ok) return http.json(400, { ok: false, error: result.reasonCode }, event);
  return http.json(200, { ok: true, options: result.options }, event);
}

async function handleStepUpVerify(event) {
  var origin = http.requestOrigin(event);
  var body = parseBody(event);
  if (!body || !body.credential) {
    return http.json(400, { ok: false, error: "invalid_json" }, event);
  }
  var loaded = await middleware.loadSessionFromEvent(event);
  if (!loaded || !loaded.session) return http.json(401, { ok: false, error: "unauthorized" }, event);
  var csrf = middleware.enforceCsrf(event, loaded.session);
  if (!csrf.ok && config.getEnforcementMode() === "enforce") {
    return http.json(403, { ok: false, error: "forbidden" }, event);
  }
  var verified = await webauthn.verifyAuthentication(body.credential, origin, "passkey_stepup");
  if (!verified.ok || verified.userId !== loaded.session.userId) {
    await audit.recordAudit({
      event: "passkey_stepup",
      success: false,
      reasonCode: verified.reasonCode || "user_mismatch",
      actorUserId: loaded.session.userId,
      ipHash: audit.ipHashForEvent(event)
    });
    return http.json(401, { ok: false, error: config.genericLoginFail() }, event);
  }
  var cfg = config.getAuthConfig();
  var until = Date.now() + cfg.stepUpTtlMs;
  await sessions.setStepUp(loaded.session, until);
  await audit.recordAudit({
    event: "passkey_stepup",
    success: true,
    actorUserId: loaded.session.userId,
    role: loaded.session.roleSnapshot,
    ipHash: audit.ipHashForEvent(event)
  });
  return http.json(200, {
    ok: true,
    stepUpUntil: until,
    stepUpRemainingSec: Math.floor(cfg.stepUpTtlMs / 1000)
  }, event);
}

async function handleLogout(event) {
  var loaded = await middleware.loadSessionFromEvent(event);
  if (loaded && loaded.session) {
    await sessions.revokeSession(loaded.session.sessionHash, "logout");
    await audit.recordAudit({
      event: "logout",
      success: true,
      actorUserId: loaded.session.userId,
      role: loaded.session.roleSnapshot,
      ipHash: audit.ipHashForEvent(event)
    });
  }
  return http.jsonWithCookies(200, { ok: true }, event, [
    cookies.clearSessionCookie(),
    cookies.clearCsrfCookie()
  ]);
}

async function handleSessionGet(event) {
  var loaded = await middleware.loadSessionFromEvent(event);
  if (!loaded || !loaded.session) {
    return http.json(200, { ok: true, authenticated: false }, event);
  }
  var active = sessions.isSessionActive(loaded.session);
  if (!active.ok) {
    return http.json(200, { ok: true, authenticated: false, reason: active.code }, event);
  }
  var user = await users.getUser(loaded.session.userId);
  var now = Date.now();
  var stepRemaining = 0;
  if (loaded.session.stepUpUntil && loaded.session.stepUpUntil > now) {
    stepRemaining = Math.floor((loaded.session.stepUpUntil - now) / 1000);
  }
  await sessions.touchSession(loaded.session, now);
  var cfg = config.getAuthConfig();
  return http.json(200, {
    ok: true,
    authenticated: true,
    role: loaded.session.roleSnapshot,
    purpose: loaded.session.purpose,
    displayName: user ? user.displayName : null,
    emailMasked: user ? maskEmail(user.emailNormalized) : null,
    deviceName: loaded.session.deviceName,
    stepUpRemainingSec: stepRemaining,
    expiresAt: loaded.session.expiresAt,
    absoluteExpiresAt: loaded.session.absoluteExpiresAt,
    csrfToken: loaded.session.csrfToken,
    enforcementMode: config.getEnforcementMode(),
    authEnvironment: cfg.authEnvironment
  }, event);
}

async function handleDevicesGet(event) {
  var loaded = await middleware.loadSessionFromEvent(event);
  if (!loaded || !loaded.session) return http.json(401, { ok: false, error: "unauthorized" }, event);
  if (loaded.session.purpose !== "full") {
    return http.json(403, { ok: false, error: "forbidden" }, event);
  }
  var list = await sessions.listUserSessions(loaded.session.userId);
  list.forEach(function (d) {
    d.current = d.sessionId === loaded.session.sessionHash;
  });
  return http.json(200, { ok: true, devices: list }, event);
}

async function handleDeviceDelete(event, sessionId) {
  var loaded = await middleware.loadSessionFromEvent(event);
  if (!loaded || !loaded.session) return http.json(401, { ok: false, error: "unauthorized" }, event);
  var csrf = middleware.enforceCsrf(event, loaded.session);
  if (!csrf.ok && config.getEnforcementMode() === "enforce") {
    return http.json(403, { ok: false, error: "forbidden" }, event);
  }
  var target = String(sessionId || "").trim();
  if (!target) return http.json(400, { ok: false, error: "invalid_id" }, event);
  var list = await sessions.listUserSessions(loaded.session.userId);
  var owned = list.some(function (d) { return d.sessionId === target; });
  if (!owned) return http.json(404, { ok: false, error: "not_found" }, event);
  await sessions.revokeSession(target, "device_logout");
  await audit.recordAudit({
    event: "device_logout",
    success: true,
    actorUserId: loaded.session.userId,
    target: target.slice(0, 16),
    ipHash: audit.ipHashForEvent(event)
  });
  var clearingCurrent = target === loaded.session.sessionHash;
  if (clearingCurrent) {
    return http.jsonWithCookies(200, { ok: true, clearedCurrent: true }, event, [
      cookies.clearSessionCookie(),
      cookies.clearCsrfCookie()
    ]);
  }
  return http.json(200, { ok: true, clearedCurrent: false }, event);
}

exports.handler = async function (event) {
  kv.connectFromLambdaEvent(event);
  authKv.connectFromLambdaEvent(event);
  if (event.httpMethod === "OPTIONS") return http.options(event);

  var path = routePath(event);
  var method = String(event.httpMethod || "GET").toUpperCase();

  try {
    if (method === "POST" && path === "email/start") return await handleEmailStart(event);
    if (method === "POST" && path === "email/verify") return await handleEmailVerify(event);
    if (method === "POST" && path === "passkey/register/options") return await handleRegisterOptions(event);
    if (method === "POST" && path === "passkey/register/verify") return await handleRegisterVerify(event);
    if (method === "POST" && path === "passkey/login/options") return await handleLoginOptions(event);
    if (method === "POST" && path === "passkey/login/verify") return await handleLoginVerify(event);
    if (method === "POST" && path === "passkey/step-up/options") return await handleStepUpOptions(event);
    if (method === "POST" && path === "passkey/step-up/verify") return await handleStepUpVerify(event);
    if (method === "POST" && path === "logout") return await handleLogout(event);
    if (method === "GET" && path === "session") return await handleSessionGet(event);
    if (method === "GET" && path === "devices") return await handleDevicesGet(event);
    if (method === "DELETE" && path.indexOf("devices/") === 0) {
      return await handleDeviceDelete(event, path.slice("devices/".length));
    }
    return http.json(404, { ok: false, error: "not_found" }, event);
  } catch (e) {
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      stage: "api-auth",
      ok: false,
      message: e && e.message ? String(e.message).slice(0, 200) : "error"
    }));
    return http.json(500, { ok: false, error: "unavailable" }, event);
  }
};
