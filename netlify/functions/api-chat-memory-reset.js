"use strict";

var http = require("./shared/http");
var env = require("./shared/env");
var memoryStore = require("./shared/conversation-memory-store");

/**
 * Reset free-chat memory for the admin user only.
 * Does not delete projects / meeting logs / command history.
 */
exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return http.options();
  if (event.httpMethod !== "POST") {
    return http.json(405, { ok: false, error: "method_not_allowed" });
  }

  var config = env.getLineConfig();
  if (!config.adminUserId) {
    return http.json(503, { ok: false, error: "admin_not_configured" });
  }

  try {
    var ok = await memoryStore.clearChatMemory(config.adminUserId);
    if (!ok) return http.json(500, { ok: false, error: "reset_failed" });
    return http.json(200, { ok: true });
  } catch (e) {
    return http.json(500, { ok: false, error: "reset_failed" });
  }
};
