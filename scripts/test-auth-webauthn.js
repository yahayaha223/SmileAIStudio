"use strict";

/**
 * Auth / WebAuthn / enforcement unit+integration tests (no production, no network email).
 * Run: node scripts/test-auth-webauthn.js
 */

var assert = require("assert");
var path = require("path");
var fs = require("fs");

process.env.AUTH_ENVIRONMENT = "local";
process.env.AUTH_ENFORCEMENT_MODE = "enforce";
process.env.AUTH_RP_ID = "localhost";
process.env.AUTH_RP_NAME = "Smile AI Studio Test";
process.env.AUTH_ALLOWED_ORIGINS = "http://127.0.0.1:8888,http://localhost:8888";
process.env.AUTH_COOKIE_SECURE = "0";
process.env.AUTH_EMAIL_PROVIDER = "console";
process.env.AUTH_TEST_EXPOSE_EMAIL_TOKEN = "1";
process.env.AUTH_BOOTSTRAP_ENABLED = "1";
process.env.AUTH_BOOTSTRAP_OWNER_EMAIL = "owner@example.com";
process.env.AUTH_IP_HASH_SALT = "test-salt";
process.env.AUTH_STAGING_LINE_TEST_ENABLED = "0";

var shared = path.join(__dirname, "..", "netlify", "functions", "shared", "auth");
var authKv = require(path.join(shared, "auth-kv"));
var config = require(path.join(shared, "config"));
var cryptoUtil = require(path.join(shared, "crypto-util"));
var challenges = require(path.join(shared, "challenges"));
var emailTokens = require(path.join(shared, "email-tokens"));
var sessions = require(path.join(shared, "sessions"));
var users = require(path.join(shared, "users"));
var credentials = require(path.join(shared, "credentials"));
var cookies = require(path.join(shared, "cookies"));
var middleware = require(path.join(shared, "middleware"));
var permissions = require(path.join(shared, "permissions"));
var rateLimit = require(path.join(shared, "rate-limit"));
var audit = require(path.join(shared, "audit"));
var email = require(path.join(shared, "email"));
var http = require(path.join(__dirname, "..", "netlify", "functions", "shared", "http"));
var apiAuth = require(path.join(__dirname, "..", "netlify", "functions", "api-auth"));

var passed = 0;
var failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(function () { return fn(); })
    .then(function () {
      passed += 1;
      console.log("OK  " + name);
    })
    .catch(function (e) {
      failed += 1;
      console.log("NG  " + name);
      console.log("    " + (e && e.message ? e.message : e));
    });
}

function fakeEvent(opts) {
  opts = opts || {};
  return {
    httpMethod: opts.method || "POST",
    path: opts.path || "/api/auth/email/start",
    headers: Object.assign({
      origin: opts.origin || "http://127.0.0.1:8888",
      "content-type": "application/json",
      "user-agent": "auth-test"
    }, opts.headers || {}),
    body: opts.body != null ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : "{}",
    queryStringParameters: opts.qs || {},
    isBase64Encoded: false
  };
}

async function reset() {
  authKv.resetAuthMemoryForTests();
  try {
    var f = path.join(process.cwd(), ".data", "auth-store.json");
    if (fs.existsSync(f)) fs.writeFileSync(f, "{}", "utf8");
  } catch (e) { /* ignore */ }
}

