"use strict";

/**
 * Secret-safe structured logs for homepage FTP publish.
 * Never log credentials, tokens, API keys, or file bodies.
 */
var crypto = require("crypto");

var MAX_MSG = 160;
var FORBIDDEN_KEY = /password|token|secret|ftp_user|ftp_password|api[_-]?key|authorization|bearer|cookie|buffer|filebody|private[_-]?key|content/i;

function newRequestId() {
  return "spub_" + crypto.randomBytes(8).toString("hex");
}

function payloadLooksUnsafe(text) {
  var blob = String(text || "").toLowerCase();
  if (blob.indexOf("password") >= 0) return true;
  if (blob.indexOf("ftp_user") >= 0) return true;
  if (blob.indexOf("secret") >= 0) return true;
  if (blob.indexOf("apikey") >= 0 || blob.indexOf("api_key") >= 0) return true;
  if (blob.indexOf("github_token") >= 0) return true;
  if (blob.indexOf("bearer ") >= 0) return true;
  return false;
}

function sanitizeMessage(raw) {
  var s = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  s = s.replace(
    /(password|passwd|pwd|token|secret|authorization|api[_-]?key)\s*[:=]\s*\S+/ig,
    "$1=(redacted)"
  );
  if (s.length > MAX_MSG) s = s.slice(0, MAX_MSG);
  if (payloadLooksUnsafe(s)) return "(omitted)";
  return s;
}

function ftpErrorCode(err) {
  if (!err) return null;
  var code = err.code != null ? String(err.code) : "";
  if (/^\d{3}$/.test(code)) return code;
  var msg = String(err.message || err || "");
  var m = msg.match(/(?:^|\D)([1-5]\d{2})(?:\D|$)/);
  if (m) return m[1];
  if (code && !FORBIDDEN_KEY.test(code) && !payloadLooksUnsafe(code)) {
    return code.slice(0, 40);
  }
  return null;
}

function describeFtpError(err) {
  if (!err) return { ftpErrorCode: null, ftpErrorMessage: null };
  return {
    ftpErrorCode: ftpErrorCode(err),
    ftpErrorMessage: sanitizeMessage(err.message || err)
  };
}

function isForbiddenKey(key) {
  var k = String(key || "");
  if (FORBIDDEN_KEY.test(k)) return true;
  var lk = k.toLowerCase();
  return lk === "user" || lk === "host" || lk === "buffer" || lk === "body" || lk === "file";
}

function coerceValue(v) {
  if (v == null) return v;
  if (Buffer.isBuffer(v)) return undefined;
  if (typeof v === "boolean" || typeof v === "number") return v;
  if (typeof v === "string") return sanitizeMessage(v);
  if (Array.isArray(v)) {
    return v.slice(0, 20).map(function (item) {
      if (item == null) return item;
      if (typeof item === "string") return sanitizeMessage(item);
      if (typeof item === "number" || typeof item === "boolean") return item;
      return undefined;
    }).filter(function (item) { return item !== undefined; });
  }
  return undefined;
}

function pickSafe(payload) {
  var src = payload && typeof payload === "object" ? payload : {};
  var out = { at: new Date().toISOString() };
  Object.keys(src).forEach(function (k) {
    if (k === "at") return;
    if (isForbiddenKey(k)) return;
    var v = coerceValue(src[k]);
    if (v === undefined) return;
    out[k] = v;
  });
  return out;
}

function logEvent(payload) {
  var safe = pickSafe(payload);
  var dumped = JSON.stringify(safe);
  if (payloadLooksUnsafe(dumped)) {
    console.log(JSON.stringify({
      at: safe.at,
      stage: safe.stage || "site-publish",
      requestId: safe.requestId || null,
      omitted: true
    }));
    return safe;
  }
  console.log(dumped);
  return safe;
}

module.exports = {
  newRequestId: newRequestId,
  payloadLooksUnsafe: payloadLooksUnsafe,
  sanitizeMessage: sanitizeMessage,
  ftpErrorCode: ftpErrorCode,
  describeFtpError: describeFtpError,
  pickSafe: pickSafe,
  logEvent: logEvent
};
