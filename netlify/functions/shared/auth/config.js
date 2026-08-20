"use strict";

var env = require("../env");

var COOKIE_SESSION = "smile_studio_session";
var COOKIE_CSRF = "smile_studio_csrf";
var PRODUCTION_RP_ID = "studio.egaonokiroku.co.jp";
var PRODUCTION_ORIGIN = "https://studio.egaonokiroku.co.jp";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function parseList(raw) {
  return String(raw || "")
    .split(",")
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
}

/**
 * off | observe | enforce
 * Unknown values fail closed to enforce.
 * Production must not casually use off (documented emergency only).
 */
function getEnforcementMode() {
  var raw = String(env.getEnv("AUTH_ENFORCEMENT_MODE", "off")).trim().toLowerCase();
  if (raw === "off" || raw === "observe" || raw === "enforce") return raw;
  return "enforce";
}

function getRpId() {
  return String(env.getEnv("AUTH_RP_ID", "localhost")).trim() || "localhost";
}

function getRpName() {
  return String(env.getEnv("AUTH_RP_NAME", "Smile AI Studio")).trim() || "Smile AI Studio";
}

function isProductionRp() {
  return getRpId() === PRODUCTION_RP_ID;
}

/**
 * local | staging | production
 * Unknown values fall back to local (never silently treat as production).
 */
function getAuthEnvironment() {
  var raw = String(env.getEnv("AUTH_ENVIRONMENT", "local")).trim().toLowerCase();
  if (raw === "local" || raw === "staging" || raw === "production") return raw;
  return "local";
}

function isProductionEnvironment() {
  return getAuthEnvironment() === "production";
}

function isStagingEnvironment() {
  return getAuthEnvironment() === "staging";
}

/** Auth data namespace prefix (Blobs/file keys). */
function getAuthDataPrefix() {
  return getAuthEnvironment() + "/";
}

/**
 * Important ops that must never run outside production (code hard-deny).
 */
function isProductionOnlyPermission(permissionKey) {
  var key = String(permissionKey || "");
  var blocked = [
    "production-publish:POST",
    "api-diary-publish:POST",
    "ftp-upload:POST",
    "backup-restore:POST",
    "secrets:POST",
    "changeConnectionSettings",
    "user-admin:POST"
  ];
  return blocked.indexOf(key) !== -1;
}

/**
 * GitHub Issue mutations can start a Cursor Automation.
 * Always require a real owner session + CSRF, even if AUTH_ENFORCEMENT_MODE is off/observe.
 */
function isAlwaysEnforcedPermission(permissionKey) {
  var key = String(permissionKey || "");
  return key === "api-github-issues:POST:create" ||
    key === "api-github-issues:POST:update-agent-status" ||
    key === "api-diary-publish:POST";
}

/**
 * Exact-match allowlist only. Never endsWith / partial.
 */
function getAllowedOrigins() {
  var list = parseList(env.getEnv("AUTH_ALLOWED_ORIGINS", ""));
  var defaults = [
    "http://127.0.0.1:8888",
    "http://localhost:8888",
    "http://127.0.0.1:8889",
    "http://localhost:8889",
    "http://127.0.0.1:8790",
    "http://localhost:8790",
    "http://127.0.0.1:8765",
    "http://localhost:8765"
  ];
  // Production origin only when running as production (never auto-allow on staging)
  if (getAuthEnvironment() === "production") {
    defaults.push(PRODUCTION_ORIGIN);
  }
  var preview = String(env.getEnv("AUTH_PREVIEW_ORIGIN", "")).trim();
  if (preview) defaults.push(preview);
  var out = [];
  var seen = Object.create(null);
  defaults.concat(list).forEach(function (o) {
    if (!seen[o]) {
      seen[o] = true;
      out.push(o);
    }
  });
  return out;
}

function isOriginAllowed(origin) {
  if (!origin) return false;
  return getAllowedOrigins().indexOf(String(origin)) !== -1;
}

function cookieSecureDefault() {
  var flag = String(env.getEnv("AUTH_COOKIE_SECURE", "")).trim().toLowerCase();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return isProductionRp();
}

