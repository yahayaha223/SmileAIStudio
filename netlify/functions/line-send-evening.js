"use strict";

/**
 * Evening task check — prepared for future schedule enablement.
 * Do NOT enable netlify.toml schedule until morning push is stable.
 */
var env = require("./shared/env");
var lineClient = require("./shared/line-client");
var taskStore = require("./shared/task-store");
var taskMessages = require("./shared/task-message-builder");
var taskParser = require("./shared/task-parser");
var conversationStore = require("./shared/conversation-store");
var kv = require("./shared/kv-store");
var authConfig = require("./shared/auth/config");

exports.handler = async function (event) {
  if (event) kv.connectFromLambdaEvent(event);

  if (!authConfig.isProductionEnvironment()) {
    return {
      statusCode: 403,
      body: JSON.stringify({ ok: false, error: "forbidden", reason: "line_schedule_disabled_outside_production" })
    };
  }

  var config = env.getLineConfig();
  var missing = env.assertLineConfigured(config);
  if (missing.length) {
    return {
      statusCode: 503,
      body: JSON.stringify({ ok: false, error: "line_not_configured" })
    };
  }

  // Safety: require explicit enable flag
  if (String(process.env.LINE_EVENING_TASKS_ENABLED || "") !== "1") {
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        skipped: true,
        reason: "LINE_EVENING_TASKS_ENABLED not set"
      })
    };
  }

  try {
    var today = taskParser.toYmd(taskParser.startOfJstDay());
    var all = await taskStore.listAllTasks();
    var dueToday = all.filter(function (t) { return t.dueDate === today; });
    var completedToday = dueToday.filter(function (t) { return t.status === "completed"; });
    var openToday = dueToday.filter(function (t) {
      return t.status === "pending" || t.status === "in_progress" || t.status === "postponed";
    });
    var text = taskMessages.buildEveningStub({
      todayTotal: dueToday.length,
      completedToday: completedToday.length,
      openTitles: openToday.map(function (t) { return t.title; })
    });
    var result = await lineClient.pushMessage(
      config.accessToken,
      config.adminUserId,
      text
    );
    if (!result.ok) {
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: "send_failed" }) };
    }
    await conversationStore.saveConversation(config.adminUserId, {
      stage: "awaiting-task-list-action",
      taskListIds: openToday.map(function (t) { return t.id; })
    });
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: "send_failed" }) };
  }
};
