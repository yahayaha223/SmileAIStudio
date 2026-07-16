"use strict";

var http = require("./shared/http");
var kv = require("./shared/kv-store");
var env = require("./shared/env");
var projectStore = require("./shared/project-store");
var conversationStore = require("./shared/conversation-store");
var memoryStore = require("./shared/conversation-memory-store");
var messages = require("./shared/message-builder");

exports.handler = async function (event) {
  kv.connectFromLambdaEvent(event);
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
  var bootstrapMode = env.isAdminBootstrapMode(config);
  var lastSeenUserId = String(meta.lastSeenUserId || "");
  var recentUserIds = Array.isArray(meta.recentUserIds) ? meta.recentUserIds : [];
  var chatCount = 0;
  if (config.adminUserId) {
    try {
      chatCount = await memoryStore.getChatMemoryCount(config.adminUserId);
    } catch (e) {
      chatCount = 0;
    }
  }

  return http.json(200, {
    ok: true,
    configured: missing.length === 0,
    missing: missing,
    bootstrapMode: bootstrapMode,
    lastSeenUserId: lastSeenUserId,
    lastSeenUserAt: meta.lastSeenUserAt || "",
    recentUserIds: recentUserIds.slice(0, 5).map(function (row) {
      return {
        userId: String(row.userId || ""),
        at: String(row.at || ""),
        sourceType: String(row.sourceType || "")
      };
    }),
    secrets: {
      LINE_CHANNEL_SECRET: env.maskSecret(config.channelSecret),
      LINE_CHANNEL_ACCESS_TOKEN: env.maskSecret(config.accessToken),
      LINE_ADMIN_USER_ID: config.adminUserId ? "設定済み" : "未設宁E,
      APP_BASE_URL: config.appBaseUrl ? "設定済み" : "未設宁E,
      OPENAI_API_KEY: env.maskSecret(config.openaiApiKey)
    },
    aiSecretary: {
      enabled: env.hasOpenAiKey(config),
      openai: env.maskSecret(config.openaiApiKey),
      chatMemoryCount: chatCount,
      lastAiReplyAt: meta.lastAiReplyAt || ""
    },
    lastWebhookAt: meta.lastWebhookAt || "",
    lastMorningPushAt: meta.lastMorningPushAt || "",
    lastTestPushAt: meta.lastTestPushAt || "",
    conversationStage: conversation && !conversation.expired ? (conversation.stage || "") : "",
    todayPriority: priority,
    morningPreview: messages.buildMorningMessage(projects, priority, 0),
    schedule: "0 23 * * * (UTC) = 日本時間 08:00",
    netlifyHint:
      "Netlify ↁESite configuration ↁEEnvironment variables ↁELINE_ADMIN_USER_ID / OPENAI_API_KEY"
  });
};
