"use strict";

/**
 * POST /.netlify/functions/api-diary-delete
 * Production-only diary list/delete. FTP secrets stay server-side.
 * Owner + CSRF. Delete requires explicit userConfirmed.
 */
var http = require("./shared/http");
var protectApi = require("./shared/auth/protect-api");
var rateLimit = require("./shared/auth/rate-limit");
var audit = require("./shared/auth/audit");
var diaryDelete = require("./shared/diary-delete");
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
  return "api-diary-delete:POST";
}

async function connectDiaryFtp(event, guard, userId, ipHash) {
  if (!ftpClient.isConfigured()) {
    await audit.recordAudit({
      event: "diary_delete",
      success: false,
      reasonCode: "ftp_not_configured",
      actorUserId: userId,
      role: guard && guard.session ? guard.session.roleSnapshot : null,
      target: "api-diary-delete",
      ipHash: ipHash
    });
    return {
      ok: false,
      response: http.json(503, {
        ok: false,
        error: "ftp_not_configured",
        userMessage: "公開先の接続設定が必要です"
      }, event)
    };
  }
  try {
    return { ok: true, ftp: await ftpClient.connectFromEnv() };
  } catch (e) {
    await audit.recordAudit({
      event: "diary_delete",
      success: false,
      reasonCode: e.code || "ftp_connect_failed",
      actorUserId: userId,
      role: guard && guard.session ? guard.session.roleSnapshot : null,
      target: "api-diary-delete",
      ipHash: ipHash
    });
    return {
      ok: false,
      response: http.json(503, {
        ok: false,
        error: e.code || "ftp_connect_failed",
        userMessage: "公開先に接続できませんでした"
      }, event)
    };
  }
}

async function handler(event, guard) {
  if (event.httpMethod !== "POST") {
    return http.json(405, { ok: false, error: "method_not_allowed" }, event);
  }
  var body = parseBody(event);
  if (!body) return http.json(400, { ok: false, error: "invalid_json" }, event);

  var action = String(body.action || "delete").trim();
  if (action !== "list" && action !== "delete") {
    return http.json(400, { ok: false, error: "unknown_action", userMessage: "操作が不正です" }, event);
  }

  var userId = (guard && guard.session && guard.session.userId) || "anon";
  var ipHash = audit.ipHashForEvent(event);
  var rlKey = action === "list" ? "diary-delete-list:user:" + userId : "diary-delete:user:" + userId;
  var rl = await rateLimit.rateLimit(rlKey, action === "list" ? 20 : 6, 10 * 60 * 1000);
  if (!rl.ok) {
    return http.json(429, {
      ok: false,
      error: "rate_limited",
      userMessage: "しばらく待ってから再試行してください"
    }, event);
  }

  if (action === "delete" && !body.userConfirmed) {
    return http.json(400, {
      ok: false,
      error: "confirm_required",
      userMessage: "削除確認が必要です"
    }, event);
  }

  var connected = await connectDiaryFtp(event, guard, userId, ipHash);
  if (!connected.ok) return connected.response;

  var result = action === "list"
    ? await diaryDelete.listDiariesOnServer({ ftp: connected.ftp })
    : await diaryDelete.deleteDiaryOnServer({
      userConfirmed: true,
      diaryId: body.diaryId,
      ftp: connected.ftp
    });

  await audit.recordAudit({
    event: action === "list" ? "diary_list" : "diary_delete",
    success: !!result.ok,
    reasonCode: result.ok ? "ok" : (result.code || "failed"),
    actorUserId: userId,
    role: guard && guard.session ? guard.session.roleSnapshot : null,
    target: "api-diary-delete",
    ipHash: ipHash,
    meta: {
      action: action,
      diaryId: body.diaryId || null,
      productionUntouched: result.productionUntouched !== false
    }
  });

  if (!result.ok) {
    var status = 502;
    if (
      result.code === "confirm_required" ||
      result.code === "invalid_diary_id" ||
      result.code === "not_found" ||
      result.code === "ambiguous_id" ||
      result.code === "last_article"
    ) {
      status = 400;
    }
    return http.json(status, {
      ok: false,
      error: result.code,
      userMessage: result.userMessage || "日記を消せませんでした",
      productionUntouched: result.productionUntouched !== false
    }, event);
  }

  if (action === "list") {
    return http.json(200, {
      ok: true,
      code: result.code,
      userMessage: result.userMessage,
      articles: result.articles || [],
      count: result.count || 0,
      pageUrl: result.pageUrl,
      productionUntouched: true
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
