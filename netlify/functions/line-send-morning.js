"use strict";

var env = require("./shared/env");
var lineClient = require("./shared/line-client");
var messages = require("./shared/message-builder");
var projectStore = require("./shared/project-store");
var conversationStore = require("./shared/conversation-store");
var taskStore = require("./shared/task-store");
var taskMessages = require("./shared/task-message-builder");
var kv = require("./shared/kv-store");
var authConfig = require("./shared/auth/config");

exports.handler = async function (event) {
  if (event) kv.connectFromLambdaEvent(event);

  // Staging/local Branch Deploy must never send scheduled LINE production pushes.
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

  try {
    var projects = await projectStore.listEnabledProjects();
    var priority = await projectStore.getTodayPriority();
    var dash = await taskStore.getDashboardCounts();
    var text = taskMessages.buildMorningWithTasks(projects, priority, dash);
    var result = await lineClient.pushMessage(
      config.accessToken,
      config.adminUserId,
      text
    );
    if (!result.ok) {
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: "send_failed" }) };
    }
    await conversationStore.saveConversation(config.adminUserId, {
      stage: "awaiting-morning-dashboard",
      selectedProjectId: "",
      choices: ["タスクを見る", "今日の最優先を変更", "プロジェクト状況を見る"],
      taskDraft: null,
      taskListIds: []
    });
    await projectStore.patchLineMeta({ lastMorningPushAt: new Date().toISOString() });
    return { statusCode: 200, body: JSON.stringify({ ok: true, tasksToday: dash.today, overdue: dash.overdue }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: "send_failed" }) };
  }
};
