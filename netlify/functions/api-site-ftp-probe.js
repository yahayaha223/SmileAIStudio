"use strict";

/**
 * POST /.netlify/functions/api-site-ftp-probe
 * Read-only FTP layout diagnosis. Owner + CSRF. Never STOR/rename/remove/cd.
 */
var http = require("./shared/http");
var protectApi = require("./shared/auth/protect-api");
var rateLimit = require("./shared/auth/rate-limit");
var audit = require("./shared/auth/audit");
var ftpClient = require("./shared/ftp-client");
var siteFtpProbe = require("./shared/site-ftp-probe");

function permissionKey(event) {
  if (String(event.httpMethod || "").toUpperCase() !== "POST") return null;
  return "api-site-ftp-probe:POST";
}

async function handler(event, guard) {
  if (event.httpMethod !== "POST") {
    return http.json(405, { ok: false, error: "method_not_allowed" }, event);
  }

  var userId = (guard && guard.session && guard.session.userId) || "anon";
  var ipHash = audit.ipHashForEvent(event);
  var rl = await rateLimit.rateLimit("site-ftp-probe:user:" + userId, 6, 10 * 60 * 1000);
  if (!rl.ok) {
    return http.json(429, {
      ok: false,
      error: "rate_limited",
      userMessage: "しばらく待ってから再試行してください"
    }, event);
  }

  var cfg = ftpClient.getFtpConfig();
  if (!(cfg.host && cfg.user && cfg.password)) {
    await audit.recordAudit({
      event: "site_ftp_probe",
      success: false,
      reasonCode: "ftp_not_configured",
      actorUserId: userId,
      role: guard && guard.session ? guard.session.roleSnapshot : null,
      target: "api-site-ftp-probe",
      ipHash: ipHash
    });
    return http.json(503, {
      ok: false,
      error: "ftp_not_configured",
      userMessage: "FTP接続設定が必要です"
    }, event);
  }

  var ftp;
  try {
    ftp = await ftpClient.connectLoginOnlyFromEnv();
  } catch (e) {
    await audit.recordAudit({
      event: "site_ftp_probe",
      success: false,
      reasonCode: e.code || "ftp_connect_failed",
      actorUserId: userId,
      role: guard && guard.session ? guard.session.roleSnapshot : null,
      target: "api-site-ftp-probe",
      ipHash: ipHash
    });
    return http.json(503, {
      ok: false,
      error: e.code || "ftp_connect_failed",
      userMessage: "FTPに接続できませんでした"
    }, event);
  }

  var result;
  try {
    result = await siteFtpProbe.probeLoginLayout(ftp);
  } finally {
    if (ftp && typeof ftp.close === "function") {
      try { await ftp.close(); } catch (eClose) { /* ignore */ }
    }
  }

  await audit.recordAudit({
    event: "site_ftp_probe",
    success: !!(result && result.ok),
    reasonCode: result && result.ok ? "ok" : (result && result.code) || "failed",
    actorUserId: userId,
    role: guard && guard.session ? guard.session.roleSnapshot : null,
    target: "api-site-ftp-probe",
    ipHash: ipHash,
    meta: {
      loginPwd: result && result.loginPwd ? result.loginPwd : null,
      rootDirs: result && result.rootDirs ? result.rootDirs : [],
      publicHtmlHints: result && result.publicHtmlHints ? result.publicHtmlHints : []
    }
  });

  if (!result || !result.ok) {
    return http.json(502, {
      ok: false,
      error: result && result.code ? result.code : "probe_failed",
      userMessage: (result && result.userMessage) || "FTP公開先を確認できませんでした"
    }, event);
  }

  return http.json(200, {
    ok: true,
    loginPwd: result.loginPwd,
    rootDirs: result.rootDirs,
    publicHtmlHints: result.publicHtmlHints,
    writeOps: 0,
    userMessage: "FTP公開先の読み取り診断が完了しました"
  }, event);
}

exports.handler = protectApi.wrapApi(handler, permissionKey);
