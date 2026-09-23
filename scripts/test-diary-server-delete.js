"use strict";

/**
 * Server-side diary delete tests (no real FTP).
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
var diaryDelete = require(path.join(__dirname, "..", "netlify", "functions", "shared", "diary-delete.js"));
var mutate = require(path.join(__dirname, "..", "netlify", "functions", "shared", "diary-index-mutate.js"));
var ftpClient = require(path.join(__dirname, "..", "netlify", "functions", "shared", "ftp-client.js"));
var permissions = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "permissions.js"));
var authConfig = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "config.js"));
var middleware = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "middleware.js"));
var users = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "users.js"));
var sessions = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "sessions.js"));
var authKv = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "auth-kv.js"));

var SAMPLE_INDEX = [
  "<!DOCTYPE html>",
  "<html><head><meta charset=\"UTF-8\"><title>活動日記</title></head>",
  "<body><div id=\"diary-base\">",
  "<div class=\"year-navi-mobile\"><select></select></div>",
  "<div class=\"diary-box\" id=\"diary-260820\">",
  "<div class=\"diary-date\">2026.08.20</div>",
  "<!-- Smile AI Studio タイトル: 公園で遊びました -->",
  "<div class=\"diary-main\">今日は公園で遊びました。</div>",
  "</div>",
  "<div class=\"diary-box\" id=\"diary-240101\">",
  "<div class=\"diary-date\">2024.01.01</div>",
  "<div class=\"diary-main\">旧記事です。えがお</div>",
  "</div></div></body></html>"
].join("\n");

var ONE_BOX_INDEX = [
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
    path: "/api/diary-delete",
    headers: Object.assign({
      origin: "http://127.0.0.1:8888",
      "content-type": "application/json",
      "user-agent": "diary-delete-test"
    }, opts.headers || {}),
    body: "{}",
    queryStringParameters: {},
    isBase64Encoded: false
  };
}

async function resetAuth() {
  authKv.resetAuthMemoryForTests();
}

async function run() {
  await test("listDiaryArticles reads date/title/excerpt", function () {
    var listed = mutate.listDiaryArticles(SAMPLE_INDEX);
    assert.strictEqual(listed.ok, true);
    assert.strictEqual(listed.count, 2);
    assert.strictEqual(listed.articles[0].id, "diary-260820");
    assert.strictEqual(listed.articles[0].date, "2026.08.20");
    assert.ok(listed.articles[0].title.indexOf("公園") >= 0);
    assert.strictEqual(listed.articles[1].id, "diary-240101");
  });

  await test("removeArticle keeps other diary-box and year-navi", function () {
    var r = mutate.removeArticle(SAMPLE_INDEX, "diary-260820");
    assert.strictEqual(r.ok, true, r.error || r.code);
    assert.ok(r.afterHtml.indexOf("id=\"diary-260820\"") === -1);
    assert.ok(r.afterHtml.indexOf("id=\"diary-240101\"") >= 0);
    assert.ok(r.afterHtml.indexOf("旧記事です") >= 0);
    assert.ok(r.afterHtml.indexOf("year-navi-mobile") >= 0);
    assert.ok(r.afterHtml.indexOf("今日は公園") === -1);
    assert.strictEqual(r.afterCount, 1);
  });

  await test("removeArticle refuses last remaining box", function () {
    var r = mutate.removeArticle(ONE_BOX_INDEX, "diary-240101");
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, "last_article");
  });

  await test("removeArticle refuses missing and invalid ids", function () {
    var missing = mutate.removeArticle(SAMPLE_INDEX, "diary-111111");
    assert.strictEqual(missing.ok, false);
    assert.strictEqual(missing.code, "not_found");
    var bad = mutate.removeArticle(SAMPLE_INDEX, "../index.htm");
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.code, "invalid_diary_id");
  });

  await test("insert still works after remove", function () {
    var removed = mutate.removeArticle(SAMPLE_INDEX, "diary-260820");
    assert.strictEqual(removed.ok, true);
    var inserted = mutate.insertArticle(
      removed.afterHtml,
      "<div class=\"diary-box\" id=\"diary-260901\">new</div>"
    );
    assert.strictEqual(inserted.ok, true);
    assert.ok(inserted.afterHtml.indexOf("id=\"diary-260901\"") >= 0);
    assert.ok(inserted.afterHtml.indexOf("id=\"diary-240101\"") >= 0);
  });

  await test("list + delete via memory FTP", async function () {
    var ftp = ftpClient.createMemoryFtp({ "index.htm": Buffer.from(SAMPLE_INDEX, "utf8") });
    var listed = await diaryDelete.listDiariesOnServer({ ftp: ftp, keepOpen: true });
    assert.strictEqual(listed.ok, true, listed.userMessage || listed.code);
    assert.strictEqual(listed.productionUntouched, true);
    assert.ok(listed.articles.some(function (row) { return row.id === "diary-260820"; }));

    var original = Buffer.from(ftp.files["index.htm"]);
    var r = await diaryDelete.deleteDiaryOnServer({
      userConfirmed: true,
      diaryId: "diary-260820",
      ftp: ftp
    });
    assert.strictEqual(r.ok, true, r.userMessage || r.code);
    assert.strictEqual(r.productionUntouched, false);
    var live = ftp.files["index.htm"].toString("utf8");
    assert.ok(live.indexOf("公園で遊びました") === -1);
    assert.ok(live.indexOf("旧記事です") >= 0);
    assert.ok(ftp.files[diaryPublish.SAFETY_BAK_NAME]);
    assert.strictEqual(Buffer.compare(ftp.files[diaryPublish.SAFETY_BAK_NAME], original), 0);
  });

  await test("delete requires confirm and does not write", async function () {
    var ftp = ftpClient.createMemoryFtp({ "index.htm": Buffer.from(SAMPLE_INDEX, "utf8") });
    var r = await diaryDelete.deleteDiaryOnServer({
      userConfirmed: false,
      diaryId: "diary-260820",
      ftp: ftp
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, "confirm_required");
    assert.strictEqual(ftp.files["index.htm"].toString("utf8"), SAMPLE_INDEX);
  });

  await test("FTP切替失敗時に元indexを復元", async function () {
    var ftp = ftpClient.createMemoryFtp({ "index.htm": Buffer.from(SAMPLE_INDEX, "utf8") });
    var origRename = ftp.rename.bind(ftp);
    ftp.rename = async function (from, to) {
      if (from === diaryPublish.PUBLISHING_NAME) {
        throw new Error("rename failed");
      }
      return origRename(from, to);
    };
    var r = await diaryDelete.deleteDiaryOnServer({
      userConfirmed: true,
      diaryId: "diary-260820",
      ftp: ftp
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.productionUntouched, true);
    assert.strictEqual(ftp.files["index.htm"].toString("utf8"), SAMPLE_INDEX);
  });

  await test("owner以外拒否 / CSRF拒否", async function () {
    process.env.AUTH_ENVIRONMENT = "production";
    process.env.AUTH_ENFORCEMENT_MODE = "off";
    process.env.AUTH_ALLOWED_ORIGINS = "http://127.0.0.1:8888";
    process.env.AUTH_RP_ID = "localhost";
    await resetAuth();

    var noSession = await middleware.enforceAccess(fakeEvent(), {
      permissionKey: "api-diary-delete:POST"
    });
    assert.strictEqual(noSession.ok, false);
    assert.strictEqual(noSession.response.statusCode, 401);

    var staffUser = await users.createUser({ email: "staff-diary-del@example.com", role: "staff", status: "active" });
    var staff = await sessions.createSession(staffUser.user, { purpose: "full", deviceName: "S" });
    var staffDenied = await middleware.enforceAccess(fakeEvent({
      headers: {
        cookie: authConfig.COOKIE_SESSION + "=" + encodeURIComponent(staff.rawId) + "; " +
          authConfig.COOKIE_CSRF + "=" + encodeURIComponent(staff.session.csrfToken),
        "x-csrf-token": staff.session.csrfToken
      }
    }), { permissionKey: "api-diary-delete:POST" });
    assert.strictEqual(staffDenied.ok, false);
    assert.strictEqual(staffDenied.response.statusCode, 403);

    await resetAuth();
    var ownerUser = await users.createUser({ email: "owner-diary-del@example.com", role: "owner", status: "active" });
    var owner = await sessions.createSession(ownerUser.user, { purpose: "full", deviceName: "O" });
    var badCsrf = await middleware.enforceAccess(fakeEvent({
      headers: {
        cookie: authConfig.COOKIE_SESSION + "=" + encodeURIComponent(owner.rawId) + "; " +
          authConfig.COOKIE_CSRF + "=" + encodeURIComponent(owner.session.csrfToken),
        "x-csrf-token": "wrong"
      }
    }), { permissionKey: "api-diary-delete:POST" });
    assert.strictEqual(badCsrf.ok, false);
    assert.strictEqual(badCsrf.response.statusCode, 403);

    process.env.AUTH_ENVIRONMENT = "local";
    process.env.AUTH_ENFORCEMENT_MODE = "enforce";
  });

  await test("permission is owner-only and production-only", function () {
    var perm = permissions.resolvePermission("api-diary-delete:POST");
    assert.ok(perm);
    assert.deepStrictEqual(perm.roles, ["owner"]);
    assert.strictEqual(authConfig.isAlwaysEnforcedPermission("api-diary-delete:POST"), true);
    assert.strictEqual(authConfig.isProductionOnlyPermission("api-diary-delete:POST"), true);
  });

  await test("no FTP secrets in browser sources / delete uses diary FTP only", function () {
    var simple = fs.readFileSync(path.join(__dirname, "..", "js", "smile-simple-diary-delete.js"), "utf8");
    var api = fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "api-diary-delete.js"), "utf8");
    var shared = fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "shared", "diary-delete.js"), "utf8");
    assert.ok(!/FTP_PASSWORD\s*=\s*['"]/.test(simple));
    assert.ok(!/FTP_PASSWORD\s*=\s*['"]/.test(api));
    assert.ok(/connectFromEnv\(\)/.test(api));
    assert.ok(!/connectSiteFromEnv/.test(api + shared));
    assert.ok(!/SITE_FTP_USER/.test(api + shared));
    assert.ok(!/SITE_FTP_PASSWORD/.test(api + shared));
    assert.ok(/api-diary-delete/.test(simple));
    assert.ok(/userConfirmed/.test(simple));
  });

  await test("UI has owner-only delete confirm flow", function () {
    var html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    var script = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
    assert.ok(/simple-diary-delete-modal/.test(html));
    assert.ok(/btn-home-delete-diary/.test(html));
    assert.ok(/公開した日記を消す/.test(html));
    assert.ok(/btn-simple-diary-delete-yes/.test(html));
    assert.ok(/SmileSimpleDiaryDelete/.test(script));
    assert.ok(/userConfirmed/.test(script));
    assert.ok(/オーナーだけが公開日記を消せます/.test(script));
    assert.ok(/元のホームページは変更されていません/.test(script));
  });

  await test("publish path is unchanged and still owner-only", function () {
    var perm = permissions.resolvePermission("api-diary-publish:POST");
    assert.ok(perm);
    assert.deepStrictEqual(perm.roles, ["owner"]);
    assert.strictEqual(authConfig.isAlwaysEnforcedPermission("api-diary-publish:POST"), true);
    var api = fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "api-diary-publish.js"), "utf8");
    assert.ok(/connectFromEnv\(\)/.test(api));
    assert.ok(!/api-diary-delete/.test(api));
  });

  console.log("\nPassed " + passed + " diary-server-delete tests" + (failed ? (" failed=" + failed) : ""));
  if (failed) process.exit(1);
}

run().catch(function (e) {
  console.error(e);
  process.exit(1);
});
