"use strict";

/**
 * POST /.netlify/functions/api-diary-publish
 * Production-only diary publish. FTP secrets stay server-side.
 * Owner + CSRF + explicit userConfirmed required.
 */
var http = require("./shared/http");
var protectApi = require("./shared/auth/protect-api");
var rateLimit = require("./shared/auth/rate-limit");
var audit = require("./shared/auth/audit");
var diaryPublish = require("./shared/diary-publish");
var ftpClient = require("./shared/ftp-client");

function parseBody(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch (e) {
    return null;
  }
}

function permissionKey(event) {
  if (String(event.httpMethod || "").toUpperCase() !== "POST") return null;
  return "api-diary-publish:POST";
}

async function handler(event, guard) {
  if (event.httpMethod !== "POST") {
    return http.json(405, { ok: false, error: "method_not_allowed" }, event);
  }
  var body = parseBody(event);
  if (!body) return http.json(400, { ok: false, error: "invalid_json" }, event);

  var userId = (guard && guard.session && guard.session.userId) || "anon";
  var ipHash = audit.ipHashForEvent(event);
  var rl = await rateLimit.rateLimit("diary-publish:user:" + userId, 6, 10 * 60 * 1000);
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

  if (!ftpClient.isConfigured()) {
    await audit.recordAudit({
      event: "diary_publish",
      success: false,
      reasonCode: "ftp_not_configured",
      actorUserId: userId,
      role: guard && guard.session ? guard.session.roleSnapshot : null,
      target: "api-diary-publish",
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
    ftp = await ftpClient.connectFromEnv();
  } catch (e) {
    await audit.recordAudit({
      event: "diary_publish",
      success: false,
      reasonCode: e.code || "ftp_connect_failed",
      actorUserId: userId,
      role: guard && guard.session ? guard.session.roleSnapshot : null,
      target: "api-diary-publish",
      ipHash: ipHash
    });
    return http.json(503, {
      ok: false,
      error: e.code || "ftp_connect_failed",
      userMessage: "公開先に接続できませんでした"
    }, event);
  }

  var result = await diaryPublish.publishDiaryOnServer({
    userConfirmed: true,
    entry: body.entry,
    images: body.images,
    ftp: ftp
  });

  await audit.recordAudit({
    event: "diary_publish",
    success: !!result.ok,
    reasonCode: result.ok ? "ok" : (result.code || "failed"),
    actorUserId: userId,
    role: guard && guard.session ? guard.session.roleSnapshot : null,
    target: "api-diary-publish",
    ipHash: ipHash,
    meta: {
      diaryId: (body.entry && body.entry.id) || null,
      imageCount: Array.isArray(body.images) ? body.images.length : 0,
      productionUntouched: result.productionUntouched !== false
    }
  });

  if (!result.ok) {
    var status = result.code === "confirm_required" || result.code === "invalid_entry" ? 400 : 502;
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
    pageUrl: result.pageUrl,
    diaryId: result.diaryId,
    productionUntouched: false,
    history: result.history || null
  }, event);
}

exports.handler = protectApi.wrapApi(handler, permissionKey);
