"use strict";

var env = require("./shared/env");
var http = require("./shared/http");
var lineClient = require("./shared/line-client");
var messages = require("./shared/message-builder");
var projectStore = require("./shared/project-store");
var protectApi = require("./shared/auth/protect-api");
var authConfig = require("./shared/auth/config");

var lastSentAt = 0;

async function handler(event) {
  if (event.httpMethod !== "POST") {
    return http.json(405, { ok: false, error: "method_not_allowed" });
  }

  var authCfg = authConfig.getAuthConfig();
  // Staging/local: block LINE production pushes unless explicitly enabled for staging tests.
  if (!authCfg.isProductionEnvironment) {
    if (!(authCfg.isStagingEnvironment && authCfg.stagingLineTestEnabled)) {
      return http.json(403, {
        ok: false,
        error: "forbidden",
        reason: "line_send_disabled_outside_production"
      });
    }
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
      return http.json(502, { ok: false, error: "send_failed" });
    }
    lastSentAt = now;
    await projectStore.patchLineMeta({ lastTestPushAt: new Date().toISOString() });
    return http.json(200, { ok: true });
  } catch (e) {
    console.log("[line-send-test] exception");
    return http.json(502, { ok: false, error: "send_failed" });
  }
}

exports.handler = protectApi.wrapApi(handler, "line-send-test:POST");
