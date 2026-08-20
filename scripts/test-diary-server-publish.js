"use strict";

/**
 * Server-side diary publish tests (no real FTP).
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

var diaryPublish = require(path.join(__dirname, "..", "netlify", "functions", "shared", "diary-publish.js"));
var mutate = require(path.join(__dirname, "..", "netlify", "functions", "shared", "diary-index-mutate.js"));
var ftpClient = require(path.join(__dirname, "..", "netlify", "functions", "shared", "ftp-client.js"));
var permissions = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "permissions.js"));
var authConfig = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "config.js"));
var middleware = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "middleware.js"));
var users = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "users.js"));
var sessions = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "sessions.js"));
var authKv = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "auth-kv.js"));

var PNG_1X1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

var SAMPLE_INDEX = [
  "<!DOCTYPE html>",
  "<html><head><meta charset=\"UTF-8\"><title>活動日記</title></head>",
  "<body><div id=\"diary-base\">",
  "<div class=\"year-navi-mobile\"><select></select></div>",
  "<div class=\"diary-box\" id=\"diary-240101\">",
  "<div class=\"diary-date\">2024.01.01</div>",
  "<div class=\"diary-main\">旧記事です。えがお</div>",
  "</div></div></body></html>"
].join("\n");

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
    path: "/api/diary-publish",
    headers: Object.assign({
      origin: "http://127.0.0.1:8888",
      "content-type": "application/json",
      "user-agent": "diary-test"
    }, opts.headers || {}),
    body: "{}",
    queryStringParameters: {},
    isBase64Encoded: false
  };
}

async function resetAuth() {
  authKv.resetAuthMemoryForTests();
}

function entry() {
  return {
    id: "job_test_1",
    title: "公園で遊びました",
    content: "今日は公園で遊びました。",
    publishDate: "2026-08-20"
  };
}

async function run() {
  await test("Production client path does not fetch localhost index", async function () {
    var src = fs.readFileSync(path.join(__dirname, "..", "js", "smile-simple-diary-publish.js"), "utf8");
    assert.ok(/runServerPublish/.test(src));
    assert.ok(/api-diary-publish/.test(src));
    assert.ok(/note\("branch_server"\)/.test(src));
    assert.ok(src.indexOf("note(\"branch_server\")") < src.indexOf("var indexPromise"));
    assert.ok(src.indexOf("CorporateSite/diary") === -1);

    var vm = require("vm");
    var loadIndexCalled = false;
    var fetchUrls = [];
    var sandbox = {
      location: { hostname: "studio.egaonokiroku.co.jp" },
      fetch: function (url) {
        fetchUrls.push(String(url));
        return Promise.resolve({
          json: function () {
            return Promise.resolve({
              ok: true,
              userMessage: "日記を公開しました",
              pageUrl: "https://www.egaonokiroku.co.jp/diary/index.htm"
            });
          }
        });
      },
      Date: Date,
      Array: Array,
      JSON: JSON,
      Promise: Promise,
      Object: Object,
      String: String,
      Error: Error,
      Number: Number,
      Boolean: Boolean,
      Math: Math,
      parseInt: parseInt,
      isNaN: isNaN,
      console: console
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    vm.runInNewContext(src, sandbox);
    var r = await sandbox.SmileSimpleDiaryPublish.runOneButtonPublish({
      entry: { id: "job_1", title: "t", content: "本文です", publishDate: "2026-08-20" },
      memoryItems: [],
      userConfirmed: true,
      csrfToken: "test-csrf",
      loadIndex: function () {
        loadIndexCalled = true;
        return Promise.reject(new Error("should not load index on production"));
      }
    });
    assert.strictEqual(loadIndexCalled, false, "loadIndex must not run on production");
    assert.strictEqual(r.ok, true, r.message || r.code);
    assert.ok(fetchUrls.length >= 1);
    fetchUrls.forEach(function (u) {
      assert.ok(u.indexOf("localhost") === -1, u);
      assert.ok(u.indexOf("127.0.0.1") === -1, u);
      assert.ok(u.indexOf("CorporateSite") === -1, u);
      assert.ok(u.indexOf("api-diary-publish") >= 0, u);
    });
  });

  await test("insertArticle keeps existing diary-box", function () {
    var article = "<div class=\"diary-box\" id=\"diary-260820\">new</div>";
    var r = mutate.insertArticle(SAMPLE_INDEX, article);
    assert.strictEqual(r.ok, true);
    assert.ok(r.afterHtml.indexOf("id=\"diary-260820\"") >= 0);
    assert.ok(r.afterHtml.indexOf("id=\"diary-240101\"") >= 0);
    assert.ok(r.afterHtml.indexOf("旧記事です") >= 0);
  });

  await test("index取得成功mock + FTP成功mock (no images)", async function () {
    var ftp = ftpClient.createMemoryFtp({ "index.htm": Buffer.from(SAMPLE_INDEX, "utf8") });
    var original = Buffer.from(ftp.files["index.htm"]);
    var r = await diaryPublish.publishDiaryOnServer({
      userConfirmed: true,
      entry: entry(),
      images: [],
      ftp: ftp
    });
    assert.strictEqual(r.ok, true, r.userMessage || r.code);
    assert.strictEqual(r.productionUntouched, false);
    var live = ftp.files["index.htm"].toString("utf8");
    assert.ok(live.indexOf("公園で遊びました") >= 0);
    assert.ok(live.indexOf("旧記事です") >= 0);
    assert.ok(ftp.files[diaryPublish.SAFETY_BAK_NAME]);
    assert.strictEqual(Buffer.compare(ftp.files[diaryPublish.SAFETY_BAK_NAME], original), 0);
  });

  await test("FTP失敗時に元index保持", async function () {
    var ftp = ftpClient.createMemoryFtp({ "index.htm": Buffer.from(SAMPLE_INDEX, "utf8") });
    var origStor = ftp.stor.bind(ftp);
    ftp.stor = async function (name, buf) {
      if (name === diaryPublish.PUBLISHING_NAME) {
        throw new Error("STOR failed");
      }
      return origStor(name, buf);
    };
    var r = await diaryPublish.publishDiaryOnServer({
      userConfirmed: true,
      entry: entry(),
      images: [],
      ftp: ftp
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.productionUntouched, true);
    assert.strictEqual(ftp.files["index.htm"].toString("utf8"), SAMPLE_INDEX);
  });

  await test("FTP切替失敗時に元indexを復元", async function () {
    var ftp = ftpClient.createMemoryFtp({ "index.htm": Buffer.from(SAMPLE_INDEX, "utf8") });
    var origRename = ftp.rename.bind(ftp);
    ftp.rename = async function (from, to) {
      if (from === diaryPublish.PUBLISHING_NAME && to === "index.htm") {
        throw new Error("final rename failed");
      }
      return origRename(from, to);
    };
    var r = await diaryPublish.publishDiaryOnServer({
      userConfirmed: true,
      entry: entry(),
      images: [],
      ftp: ftp
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.productionUntouched, true);
    assert.ok(ftp.files["index.htm"], "live index must exist after restore");
    assert.strictEqual(ftp.files["index.htm"].toString("utf8"), SAMPLE_INDEX);
  });

  await test("画像あり mock", async function () {
    var ftp = ftpClient.createMemoryFtp({ "index.htm": Buffer.from(SAMPLE_INDEX, "utf8") });
    var r = await diaryPublish.publishDiaryOnServer({
      userConfirmed: true,
      entry: entry(),
      images: [{ dataUrl: PNG_1X1, caption: "写真", order: 0 }],
      ftp: ftp
    });
    assert.strictEqual(r.ok, true, r.userMessage || r.code);
    assert.strictEqual(r.imageCount, 1);
    var names = Object.keys(ftp.files);
    assert.ok(names.some(function (n) { return /^image\/260820-1\.jpg$/.test(n); }), names.join(","));
    var live = ftp.files["index.htm"].toString("utf8");
    assert.ok(live.indexOf("image/260820-1.jpg") >= 0);
  });

  await test("画像なし mock", async function () {
    var ftp = ftpClient.createMemoryFtp({ "index.htm": Buffer.from(SAMPLE_INDEX, "utf8") });
    var r = await diaryPublish.publishDiaryOnServer({
      userConfirmed: true,
      entry: entry(),
      images: [],
      ftp: ftp
    });
    assert.strictEqual(r.ok, true, r.userMessage || r.code);
    assert.strictEqual(r.imageCount, 0);
    assert.ok(!Object.keys(ftp.files).some(function (n) { return n.indexOf("image/") === 0; }));
  });

  await test("confirm required without userConfirmed", async function () {
    var ftp = ftpClient.createMemoryFtp({ "index.htm": Buffer.from(SAMPLE_INDEX, "utf8") });
    var r = await diaryPublish.publishDiaryOnServer({
      userConfirmed: false,
      entry: entry(),
      ftp: ftp
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, "confirm_required");
    assert.strictEqual(ftp.files["index.htm"].toString("utf8"), SAMPLE_INDEX);
  });

  await test("owner以外拒否 / CSRF拒否", async function () {
    process.env.AUTH_ENVIRONMENT = "production";
    process.env.AUTH_ENFORCEMENT_MODE = "off";
    process.env.AUTH_ALLOWED_ORIGINS = "http://127.0.0.1:8888";
    process.env.AUTH_RP_ID = "localhost";
    await resetAuth();

    var noSession = await middleware.enforceAccess(fakeEvent(), {
      permissionKey: "api-diary-publish:POST"
    });
    assert.strictEqual(noSession.ok, false);
    assert.strictEqual(noSession.response.statusCode, 401);

    var staffUser = await users.createUser({ email: "staff-diary@example.com", role: "staff", status: "active" });
    var staff = await sessions.createSession(staffUser.user, { purpose: "full", deviceName: "S" });
    var staffDenied = await middleware.enforceAccess(fakeEvent({
      headers: {
        cookie: authConfig.COOKIE_SESSION + "=" + encodeURIComponent(staff.rawId) + "; " +
          authConfig.COOKIE_CSRF + "=" + encodeURIComponent(staff.session.csrfToken),
        "x-csrf-token": staff.session.csrfToken
      }
    }), { permissionKey: "api-diary-publish:POST" });
    assert.strictEqual(staffDenied.ok, false);
    assert.strictEqual(staffDenied.response.statusCode, 403);

    await resetAuth();
    var ownerUser = await users.createUser({ email: "owner-diary@example.com", role: "owner", status: "active" });
    var owner = await sessions.createSession(ownerUser.user, { purpose: "full", deviceName: "O" });
    var badCsrf = await middleware.enforceAccess(fakeEvent({
      headers: {
        cookie: authConfig.COOKIE_SESSION + "=" + encodeURIComponent(owner.rawId) + "; " +
          authConfig.COOKIE_CSRF + "=" + encodeURIComponent(owner.session.csrfToken),
        "x-csrf-token": "wrong"
      }
    }), { permissionKey: "api-diary-publish:POST" });
    assert.strictEqual(badCsrf.ok, false);
    assert.strictEqual(badCsrf.response.statusCode, 403);

    process.env.AUTH_ENVIRONMENT = "local";
    process.env.AUTH_ENFORCEMENT_MODE = "enforce";
  });

  await test("permission is owner-only and production-only", function () {
    var perm = permissions.resolvePermission("api-diary-publish:POST");
    assert.ok(perm);
    assert.deepStrictEqual(perm.roles, ["owner"]);
    assert.strictEqual(authConfig.isAlwaysEnforcedPermission("api-diary-publish:POST"), true);
    assert.strictEqual(authConfig.isProductionOnlyPermission("api-diary-publish:POST"), true);
  });

  await test("no FTP secrets in browser sources", function () {
    var simple = fs.readFileSync(path.join(__dirname, "..", "js", "smile-simple-diary-publish.js"), "utf8");
    var api = fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "api-diary-publish.js"), "utf8");
    assert.ok(!/FTP_PASSWORD\s*=\s*['"]/.test(simple));
    assert.ok(!/FTP_PASSWORD\s*=\s*['"]/.test(api));
  });

  console.log("\nPassed " + passed + " diary-server-publish tests" + (failed ? (" failed=" + failed) : ""));
  if (failed) process.exit(1);
}

run().catch(function (e) {
  console.error(e);
  process.exit(1);
});
