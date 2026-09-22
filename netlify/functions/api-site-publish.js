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
var siteFtpPaths = require("./shared/site-ftp-paths");
var ftpClient = require("./shared/ftp-client");
var githubIssues = require("./shared/github-issues");
var sitePublishLog = require("./shared/site-publish-log");

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
  var requestId = sitePublishLog.newRequestId();
  var issueNumber = Number(body.issueNumber);
  if (!isFinite(issueNumber) || issueNumber < 1) issueNumber = null;
  var logBase = {
    requestId: requestId,
    issueNumber: issueNumber
  };
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
    sitePublishLog.logEvent(Object.assign({}, logBase, {
      stage: "site-publish-reject",
      reasonCode: "invalid_pr"
    }));
    return http.json(400, {
      ok: false,
      error: "invalid_pr",
      requestId: requestId,
      userMessage: "公開するPRがありません"
    }, event);
  }
  logBase.prNumber = prNumber;
  sitePublishLog.logEvent(Object.assign({}, logBase, {
    stage: "site-publish-start"
  }));

  var pr = await githubIssues.getPullRequest(prNumber);
  var mergeGate = githubIssues.assertPrMergedToMain(pr);
  if (!mergeGate.ok) {
    sitePublishLog.logEvent(Object.assign({}, logBase, {
      stage: "site-publish-reject",
      reasonCode: mergeGate.error || "pr_fetch_failed"
    }));
    return http.json(mergeGate.httpStatus || 502, {
      ok: false,
      error: mergeGate.error || "pr_fetch_failed",
      requestId: requestId,
      userMessage: mergeGate.userMessage || "PRを確認できませんでした"
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

  var siteRoot = siteFtpPaths.readConfiguredSiteRoot();
  var plan = siteFtpPaths.resolvePublishPlan(allowed.map(function (f) {
    return f.repoPath;
  }), siteRoot);
  if (!plan.ok) {
    await audit.recordAudit({
      event: "site_publish",
      success: false,
      reasonCode: plan.code || "invalid_ftp_path",
      actorUserId: userId,
      role: guard && guard.session ? guard.session.roleSnapshot : null,
      target: "api-site-publish",
      ipHash: ipHash,
      meta: {
        prNumber: prNumber,
        finalFtpPath: plan.finalFtpPath || null
      }
    });
    return http.json(409, {
      ok: false,
      error: plan.code,
      requestId: requestId,
      reasonCode: plan.code,
      userMessage: plan.userMessage || "公開先パスが不正です",
      productionUntouched: true
    }, event);
  }

  var cwdPlan = siteFtpPaths.validateSiteFtpCwd(siteFtpPaths.readConfiguredSiteCwd());
  if (!cwdPlan.ok) {
    await audit.recordAudit({
      event: "site_publish",
      success: false,
      reasonCode: cwdPlan.code || "invalid_ftp_cwd",
      actorUserId: userId,
      role: guard && guard.session ? guard.session.roleSnapshot : null,
      target: "api-site-publish",
      requestId: requestId,
      ipHash: ipHash,
      meta: {
        requestId: requestId,
        issueNumber: issueNumber,
        prNumber: prNumber,
        ftpCwd: cwdPlan.ftpCwd || null
      }
    });
    sitePublishLog.logEvent(Object.assign({}, logBase, {
      stage: "site-publish-reject",
      reasonCode: cwdPlan.code || "invalid_ftp_cwd",
      ftpCwd: cwdPlan.ftpCwd || siteFtpPaths.readConfiguredSiteCwd() || null,
      selectedMode: cwdPlan.loginRoot ? "loginRoot" : "publicHtmlCwd"
    }));
    return http.json(409, {
      ok: false,
      error: cwdPlan.code,
      requestId: requestId,
      reasonCode: cwdPlan.code,
      userMessage: cwdPlan.userMessage || "FTP作業フォルダが不正です",
      productionUntouched: true
    }, event);
  }
  siteFtpPaths.logPathPlan(plan, { ftpCwd: cwdPlan.cwd });
  sitePublishLog.logEvent(Object.assign({}, logBase, {
    stage: "site-publish-plan",
    siteRoot: plan.siteRoot,
    ftpCwd: cwdPlan.cwd,
    selectedMode: cwdPlan.loginRoot ? "loginRoot" : "publicHtmlCwd",
    finalFtpPath: plan.files.map(function (f) { return f.absolutePath; }).join(",")
  }));

  var ref = pr.mergeCommitSha || pr.headSha || "";
  var files = [];
  for (var i = 0; i < allowed.length; i++) {
    var one = allowed[i];
    // eslint-disable-next-line no-await-in-loop
    var got = await githubIssues.getRepoFileContent(one.repoPath, ref);
    if (!got.ok || !got.buffer) {
      sitePublishLog.logEvent(Object.assign({}, logBase, {
        stage: "site-publish-file-fetch-fail",
        reasonCode: got.error || "file_fetch_failed",
        failedFile: one.repoPath
      }));
      return http.json(502, {
        ok: false,
        error: got.error || "file_fetch_failed",
        requestId: requestId,
        failedFile: one.repoPath,
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
      reasonCode: "site_ftp_not_configured",
      actorUserId: userId,
      role: guard && guard.session ? guard.session.roleSnapshot : null,
      target: "api-site-publish",
      ipHash: ipHash
    });
    return http.json(503, {
      ok: false,
      error: "site_ftp_not_configured",
      requestId: requestId,
      reasonCode: "site_ftp_not_configured",
      userMessage: "公式サイトFTP接続設定が必要です",
      productionUntouched: true
    }, event);
  }

  var ftp;
  try {
    ftp = await ftpClient.connectSiteFromEnv();
  } catch (e) {
    var connErr = sitePublishLog.describeFtpError(e);
    sitePublishLog.logEvent(Object.assign({}, logBase, {
      stage: "site-publish-ftp-connect-fail",
      reasonCode: e.code || "ftp_connect_failed",
      ftpCwd: siteFtpPaths.readConfiguredSiteCwd() || null,
      pwdBeforeCwd: e.diagnostic && e.diagnostic.loginPwd ? e.diagnostic.loginPwd : null,
      ftpErrorCode: connErr.ftpErrorCode,
      ftpErrorMessage: connErr.ftpErrorMessage
    }));
    await audit.recordAudit({
      event: "site_publish",
      success: false,
      reasonCode: e.code || "ftp_connect_failed",
      actorUserId: userId,
      role: guard && guard.session ? guard.session.roleSnapshot : null,
      target: "api-site-publish",
      requestId: requestId,
      ipHash: ipHash,
      meta: {
        requestId: requestId,
        issueNumber: issueNumber,
        prNumber: prNumber,
        ftpCwd: siteFtpPaths.readConfiguredSiteCwd() || null,
        loginPwd: e.diagnostic && e.diagnostic.loginPwd ? e.diagnostic.loginPwd : null,
        rootDirs: e.diagnostic && e.diagnostic.rootDirs ? e.diagnostic.rootDirs : null,
        publicHtmlHints: e.diagnostic && e.diagnostic.publicHtmlHints ? e.diagnostic.publicHtmlHints : null,
        ftpErrorCode: connErr.ftpErrorCode,
        ftpErrorMessage: connErr.ftpErrorMessage
      }
    });
    return http.json(503, {
      ok: false,
      error: e.code || "ftp_connect_failed",
      requestId: requestId,
      userMessage: e.code === "ftp_cwd_550"
        ? (e.message || "公式サイトのFTP作業フォルダに入れません。SITE_FTP_CWD を確認してください")
        : "公開先に接続できませんでした",
      diagnostic: e.diagnostic || null,
      productionUntouched: true
    }, event);
  }

  var enter = ftp && ftp.siteEnter ? ftp.siteEnter : {};
  sitePublishLog.logEvent(Object.assign({}, logBase, {
    stage: "site-publish-ftp-ready",
    siteRoot: plan.siteRoot,
    ftpCwd: cwdPlan.cwd,
    selectedMode: enter.selectedMode || (cwdPlan.loginRoot ? "loginRoot" : "publicHtmlCwd"),
    pwdBeforeCwd: enter.pwdBeforeCwd || null,
    pwdAfterCwd: enter.pwdAfterCwd || null,
    skippedCd: !!enter.skippedCd,
    finalFtpPath: plan.files.map(function (f) { return f.absolutePath; }).join(",")
  }));

  var result = await sitePublish.publishSiteFiles({
    userConfirmed: true,
    files: files,
    ftp: ftp,
    siteRoot: plan.siteRoot,
    ftpCwd: cwdPlan.cwd,
    requestId: requestId,
    issueNumber: issueNumber,
    prNumber: prNumber,
    selectedMode: enter.selectedMode || (cwdPlan.loginRoot ? "loginRoot" : "publicHtmlCwd"),
    pwdBeforeCwd: enter.pwdBeforeCwd || null,
    pwdAfterCwd: enter.pwdAfterCwd || null
  });

  await audit.recordAudit({
    event: "site_publish",
    success: !!result.ok,
    reasonCode: result.ok ? "ok" : (result.reasonCode || result.code || "failed"),
    actorUserId: userId,
    role: guard && guard.session ? guard.session.roleSnapshot : null,
    target: "api-site-publish",
    requestId: requestId,
    ipHash: ipHash,
    meta: {
      requestId: requestId,
      issueNumber: issueNumber,
      prNumber: prNumber,
      jobId: body.jobId || null,
      files: result.publishedFiles || allowed.map(function (f) { return f.remotePath; }),
      finalFtpPaths: result.publishedAbsolutePaths || plan.files.map(function (f) { return f.absolutePath; }),
      ftpCwd: cwdPlan.cwd,
      selectedMode: enter.selectedMode || (cwdPlan.loginRoot ? "loginRoot" : "publicHtmlCwd"),
      pwdBeforeCwd: enter.pwdBeforeCwd || null,
      pwdAfterCwd: enter.pwdAfterCwd || null,
      skippedCd: !!enter.skippedCd,
      failedFile: result.failedFile || null,
      ftpErrorCode: result.ftpErrorCode || null,
      ftpErrorMessage: result.ftpErrorMessage || null,
      productionUntouched: result.productionUntouched !== false
    }
  });

  if (!result.ok) {
    var status = result.code === "confirm_required" || result.code === "no_allowed_files" ? 400 : 502;
    return http.json(status, {
      ok: false,
      error: result.code,
      requestId: requestId,
      reasonCode: result.reasonCode || result.code,
      failedFile: result.failedFile || null,
      ftpErrorCode: result.ftpErrorCode || null,
      userMessage: result.userMessage || "公開できませんでした",
      productionUntouched: result.productionUntouched !== false
    }, event);
  }

  return http.json(200, {
    ok: true,
    code: result.code,
    requestId: requestId,
    userMessage: result.userMessage,
    publishedFiles: result.publishedFiles,
    publishedAbsolutePaths: result.publishedAbsolutePaths,
    productionUntouched: false,
    history: result.history || null
  }, event);
}

exports.handler = protectApi.wrapApi(handler, permissionKey);
