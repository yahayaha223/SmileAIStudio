"use strict";

var https = require("https");
var config = require("./config");
var cryptoUtil = require("./crypto-util");

function buildLoginEmail(params) {
  var cfg = config.getAuthConfig();
  var mins = Math.max(1, Math.round((params.expiresAt - Date.now()) / 60000));
  var staging = cfg.isStagingEnvironment;
  var subject = staging
    ? "[STAGING] Smile AI Studio ログインリンク"
    : "Smile AI Studio ログインリンク";
  var lines = [];
  if (staging) {
    lines.push("【STAGING】このメールはステージング環境向けです。本番アカウントではありません。");
    lines.push("ステージングで登録したパスキーは本番切替時に再登録が必要です。");
    lines.push("");
  }
  lines = lines.concat([
    "Smile AI Studio へのログイン（または初回パスキー登録）リンクです。",
    "",
    "有効期限: 約" + mins + "分（1回限り有効）",
    "",
    "次のページを開き、表示された手順に従ってください:",
    params.url,
    "",
    "心当たりがない場合はこのメールを無視してください。",
    "リンクやコードを他者へ転送・返信しないでください。",
    "",
    "株式会社えがおのきろく / Smile AI Studio"
  ]);
  return { subject: subject, text: lines.join("\n") };
}

async function sendViaConsole(params) {
  var cfg = config.getAuthConfig();
  // Never log raw token. Only hashed hint for correlation.
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    stage: "auth-email-console",
    toHash: cryptoUtil.sha256Hex(params.to).slice(0, 12),
    expiresAt: new Date(params.expiresAt).toISOString(),
    urlHost: (function () {
      try { return new URL(params.url).host; } catch (e) { return "invalid"; }
    })(),
    tokenLogged: false
  }));
  var out = { ok: true, provider: "console" };
  if (cfg.exposeTestEmailToken && params.debugToken) {
    out.debugToken = params.debugToken;
  }
  return out;
}

function sendViaResend(params) {
  var cfg = config.getAuthConfig();
  return new Promise(function (resolve) {
    if (!cfg.resendApiKey || !cfg.emailFrom) {
      resolve({ ok: false, reasonCode: "email_provider_not_configured" });
      return;
    }
    var mail = buildLoginEmail(params);
    var body = JSON.stringify({
      from: cfg.emailFrom,
      to: [params.to],
      subject: mail.subject,
      text: mail.text
    });
    var req = https.request({
      hostname: "api.resend.com",
      path: "/emails",
      method: "POST",
      headers: {
        Authorization: "Bearer " + cfg.resendApiKey,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, provider: "resend" });
        } else {
          console.log(JSON.stringify({
            at: new Date().toISOString(),
            stage: "auth-email-resend",
            ok: false,
            status: res.statusCode
          }));
          resolve({ ok: false, reasonCode: "email_send_failed" });
        }
      });
    });
    req.on("error", function () {
      resolve({ ok: false, reasonCode: "email_send_failed" });
    });
    req.write(body);
    req.end();
  });
}

/**
 * sendLoginLink({ to, url, expiresAt, debugToken? })
 */
async function sendLoginLink(params) {
  var cfg = config.getAuthConfig();
  var provider = cfg.emailProvider;
  if (provider === "resend") {
    // Production-like: fail closed if not configured (do not pretend success)
    if (!cfg.resendApiKey || !cfg.emailFrom) {
      return { ok: false, reasonCode: "email_provider_not_configured" };
    }
    return sendViaResend(params);
  }
  // default console (local / preview)
  return sendViaConsole(params);
}

module.exports = {
  sendLoginLink: sendLoginLink,
  buildLoginEmail: buildLoginEmail
};
