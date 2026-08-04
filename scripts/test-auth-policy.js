/**
 * Unit tests for auth-local/auth-policy.js (no network, no secrets).
 */
"use strict";

var assert = require("assert");
var path = require("path");
var policy = require(path.join(__dirname, "..", "auth-local", "auth-policy.js"));

var passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log("OK  " + name);
}

function fixedRandom(n) {
  var a = new Uint8Array(n);
  for (var i = 0; i < n; i++) a[i] = (i * 17 + 3) % 256;
  return a;
}

test("roles include owner admin staff", function () {
  assert.deepStrictEqual(policy.ROLES.slice().sort(), ["admin", "owner", "staff"]);
});

test("staff cannot productionPublish", function () {
  assert.strictEqual(policy.hasPermission("staff", "productionPublish"), false);
  assert.strictEqual(policy.hasPermission("staff", "saveDraft"), true);
});

test("admin cannot manageUsers or viewSecrets", function () {
  assert.strictEqual(policy.hasPermission("admin", "manageUsers"), false);
  assert.strictEqual(policy.hasPermission("admin", "viewSecrets"), false);
  assert.strictEqual(policy.hasPermission("admin", "manageProjects"), true);
});

test("owner has security and publish", function () {
  assert.strictEqual(policy.hasPermission("owner", "changeSecuritySettings"), true);
  assert.strictEqual(policy.hasPermission("owner", "productionPublish"), true);
});

test("step-up required list covers critical ops", function () {
  [
    "productionPublish",
    "ftpUpload",
    "fileDelete",
    "backupRestore",
    "manageUsers",
    "changeRoles",
    "changeConnectionSettings",
    "changeApiKeys",
    "changeSecuritySettings"
  ].forEach(function (a) {
    assert.strictEqual(policy.requiresStepUp(a), true, a);
  });
  assert.strictEqual(policy.requiresStepUp("saveDraft"), false);
});

test("canPerform enforces step-up for owner publish", function () {
  var now = 1_700_000_000_000;
  var session = {
    role: "owner",
    lastSeenAt: now,
    expiresAt: now + 3600_000,
    stepUpUntil: null,
    revoked: false
  };
  var denied = policy.canPerform(session, "productionPublish", now);
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(denied.code, "STEP_UP_REQUIRED");
  session.stepUpUntil = now + 60_000;
  var ok = policy.canPerform(session, "productionPublish", now);
  assert.strictEqual(ok.ok, true);
});

test("owner idle timeout 30 minutes", function () {
  assert.strictEqual(policy.IDLE_TIMEOUT_MS.owner, 30 * 60 * 1000);
  var now = 1_700_000_000_000;
  var session = {
    role: "owner",
    lastSeenAt: now - 31 * 60 * 1000,
    expiresAt: now + 3600_000,
    revoked: false
  };
  var r = policy.canPerform(session, "saveDraft", now);
  assert.strictEqual(r.code, "IDLE_TIMEOUT");
});

test("cookie flags secure in production", function () {
  var prod = policy.cookieFlags(true);
  assert.strictEqual(prod.httpOnly, true);
  assert.strictEqual(prod.secure, true);
  assert.strictEqual(prod.sameSite, "Lax");
  var local = policy.cookieFlags(false);
  assert.strictEqual(local.secure, false);
});

test("generic login error does not enumerate accounts", function () {
  var msg = policy.genericLoginError();
  assert.ok(msg.indexOf("登録") === -1 || msg.indexOf("登録がある場合") !== -1);
  assert.ok(msg.indexOf("パスワードが違") === -1);
  assert.ok(msg.indexOf("@") === -1);
});

test("audit rejects secrets", function () {
  assert.throws(function () {
    policy.auditEvent({ type: "login", success: true, password: "x" });
  });
  var ev = policy.auditEvent({ type: "login", actorUserId: "u1", success: true, ipHash: "ab" });
  assert.strictEqual(ev.type, "login");
  assert.strictEqual(ev.success, true);
});

test("session id entropy length", function () {
  var id = policy.createSessionId(fixedRandom);
  assert.strictEqual(id.length, 64);
});

test("login regenerates session id", function () {
  var old = { id: "old", userId: "u1", role: "owner" };
  var next = policy.rotateSession(old, fixedRandom, 1000);
  assert.notStrictEqual(next.id, old.id);
  assert.strictEqual(next.userId, "u1");
  assert.strictEqual(next.replacedFrom, "old");
  assert.strictEqual(next.stepUpUntil, null);
});

console.log("");
console.log("passed=" + passed);
process.exit(0);
