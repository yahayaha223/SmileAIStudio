"use strict";

function getEnv(name, fallback) {
  var value = process.env[name];
  if (value == null || String(value).trim() === "") {
    return fallback == null ? "" : fallback;
  }
  return String(value).trim();
}

function getLineConfig() {
  return {
    channelSecret: getEnv("LINE_CHANNEL_SECRET"),
    accessToken: getEnv("LINE_CHANNEL_ACCESS_TOKEN"),
    adminUserId: getEnv("LINE_ADMIN_USER_ID"),
    appBaseUrl: getEnv("APP_BASE_URL")
  };
}

function maskSecret(value) {
  if (!value) return "未設定";
  return "設定済み";
}

function assertLineConfigured(config) {
  var missing = [];
  if (!config.channelSecret) missing.push("LINE_CHANNEL_SECRET");
  if (!config.accessToken) missing.push("LINE_CHANNEL_ACCESS_TOKEN");
  if (!config.adminUserId) missing.push("LINE_ADMIN_USER_ID");
  return missing;
}

/** Webhook受信に必要な最小構成（管理者IDは不要） */
function assertWebhookReady(config) {
  var missing = [];
  if (!config.channelSecret) missing.push("LINE_CHANNEL_SECRET");
  if (!config.accessToken) missing.push("LINE_CHANNEL_ACCESS_TOKEN");
  return missing;
}

function isAdminBootstrapMode(config) {
  return assertWebhookReady(config).length === 0 && !config.adminUserId;
}

module.exports = {
  getEnv: getEnv,
  getLineConfig: getLineConfig,
  maskSecret: maskSecret,
  assertLineConfigured: assertLineConfigured,
  assertWebhookReady: assertWebhookReady,
  isAdminBootstrapMode: isAdminBootstrapMode
};
