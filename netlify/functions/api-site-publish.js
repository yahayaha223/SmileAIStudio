"use strict";

/**
 * POST /.netlify/functions/api-site-publish
 * Homepage production FTP after a PR is merged to main.
 * Owner + CSRF + explicit userConfirmed. Secrets stay server-side.
 */
var http = require("./shared/http");
var protectApi = require("./shared/auth/protect-api");
var rateLimit = require("./shared/auth/rate-limit");
var audit = require("./shared/auth/audit");
var sitePublish = require("./shared/site-publish");
var ftpClient = require("./shared/ftp-client");
var githubIssues = require("./shared/github-issues");

function parseBody(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch (e) {
    return null;
  }
}

function permissionKey(event) {
  if (String(event.httpMethod || "").toUpperCase() !== "POST") return null;
  return "api-site-publish:POST";
}

async function handler(event, guard) {
  if (event.httpMethod !== "POST") {
    return http.json(405, { ok: false, error: "method_not_allowed" }, event);
  }
  var body = parseBody(event);
  if (!body) return http.json(400, { ok: false, error: "invalid_json" }, event);

  var userId = (guard && guard.session && guard.session.userId) || "anon";
  var ipHash = audit.ipHashForEvent(event);
  var rl = await rateLimit.rateLimit("site-publish:user:" + userId, 4, 10 * 60 * 1000);
  if (!rl.ok) {
    return http.json(429, {
      ok: false,
      error: "rate_limited",
      userMessage: "しばらく待ってから再試行してください"
    }, event);
  }

  if (!body.userConfirmed) {
    return http.json(400, {
      ok: false,
      error: "confirm_required",
      userMessage: "公開確認が必要です"
    }, event);
  }

  var prNumber = Number(body.prNumber);
  if (!isFinite(prNumber) || prNumber < 1) {
    return http.json(400, {
      ok: false,
      error: "invalid_pr",
      userMessage: "公開するPRがありません"
    }, event);
  }

  var pr = await githubIssues.getPullRequest(prNumber);
  if (!pr.ok) {
    return http.json(502, {
      ok: false,
      error: pr.error || "pr_fetch_failed",
      userMessage: pr.userMessage || "PRを確認できませんでした"
    }, event);
  }
  if (!pr.merged) {
    return http.json(409, {
      ok: false,
      error: "pr_not_merged",
      userMessage: "PRがmainへmergeされるまで本番反映できません"
    }, event);
  }
  var baseRef = String(pr.baseRef || "").toLowerCase();
  if (baseRef !== "main" && baseRef !== "master") {
    return http.json(409, {
      ok: false,
      error: "pr_base_not_main",
      userMessage: "mainへmergeされたPRのみ公開できます"
    }, event);
  }

  var listed = await githubIssues.listPullFiles(prNumber);
  if (!listed.ok) {
    return http.json(502, {
      ok: false,
      error: listed.error || "pr_files_failed",
      userMessage: listed.userMessage || "変更ファイルを確認できませんでした"
    }, event);
  }
  var allowed = sitePublish.filterAllowedFiles(listed.filenames || []);
  if (!allowed.length) {
    return http.json(400, {
      ok: false,
      error: "no_allowed_files",
      userMessage: "このPRに公開できる公式サイトファイルがありません"
    }, event);
  }

  var ref = pr.mergeCommitSha || pr.headSha || "";
  var files = [];
  for (var i = 0; i < allowed.length; i++) {
    var one = allowed[i];
    // eslint-disable-next-line no-await-in-loop
    var got = await githubIssues.getRepoFileContent(one.repoPath, ref);
    if (!got.ok || !got.buffer) {
      return http.json(502, {
        ok: false,
        error: got.error || "file_fetch_failed",
        userMessage: "公開ファイルを取得できませんでした"
      }, event);
    }
    files.push({
      repoPath: one.repoPath,
      remotePath: one.remotePath,
      buffer: got.buffer
    });
  }

  if (!ftpClient.isSiteConfigured()) {
    await audit.recordAudit({
      event: "site_publish",
      success: false,
      reasonCode: "ftp_not_configured",
      actorUserId: userId,
      role: guard && guard.session ? guard.session.roleSnapshot : null,
      target: "api-site-publish",
      ipHash: ipHash
    });
    return http.json(503, {
      ok: false,
      error: "ftp_not_configured",
      userMessage: "公開先の接続設定が必要です"
    }, event);
  }

  var ftp;
  try {
    ftp = await ftpClient.connectSiteFromEnv();
  } catch (e) {
    await audit.recordAudit({
      event: "site_publish",
      success: false,
      reasonCode: e.code || "ftp_connect_failed",
      actorUserId: userId,
      role: guard && guard.session ? guard.session.roleSnapshot : null,
      target: "api-site-publish",
      ipHash: ipHash
    });
    return http.json(503, {
      ok: false,
      error: e.code || "ftp_connect_failed",
      userMessage: "公開先に接続できませんでした"
    }, event);
  }

  var result = await sitePublish.publishSiteFiles({
    userConfirmed: true,
    files: files,
    ftp: ftp
  });

  await audit.recordAudit({
    event: "site_publish",
    success: !!result.ok,
    reasonCode: result.ok ? "ok" : (result.code || "failed"),
    actorUserId: userId,
    role: guard && guard.session ? guard.session.roleSnapshot : null,
    target: "api-site-publish",
    ipHash: ipHash,
    meta: {
      prNumber: prNumber,
      jobId: body.jobId || null,
      files: result.publishedFiles || allowed.map(function (f) { return f.remotePath; }),
      productionUntouched: result.productionUntouched !== false
    }
  });

  if (!result.ok) {
    var status = result.code === "confirm_required" || result.code === "no_allowed_files" ? 400 : 502;
    return http.json(status, {
      ok: false,
      error: result.code,
      userMessage: result.userMessage || "公開できませんでした",
      productionUntouched: result.productionUntouched !== false
    }, event);
  }

  return http.json(200, {
    ok: true,
    code: result.code,
    userMessage: result.userMessage,
    publishedFiles: result.publishedFiles,
    productionUntouched: false,
    history: result.history || null
  }, event);
}

exports.handler = protectApi.wrapApi(handler, permissionKey);
