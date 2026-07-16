"use strict";

var env = require("./shared/env");
var http = require("./shared/http");
var kv = require("./shared/kv-store");
var lineClient = require("./shared/line-client");
var messages = require("./shared/message-builder");
var projectStore = require("./shared/project-store");

var lastSentAt = 0;

exports.handler = async function (event) {
  kv.connectFromLambdaEvent(event);
  if (event.httpMethod === "OPTIONS") return http.options();
  if (event.httpMethod !== "POST") {
    return http.json(405, { ok: false, error: "method_not_allowed" });
  }

  var now = Date.now();
  if (now - lastSentAt < 5000) {
    return http.json(429, { ok: false, error: "rate_limited" });
  }

  var config = env.getLineConfig();
  var missing = env.assertLineConfigured(config);
  if (missing.length) {
    return http.json(503, { ok: false, error: "line_not_configured" });
  }

  try {
    var result = await lineClient.pushMessage(
      config.accessToken,
      config.adminUserId,
      messages.buildTestMessage()
    );
    if (!result.ok) {
      console.log("[line-send-test] LINE push failed");
      console.log("[openai-error] status=", result.status != null ? result.status : "");
      console.log("[openai-error] message=", result.body || result.reason || "send_failed");
      console.log("[openai-error] stack=", "");
      return http.json(502, { ok: false, error: "send_failed" });
    }
    lastSentAt = now;
    await projectStore.patchLineMeta({ lastTestPushAt: new Date().toISOString() });
    return http.json(200, { ok: true });
  } catch (e) {
    console.log("[line-send-test] exception");
    console.log("[openai-error] status=", e && e.status != null ? e.status : "");
    console.log("[openai-error] message=", e && e.message ? e.message : String(e));
    console.log("[openai-error] stack=", e && e.stack ? e.stack : "");
    return http.json(502, { ok: false, error: "send_failed" });
  }
};
