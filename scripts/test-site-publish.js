"use strict";

/**
 * Homepage production publish after merged PR (no real FTP).
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

var sitePublish = require(path.join(__dirname, "..", "netlify", "functions", "shared", "site-publish.js"));
var ftpClient = require(path.join(__dirname, "..", "netlify", "functions", "shared", "ftp-client.js"));
var github = require(path.join(__dirname, "..", "netlify", "functions", "shared", "github-issues.js"));
var DevJobs = require(path.join(__dirname, "..", "js", "smile-dev-jobs.js"));
var permissions = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "permissions.js"));
var authConfig = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "config.js"));
var middleware = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "middleware.js"));
var users = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "users.js"));
var sessions = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "sessions.js"));
var authKv = require(path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "auth-kv.js"));

var OLD_INDEX = "<html>old-index</html>";
var NEW_INDEX = "<html>new-index</html>";
var OLD_CSS = "body{color:#111}";
var NEW_CSS = "body{color:#c00}";

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
    path: "/api/site-publish",
    headers: Object.assign({
      origin: "http://127.0.0.1:8888",
      "content-type": "application/json",
      "user-agent": "site-publish-test"
    }, opts.headers || {}),
    body: "{}",
    queryStringParameters: {},
    isBase64Encoded: false
  };
}

async function run() {
  await test("path traversal and non-allowlisted files are rejected", function () {
    assert.strictEqual(sitePublish.mapAllowedRepoPath("../etc/passwd"), null);
    assert.strictEqual(sitePublish.mapAllowedRepoPath("/CorporateSite/index.htm"), null);
    assert.strictEqual(sitePublish.mapAllowedRepoPath("CorporateSite/../index.htm"), null);
    assert.strictEqual(sitePublish.mapAllowedRepoPath("CorporateSite/diary/diary/index.htm"), null);
    var mapped = sitePublish.filterAllowedFiles([
      "CorporateSite/index.htm",
      "CorporateSite/css/top-diary-notice.css",
      "secret.env",
      "../x"
    ]);
    assert.strictEqual(mapped.length, 2);
    assert.strictEqual(mapped[0].remotePath, "index.htm");
    assert.strictEqual(mapped[1].remotePath, "css/top-diary-notice.css");
  });

  await test("PR merge後にStudio表示が本番へ反映できますへ変わる", function () {
    var job = DevJobs.buildHomepageEditTask("お知らせを追加");
    DevJobs.upsert(job);
    DevJobs.applyExternalUpdate(job, {
      githubPrNumber: 7,
      githubPrUrl: "https://github.com/example/repo/pull/7",
      prMerged: false,
      status: "waiting_for_review",
      agentStatus: "READY_FOR_REVIEW"
    });
    var unmerged = DevJobs.getById(job.id);
    assert.strictEqual(DevJobs.studioProgressMessage(unmerged), "確認してください");
    assert.strictEqual(DevJobs.canPublishToProduction(unmerged), false);
    assert.ok(!/本番へ反映する/.test(DevJobs.renderProgressHtml(unmerged)));

    DevJobs.applyExternalUpdate(unmerged, {
      githubPrNumber: 7,
      prMerged: true,
      status: "ready_for_publish",
      changedFiles: ["CorporateSite/index.htm", "CorporateSite/css/top-diary-notice.css"]
    });
    var merged = DevJobs.getById(job.id);
    assert.strictEqual(merged.status, "ready_for_publish");
    assert.strictEqual(DevJobs.studioProgressMessage(merged), "変更案は承認済みです。本番へ反映できます");
    assert.strictEqual(DevJobs.canPublishToProduction(merged), true);
    assert.ok(/本番へ反映する/.test(DevJobs.renderProgressHtml(merged)));
  });

  await test("未merge PRでは公開ボタンが出ない", function () {
    var job = DevJobs.buildHomepageEditTask("別の依頼");
    job.githubPrNumber = 99;
    job.prMerged = false;
    job.status = "waiting_for_review";
    DevJobs.upsert(job);
    assert.strictEqual(DevJobs.canPublishToProduction(job), false);
    assert.ok(!/btn-hp-site-publish/.test(DevJobs.renderProgressHtml(job)));
  });

  await test("明示確認なしは拒否 / 2ファイル公開成功mock", async function () {
    var ftp = ftpClient.createMemoryFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "css/top-diary-notice.css": Buffer.from(OLD_CSS)
    });
    var denied = await sitePublish.publishSiteFiles({
      userConfirmed: false,
      ftp: ftp,
      files: [
        { repoPath: "CorporateSite/index.htm", buffer: Buffer.from(NEW_INDEX) }
      ]
    });
    assert.strictEqual(denied.ok, false);
    assert.strictEqual(denied.code, "confirm_required");
    assert.strictEqual(ftp.files["index.htm"].toString(), OLD_INDEX);

    var ftp2 = ftpClient.createMemoryFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "css/top-diary-notice.css": Buffer.from(OLD_CSS)
    });
    var ok = await sitePublish.publishSiteFiles({
      userConfirmed: true,
      ftp: ftp2,
      files: [
        { repoPath: "CorporateSite/index.htm", buffer: Buffer.from(NEW_INDEX) },
        { repoPath: "CorporateSite/css/top-diary-notice.css", buffer: Buffer.from(NEW_CSS) },
        { repoPath: "secret.env", buffer: Buffer.from("nope") }
      ]
    });
    assert.strictEqual(ok.ok, true, ok.userMessage || ok.code);
    assert.strictEqual(ftp2.files["index.htm"].toString(), NEW_INDEX);
    assert.strictEqual(ftp2.files["css/top-diary-notice.css"].toString(), NEW_CSS);
    assert.ok(!ftp2.files["secret.env"]);
    assert.deepStrictEqual(ok.publishedFiles, ["index.htm", "css/top-diary-notice.css"]);
  });

  await test("2ファイル目失敗時に元状態を復元", async function () {
    var ftp = ftpClient.createMemoryFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "css/top-diary-notice.css": Buffer.from(OLD_CSS)
    });
    var origStor = ftp.stor.bind(ftp);
    ftp.stor = async function (name, buf) {
      if (name === "css/top-diary-notice.css" + sitePublish.PUBLISHING_SUFFIX) {
        throw new Error("STOR failed");
      }
      return origStor(name, buf);
    };
    var r = await sitePublish.publishSiteFiles({
      userConfirmed: true,
      ftp: ftp,
      files: [
        { repoPath: "CorporateSite/index.htm", buffer: Buffer.from(NEW_INDEX) },
        { repoPath: "CorporateSite/css/top-diary-notice.css", buffer: Buffer.from(NEW_CSS) }
      ]
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.productionUntouched, true);
    assert.strictEqual(ftp.files["index.htm"].toString(), OLD_INDEX);
    assert.strictEqual(ftp.files["css/top-diary-notice.css"].toString(), OLD_CSS);
  });

  await test("owner以外拒否 / CSRF拒否", async function () {
    process.env.AUTH_ENVIRONMENT = "production";
    process.env.AUTH_ENFORCEMENT_MODE = "off";
    process.env.AUTH_ALLOWED_ORIGINS = "http://127.0.0.1:8888";
    process.env.AUTH_RP_ID = "localhost";
    authKv.resetAuthMemoryForTests();

    var noSession = await middleware.enforceAccess(fakeEvent(), {
      permissionKey: "api-site-publish:POST"
    });
    assert.strictEqual(noSession.ok, false);
    assert.strictEqual(noSession.response.statusCode, 401);

    var staffUser = await users.createUser({ email: "staff-site@example.com", role: "staff", status: "active" });
    var staff = await sessions.createSession(staffUser.user, { purpose: "full", deviceName: "S" });
    var staffDenied = await middleware.enforceAccess(fakeEvent({
      headers: {
        cookie: authConfig.COOKIE_SESSION + "=" + encodeURIComponent(staff.rawId) + "; " +
          authConfig.COOKIE_CSRF + "=" + encodeURIComponent(staff.session.csrfToken),
        "x-csrf-token": staff.session.csrfToken
      }
    }), { permissionKey: "api-site-publish:POST" });
    assert.strictEqual(staffDenied.ok, false);
    assert.strictEqual(staffDenied.response.statusCode, 403);

    authKv.resetAuthMemoryForTests();
    var ownerUser = await users.createUser({ email: "owner-site@example.com", role: "owner", status: "active" });
    var owner = await sessions.createSession(ownerUser.user, { purpose: "full", deviceName: "O" });
    var badCsrf = await middleware.enforceAccess(fakeEvent({
      headers: {
        cookie: authConfig.COOKIE_SESSION + "=" + encodeURIComponent(owner.rawId) + "; " +
          authConfig.COOKIE_CSRF + "=" + encodeURIComponent(owner.session.csrfToken),
        "x-csrf-token": "wrong"
      }
    }), { permissionKey: "api-site-publish:POST" });
    assert.strictEqual(badCsrf.ok, false);
    assert.strictEqual(badCsrf.response.statusCode, 403);

    process.env.AUTH_ENVIRONMENT = "local";
    process.env.AUTH_ENFORCEMENT_MODE = "enforce";
  });

  await test("permission is owner-only and production-only", function () {
    var perm = permissions.resolvePermission("api-site-publish:POST");
    assert.ok(perm);
    assert.deepStrictEqual(perm.roles, ["owner"]);
    assert.strictEqual(authConfig.isAlwaysEnforcedPermission("api-site-publish:POST"), true);
    assert.strictEqual(authConfig.isProductionOnlyPermission("api-site-publish:POST"), true);
  });

  await test("本番公開を勝手に実行しない", function () {
    var script = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
    var html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    var start = script.indexOf("function submitHpEditRequest(");
    var end = script.indexOf("\n  onClick(\"simple-diary-close\"");
    var submitFn = script.slice(start, end);
    assert.ok(!/api-site-publish/.test(submitFn));
    assert.ok(/showHpPublishConfirm/.test(script));
    assert.ok(/publishHpEditToSite/.test(script));
    assert.ok(/公式サイトへ本番反映します/.test(html));
    assert.ok(script.indexOf("function showHpPublishConfirm") < script.indexOf("function publishHpEditToSite"));
    var confirmStart = script.indexOf("function showHpPublishConfirm");
    var confirmEnd = script.indexOf("function publishHpEditToSite");
    var confirmFn = script.slice(confirmStart, confirmEnd);
    assert.ok(!/fetch\(/.test(confirmFn), "first click must not FTP");
    assert.ok(/userConfirmed: true/.test(script));
  });

  await test("merged PR sync becomes ready_for_publish", async function () {
    var origFetch = global.fetch;
    process.env.GITHUB_TOKEN = "test-token-not-real";
    process.env.GITHUB_OWNER = "egao";
    process.env.GITHUB_REPO = "SmileAIStudio";
    global.fetch = async function (url) {
      var u = String(url);
      if (u.indexOf("/pulls/7/files") >= 0) {
        return {
          ok: true,
          status: 200,
          text: async function () {
            return JSON.stringify([
              { filename: "CorporateSite/index.htm" },
              { filename: "CorporateSite/css/top-diary-notice.css" },
              { filename: "README.md" }
            ]);
          }
        };
      }
      if (u.indexOf("/pulls/7") >= 0) {
        return {
          ok: true,
          status: 200,
          text: async function () {
            return JSON.stringify({
              number: 7,
              merged: true,
              merged_at: "2026-08-20T00:00:00Z",
              html_url: "https://github.com/egao/SmileAIStudio/pull/7",
              base: { ref: "main" },
              merge_commit_sha: "abc123",
              head: { sha: "def456" }
            });
          }
        };
      }
      return {
        ok: true,
        status: 200,
        text: async function () {
          return JSON.stringify({
            number: 12,
            html_url: "https://github.com/egao/SmileAIStudio/issues/12",
            title: "HP",
            state: "open",
            body: "## Job Kind\nhomepage-edit\n\n## Pull Request\n#7\n\n## Agent Status\nREADY_FOR_REVIEW\n"
          });
        }
      };
    };
    try {
      var r = await github.syncIssueState(12);
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.sync.prMerged, true);
      assert.strictEqual(r.sync.status, "ready_for_publish");
      assert.strictEqual(r.sync.githubPrNumber, 7);
    } finally {
      global.fetch = origFetch;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_OWNER;
      delete process.env.GITHUB_REPO;
    }
  });

  console.log("\nPassed " + passed + " site-publish tests" + (failed ? (" failed=" + failed) : ""));
  if (failed) process.exit(1);
}

run().catch(function (e) {
  console.error(e);
  process.exit(1);
});
