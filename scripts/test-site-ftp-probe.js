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

  await test("cd の前に pwd/list し 550 なら診断して終了", async function () {
    var ftp = xserverLoginFtp();
    ftp.resolveCd = async function (target) {
      var err = new Error("550");
      err.code = 550;
      throw err;
    };
    var lines = [];
    var origLog = console.log;
    console.log = function (msg) { lines.push(String(msg)); };
    var denied;
    try {
      denied = await ftpClient.enterSiteCwdAfterLoginProbe(ftp, "/egaonokiroku.co.jp/public_html");
    } finally {
      console.log = origLog;
    }
    assert.strictEqual(denied.ok, false);
    assert.strictEqual(denied.code, "ftp_cwd_550");
    assert.ok(denied.diagnostic);
    assert.strictEqual(denied.diagnostic.loginPwd, "/");
    assert.deepStrictEqual(denied.diagnostic.rootDirs, ["egaonokiroku.co.jp"]);
    assert.ok(denied.diagnostic.publicHtmlHints.some(function (h) {
      return h.at === "one-level" && h.parent === "egaonokiroku.co.jp";
    }));
    var ops = ftp.ops.map(function (op) { return op.op; });
    var pwdIdx = ops.indexOf("pwd");
    var listIdx = ops.indexOf("list");
    var cdIdx = ops.indexOf("cd");
    assert.ok(pwdIdx >= 0 && listIdx >= 0 && cdIdx >= 0);
    assert.ok(pwdIdx < cdIdx, "pwd must run before cd");
    assert.ok(listIdx < cdIdx, "list must run before cd");
    assert.strictEqual(writeOpCount(ftp.ops), 0);
    var cwd550 = lines.map(function (line) {
      try { return JSON.parse(line); } catch (eParse) { return {}; }
    }).filter(function (p) { return p.stage === "site-ftp-cwd-550"; });
    assert.ok(cwd550.length >= 1);
    assert.strictEqual(cwd550[0].loginPwd, "/");
    assert.deepStrictEqual(cwd550[0].rootDirs, ["egaonokiroku.co.jp"]);
    assert.strictEqual(cwd550[0].writeOps, 0);
    var blob = JSON.stringify(cwd550[0]).toLowerCase();
    assert.ok(blob.indexOf("password") < 0);
    assert.ok(blob.indexOf("ftp_user") < 0);
    assert.ok(blob.indexOf("secret") < 0);
  });

  await test("login直下に public_html があれば 1階層探索しない", async function () {
    var ftp = ftpClient.createMemoryFtp({});
    ftp.cwd = "/";
    ftp.listEntries = async function (dir) {
      if (dir === "." || dir === "/") {
        return [
          { name: "public_html", type: 2 },
          { name: "mail", type: 2 }
        ];
      }
      throw new Error("should not list children");
    };
    var r = await probe.probeLoginLayout(ftp);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.rootDirs, ["public_html", "mail"]);
    assert.ok(r.publicHtmlHints.some(function (h) { return h.at === "login-list"; }));
    assert.ok(!r.publicHtmlHints.some(function (h) { return h.at === "one-level"; }));
    assert.strictEqual(ftp.ops.filter(function (op) { return op.op === "list"; }).length, 1);
    assert.strictEqual(writeOpCount(ftp.ops), 0);
  });

  await test("診断APIは cd/STOR/rename/remove しない", function () {
    var probeApi = fs.readFileSync(
      path.join(__dirname, "..", "netlify", "functions", "api-site-ftp-probe.js"),
      "utf8"
    );
    var ftpSrc = fs.readFileSync(
      path.join(__dirname, "..", "netlify", "functions", "shared", "ftp-client.js"),
      "utf8"
    );
    assert.ok(/connectLoginOnlyFromEnv/.test(probeApi));
    assert.ok(!/\.cd\(/.test(probeApi));
    assert.ok(!/\.stor\(/.test(probeApi));
    assert.ok(!/\.rename\(/.test(probeApi));
    assert.ok(!/\.remove\(/.test(probeApi));
    var loginOnly = ftpSrc.slice(
      ftpSrc.indexOf("async function connectLoginOnlyFromEnv"),
      ftpSrc.indexOf("async function enterSiteCwdAfterLoginProbe")
    );
    assert.ok(/cfg\.remoteDir = ""/.test(loginOnly));
    assert.ok(/cfg\.probeOnly = true/.test(loginOnly));
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

  await test("ホームページ編集画面から診断できる", function () {
    var ui = require(path.join(__dirname, "..", "js", "smile-site-ftp-probe-ui.js"));
    var html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    var script = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
    assert.ok(/id="btn-hp-edit-ftp-probe"/.test(html));
    assert.ok(/FTP公開先を診断/.test(html));
    assert.ok(/id="hp-edit-ftp-probe-result"/.test(html));
    assert.ok(/smile-site-ftp-probe-ui\.js/.test(html));
    var start = script.indexOf("function runHpFtpProbe(");
    var end = script.indexOf("function githubErrorMessage(");
    assert.ok(start >= 0 && end > start);
    var fn = script.slice(start, end);
    assert.ok(/\/\.netlify\/functions\/api-site-ftp-probe/.test(fn));
    assert.ok(/X-CSRF-Token/.test(fn));
    assert.ok(/credentials:\s*"include"/.test(fn));
    assert.ok(/role !== "owner"/.test(fn));
    assert.ok(!/api-site-publish/.test(fn));
    assert.ok(!/api-github-issues/.test(fn));
    assert.ok(!/api-diary-publish/.test(fn));
    assert.ok(!/\.stor\(/.test(fn));
    assert.ok(!/\.rename\(/.test(fn));
    assert.ok(!/\.remove\(/.test(fn));
    assert.ok(!/\.cd\(/.test(fn));
    var submitStart = script.indexOf("function submitHpEditRequest(");
    var submitEnd = script.indexOf("\n  onClick(\"simple-diary-close\"");
    var submitFn = script.slice(submitStart, submitEnd);
    assert.ok(!/api-site-ftp-probe/.test(submitFn));

    var okText = ui.formatSuccess({
      loginPwd: "/",
      rootDirs: ["egaonokiroku.co.jp"],
      publicHtmlHints: [{ at: "one-level", parent: "egaonokiroku.co.jp", name: "public_html" }],
      writeOps: 0
    });
    assert.ok(/^FTP診断完了/.test(okText));
    assert.ok(/ログイン直後の場所：\n\//.test(okText));
    assert.ok(/見えているフォルダ：\negaonokiroku.co.jp/.test(okText));
    assert.ok(/public_html候補：\negaonokiroku.co.jp \/ public_html/.test(okText));
    assert.ok(/書込み操作：\n0回/.test(okText));
    assert.ok(!/index\.htm/.test(okText));
    var blob = okText.toLowerCase();
    assert.ok(blob.indexOf("password") < 0);
    assert.ok(blob.indexOf("ftp_user") < 0);
    assert.ok(blob.indexOf("secret") < 0);

    var hidden = ui.formatSuccess({
      loginPwd: "/secret",
      rootDirs: ["password"],
      publicHtmlHints: []
    });
    assert.ok(hidden.indexOf("/secret") < 0);
    assert.ok(hidden.toLowerCase().indexOf("password") < 0);

    var failText = ui.formatFailure({
      error: "ftp_connect_failed",
      userMessage: "FTPに接続できませんでした"
    });
    assert.strictEqual(failText, "エラーコード：ftp_connect_failed\nFTPに接続できませんでした");
    assert.ok(!/loginPwd/.test(failText));
    assert.ok(!/FTP_PASSWORD/.test(ui.formatFailure.toString()));
  });

  console.log("\nPassed " + passed + " site-ftp-probe tests" + (failed ? (" failed=" + failed) : ""));
  if (failed) process.exit(1);
}

run().catch(function (e) {
  console.error(e);
  process.exit(1);
});
