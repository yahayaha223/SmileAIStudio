"use strict";

/**
 * Read-only site FTP probe tests (no real FTP).
 */
process.env.AUTH_ENVIRONMENT = process.env.AUTH_ENVIRONMENT || "local";
process.env.AUTH_ENFORCEMENT_MODE = process.env.AUTH_ENFORCEMENT_MODE || "enforce";
process.env.AUTH_RP_ID = process.env.AUTH_RP_ID || "localhost";
process.env.AUTH_ALLOWED_ORIGINS = process.env.AUTH_ALLOWED_ORIGINS || "http://127.0.0.1:8888,http://localhost:8888";
process.env.AUTH_COOKIE_SECURE = "0";
process.env.AUTH_IP_HASH_SALT = process.env.AUTH_IP_HASH_SALT || "test-salt";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var probe = require(path.join(__dirname, "..", "netlify", "functions", "shared", "site-ftp-probe.js"));
var ftpClient = require(path.join(__dirname, "..", "netlify", "functions", "shared", "ftp-client.js"));
var siteFtpPaths = require(path.join(__dirname, "..", "netlify", "functions", "shared", "site-ftp-paths.js"));
var permissions = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "permissions.js"));
var authConfig = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "config.js"));
var middleware = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "middleware.js"));
var users = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "users.js"));
var sessions = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "sessions.js"));
var authKv = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "auth-kv.js"));

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
    path: "/api/site-ftp-probe",
    headers: Object.assign({
      origin: "http://127.0.0.1:8888",
      "content-type": "application/json",
      "user-agent": "site-ftp-probe-test"
    }, opts.headers || {}),
    body: "{}",
    queryStringParameters: {},
    isBase64Encoded: false
  };
}

function xserverLoginFtp() {
  var ftp = ftpClient.createMemoryFtp({});
  ftp.cwd = "/";
  ftp.listEntries = async function (dir) {
    if (dir === "." || dir === "/") {
      return [
        { name: "egaonokiroku.co.jp", type: 2 },
        { name: "readme.txt", type: 1 }
      ];
    }
    if (dir === "egaonokiroku.co.jp") {
      return [
        { name: "public_html", type: 2 },
        { name: "mail", type: 2 }
      ];
    }
    return [];
  };
  return ftp;
}

function writeOpCount(ops) {
  var n = 0;
  (ops || []).forEach(function (op) {
    if (op.op === "stor" || op.op === "rename" || op.op === "remove") n += 1;
  });
  return n;
}

