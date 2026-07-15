"use strict";

var env = require("./shared/env");
var http = require("./shared/http");
var signature = require("./shared/line-signature");
var lineClient = require("./shared/line-client");
var router = require("./shared/command-router");
var projectStore = require("./shared/project-store");
var messages = require("./shared/message-builder");
var dedupe = require("./shared/event-dedupe");

async function rememberSeenUser(userId, sourceType) {
  if (!userId) return;
  var meta = await projectStore.getLineMeta();
  var recent = Array.isArray(meta.recentUserIds) ? meta.recentUserIds.slice() : [];
  recent = recent.filter(function (row) {
    return row && row.userId !== userId;
  });
  recent.unshift({
    userId: userId,
    at: new Date().toISOString(),
    sourceType: sourceType || "message"
  });
  recent = recent.slice(0, 10);
  await projectStore.patchLineMeta({
    lastWebhookAt: new Date().toISOString(),
    lastSeenUserId: userId,
    lastSeenUserAt: new Date().toISOString(),
    recentUserIds: recent
  });
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return http.options();
  if (event.httpMethod !== "POST") {
    return http.json(405, { ok: false, error: "method_not_allowed" });
  }

  var config = env.getLineConfig();
  var webhookMissing = env.assertWebhookReady(config);
  if (webhookMissing.length) {
    return http.json(503, { ok: false, error: "line_not_configured" });
  }

  var bootstrapMode = env.isAdminBootstrapMode(config);

  var rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : String(event.body || "");
  var headerSig =
    (event.headers && (event.headers["x-line-signature"] || event.headers["X-Line-Signature"])) || "";

  if (!signature.verifyLineSignature(rawBody, headerSig, config.channelSecret)) {
    return http.text(401, "invalid signature");
  }

  var payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return http.json(400, { ok: false, error: "invalid_json" });
  }

  await projectStore.patchLineMeta({ lastWebhookAt: new Date().toISOString() });

  var events = Array.isArray(payload.events) ? payload.events : [];
  for (var i = 0; i < events.length; i++) {
    var ev = events[i] || {};
    try {
      if (dedupe.rememberEvent(ev.webhookEventId || ev.replyToken + ":" + (ev.timestamp || i))) {
        continue;
      }

      var userId = ev.source && ev.source.userId ? String(ev.source.userId) : "";

      // Admin bootstrap: capture User ID from follow / text message
      if (bootstrapMode) {
        if ((ev.type === "follow" || (ev.type === "message" && ev.message && ev.message.type === "text")) && userId) {
          await rememberSeenUser(userId, ev.type);
          if (ev.replyToken) {
            await lineClient.replyMessage(
              config.accessToken,
              ev.replyToken,
              messages.buildUserIdCaptureMessage(userId)
            );
          }
        }
        continue;
      }

      if (ev.type !== "message" || !ev.message || ev.message.type !== "text") continue;
      if (!userId || userId !== config.adminUserId) {
        if (ev.replyToken) {
          await lineClient.replyMessage(
            config.accessToken,
            ev.replyToken,
            "この機能は管理者専用です"
          );
        }
        continue;
      }
      var result = await router.routeIncomingText(userId, ev.message.text || "");
      if (ev.replyToken) {
        await lineClient.replyMessage(config.accessToken, ev.replyToken, result.text);
      }
    } catch (err) {
      console.log(JSON.stringify({
        at: new Date().toISOString(),
        stage: "webhook-event",
        ok: false,
        type: ev.type || "unknown"
      }));
    }
  }

  return http.json(200, {
    ok: true,
    bootstrapMode: bootstrapMode
  });
};
