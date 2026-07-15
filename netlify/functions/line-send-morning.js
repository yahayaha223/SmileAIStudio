"use strict";

var env = require("./shared/env");
var lineClient = require("./shared/line-client");
var messages = require("./shared/message-builder");
var projectStore = require("./shared/project-store");
var conversationStore = require("./shared/conversation-store");

exports.handler = async function () {
  var config = env.getLineConfig();
  var missing = env.assertLineConfigured(config);
  if (missing.length) {
    return {
      statusCode: 503,
      body: JSON.stringify({ ok: false, error: "line_not_configured" })
    };
  }

  try {
    var projects = await projectStore.listEnabledProjects();
    var priority = await projectStore.getTodayPriority();
    var text = messages.buildMorningMessage(projects, priority, 0);
    var result = await lineClient.pushMessage(
      config.accessToken,
      config.adminUserId,
      text
    );
    if (!result.ok) {
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: "send_failed" }) };
    }
    await conversationStore.saveConversation(config.adminUserId, {
      stage: "awaiting-project",
      selectedProjectId: "",
      choices: projects.map(function (p) { return p.id; })
    });
    await projectStore.patchLineMeta({ lastMorningPushAt: new Date().toISOString() });
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: "send_failed" }) };
  }
};
