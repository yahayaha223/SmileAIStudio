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
var siteFtpPaths = require(path.join(__dirname, "..", "netlify", "functions", "shared", "site-ftp-paths.js"));
var ftpClient = require(path.join(__dirname, "..", "netlify", "functions", "shared", "ftp-client.js"));
var github = require(path.join(__dirname, "..", "netlify", "functions", "shared", "github-issues.js"));
var sitePublishLog = require(path.join(__dirname, "..", "netlify", "functions", "shared", "site-publish-log.js"));
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

function homepageFtp(initialFiles) {
  var ftp = ftpClient.createMemoryFtp(initialFiles);
  ftp.cwd = "/public_html";
  return ftp;
}

function loginRootFtp(initialFiles) {
  var ftp = ftpClient.createMemoryFtp(initialFiles);
  ftp.cwd = "/";
  ftp.rejectCdSlash = true;
  ftp.listEntries = async function (dir) {
    if (dir === "." || dir === "/") {
      return [
        { name: "image", type: 2 },
        { name: "css", type: 2 },
        { name: "diary", type: 2 },
        { name: "index.htm", type: 1 }
      ];
    }
    return [];
  };
  return ftp;
}

function xserverFtp(initialFiles) {
  var ftp = ftpClient.createMemoryFtp(initialFiles);
  ftp.cwd = "/";
  var existing = {
    "/": true,
    "/egaonokiroku.co.jp": true,
    "/egaonokiroku.co.jp/public_html": true,
    "/egaonokiroku.co.jp/public_html/css": true,
    "/egaonokiroku.co.jp/public_html/diary": true
  };
  ftp.resolveCd = async function (target) {
    if (target === "/public_html" || !existing[target]) {
      var err = new Error("550");
      err.code = 550;
      throw err;
    }
  };
  return ftp;
}