async function run() {
  await reset();

  await test("challenge expires", async function () {
    var raw = "chal-exp-" + Date.now();
    await challenges.saveChallenge({ challenge: raw, purpose: "passkey_login", ttlMs: 1 });
    await new Promise(function (r) { setTimeout(r, 5); });
    var c = await challenges.consumeChallenge(raw, "passkey_login");
    assert.strictEqual(c.ok, false);
    assert.strictEqual(c.reasonCode, "challenge_expired");
  });

  await test("challenge one-time use", async function () {
    var raw = "chal-once-" + Date.now();
    await challenges.saveChallenge({ challenge: raw, purpose: "passkey_login", ttlMs: 60000 });
    var a = await challenges.consumeChallenge(raw, "passkey_login");
    var b = await challenges.consumeChallenge(raw, "passkey_login");
    assert.strictEqual(a.ok, true);
    assert.strictEqual(b.ok, false);
    assert.strictEqual(b.reasonCode, "challenge_used");
  });

  await test("origin mismatch denied by cors helper", async function () {
    var ev = fakeEvent({ origin: "https://evil.example" });
    var opt = http.options(ev);
    assert.strictEqual(opt.statusCode, 403);
    assert.ok(!http.corsHeaders(ev)["Access-Control-Allow-Origin"]);
  });

  await test("RP production blocks non-production origin for options", async function () {
    var prev = process.env.AUTH_RP_ID;
    process.env.AUTH_RP_ID = "studio.egaonokiroku.co.jp";
    var webauthn = require(path.join(shared, "webauthn-service"));
    var r = await webauthn.authenticationOptions("http://127.0.0.1:8888");
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reasonCode, "rp_origin_mismatch");
    process.env.AUTH_RP_ID = prev || "localhost";
  });

  await test("credential duplicate rejected", async function () {
    await reset();
    var u = await users.createUser({ email: "dup@example.com", role: "staff", status: "active" });
    var rec = credentials.newCredentialRecord({
      credentialId: "cred-dup-1",
      userId: u.user.id,
      publicKey: "aaaa",
      counter: 0
    });
    var a = await credentials.saveCredential(rec);
    var b = await credentials.saveCredential(Object.assign({}, rec));
    assert.strictEqual(a.ok, true);
    assert.strictEqual(b.ok, false);
    assert.strictEqual(b.reasonCode, "credential_duplicate");
  });

  await test("session idle 30m owner + absolute 12h", async function () {
    await reset();
    var u = await users.createUser({ email: "idle@example.com", role: "owner", status: "active" });
    var created = await sessions.createSession(u.user, { purpose: "full", deviceName: "t" });
    var s = created.session;
    var now = s.lastSeenAt + 31 * 60 * 1000;
    assert.strictEqual(sessions.isSessionActive(s, now).code, "IDLE_EXPIRED");
    var abs = await sessions.createSession(u.user, { purpose: "full" });
    abs.session.expiresAt = Date.now() + 999999999;
    abs.session.absoluteExpiresAt = Date.now() - 1;
    assert.strictEqual(sessions.isSessionActive(abs.session).code, "ABSOLUTE_EXPIRED");
  });

  await test("revoked session rejected", async function () {
    await reset();
    var u = await users.createUser({ email: "rev@example.com", role: "owner", status: "active" });
    var created = await sessions.createSession(u.user, { purpose: "full" });
    await sessions.revokeSession(created.session.sessionHash, "test");
    var again = await sessions.getSessionByRawId(created.rawId);
    assert.strictEqual(sessions.isSessionActive(again).ok, false);
  });

  await test("role denial staff cannot delete tasks perm", async function () {
    assert.strictEqual(permissions.roleAllowed("staff", permissions.resolvePermission("api-tasks:POST:delete").roles), false);
    assert.strictEqual(permissions.roleAllowed("owner", permissions.resolvePermission("api-tasks:POST:delete").roles), true);
    assert.strictEqual(permissions.resolvePermission("api-tasks:POST:delete").stepUp, true);
  });

  await test("step-up expiry enforced in middleware", async function () {
    await reset();
    process.env.AUTH_ENFORCEMENT_MODE = "enforce";
    var u = await users.createUser({ email: "step@example.com", role: "owner", status: "active" });
    var created = await sessions.createSession(u.user, { purpose: "full" });
    var ev = fakeEvent({
      method: "POST",
      headers: {
        cookie: config.COOKIE_SESSION + "=" + encodeURIComponent(created.rawId) + "; " +
          config.COOKIE_CSRF + "=" + encodeURIComponent(created.session.csrfToken),
        "x-csrf-token": created.session.csrfToken
      },
      body: { action: "delete", id: "x" }
    });
    var guard = await middleware.enforceAccess(ev, { permissionKey: "api-tasks:POST:delete" });
    assert.strictEqual(guard.ok, false);
    assert.ok(guard.response.body.indexOf("step_up_required") !== -1);
  });

  await test("CSRF rejection", async function () {
    await reset();
    var u = await users.createUser({ email: "csrf@example.com", role: "staff", status: "active" });
    var created = await sessions.createSession(u.user, { purpose: "full" });
    var ev = fakeEvent({
      method: "POST",
      headers: {
        cookie: config.COOKIE_SESSION + "=" + encodeURIComponent(created.rawId) + "; " +
          config.COOKIE_CSRF + "=" + encodeURIComponent(created.session.csrfToken),
        "x-csrf-token": "wrong"
      },
      body: {}
    });
    var guard = await middleware.enforceAccess(ev, { permissionKey: "api-tasks:POST:create" });
    assert.strictEqual(guard.ok, false);
  });

  await test("CORS exact allowlist", async function () {
    assert.strictEqual(config.isOriginAllowed("http://127.0.0.1:8888"), true);
    assert.strictEqual(config.isOriginAllowed("https://evil.egaonokiroku.co.jp"), false);
    assert.strictEqual(config.isOriginAllowed("https://studio.egaonokiroku.co.jp.evil.com"), false);
  });

  await test("rate limit trips", async function () {
    await reset();
    var key = "rl-test-" + Date.now();
    var last = null;
    for (var i = 0; i < 4; i++) last = await rateLimit.rateLimit(key, 3, 60000);
    assert.strictEqual(last.ok, false);
  });

  await test("account enumeration: email start always generic", async function () {
    await reset();
    var a = await apiAuth.handler(fakeEvent({
      path: "/api/auth/email/start",
      body: { email: "nobody@example.com" }
    }));
    var b = await apiAuth.handler(fakeEvent({
      path: "/api/auth/email/start",
      body: { email: "owner@example.com" }
    }));
    assert.strictEqual(a.statusCode, 200);
    assert.strictEqual(b.statusCode, 200);
    var aj = JSON.parse(a.body);
    var bj = JSON.parse(b.body);
    assert.strictEqual(aj.message, bj.message);
    assert.ok(!aj.exists && !bj.exists);
  });

  await test("email token one-time + hash stored", async function () {
    await reset();
    var issued = await emailTokens.issueEmailToken({ email: "owner@example.com", purpose: "login_or_enroll" });
    assert.ok(issued.row.tokenHash);
    assert.ok(issued.row.tokenHash !== issued.raw);
    var c1 = await emailTokens.consumeEmailToken(issued.raw);
    var c2 = await emailTokens.consumeEmailToken(issued.raw);
    assert.strictEqual(c1.ok, true);
    assert.strictEqual(c2.ok, false);
  });

  await test("email verify issues enroll session cookies", async function () {
    await reset();
    await users.ensureBootstrapOwner();
    var issued = await emailTokens.issueEmailToken({ email: "owner@example.com", userId: (await users.getUserByEmail("owner@example.com")).id });
    var res = await apiAuth.handler(fakeEvent({
      path: "/api/auth/email/verify",
      body: { token: issued.raw, deviceName: "Test" }
    }));
    assert.strictEqual(res.statusCode, 200);
    var body = JSON.parse(res.body);
    assert.strictEqual(body.enrollRequired, true);
    assert.strictEqual(body.canRegisterPasskey, true);
    var setCookie = (res.multiValueHeaders && res.multiValueHeaders["Set-Cookie"]) || [];
    assert.ok(setCookie.some(function (c) { return c.indexOf("smile_studio_session=") === 0 && c.indexOf("HttpOnly") !== -1; }));
    assert.ok(setCookie.some(function (c) { return c.indexOf("SameSite=Lax") !== -1; }));
    assert.ok(setCookie.every(function (c) { return c.indexOf("Secure") === -1; })); // AUTH_COOKIE_SECURE=0
    // Enroll cookies must be short-lived (15m), not full 12h absolute session.
    assert.ok(setCookie.some(function (c) { return /Max-Age=900\b/.test(c); }));
  });

  await test("enroll session can retry register/options without 401", async function () {
    await reset();
    var u = await users.createUser({ email: "second@example.com", role: "owner", status: "active" });
    var enroll = await sessions.createSession(u.user, { purpose: "passkey_enroll", deviceName: "PC" });
    var cookie = config.COOKIE_SESSION + "=" + encodeURIComponent(enroll.rawId);
    var sessionRes = await apiAuth.handler(fakeEvent({
      method: "GET",
      path: "/api/auth/session",
      headers: { cookie: cookie }
    }));
    var sessionBody = JSON.parse(sessionRes.body);
    assert.strictEqual(sessionBody.authenticated, false);
    assert.strictEqual(sessionBody.enrollRequired, true);
    assert.strictEqual(sessionBody.canRegisterPasskey, true);
    assert.ok(sessionBody.csrfToken);

    var opt1 = await apiAuth.handler(fakeEvent({
      method: "POST",
      path: "/api/auth/passkey/register/options",
      headers: { cookie: cookie, origin: "http://127.0.0.1:8888" },
      body: {}
    }));
    assert.strictEqual(opt1.statusCode, 200);
    assert.ok(JSON.parse(opt1.body).options);

    var opt2 = await apiAuth.handler(fakeEvent({
      method: "POST",
      path: "/api/auth/passkey/register/options",
      headers: { cookie: cookie, origin: "http://127.0.0.1:8888" },
      body: {}
    }));
    assert.strictEqual(opt2.statusCode, 200);
    assert.ok(JSON.parse(opt2.body).options);
  });

  await test("register/options 401 includes reasonCode when session missing", async function () {
    await reset();
    var res = await apiAuth.handler(fakeEvent({
      method: "POST",
      path: "/api/auth/passkey/register/options",
      headers: { origin: "http://127.0.0.1:8888" },
      body: {}
    }));
    assert.strictEqual(res.statusCode, 401);
    var body = JSON.parse(res.body);
    assert.strictEqual(body.reasonCode, "session_missing");
  });

  await test("full session can request register/options for additional passkey", async function () {
    await reset();
    var u = await users.createUser({ email: "add@example.com", role: "owner", status: "active" });
    var full = await sessions.createSession(u.user, { purpose: "full", deviceName: "Phone" });
    var res = await apiAuth.handler(fakeEvent({
      method: "POST",
      path: "/api/auth/passkey/register/options",
      headers: {
        cookie: config.COOKIE_SESSION + "=" + encodeURIComponent(full.rawId),
        origin: "http://127.0.0.1:8888"
      },
      body: {}
    }));
    assert.strictEqual(res.statusCode, 200);
    assert.ok(JSON.parse(res.body).options);
  });

  await test("logout revokes server session", async function () {
    await reset();
    var u = await users.createUser({ email: "out@example.com", role: "staff", status: "active" });
    var created = await sessions.createSession(u.user, { purpose: "full" });
    var res = await apiAuth.handler(fakeEvent({
      method: "POST",
      path: "/api/auth/logout",
      headers: {
        cookie: [
          config.COOKIE_SESSION + "=" + encodeURIComponent(created.rawId),
          config.COOKIE_CSRF + "=" + encodeURIComponent(created.session.csrfToken)
        ].join("; "),
        "x-csrf-token": created.session.csrfToken
      }
    }));
    assert.strictEqual(res.statusCode, 200);
    var again = await sessions.getSessionByRawId(created.rawId);
    assert.ok(again.revokedAt);
  });

  await test("logout rejects missing CSRF and keeps session", async function () {
    await reset();
    var u = await users.createUser({ email: "csrf-out@example.com", role: "staff", status: "active" });
    var created = await sessions.createSession(u.user, { purpose: "full" });
    var res = await apiAuth.handler(fakeEvent({
      method: "POST",
      path: "/api/auth/logout",
      headers: {
        cookie: config.COOKIE_SESSION + "=" + encodeURIComponent(created.rawId)
      }
    }));
    assert.strictEqual(res.statusCode, 403);
    var again = await sessions.getSessionByRawId(created.rawId);
    assert.ok(!again.revokedAt);
  });

  await test("devices list + force logout", async function () {
    await reset();
    var u = await users.createUser({ email: "dev@example.com", role: "owner", status: "active" });
    var a = await sessions.createSession(u.user, { purpose: "full", deviceName: "A" });
    var b = await sessions.createSession(u.user, { purpose: "full", deviceName: "B" });
    var listRes = await apiAuth.handler(fakeEvent({
      method: "GET",
      path: "/api/auth/devices",
      headers: { cookie: config.COOKIE_SESSION + "=" + encodeURIComponent(a.rawId) }
    }));
    var list = JSON.parse(listRes.body);
    assert.ok(list.devices.length >= 2);
    var del = await apiAuth.handler(fakeEvent({
      method: "DELETE",
      path: "/api/auth/devices/" + b.session.sessionHash,
      headers: {
        cookie: config.COOKIE_SESSION + "=" + encodeURIComponent(a.rawId) + "; " +
          config.COOKIE_CSRF + "=" + encodeURIComponent(a.session.csrfToken),
        "x-csrf-token": a.session.csrfToken
      }
    }));
    assert.strictEqual(del.statusCode, 200);
    assert.ok((await sessions.getSessionByRawId(b.rawId)).revokedAt);
  });

  await test("enforcement off does not reject API", async function () {
    process.env.AUTH_ENFORCEMENT_MODE = "off";
    var guard = await middleware.enforceAccess(fakeEvent({ method: "GET" }), {
      permissionKey: "api-tasks:GET"
    });
    assert.strictEqual(guard.ok, true);
    assert.strictEqual(guard.bypass, true);
    process.env.AUTH_ENFORCEMENT_MODE = "enforce";
  });

  await test("enforcement observe audits but allows", async function () {
    process.env.AUTH_ENFORCEMENT_MODE = "observe";
    var guard = await middleware.enforceAccess(fakeEvent({ method: "GET" }), {
      permissionKey: "api-tasks:GET"
    });
    assert.strictEqual(guard.ok, true);
    assert.strictEqual(guard.bypass, true);
    process.env.AUTH_ENFORCEMENT_MODE = "enforce";
  });

  await test("unknown enforcement mode fails closed to enforce", async function () {
    process.env.AUTH_ENFORCEMENT_MODE = "weird";
    assert.strictEqual(config.getEnforcementMode(), "enforce");
    process.env.AUTH_ENFORCEMENT_MODE = "enforce";
  });

  await test("audit rejects secrets + email console does not log token", async function () {
    // sanitizeMeta strips secret-like keys rather than throw
    var meta = audit.sanitizeMeta({ token: "secret", password: "x", note: "ok" });
    assert.strictEqual(meta.token, undefined);
    assert.strictEqual(meta.password, undefined);
    assert.strictEqual(meta.note, "ok");
    var logs = [];
    var orig = console.log;
    console.log = function (m) { logs.push(String(m)); };
    try {
      await email.sendLoginLink({
        to: "owner@example.com",
        url: "http://127.0.0.1:8888/auth-local/login.html#auth_token=SUPERSECRETTOKEN",
        expiresAt: Date.now() + 60000,
        debugToken: "SUPERSECRETTOKEN"
      });
    } finally {
      console.log = orig;
    }
    var joined = logs.join("\n");
    assert.ok(joined.indexOf("SUPERSECRETTOKEN") === -1);
  });

  await test("cookie builder attributes", async function () {
    process.env.AUTH_COOKIE_SECURE = "1";
    var c = cookies.sessionCookie("abc", 120);
    assert.ok(c.indexOf("HttpOnly") !== -1);
    assert.ok(c.indexOf("Secure") !== -1);
    assert.ok(c.indexOf("SameSite=Lax") !== -1);
    assert.ok(c.indexOf("Path=/") !== -1);
    assert.ok(c.indexOf("Domain=") === -1);
    process.env.AUTH_COOKIE_SECURE = "0";
  });

  await test("bootstrap creates only first owner", async function () {
    await reset();
    process.env.AUTH_BOOTSTRAP_ENABLED = "1";
    var a = await users.ensureBootstrapOwner();
    var b = await users.ensureBootstrapOwner();
    assert.strictEqual(a.ok, true);
    assert.strictEqual(b.ok, false);
    assert.strictEqual(b.reasonCode, "owner_exists");
  });

  await test("session GET returns role without secrets", async function () {
    await reset();
    var u = await users.createUser({ email: "me@example.com", role: "admin", status: "active" });
    var created = await sessions.createSession(u.user, { purpose: "full", deviceName: "Phone" });
    var res = await apiAuth.handler(fakeEvent({
      method: "GET",
      path: "/api/auth/session",
      headers: { cookie: config.COOKIE_SESSION + "=" + encodeURIComponent(created.rawId) }
    }));
    var body = JSON.parse(res.body);
    assert.strictEqual(body.authenticated, true);
    assert.strictEqual(body.canRegisterPasskey, true);
    assert.strictEqual(body.purpose, "full");
    assert.strictEqual(body.role, "admin");
    assert.ok(!body.sessionRaw);
    assert.ok(!JSON.stringify(body).toLowerCase().includes("password"));
  });

  await test("auth kv namespaces by environment", async function () {
    process.env.AUTH_ENVIRONMENT = "local";
    assert.strictEqual(authKv.namespacedKey("users/x").indexOf("local/"), 0);
    assert.strictEqual(authKv.storeNameForEnv(), "smile-studio-auth-local");
    process.env.AUTH_ENVIRONMENT = "staging";
    assert.strictEqual(authKv.namespacedKey("users/x").indexOf("staging/"), 0);
    assert.strictEqual(authKv.storeNameForEnv(), "smile-studio-auth-staging");
    process.env.AUTH_ENVIRONMENT = "production";
    assert.strictEqual(authKv.storeNameForEnv(), "smile-studio-auth");
    process.env.AUTH_ENVIRONMENT = "local";
  });

  await test("staging hard-denies production-only APIs even in off mode", async function () {
    process.env.AUTH_ENVIRONMENT = "staging";
    process.env.AUTH_ENFORCEMENT_MODE = "off";
    var guard = await middleware.enforceAccess(fakeEvent({ method: "POST" }), {
      permissionKey: "production-publish:POST"
    });
    assert.strictEqual(guard.ok, false);
    assert.ok(guard.response.body.indexOf("env_blocked") !== -1);
    process.env.AUTH_ENVIRONMENT = "local";
    process.env.AUTH_ENFORCEMENT_MODE = "enforce";
  });

  await test("staging rejects production RP ID", async function () {
    process.env.AUTH_ENVIRONMENT = "staging";
    process.env.AUTH_RP_ID = "studio.egaonokiroku.co.jp";
    var webauthn = require(path.join(shared, "webauthn-service"));
    var r = await webauthn.authenticationOptions("https://auth-staging--smile-ai-studio.netlify.app");
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reasonCode, "staging_must_not_use_production_rp");
    process.env.AUTH_RP_ID = "localhost";
    process.env.AUTH_ENVIRONMENT = "local";
  });

  await test("staging email marks STAGING", async function () {
    process.env.AUTH_ENVIRONMENT = "staging";
    var mail = email.buildLoginEmail({
      to: "t@example.com",
      url: "https://example.test/#auth_token=x",
      expiresAt: Date.now() + 600000
    });
    assert.ok(mail.subject.indexOf("STAGING") !== -1);
    assert.ok(mail.text.indexOf("STAGING") !== -1);
    process.env.AUTH_ENVIRONMENT = "local";
  });

  console.log("");
  console.log("passed=" + passed + " failed=" + failed);
  if (failed) process.exit(1);
}

run().catch(function (e) {
  console.error(e);
  process.exit(1);
});