async function run() {
  await test("診断処理は pwd/list のみ", async function () {
    var ftp = xserverLoginFtp();
    var r = await probe.probeLoginLayout(ftp);
    assert.strictEqual(r.ok, true, r.userMessage || r.code);
    assert.strictEqual(r.loginPwd, "/");
    assert.deepStrictEqual(r.rootDirs, ["egaonokiroku.co.jp"]);
    assert.ok(r.publicHtmlHints.some(function (h) {
      return h.at === "one-level" && h.parent === "egaonokiroku.co.jp" && h.name === "public_html";
    }));
    var ops = ftp.ops.map(function (op) { return op.op; });
    ops.forEach(function (op) {
      assert.ok(op === "pwd" || op === "list", "unexpected op " + op);
    });
    assert.ok(ops.indexOf("pwd") >= 0);
    assert.ok(ops.indexOf("list") >= 0);
    assert.strictEqual(writeOpCount(ftp.ops), 0);
  });

  await test("STOR / rename / remove が 0回", async function () {
    var ftp = xserverLoginFtp();
    await probe.probeLoginLayout(ftp);
    assert.strictEqual(ftp.ops.filter(function (op) { return op.op === "stor"; }).length, 0);
    assert.strictEqual(ftp.ops.filter(function (op) { return op.op === "rename"; }).length, 0);
    assert.strictEqual(ftp.ops.filter(function (op) { return op.op === "remove"; }).length, 0);
    var ro = probe.readOnlyFtp(ftp);
    await assert.rejects(function () { return ro.stor("x", Buffer.from("no")); });
    await assert.rejects(function () { return ro.rename("a", "b"); });
    await assert.rejects(function () { return ro.remove("x"); });
    await assert.rejects(function () { return ro.cd("/public_html"); });
  });

  await test("password / user がログに含まれない", async function () {
    var lines = [];
    var origLog = console.log;
    console.log = function (msg) { lines.push(String(msg)); };
    try {
      await probe.probeLoginLayout(xserverLoginFtp());
    } finally {
      console.log = origLog;
    }
    assert.ok(lines.length >= 1);
    var payload = JSON.parse(lines[0]);
    assert.strictEqual(payload.stage, "site-ftp-probe");
    assert.strictEqual(payload.writeOps, 0);
    var blob = JSON.stringify(payload).toLowerCase();
    assert.ok(blob.indexOf("password") < 0);
    assert.ok(blob.indexOf("secret") < 0);
    assert.ok(blob.indexOf("ftp_user") < 0);
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, "user"));
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, "host"));
  });

  await test("cd 550 のあとも書込みせず診断できる", async function () {
    var ftp = xserverLoginFtp();
    ftp.resolveCd = async function (target) {
      var err = new Error("550");
      err.code = 550;
      throw err;
    };
    var denied = await siteFtpPaths.enterSiteFtpCwd(ftp, "/egaonokiroku.co.jp/public_html");
    assert.strictEqual(denied.ok, false);
    assert.strictEqual(denied.code, "ftp_cwd_550");
    var r = await probe.probeLoginLayout(ftp);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.rootDirs, ["egaonokiroku.co.jp"]);
    assert.strictEqual(writeOpCount(ftp.ops), 0);
  });

  await test("owner以外拒否 / CSRF拒否", async function () {
    process.env.AUTH_ENVIRONMENT = "production";
    process.env.AUTH_ENFORCEMENT_MODE = "off";
    process.env.AUTH_ALLOWED_ORIGINS = "http://127.0.0.1:8888";
    process.env.AUTH_RP_ID = "localhost";
    authKv.resetAuthMemoryForTests();

    var noSession = await middleware.enforceAccess(fakeEvent(), {
      permissionKey: "api-site-ftp-probe:POST"
    });
    assert.strictEqual(noSession.ok, false);
    assert.strictEqual(noSession.response.statusCode, 401);

    var staffUser = await users.createUser({ email: "staff-probe@example.com", role: "staff", status: "active" });
    var staff = await sessions.createSession(staffUser.user, { purpose: "full", deviceName: "S" });
    var staffDenied = await middleware.enforceAccess(fakeEvent({
      headers: {
        cookie: authConfig.COOKIE_SESSION + "=" + encodeURIComponent(staff.rawId) + "; " +
          authConfig.COOKIE_CSRF + "=" + encodeURIComponent(staff.session.csrfToken),
        "x-csrf-token": staff.session.csrfToken
      }
    }), { permissionKey: "api-site-ftp-probe:POST" });
    assert.strictEqual(staffDenied.ok, false);
    assert.strictEqual(staffDenied.response.statusCode, 403);

    authKv.resetAuthMemoryForTests();
    var ownerUser = await users.createUser({ email: "owner-probe@example.com", role: "owner", status: "active" });
    var owner = await sessions.createSession(ownerUser.user, { purpose: "full", deviceName: "O" });
    var badCsrf = await middleware.enforceAccess(fakeEvent({
      headers: {
        cookie: authConfig.COOKIE_SESSION + "=" + encodeURIComponent(owner.rawId) + "; " +
          authConfig.COOKIE_CSRF + "=" + encodeURIComponent(owner.session.csrfToken),
        "x-csrf-token": "wrong"
      }
    }), { permissionKey: "api-site-ftp-probe:POST" });
    assert.strictEqual(badCsrf.ok, false);
    assert.strictEqual(badCsrf.response.statusCode, 403);

    process.env.AUTH_ENVIRONMENT = "local";
    process.env.AUTH_ENFORCEMENT_MODE = "enforce";
  });

  await test("permission is owner-only and production-only", function () {
    var perm = permissions.resolvePermission("api-site-ftp-probe:POST");
    assert.ok(perm);
    assert.deepStrictEqual(perm.roles, ["owner"]);
    assert.strictEqual(authConfig.isAlwaysEnforcedPermission("api-site-ftp-probe:POST"), true);
    assert.strictEqual(authConfig.isProductionOnlyPermission("api-site-ftp-probe:POST"), true);
    var src = fs.readFileSync(
      path.join(__dirname, "..", "netlify", "functions", "shared", "site-ftp-probe.js"),
      "utf8"
    );
    assert.ok(!/FTP_PASSWORD\s*=/.test(src));
    assert.ok(/Never STOR/.test(src) || /pwd \+ list only/.test(src));
  });

  console.log("\nPassed " + passed + " site-ftp-probe tests" + (failed ? (" failed=" + failed) : ""));
  if (failed) process.exit(1);
}

run().catch(function (e) {
  console.error(e);
  process.exit(1);
});