async function run() {
  process.env.SITE_FTP_REMOTE_DIR = "/public_html";
  process.env.SITE_FTP_CWD = "/egaonokiroku.co.jp/public_html";
  process.env.SITE_FTP_HOST = "site.example.com";
  process.env.SITE_FTP_USER = "site-ftp-user";
  process.env.SITE_FTP_PASSWORD = "site-ftp-password";
  process.env.FTP_HOST = "diary.example.com";
  process.env.FTP_USER = "diary-ftp-user";
  process.env.FTP_PASSWORD = "diary-ftp-password";
  process.env.FTP_REMOTE_DIR = "/public_html/diary";

  await test("CorporateSite/index.htm → /public_html/index.htm", function () {
    var one = siteFtpPaths.resolveOneTarget("CorporateSite/index.htm", "/public_html");
    assert.strictEqual(one.ok, true);
    assert.strictEqual(one.absolutePath, "/public_html/index.htm");
    assert.strictEqual(one.remotePath, "index.htm");
  });

  await test("CorporateSite/css/top-diary-notice.css → /public_html/css/top-diary-notice.css", function () {
    var one = siteFtpPaths.resolveOneTarget("CorporateSite/css/top-diary-notice.css", "/public_html");
    assert.strictEqual(one.ok, true);
    assert.strictEqual(one.absolutePath, "/public_html/css/top-diary-notice.css");
  });

  await test("事故再現: CorporateSite/index.htm を /public_html/diary/index.htm へ書かない", function () {
    var bad = siteFtpPaths.resolveOneTarget("CorporateSite/index.htm", "/public_html/diary");
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.code, "homepage_must_not_write_diary");
    assert.strictEqual(bad.finalFtpPath, "/public_html/diary/index.htm");

    var plan = siteFtpPaths.resolvePublishPlan(
      ["CorporateSite/index.htm", "CorporateSite/css/top-diary-notice.css"],
      "/public_html/diary"
    );
    assert.strictEqual(plan.ok, false);
    assert.ok(plan.code === "site_root_must_not_be_diary" || plan.code === "homepage_must_not_write_diary");
  });

  await test("事故再現: 日記用 FTP_REMOTE_DIR をホームページ公開で再利用しない", function () {
    var prevSite = process.env.SITE_FTP_REMOTE_DIR;
    var prevCwd = process.env.SITE_FTP_CWD;
    var prevAlias = process.env.FTP_SITE_REMOTE_DIR;
    delete process.env.SITE_FTP_REMOTE_DIR;
    delete process.env.SITE_FTP_CWD;
    delete process.env.FTP_SITE_REMOTE_DIR;
    process.env.FTP_REMOTE_DIR = "/public_html/diary";
    try {
      var siteCfg = ftpClient.getSiteFtpConfig();
      var diaryCfg = ftpClient.getFtpConfig();
      assert.strictEqual(diaryCfg.remoteDir, "/public_html/diary");
      assert.notStrictEqual(siteCfg.remoteDir, diaryCfg.remoteDir);
      assert.strictEqual(siteCfg.remoteDir, "");
      assert.strictEqual(ftpClient.isSiteConfigured({
        host: "ftp.example.com",
        user: "u",
        password: "p",
        remoteDir: siteCfg.remoteDir
      }), false);
      assert.strictEqual(ftpClient.isConfigured({
        host: "ftp.example.com",
        user: "u",
        password: "p",
        remoteDir: diaryCfg.remoteDir
      }), true);
    } finally {
      process.env.SITE_FTP_REMOTE_DIR = prevSite;
      process.env.SITE_FTP_CWD = prevCwd;
      if (prevAlias) process.env.FTP_SITE_REMOTE_DIR = prevAlias;
      else delete process.env.FTP_SITE_REMOTE_DIR;
      process.env.FTP_REMOTE_DIR = "/public_html/diary";
    }
  });

  await test("日記公開は /public_html/diary/index.htm のままであること", function () {
    var diarySrc = fs.readFileSync(
      path.join(__dirname, "..", "netlify", "functions", "shared", "diary-publish.js"),
      "utf8"
    );
    var diaryApi = fs.readFileSync(
      path.join(__dirname, "..", "netlify", "functions", "api-diary-publish.js"),
      "utf8"
    );
    var ftpSrc = fs.readFileSync(
      path.join(__dirname, "..", "netlify", "functions", "shared", "ftp-client.js"),
      "utf8"
    );
    var siteFn = ftpSrc.slice(
      ftpSrc.indexOf("function getSiteFtpConfig"),
      ftpSrc.indexOf("function isSiteConfigured")
    );
    var diaryFn = ftpSrc.slice(
      ftpSrc.indexOf("function getFtpConfig"),
      ftpSrc.indexOf("function isConfigured")
    );
    assert.ok(/var INDEX_NAME = "index.htm"/.test(diarySrc));
    assert.ok(/connectFromEnv\(\)/.test(diaryApi));
    assert.ok(!/connectSiteFromEnv/.test(diaryApi));
    assert.ok(!/connectSiteFromEnv/.test(diarySrc));
    assert.ok(!/SITE_FTP_USER/.test(diarySrc));
    assert.ok(!/SITE_FTP_PASSWORD/.test(diarySrc));
    assert.ok(!/SITE_FTP_USER/.test(diaryApi));
    assert.ok(!/SITE_FTP_PASSWORD/.test(diaryApi));
    assert.ok(/remoteDir:\s*env\.getEnv\("FTP_REMOTE_DIR"\)/.test(ftpSrc));
    assert.ok(/SITE_FTP_USER/.test(siteFn));
    assert.ok(/SITE_FTP_PASSWORD/.test(siteFn));
    assert.ok(/SITE_FTP_HOST/.test(siteFn));
    assert.ok(/readConfiguredSiteCwd\(\)/.test(siteFn));
    assert.ok(!/getFtpConfig\(/.test(siteFn));
    assert.ok(!/env\.getEnv\("FTP_USER"\)/.test(siteFn));
    assert.ok(!/env\.getEnv\("FTP_PASSWORD"\)/.test(siteFn));
    assert.ok(!/env\.getEnv\("FTP_HOST"\)/.test(siteFn));
    assert.ok(/env\.getEnv\("FTP_USER"\)/.test(diaryFn) || /FTP_USER/.test(diaryFn));
    assert.ok(/env\.getEnv\("FTP_PASSWORD"\)/.test(diaryFn));
    assert.ok(!/SITE_FTP_USER/.test(diaryFn));
    assert.ok(!/SITE_FTP_PASSWORD/.test(diaryFn));
    var diaryCfg = ftpClient.getFtpConfig();
    var siteCfg = ftpClient.getSiteFtpConfig();
    assert.strictEqual(diaryCfg.remoteDir, "/public_html/diary");
    assert.strictEqual(siteCfg.remoteDir, "/egaonokiroku.co.jp/public_html");
    assert.notStrictEqual(siteCfg.remoteDir, diaryCfg.remoteDir);
    assert.notStrictEqual(siteCfg.user, diaryCfg.user);
    assert.notStrictEqual(siteCfg.password, diaryCfg.password);
    assert.notStrictEqual(siteCfg.host, diaryCfg.host);
    assert.strictEqual(siteFtpPaths.readConfiguredSiteRoot(), "/public_html");
  });

  await test("path traversal and non-allowlisted files are rejected", function () {
    assert.strictEqual(sitePublish.mapAllowedRepoPath("../etc/passwd"), null);
    assert.strictEqual(sitePublish.mapAllowedRepoPath("/CorporateSite/index.htm"), null);
    assert.strictEqual(sitePublish.mapAllowedRepoPath("CorporateSite/../index.htm"), null);
    assert.strictEqual(sitePublish.mapAllowedRepoPath("CorporateSite/diary/diary/index.htm"), null);
    assert.strictEqual(siteFtpPaths.validateSiteRoot("../public_html").ok, false);
    assert.strictEqual(siteFtpPaths.validateSiteRoot("/public_html/../diary").ok, false);
    assert.strictEqual(siteFtpPaths.validateSiteFtpCwd("/../").ok, false);
    assert.strictEqual(siteFtpPaths.validateSiteFtpCwd("../").ok, false);
    assert.strictEqual(siteFtpPaths.validateSiteFtpCwd("/public_html/../").ok, false);
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
    assert.ok(!/再公開する/.test(DevJobs.renderProgressHtml(job)));
  });

  await test("published Jobで再公開するが表示される", function () {
    var job = DevJobs.buildHomepageEditTask("Issue 6 再公開");
    job.githubPrNumber = 7;
    job.prMerged = true;
    job.status = "published";
    DevJobs.upsert(job);
    assert.strictEqual(DevJobs.studioProgressMessage(job), "公開済み");
    assert.strictEqual(DevJobs.canPublishToProduction(job), false);
    assert.strictEqual(DevJobs.canRepublishToProduction(job), true);
    assert.strictEqual(DevJobs.canRequestSitePublish(job), true);
    var html = DevJobs.renderProgressHtml(job);
    assert.ok(/再公開する/.test(html));
    assert.ok(/btn-hp-site-republish/.test(html));
    assert.ok(!/本番へ反映する/.test(html));
  });

  await test("未merge PRでは再公開不可", function () {
    var job = DevJobs.buildHomepageEditTask("未merge再公開");
    job.githubPrNumber = 7;
    job.prMerged = false;
    job.status = "published";
    DevJobs.upsert(job);
    assert.strictEqual(DevJobs.canRepublishToProduction(job), false);
    assert.strictEqual(DevJobs.canRequestSitePublish(job), false);
    assert.ok(!/再公開する/.test(DevJobs.renderProgressHtml(job)));
    job.status = "waiting_for_review";
    DevJobs.upsert(job);
    assert.strictEqual(DevJobs.canRequestSitePublish(job), false);
  });

  await test("SITE_FTP_REMOTE_DIRが/public_html以外なら拒否", function () {
    assert.strictEqual(siteFtpPaths.validateSiteRoot("/public_html/diary").ok, false);
    assert.strictEqual(siteFtpPaths.validateSiteRoot("/tmp").ok, false);
    assert.strictEqual(siteFtpPaths.validateSiteRoot("").ok, false);
    process.env.SITE_FTP_REMOTE_DIR = "/public_html/diary";
    try {
      assert.strictEqual(siteFtpPaths.readConfiguredSiteRoot(), "/public_html/diary");
      assert.strictEqual(siteFtpPaths.validateSiteRoot(siteFtpPaths.readConfiguredSiteRoot()).ok, false);
      var plan = siteFtpPaths.resolvePublishPlan(["CorporateSite/index.htm"], "/public_html/diary");
      assert.strictEqual(plan.ok, false);
    } finally {
      process.env.SITE_FTP_REMOTE_DIR = "/public_html";
    }
    assert.strictEqual(siteFtpPaths.validateSiteRoot("/public_html").ok, true);
  });

  await test("Xserver 550: cd /public_html は失敗し SITE_FTP_CWD で公開できる", async function () {
    var ftpOld = xserverFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "css/top-diary-notice.css": Buffer.from(OLD_CSS)
    });
    var oldCd = await siteFtpPaths.enterSiteFtpCwd(ftpOld, "/public_html");
    assert.strictEqual(oldCd.ok, false);
    assert.strictEqual(oldCd.code, "ftp_cwd_550");
    assert.ok(!ftpOld.ops.some(function (op) { return op.op === "stor"; }));

    var ftp = xserverFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "css/top-diary-notice.css": Buffer.from(OLD_CSS)
    });
    var entered = await siteFtpPaths.enterSiteFtpCwd(ftp, "/egaonokiroku.co.jp/public_html");
    assert.strictEqual(entered.ok, true, entered.userMessage || entered.code);
    assert.strictEqual(entered.cwd, "/egaonokiroku.co.jp/public_html");
    var ok = await sitePublish.publishSiteFiles({
      userConfirmed: true,
      siteRoot: "/public_html",
      ftpCwd: entered.cwd,
      ftp: ftp,
      files: [
        { repoPath: "CorporateSite/index.htm", buffer: Buffer.from(NEW_INDEX) },
        { repoPath: "CorporateSite/css/top-diary-notice.css", buffer: Buffer.from(NEW_CSS) }
      ]
    });
    assert.strictEqual(ok.ok, true, ok.userMessage || ok.code);
    assert.strictEqual(ftp.files["index.htm"].toString(), NEW_INDEX);
    assert.strictEqual(ftp.files["css/top-diary-notice.css"].toString(), NEW_CSS);
    assert.deepStrictEqual(ok.publishedAbsolutePaths, [
      "/public_html/index.htm",
      "/public_html/css/top-diary-notice.css"
    ]);
  });

  await test("FTP実CWDが diary 配下または不正ドメイン/.. なら拒否", async function () {
    assert.strictEqual(siteFtpPaths.validateSiteFtpCwd("/egaonokiroku.co.jp/public_html/diary").ok, false);
    assert.strictEqual(siteFtpPaths.validateSiteFtpCwd("/egaonokiroku.co.jp/public_html/diary").code, "ftp_cwd_is_diary");
    assert.strictEqual(siteFtpPaths.validateSiteFtpCwd("/not_a_host/public_html").ok, false);
    assert.strictEqual(siteFtpPaths.validateSiteFtpCwd("/egaonokiroku.co.jp/../public_html").ok, false);
    assert.strictEqual(siteFtpPaths.validateSiteFtpCwd("../egaonokiroku.co.jp/public_html").ok, false);
    var ftp = xserverFtp({ "index.htm": Buffer.from("DIARY-INDEX") });
    var denied = await siteFtpPaths.enterSiteFtpCwd(ftp, "/egaonokiroku.co.jp/public_html/diary");
    assert.strictEqual(denied.ok, false);
    assert.strictEqual(denied.code, "ftp_cwd_is_diary");
    assert.ok(!ftp.ops.some(function (op) { return op.op === "cd"; }));
    var siteCfg = ftpClient.getSiteFtpConfig();
    assert.notStrictEqual(siteCfg.remoteDir, process.env.FTP_REMOTE_DIR);
  });

  await test("ログイン直後 pwd=/ なら不要な cd をせず公開できる", async function () {
    var cwd = siteFtpPaths.validateSiteFtpCwd("/");
    assert.strictEqual(cwd.ok, true, cwd.userMessage || cwd.code);
    assert.strictEqual(cwd.cwd, "/");
    assert.strictEqual(cwd.loginRoot, true);

    var ftp = loginRootFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "css/top-diary-notice.css": Buffer.from(OLD_CSS),
      "diary/index.htm": Buffer.from("DIARY-LIVE")
    });
    var entered = await siteFtpPaths.enterSiteFtpCwd(ftp, "/");
    assert.strictEqual(entered.ok, true, entered.userMessage || entered.code);
    assert.strictEqual(entered.cwd, "/");
    assert.strictEqual(entered.skippedCd, true);
    assert.ok(!ftp.ops.some(function (op) { return op.op === "cd"; }), "must not cd");

    var ok = await sitePublish.publishSiteFiles({
      userConfirmed: true,
      siteRoot: "/public_html",
      ftpCwd: "/",
      requestId: "spub_test_login_root",
      issueNumber: 6,
      prNumber: 7,
      selectedMode: "loginRoot",
      pwdBeforeCwd: "/",
      pwdAfterCwd: "/",
      ftp: ftp,
      files: [
        { repoPath: "CorporateSite/index.htm", buffer: Buffer.from(NEW_INDEX) },
        { repoPath: "CorporateSite/css/top-diary-notice.css", buffer: Buffer.from(NEW_CSS) },
        { repoPath: "CorporateSite/diary/index.htm", buffer: Buffer.from("NO-DIARY") },
        { repoPath: "../index.htm", buffer: Buffer.from("NO-TRAVERSAL") },
        { repoPath: "secret.env", buffer: Buffer.from("nope") }
      ]
    });
    assert.strictEqual(ok.ok, true, ok.userMessage || ok.code);
    assert.strictEqual(ftp.files["index.htm"].toString(), NEW_INDEX);
    assert.strictEqual(ftp.files["css/top-diary-notice.css"].toString(), NEW_CSS);
    assert.strictEqual(ftp.files["diary/index.htm"].toString(), "DIARY-LIVE");
    assert.ok(!ftp.files["../index.htm"]);
    assert.ok(!ftp.files["secret.env"]);
    assert.ok(ftp.files["index.htm" + sitePublish.BAK_SUFFIX], "index backup required");
    assert.ok(ftp.files["css/top-diary-notice.css" + sitePublish.BAK_SUFFIX], "css backup required");
    assert.deepStrictEqual(ok.publishedFiles, ["index.htm", "css/top-diary-notice.css"]);
    assert.deepStrictEqual(ok.publishedAbsolutePaths, [
      "/public_html/index.htm",
      "/public_html/css/top-diary-notice.css"
    ]);
    var written = ftp.ops.filter(function (op) { return op.op === "stor"; }).map(function (op) { return op.name; });
    assert.ok(written.indexOf("index.htm") < 0 || written.some(function (n) {
      return n === "index.htm" + sitePublish.BAK_SUFFIX || n === "index.htm" + sitePublish.PUBLISHING_SUFFIX;
    }));
    assert.ok(!written.some(function (n) { return /(^|\/)diary(\/|$)/i.test(n); }));
    assert.ok(!written.some(function (n) { return n.indexOf("..") >= 0; }));
    assert.strictEqual(ftp.cwd, "/", "must stay at login root after css ensureDir");
    assert.ok(!ftp.ops.some(function (op) {
      return op.op === "cd" && (op.dir === "/" || op.target === "/" || op.rejected);
    }), "must not CWD /");
  });

  await test("pwd=/ でも直下に public_html があれば SITE_FTP_CWD=/ を拒否", async function () {
    var ftp = loginRootFtp({ "index.htm": Buffer.from(OLD_INDEX) });
    ftp.listEntries = async function () {
      return [
        { name: "egaonokiroku.co.jp", type: 2 },
        { name: "public_html", type: 2 }
      ];
    };
    var denied = await siteFtpPaths.enterSiteFtpCwd(ftp, "/");
    assert.strictEqual(denied.ok, false);
    assert.strictEqual(denied.code, "ftp_login_has_public_html");
    assert.ok(!ftp.ops.some(function (op) { return op.op === "cd" || op.op === "stor"; }));
  });

  await test("SITE_FTP_* 未設定なら homepage publish 拒否", function () {
    var prev = {
      SITE_FTP_HOST: process.env.SITE_FTP_HOST,
      SITE_FTP_USER: process.env.SITE_FTP_USER,
      SITE_FTP_PASSWORD: process.env.SITE_FTP_PASSWORD,
      SITE_FTP_CWD: process.env.SITE_FTP_CWD
    };
    delete process.env.SITE_FTP_HOST;
    delete process.env.SITE_FTP_USER;
    delete process.env.SITE_FTP_PASSWORD;
    delete process.env.SITE_FTP_CWD;
    try {
      assert.strictEqual(ftpClient.hasSiteFtpCredentials(), false);
      assert.strictEqual(ftpClient.isSiteConfigured(), false);
      var api = fs.readFileSync(
        path.join(__dirname, "..", "netlify", "functions", "api-site-publish.js"),
        "utf8"
      );
      assert.ok(/site_ftp_not_configured/.test(api));
    } finally {
      Object.keys(prev).forEach(function (k) {
        if (prev[k]) process.env[k] = prev[k];
        else delete process.env[k];
      });
    }
  });

  await test("FTP_* が正しくても SITE_FTP_* 未設定なら homepage publish 拒否", function () {
    var prev = {
      SITE_FTP_HOST: process.env.SITE_FTP_HOST,
      SITE_FTP_USER: process.env.SITE_FTP_USER,
      SITE_FTP_PASSWORD: process.env.SITE_FTP_PASSWORD,
      SITE_FTP_CWD: process.env.SITE_FTP_CWD
    };
    delete process.env.SITE_FTP_HOST;
    delete process.env.SITE_FTP_USER;
    delete process.env.SITE_FTP_PASSWORD;
    delete process.env.SITE_FTP_CWD;
    process.env.FTP_HOST = "diary.example.com";
    process.env.FTP_USER = "diary-ftp-user";
    process.env.FTP_PASSWORD = "diary-ftp-password";
    process.env.FTP_REMOTE_DIR = "/public_html/diary";
    try {
      assert.strictEqual(ftpClient.isConfigured(), true);
      assert.strictEqual(ftpClient.isSiteConfigured(), false);
      assert.strictEqual(ftpClient.getSiteFtpConfig().user, "");
      assert.strictEqual(ftpClient.getSiteFtpConfig().password, "");
      assert.notStrictEqual(ftpClient.getSiteFtpConfig().user, process.env.FTP_USER);
      assert.strictEqual(ftpClient.getFtpConfig().user, "diary-ftp-user");
    } finally {
      Object.keys(prev).forEach(function (k) {
        if (prev[k]) process.env[k] = prev[k];
        else delete process.env[k];
      });
    }
  });

  await test("homepage publish は FTP_USER / FTP_PASSWORD を参照しない", function () {
    var files = [
      "netlify/functions/shared/ftp-client.js",
      "netlify/functions/api-site-publish.js",
      "netlify/functions/api-site-ftp-probe.js",
      "netlify/functions/shared/site-publish.js"
    ];
    var ftpSrc = fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "shared", "ftp-client.js"), "utf8");
    var siteFn = ftpSrc.slice(
      ftpSrc.indexOf("function getSiteFtpConfig"),
      ftpSrc.indexOf("async function connectFromEnv")
    );
    assert.ok(!/env\.getEnv\("FTP_USER"\)/.test(siteFn));
    assert.ok(!/env\.getEnv\("FTP_PASSWORD"\)/.test(siteFn));
    assert.ok(/getSiteFtpConfig\(\)/.test(fs.readFileSync(path.join(__dirname, "..", files[1]), "utf8")) ||
      /isSiteConfigured\(\)/.test(fs.readFileSync(path.join(__dirname, "..", files[1]), "utf8")));
    var probe = fs.readFileSync(path.join(__dirname, "..", files[2]), "utf8");
    assert.ok(/getSiteFtpConfig/.test(probe));
    assert.ok(!/getFtpConfig\(/.test(probe));
    var loginOnly = ftpSrc.slice(
      ftpSrc.indexOf("async function connectLoginOnlyFromEnv"),
      ftpSrc.indexOf("async function enterSiteCwdAfterLoginProbe")
    );
    assert.ok(/getSiteFtpConfig\(\)/.test(loginOnly));
    assert.ok(!/getFtpConfig\(\)/.test(loginOnly));
  });

  await test("diary publish は SITE_FTP_USER / SITE_FTP_PASSWORD を参照しない", function () {
    var diarySrc = fs.readFileSync(
      path.join(__dirname, "..", "netlify", "functions", "shared", "diary-publish.js"),
      "utf8"
    );
    var diaryApi = fs.readFileSync(
      path.join(__dirname, "..", "netlify", "functions", "api-diary-publish.js"),
      "utf8"
    );
    var ftpSrc = fs.readFileSync(
      path.join(__dirname, "..", "netlify", "functions", "shared", "ftp-client.js"),
      "utf8"
    );
    var diaryFn = ftpSrc.slice(
      ftpSrc.indexOf("function getFtpConfig"),
      ftpSrc.indexOf("function getSiteFtpConfig")
    );
    assert.ok(!/SITE_FTP_USER/.test(diarySrc + diaryApi + diaryFn));
    assert.ok(!/SITE_FTP_PASSWORD/.test(diarySrc + diaryApi + diaryFn));
    assert.ok(/connectFromEnv\(\)/.test(diaryApi));
    assert.ok(!/connectSiteFromEnv/.test(diaryApi));
  });

  await test("SITE_FTP_CWD=/ で homepage root 判定", function () {
    var prevCwd = process.env.SITE_FTP_CWD;
    var prevDiary = process.env.FTP_REMOTE_DIR;
    process.env.SITE_FTP_CWD = "/";
    process.env.FTP_REMOTE_DIR = "/";
    try {
      var cwd = siteFtpPaths.validateSiteFtpCwd("/");
      assert.strictEqual(cwd.ok, true, cwd.userMessage || cwd.code);
      assert.strictEqual(cwd.loginRoot, true);
      assert.strictEqual(ftpClient.getSiteFtpConfig().remoteDir, "/");
      assert.strictEqual(ftpClient.getFtpConfig().remoteDir, "/");
      assert.notStrictEqual(ftpClient.getSiteFtpConfig().user, ftpClient.getFtpConfig().user);
    } finally {
      process.env.SITE_FTP_CWD = prevCwd;
      process.env.FTP_REMOTE_DIR = prevDiary || "/public_html/diary";
    }
  });

  await test("ログイン直下に diary が無いとホームページ公開しない", async function () {
    var ftp = loginRootFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "diary/index.htm": Buffer.from("DIARY-LIVE")
    });
    ftp.listEntries = async function () {
      return [
        { name: "image", type: 2 },
        { name: "css", type: 2 }
      ];
    };
    var denied = await siteFtpPaths.enterSiteFtpCwd(ftp, "/");
    assert.strictEqual(denied.ok, false);
    assert.strictEqual(denied.code, "ftp_login_missing_diary_dir");
    var r = await sitePublish.publishSiteFiles({
      userConfirmed: true,
      siteRoot: "/public_html",
      ftpCwd: "/",
      ftp: ftp,
      files: [
        { repoPath: "CorporateSite/index.htm", buffer: Buffer.from(NEW_INDEX) },
        { repoPath: "CorporateSite/css/top-diary-notice.css", buffer: Buffer.from(NEW_CSS) }
      ]
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, "ftp_login_missing_diary_dir");
    assert.strictEqual(r.productionUntouched, true);
    assert.strictEqual(ftp.files["index.htm"].toString(), OLD_INDEX);
    assert.strictEqual(ftp.files["diary/index.htm"].toString(), "DIARY-LIVE");
    assert.ok(!ftp.ops.some(function (op) { return op.op === "stor" || op.op === "rename" || op.op === "remove"; }));
  });

  await test("ホームページ公開は diary の Shift_JIS を byte 単位で保持する", async function () {
    var crypto = require("crypto");
    function sha(buf) {
      return crypto.createHash("sha256").update(buf).digest("hex");
    }
    var diarySjis = Buffer.from([0x82, 0xa0, 0x82, 0xa2, 0x0a]);
    var homeSjis = Buffer.from([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, 0x82, 0xa0, 0x3c, 0x2f, 0x68, 0x74, 0x6d, 0x6c, 0x3e]);
    var before = sha(diarySjis);
    var ftp = loginRootFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "css/top-diary-notice.css": Buffer.from(OLD_CSS),
      "diary/index.htm": Buffer.from(diarySjis)
    });
    var r = await sitePublish.publishSiteFiles({
      userConfirmed: true,
      siteRoot: "/public_html",
      ftpCwd: "/",
      ftp: ftp,
      files: [
        { repoPath: "CorporateSite/index.htm", buffer: Buffer.from(homeSjis) },
        { repoPath: "CorporateSite/css/top-diary-notice.css", buffer: Buffer.from(NEW_CSS) }
      ]
    });
    assert.strictEqual(r.ok, true, r.userMessage || r.code);
    assert.ok(ftp.files["index.htm"].equals(homeSjis));
    assert.ok(ftp.files["diary/index.htm"].equals(diarySjis));
    assert.strictEqual(sha(ftp.files["diary/index.htm"]), before);
    assert.ok(!ftp.ops.some(function (op) {
      var p = String(op.name || op.from || op.to || op.dir || "");
      return /(^|\/)diary(\/|$)/i.test(p);
    }));
  });

  await test("FTP_REMOTE_DIR=/ でも日記公開は diary/index.htm を解決する", function () {
    var prevCwd = process.env.SITE_FTP_CWD;
    var prevDiary = process.env.FTP_REMOTE_DIR;
    process.env.SITE_FTP_CWD = "/";
    process.env.FTP_REMOTE_DIR = "/";
    try {
      assert.strictEqual(ftpClient.getFtpConfig().remoteDir, "/");
      assert.strictEqual(ftpClient.getSiteFtpConfig().remoteDir, "/");
      var atHome = siteFtpPaths.resolveDiaryFtpEnter("/", ["image", "css", "diary"]);
      assert.strictEqual(atHome.ok, true);
      assert.strictEqual(atHome.cd, "diary");
      assert.notStrictEqual(atHome.cd, "/");
      var inDiaryChroot = siteFtpPaths.resolveDiaryFtpEnter("/", ["image", "css"]);
      assert.strictEqual(inDiaryChroot.ok, true);
      assert.strictEqual(inDiaryChroot.cd, "");
      var keep = siteFtpPaths.resolveDiaryFtpEnter("/public_html/diary");
      assert.strictEqual(keep.ok, true);
      assert.strictEqual(keep.cd, "/public_html/diary");
      var bad = siteFtpPaths.resolveDiaryFtpEnter("/public_html");
      assert.strictEqual(bad.ok, false);
      assert.strictEqual(bad.code, "diary_remote_not_diary");
    } finally {
      process.env.SITE_FTP_CWD = prevCwd;
      process.env.FTP_REMOTE_DIR = prevDiary || "/public_html/diary";
    }
  });

  await test("rollback しても diary の SHA-256 は不変", async function () {
    var crypto = require("crypto");
    var diaryBytes = Buffer.from("DIARY-LIVE-SJIS-\x82\xa0");
    var before = crypto.createHash("sha256").update(diaryBytes).digest("hex");
    var ftp = loginRootFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "css/top-diary-notice.css": Buffer.from(OLD_CSS),
      "diary/index.htm": Buffer.from(diaryBytes)
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
      siteRoot: "/public_html",
      ftpCwd: "/",
      ftp: ftp,
      files: [
        { repoPath: "CorporateSite/index.htm", buffer: Buffer.from(NEW_INDEX) },
        { repoPath: "CorporateSite/css/top-diary-notice.css", buffer: Buffer.from(NEW_CSS) }
      ]
    });
    assert.strictEqual(r.ok, false);
    assert.ok(ftp.files["diary/index.htm"].equals(diaryBytes));
    assert.strictEqual(
      crypto.createHash("sha256").update(ftp.files["diary/index.htm"]).digest("hex"),
      before
    );
    assert.ok(!ftp.ops.some(function (op) {
      var p = String(op.name || op.from || op.to || "");
      return /(^|\/)diary(\/|$)/i.test(p);
    }));
  });

  await test("pwd が / 以外なら SITE_FTP_CWD=/ を拒否", async function () {
    var ftp = loginRootFtp({ "index.htm": Buffer.from(OLD_INDEX) });
    ftp.cwd = "/egaonokiroku.co.jp";
    var denied = await siteFtpPaths.enterSiteFtpCwd(ftp, "/");
    assert.strictEqual(denied.ok, false);
    assert.strictEqual(denied.code, "ftp_cwd_not_login_root");
    assert.ok(!ftp.ops.some(function (op) { return op.op === "cd" || op.op === "stor"; }));
  });

  await test("ログインルート公開で 2ファイル目失敗時に元状態を復元", async function () {
    var ftp = loginRootFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "css/top-diary-notice.css": Buffer.from(OLD_CSS),
      "diary/index.htm": Buffer.from("DIARY-LIVE")
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
      siteRoot: "/public_html",
      ftpCwd: "/",
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
    assert.strictEqual(ftp.files["diary/index.htm"].toString(), "DIARY-LIVE");
  });

  await test("SITE_FTP_CWD=/ でも日記公開先は FTP_REMOTE_DIR のまま", function () {
    var prevCwd = process.env.SITE_FTP_CWD;
    process.env.SITE_FTP_CWD = "/";
    process.env.FTP_REMOTE_DIR = "/public_html/diary";
    try {
      var siteCfg = ftpClient.getSiteFtpConfig();
      var diaryCfg = ftpClient.getFtpConfig();
      assert.strictEqual(siteCfg.remoteDir, "/");
      assert.strictEqual(diaryCfg.remoteDir, "/public_html/diary");
      assert.notStrictEqual(siteCfg.remoteDir, diaryCfg.remoteDir);
      assert.strictEqual(siteFtpPaths.validateSiteFtpCwd("/").ok, true);
      assert.strictEqual(siteFtpPaths.pathHasDiarySegment("/public_html/diary/index.htm"), true);
    } finally {
      process.env.SITE_FTP_CWD = prevCwd;
      process.env.FTP_REMOTE_DIR = "/public_html/diary";
    }
  });

  await test("SITE_FTP_CWD=/ と FTP_REMOTE_DIR=/ は同一chrootでも日記フォルダ再利用ではない", function () {
    var prevCwd = process.env.SITE_FTP_CWD;
    var prevDiary = process.env.FTP_REMOTE_DIR;
    process.env.SITE_FTP_CWD = "/";
    process.env.FTP_REMOTE_DIR = "/";
    try {
      assert.strictEqual(siteFtpPaths.siteCwdReusesDiaryFolder("/", "/"), false);
      var cwd = siteFtpPaths.validateSiteFtpCwd("/");
      assert.strictEqual(cwd.ok, true, cwd.userMessage || cwd.code);
      assert.strictEqual(cwd.loginRoot, true);
      assert.strictEqual(ftpClient.getSiteFtpConfig().remoteDir, "/");
      assert.strictEqual(ftpClient.getFtpConfig().remoteDir, "/");
      assert.strictEqual(siteFtpPaths.validateSiteFtpCwd("/public_html/diary").ok, false);
      assert.strictEqual(siteFtpPaths.validateSiteFtpCwd("/public_html/diary").code, "ftp_cwd_is_diary");
      process.env.FTP_REMOTE_DIR = "/public_html";
      process.env.SITE_FTP_CWD = "/public_html";
      var same = siteFtpPaths.validateSiteFtpCwd("/public_html");
      assert.strictEqual(same.ok, false);
      assert.strictEqual(same.code, "site_cwd_reuses_diary_dir");
    } finally {
      process.env.SITE_FTP_CWD = prevCwd;
      process.env.FTP_REMOTE_DIR = prevDiary || "/public_html/diary";
    }
  });

  await test("FTP_REMOTE_DIR=/ でもホームページ公開は diary に書かない", async function () {
    var prevCwd = process.env.SITE_FTP_CWD;
    var prevDiary = process.env.FTP_REMOTE_DIR;
    process.env.SITE_FTP_CWD = "/";
    process.env.FTP_REMOTE_DIR = "/";
    try {
      assert.strictEqual(siteFtpPaths.validateSiteFtpCwd("/").ok, true);
      var ftp = loginRootFtp({
        "index.htm": Buffer.from(OLD_INDEX),
        "css/top-diary-notice.css": Buffer.from(OLD_CSS),
        "diary/index.htm": Buffer.from("DIARY-LIVE")
      });
      var r = await sitePublish.publishSiteFiles({
        userConfirmed: true,
        siteRoot: "/public_html",
        ftpCwd: "/",
        ftp: ftp,
        files: [
          { repoPath: "CorporateSite/index.htm", buffer: Buffer.from(NEW_INDEX) },
          { repoPath: "CorporateSite/css/top-diary-notice.css", buffer: Buffer.from(NEW_CSS) }
        ]
      });
      assert.strictEqual(r.ok, true, r.userMessage || r.code);
      assert.strictEqual(ftp.files["index.htm"].toString(), NEW_INDEX);
      assert.strictEqual(ftp.files["css/top-diary-notice.css"].toString(), NEW_CSS);
      assert.strictEqual(ftp.files["diary/index.htm"].toString(), "DIARY-LIVE");
      assert.ok(!ftp.ops.some(function (op) {
        var p = String(op.name || op.from || op.to || "");
        return /(^|\/)diary(\/|$)/i.test(p);
      }));
    } finally {
      process.env.SITE_FTP_CWD = prevCwd;
      process.env.FTP_REMOTE_DIR = prevDiary || "/public_html/diary";
    }
  });

  function collectPaths(ftp) {
    var out = [];
    ftp.ops.forEach(function (op) {
      if (op.op !== "stor" && op.op !== "retr" && op.op !== "rename") return;
      if (op.name) out.push(op.name);
      if (op.from) out.push(op.from);
      if (op.to) out.push(op.to);
    });
    return out;
  }

  function assertSafeLoginRootPaths(ftp) {
    collectPaths(ftp).forEach(function (p) {
      assert.ok(String(p).charAt(0) !== "/", "must not use absolute FTP path: " + p);
      assert.ok(String(p).indexOf("//") < 0, "must not join onto /: " + p);
      assert.ok(String(p).indexOf("..") < 0, "must not traverse: " + p);
      assert.ok(!/(^|\/)diary(\/|$)/i.test(p), "must not write diary: " + p);
    });
  }

  await test("pwd=/ のまま index.htm と css/top-diary-notice.css を相対パスで操作", async function () {
    var ftp = loginRootFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "css/top-diary-notice.css": Buffer.from(OLD_CSS)
    });
    var r = await sitePublish.publishSiteFiles({
      userConfirmed: true,
      siteRoot: "/public_html",
      ftpCwd: "/",
      ftp: ftp,
      files: [
        { repoPath: "CorporateSite/index.htm", buffer: Buffer.from(NEW_INDEX) },
        { repoPath: "CorporateSite/css/top-diary-notice.css", buffer: Buffer.from(NEW_CSS) }
      ]
    });
    assert.strictEqual(r.ok, true, r.userMessage || r.code);
    assert.strictEqual(ftp.cwd, "/");
    var stor = ftp.ops.filter(function (op) { return op.op === "stor"; }).map(function (op) { return op.name; });
    var renamed = ftp.ops.filter(function (op) { return op.op === "rename"; });
    assert.ok(stor.indexOf("index.htm" + sitePublish.BAK_SUFFIX) >= 0);
    assert.ok(stor.indexOf("css/top-diary-notice.css" + sitePublish.BAK_SUFFIX) >= 0);
    assert.ok(stor.indexOf("index.htm" + sitePublish.PUBLISHING_SUFFIX) >= 0);
    assert.ok(stor.indexOf("css/top-diary-notice.css" + sitePublish.PUBLISHING_SUFFIX) >= 0);
    assert.ok(renamed.some(function (op) {
      return op.from === "index.htm" && op.to === "index.htm" + sitePublish.PREPUB_SUFFIX;
    }));
    assert.ok(renamed.some(function (op) {
      return op.from === "index.htm" + sitePublish.PUBLISHING_SUFFIX && op.to === "index.htm";
    }));
    assert.ok(renamed.some(function (op) {
      return op.from === "css/top-diary-notice.css" &&
        op.to === "css/top-diary-notice.css" + sitePublish.PREPUB_SUFFIX;
    }));
    assert.ok(renamed.some(function (op) {
      return op.from === "css/top-diary-notice.css" + sitePublish.PUBLISHING_SUFFIX &&
        op.to === "css/top-diary-notice.css";
    }));
    assert.ok(!ftp.ops.some(function (op) {
      return op.op === "cd" && (op.dir === "/" || op.rejected);
    }));
    assertSafeLoginRootPaths(ftp);
  });

  await test("CWD / が 550 でも css ensureDir 後に pwd=/ のまま公開できる", async function () {
    var ftp = loginRootFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "css/top-diary-notice.css": Buffer.from(OLD_CSS)
    });
    ftp.rejectCdSlash = true;
    var r = await sitePublish.publishSiteFiles({
      userConfirmed: true,
      siteRoot: "/public_html",
      ftpCwd: "/",
      ftp: ftp,
      files: [
        { repoPath: "CorporateSite/index.htm", buffer: Buffer.from(NEW_INDEX) },
        { repoPath: "CorporateSite/css/top-diary-notice.css", buffer: Buffer.from(NEW_CSS) }
      ]
    });
    assert.strictEqual(r.ok, true, r.userMessage || r.code);
    assert.strictEqual(ftp.cwd, "/");
    assert.ok(ftp.ops.some(function (op) { return op.op === "ensureDir" && op.dir === "css"; }));
    assert.ok(ftp.ops.some(function (op) { return op.op === "cdup"; }));
    assert.ok(!ftp.ops.some(function (op) {
      return op.op === "cd" && (op.dir === "/" || op.rejected);
    }));
  });

  await test("backup / rename / restore パスが相対のまま", async function () {
    var ftp = loginRootFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "css/top-diary-notice.css": Buffer.from(OLD_CSS)
    });
    var origStor = ftp.stor.bind(ftp);
    ftp.stor = async function (name, buf) {
      if (name === "css/top-diary-notice.css" + sitePublish.PUBLISHING_SUFFIX) {
        var err = new Error("550 STOR failed");
        err.code = 550;
        throw err;
      }
      return origStor(name, buf);
    };
    var r = await sitePublish.publishSiteFiles({
      userConfirmed: true,
      siteRoot: "/public_html",
      ftpCwd: "/",
      ftp: ftp,
      files: [
        { repoPath: "CorporateSite/index.htm", buffer: Buffer.from(NEW_INDEX) },
        { repoPath: "CorporateSite/css/top-diary-notice.css", buffer: Buffer.from(NEW_CSS) }
      ]
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.failedFile, "css/top-diary-notice.css");
    assert.strictEqual(r.ftpErrorCode, "550");
    assert.strictEqual(ftp.files["index.htm"].toString(), OLD_INDEX);
    var restored = ftp.ops.filter(function (op) {
      return op.op === "rename" && op.to === "index.htm";
    });
    assert.ok(restored.some(function (op) {
      return op.from === "index.htm" + sitePublish.PREPUB_SUFFIX;
    }));
    assertSafeLoginRootPaths(ftp);
    assert.ok(sitePublish.isAllowedOpPath("index.htm" + sitePublish.BAK_SUFFIX));
    assert.ok(sitePublish.isAllowedOpPath("css/top-diary-notice.css" + sitePublish.PREPUB_SUFFIX));
    assert.ok(!sitePublish.isAllowedOpPath("/index.htm"));
    assert.ok(!sitePublish.isAllowedOpPath("/public_html/index.htm"));
    assert.ok(!sitePublish.isAllowedOpPath("../index.htm"));
    assert.ok(!sitePublish.isAllowedOpPath("diary/index.htm"));
    assert.strictEqual(
      siteFtpPaths.joinFtpPath("/public_html", "css/top-diary-notice.css"),
      "/public_html/css/top-diary-notice.css"
    );
    assert.notStrictEqual(siteFtpPaths.joinFtpPath("/", "index.htm"), "index.htm");
  });

  await test("1ファイル目失敗では本番を触らない", async function () {
    var ftp = loginRootFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "css/top-diary-notice.css": Buffer.from(OLD_CSS)
    });
    var origStor = ftp.stor.bind(ftp);
    ftp.stor = async function (name, buf) {
      if (name === "index.htm" + sitePublish.PUBLISHING_SUFFIX) {
        var err = new Error("550 first file");
        err.code = 550;
        throw err;
      }
      return origStor(name, buf);
    };
    var r = await sitePublish.publishSiteFiles({
      userConfirmed: true,
      siteRoot: "/public_html",
      ftpCwd: "/",
      ftp: ftp,
      files: [
        { repoPath: "CorporateSite/index.htm", buffer: Buffer.from(NEW_INDEX) },
        { repoPath: "CorporateSite/css/top-diary-notice.css", buffer: Buffer.from(NEW_CSS) }
      ]
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.failedFile, "index.htm");
    assert.strictEqual(r.productionUntouched, true);
    assert.strictEqual(ftp.files["index.htm"].toString(), OLD_INDEX);
    assert.strictEqual(ftp.files["css/top-diary-notice.css"].toString(), OLD_CSS);
    assert.strictEqual(ftp.cwd, "/");
  });

  await test("backup失敗で公開を中止する", async function () {
    var ftp = loginRootFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "css/top-diary-notice.css": Buffer.from(OLD_CSS)
    });
    var origStor = ftp.stor.bind(ftp);
    ftp.stor = async function (name, buf) {
      if (name === "index.htm" + sitePublish.BAK_SUFFIX) {
        var err = new Error("550 backup");
        err.code = 550;
        throw err;
      }
      return origStor(name, buf);
    };
    var r = await sitePublish.publishSiteFiles({
      userConfirmed: true,
      siteRoot: "/public_html",
      ftpCwd: "/",
      ftp: ftp,
      files: [
        { repoPath: "CorporateSite/index.htm", buffer: Buffer.from(NEW_INDEX) },
        { repoPath: "CorporateSite/css/top-diary-notice.css", buffer: Buffer.from(NEW_CSS) }
      ]
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.failedFile, "index.htm");
    assert.strictEqual(r.ftpErrorCode, "550");
    assert.strictEqual(ftp.files["index.htm"].toString(), OLD_INDEX);
    assert.ok(!ftp.ops.some(function (op) {
      return op.op === "rename" && op.to === "index.htm" + sitePublish.PREPUB_SUFFIX;
    }));
  });

  await test("rollback失敗を reasonCode 付きで返す", async function () {
    var ftp = loginRootFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "css/top-diary-notice.css": Buffer.from(OLD_CSS)
    });
    var failRestore = false;
    var origStor = ftp.stor.bind(ftp);
    var origRename = ftp.rename.bind(ftp);
    ftp.stor = async function (name, buf) {
      if (name === "css/top-diary-notice.css" + sitePublish.PUBLISHING_SUFFIX) {
        failRestore = true;
        var err = new Error("550 second file");
        err.code = 550;
        throw err;
      }
      if (failRestore && name === "index.htm") {
        var errStor = new Error("550 restore stor");
        errStor.code = 550;
        throw errStor;
      }
      return origStor(name, buf);
    };
    ftp.rename = async function (from, to) {
      if (failRestore && to === "index.htm") {
        var errRn = new Error("550 restore rename");
        errRn.code = 550;
        throw errRn;
      }
      return origRename(from, to);
    };
    var r = await sitePublish.publishSiteFiles({
      userConfirmed: true,
      siteRoot: "/public_html",
      ftpCwd: "/",
      ftp: ftp,
      files: [
        { repoPath: "CorporateSite/index.htm", buffer: Buffer.from(NEW_INDEX) },
        { repoPath: "CorporateSite/css/top-diary-notice.css", buffer: Buffer.from(NEW_CSS) }
      ]
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.productionUntouched, false);
    assert.ok(ftp.ops.some(function (op) { return op.op === "rename" && op.rejected !== true; }));
  });

  await test("公開失敗ログに stage / requestId / FTP エラーを出し secret は出さない", async function () {
    var ftp = loginRootFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "css/top-diary-notice.css": Buffer.from(OLD_CSS)
    });
    var origStor = ftp.stor.bind(ftp);
    ftp.stor = async function (name, buf) {
      if (name === "css/top-diary-notice.css" + sitePublish.PUBLISHING_SUFFIX) {
        var err = new Error("550 STOR css/top-diary-notice.css password=SHOULD_NOT_APPEAR");
        err.code = 550;
        throw err;
      }
      return origStor(name, buf);
    };
    var lines = [];
    var origLog = console.log;
    console.log = function (msg) { lines.push(String(msg)); };
    try {
      await sitePublish.publishSiteFiles({
        userConfirmed: true,
        siteRoot: "/public_html",
        ftpCwd: "/",
        requestId: "spub_test_fail_log",
        issueNumber: 6,
        prNumber: 7,
        selectedMode: "loginRoot",
        pwdBeforeCwd: "/",
        pwdAfterCwd: "/",
        ftp: ftp,
        files: [
          { repoPath: "CorporateSite/index.htm", buffer: Buffer.from(NEW_INDEX) },
          { repoPath: "CorporateSite/css/top-diary-notice.css", buffer: Buffer.from(NEW_CSS) }
        ]
      });
    } finally {
      console.log = origLog;
    }
    var blob = lines.join("\n");
    assert.ok(blob.indexOf("spub_test_fail_log") >= 0);
    assert.ok(blob.indexOf("backup-start") >= 0);
    assert.ok(blob.indexOf("backup-success") >= 0);
    assert.ok(blob.indexOf("upload-fail") >= 0);
    assert.ok(blob.indexOf("rollback-start") >= 0);
    assert.ok(blob.indexOf("\"prNumber\":\"7\"") >= 0 || blob.indexOf("\"prNumber\":7") >= 0);
    assert.ok(blob.indexOf("\"issueNumber\":6") >= 0 || blob.indexOf("\"issueNumber\":\"6\"") >= 0);
    assert.ok(blob.indexOf("loginRoot") >= 0);
    assert.ok(blob.indexOf("css/top-diary-notice.css") >= 0);
    assert.ok(blob.toLowerCase().indexOf("should_not_appear") < 0);
    assert.ok(blob.toLowerCase().indexOf("ftp_user") < 0);
    assert.ok(blob.indexOf(NEW_INDEX) < 0);
    assert.ok(blob.indexOf(NEW_CSS) < 0);
    var parsed = lines.map(function (line) {
      try { return JSON.parse(line); } catch (e) { return null; }
    }).filter(Boolean);
    var failLog = parsed.filter(function (row) { return row.stage === "upload-fail"; })[0];
    assert.ok(failLog);
    assert.strictEqual(failLog.requestId, "spub_test_fail_log");
    assert.strictEqual(failLog.failedFile, "css/top-diary-notice.css");
    assert.strictEqual(failLog.ftpErrorCode, "550");
    assert.ok(!Object.prototype.hasOwnProperty.call(failLog, "password"));
    assert.ok(!Object.prototype.hasOwnProperty.call(failLog, "buffer"));
    var safe = sitePublishLog.pickSafe({
      stage: "upload-fail",
      requestId: "spub_x",
      password: "nope",
      FTP_USER: "hidden",
      buffer: Buffer.from("body")
    });
    assert.ok(!Object.prototype.hasOwnProperty.call(safe, "password"));
    assert.ok(!Object.prototype.hasOwnProperty.call(safe, "FTP_USER"));
    assert.ok(!Object.prototype.hasOwnProperty.call(safe, "buffer"));
  });

  await test("明示確認なしは拒否 / 2ファイル公開成功mock", async function () {
    var ftp = homepageFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "css/top-diary-notice.css": Buffer.from(OLD_CSS)
    });
    var denied = await sitePublish.publishSiteFiles({
      userConfirmed: false,
      siteRoot: "/public_html",
      ftp: ftp,
      files: [
        { repoPath: "CorporateSite/index.htm", buffer: Buffer.from(NEW_INDEX) }
      ]
    });
    assert.strictEqual(denied.ok, false);
    assert.strictEqual(denied.code, "confirm_required");
    assert.strictEqual(ftp.files["index.htm"].toString(), OLD_INDEX);

    var ftp2 = homepageFtp({
      "index.htm": Buffer.from(OLD_INDEX),
      "css/top-diary-notice.css": Buffer.from(OLD_CSS)
    });
    var ok = await sitePublish.publishSiteFiles({
      userConfirmed: true,
      siteRoot: "/public_html",
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
    assert.deepStrictEqual(ok.publishedAbsolutePaths, [
      "/public_html/index.htm",
      "/public_html/css/top-diary-notice.css"
    ]);
  });

  await test("2ファイル目失敗時に元状態を復元", async function () {
    var ftp = homepageFtp({
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
      siteRoot: "/public_html",
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

  await test("FTP作業フォルダが /public_html/diary なら公式サイト公開を拒否", async function () {
    var ftp = homepageFtp({
      "index.htm": Buffer.from("DIARY-INDEX")
    });
    ftp.cwd = "/public_html/diary";
    var r = await sitePublish.publishSiteFiles({
      userConfirmed: true,
      siteRoot: "/public_html",
      ftp: ftp,
      files: [
        { repoPath: "CorporateSite/index.htm", buffer: Buffer.from(NEW_INDEX) }
      ]
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, "ftp_cwd_is_diary");
    assert.strictEqual(ftp.files["index.htm"].toString(), "DIARY-INDEX");
    assert.ok(!ftp.ops.some(function (op) { return op.op === "stor"; }));
  });

  await test("公開前パス検証ログに password / user / secret を出さない", async function () {
    var lines = [];
    var origLog = console.log;
    console.log = function (msg) { lines.push(String(msg)); };
    try {
      siteFtpPaths.logPathPlan({
        siteRoot: "/public_html",
        files: [
          {
            repoPath: "CorporateSite/index.htm",
            remotePath: "index.htm",
            absolutePath: "/public_html/index.htm"
          }
        ]
      }, { ftpCwd: "/public_html" });
    } finally {
      console.log = origLog;
    }
    assert.ok(lines.length >= 1);
    var payload = JSON.parse(lines[0]);
    assert.strictEqual(payload.stage, "site-publish-path-check");
    assert.strictEqual(payload.siteRoot, "/public_html");
    assert.strictEqual(payload.ftpCwd, "/public_html");
    assert.strictEqual(payload.files[0].finalFtpPath, "/public_html/index.htm");
    var blob = JSON.stringify(payload).toLowerCase();
    assert.ok(blob.indexOf("password") < 0);
    assert.ok(blob.indexOf("secret") < 0);
    assert.ok(blob.indexOf("ftp_user") < 0);
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, "user"));
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, "host"));
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

    var staffReady = await middleware.enforceAccess(fakeEvent({
      headers: {
        cookie: authConfig.COOKIE_SESSION + "=" + encodeURIComponent(staff.rawId) + "; " +
          authConfig.COOKIE_CSRF + "=" + encodeURIComponent(staff.session.csrfToken),
        "x-csrf-token": staff.session.csrfToken
      }
    }), { permissionKey: "api-github-issues:POST:find-ready-site-publish" });
    assert.strictEqual(staffReady.ok, false);
    assert.strictEqual(staffReady.response.statusCode, 403);

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

    var badReadyCsrf = await middleware.enforceAccess(fakeEvent({
      headers: {
        cookie: authConfig.COOKIE_SESSION + "=" + encodeURIComponent(owner.rawId) + "; " +
          authConfig.COOKIE_CSRF + "=" + encodeURIComponent(owner.session.csrfToken),
        "x-csrf-token": "wrong"
      }
    }), { permissionKey: "api-github-issues:POST:find-ready-site-publish" });
    assert.strictEqual(badReadyCsrf.ok, false);
    assert.strictEqual(badReadyCsrf.response.statusCode, 403);

    process.env.AUTH_ENVIRONMENT = "local";
    process.env.AUTH_ENFORCEMENT_MODE = "enforce";
  });

  await test("permission is owner-only and production-only", function () {
    var perm = permissions.resolvePermission("api-site-publish:POST");
    assert.ok(perm);
    assert.deepStrictEqual(perm.roles, ["owner"]);
    assert.strictEqual(authConfig.isAlwaysEnforcedPermission("api-site-publish:POST"), true);
    assert.strictEqual(authConfig.isProductionOnlyPermission("api-site-publish:POST"), true);

    var readyPerm = permissions.resolvePermission("api-github-issues:POST:find-ready-site-publish");
    assert.ok(readyPerm);
    assert.deepStrictEqual(readyPerm.roles, ["owner"]);
    assert.strictEqual(
      authConfig.isAlwaysEnforcedPermission("api-github-issues:POST:find-ready-site-publish"),
      true
    );
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
    assert.ok(/btn-hp-site-republish/.test(script));
    assert.ok(/公式サイトへ本番反映します/.test(html));
    assert.ok(script.indexOf("function showHpPublishConfirm") < script.indexOf("function publishHpEditToSite"));
    var confirmStart = script.indexOf("function showHpPublishConfirm");
    var confirmEnd = script.indexOf("function publishHpEditToSite");
    var confirmFn = script.slice(confirmStart, confirmEnd);
    assert.ok(!/fetch\(/.test(confirmFn), "first click must not FTP");
    var republishClick = script.slice(
      script.indexOf("btn-hp-site-republish"),
      script.indexOf("btn-hp-site-republish") + 180
    );
    assert.ok(/showHpPublishConfirm/.test(republishClick));
    assert.ok(!/publishHpEditToSite/.test(republishClick));
    assert.ok(/userConfirmed: true/.test(script));
    assert.ok(/find-ready-site-publish/.test(script));
    assert.ok(/hp-edit-github-ready/.test(html));
    assert.ok(/承認済みの変更があります/.test(script));
    var readyIdx = script.lastIndexOf("btn-hp-github-ready-publish");
    var readyClick = script.slice(readyIdx, readyIdx + 420);
    assert.ok(/showHpPublishConfirm/.test(readyClick));
    assert.ok(!/publishHpEditToSite/.test(readyClick));
  });

  await test("server rejects unmerged PR and missing userConfirmed", function () {
    var gate = github.assertPrMergedToMain({ ok: true, merged: false, baseRef: "main" });
    assert.strictEqual(gate.ok, false);
    assert.strictEqual(gate.error, "pr_not_merged");
    var merged = github.assertPrMergedToMain({ ok: true, merged: true, baseRef: "main" });
    assert.strictEqual(merged.ok, true);
    var apiSrc = fs.readFileSync(
      path.join(__dirname, "..", "netlify", "functions", "api-site-publish.js"),
      "utf8"
    );
    assert.ok(/assertPrMergedToMain/.test(apiSrc));
    assert.ok(/if \(!body\.userConfirmed\)/.test(apiSrc));
    assert.ok(/getPullRequest\(prNumber\)/.test(apiSrc));
    assert.ok(/reasonCode: cwdPlan.code/.test(apiSrc));
    assert.ok(/requestId: requestId/.test(apiSrc));
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
