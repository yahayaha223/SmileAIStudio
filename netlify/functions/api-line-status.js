"use strict";

var http = require("./shared/http");
var env = require("./shared/env");
var projectStore = require("./shared/project-store");
var conversationStore = require("./shared/conversation-store");
var messages = require("./shared/message-builder");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return http.options();
  if (event.httpMethod !== "GET") {
    return http.json(405, { ok: false, error: "method_not_allowed" });
  }

  var config = env.getLineConfig();
  var missing = env.assertLineConfigured(config);
  var meta = await projectStore.getLineMeta();
  var priority = await projectStore.getTodayPriority();
  var conversation = config.adminUserId
    ? await conversationStore.getConversation(config.adminUserId)
    : null;
  var projects = await projectStore.listEnabledProjects();

  return http.json(200, {
    ok: true,
    configured: missing.length === 0,
    missing: missing,
    secrets: {
      LINE_CHANNEL_SECRET: env.maskSecret(config.channelSecret),
      LINE_CHANNEL_ACCESS_TOKEN: env.maskSecret(config.accessToken),
      LINE_ADMIN_USER_ID: config.adminUserId ? "設定済み" : "未設定",
      APP_BASE_URL: config.appBaseUrl ? "設定済み" : "未設定"
    },
    lastWebhookAt: meta.lastWebhookAt || "",
    lastMorningPushAt: meta.lastMorningPushAt || "",
    lastTestPushAt: meta.lastTestPushAt || "",
    conversationStage: conversation && !conversation.expired ? (conversation.stage || "") : "",
    todayPriority: priority,
    morningPreview: messages.buildMorningMessage(projects, priority, 0),
    schedule: "0 23 * * * (UTC) = 日本時間 08:00"
  });
};