function getAuthConfig() {
  var authEnvironment = getAuthEnvironment();
  return {
    cookieSession: COOKIE_SESSION,
    cookieCsrf: COOKIE_CSRF,
    authEnvironment: authEnvironment,
    dataPrefix: getAuthDataPrefix(),
    rpId: getRpId(),
    rpName: getRpName(),
    productionRpId: PRODUCTION_RP_ID,
    productionOrigin: PRODUCTION_ORIGIN,
    isProductionRp: isProductionRp(),
    isProductionEnvironment: authEnvironment === "production",
    isStagingEnvironment: authEnvironment === "staging",
    enforcementMode: getEnforcementMode(),
    allowedOrigins: getAllowedOrigins(),
    cookieSecure: cookieSecureDefault(),
    emailTtlMs: 10 * 60 * 1000,
    challengeTtlMs: 5 * 60 * 1000,
    // Short-lived cookie/session for email → passkey enrollment (2nd device included)
    enrollSessionMs: 15 * 60 * 1000,
    stepUpTtlMs: 5 * 60 * 1000,
    idleTimeoutMs: {
      owner: 30 * 60 * 1000,
      admin: 60 * 60 * 1000,
      staff: 60 * 60 * 1000
    },
    absoluteSessionMs: 12 * 60 * 60 * 1000,
    bootstrapEnabled: String(env.getEnv("AUTH_BOOTSTRAP_ENABLED", "")).trim() === "1",
    bootstrapOwnerEmail: normalizeEmail(env.getEnv("AUTH_BOOTSTRAP_OWNER_EMAIL", "")),
    emailProvider: String(env.getEnv("AUTH_EMAIL_PROVIDER", "console")).trim().toLowerCase() || "console",
    emailFrom: String(env.getEnv("AUTH_EMAIL_FROM", "")).trim(),
    resendApiKey: String(env.getEnv("RESEND_API_KEY", "")).trim(),
    appPublicUrl: String(env.getEnv("AUTH_APP_URL", env.getEnv("APP_BASE_URL", ""))).trim(),
    // When 1, console provider may return debugToken in JSON for local tests only
    exposeTestEmailToken: String(env.getEnv("AUTH_TEST_EXPOSE_EMAIL_TOKEN", "")).trim() === "1",
    ipHashSalt: String(env.getEnv("AUTH_IP_HASH_SALT", "smile-auth-ip-salt")).trim(),
    adminPublishEnabled: String(env.getEnv("AUTH_ADMIN_PUBLISH_ENABLED", "")).trim() === "1",
    // Staging LINE test push (admin only). Default off.
    stagingLineTestEnabled: String(env.getEnv("AUTH_STAGING_LINE_TEST_ENABLED", "")).trim() === "1"
  };
}

function genericAuthMessage() {
  return "リクエストを受け付けました。登録がある場合のみ案内が届きます。";
}

function genericLoginFail() {
  return "ログインできませんでした。入力内容をご確認のうえ、再度お試しください。";
}

module.exports = {
  COOKIE_SESSION: COOKIE_SESSION,
  COOKIE_CSRF: COOKIE_CSRF,
  PRODUCTION_RP_ID: PRODUCTION_RP_ID,
  PRODUCTION_ORIGIN: PRODUCTION_ORIGIN,
  normalizeEmail: normalizeEmail,
  getEnforcementMode: getEnforcementMode,
  getRpId: getRpId,
  getRpName: getRpName,
  isProductionRp: isProductionRp,
  getAuthEnvironment: getAuthEnvironment,
  isProductionEnvironment: isProductionEnvironment,
  isStagingEnvironment: isStagingEnvironment,
  getAuthDataPrefix: getAuthDataPrefix,
  isProductionOnlyPermission: isProductionOnlyPermission,
  isAlwaysEnforcedPermission: isAlwaysEnforcedPermission,
  getAllowedOrigins: getAllowedOrigins,
  isOriginAllowed: isOriginAllowed,
  getAuthConfig: getAuthConfig,
  genericAuthMessage: genericAuthMessage,
  genericLoginFail: genericLoginFail
};
