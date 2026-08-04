"use strict";

var http = require("./shared/http");
var meetingLogStore = require("./shared/meeting-log-store");
var protectApi = require("./shared/auth/protect-api");

async function handler(event) {
  if (event.httpMethod !== "GET") {
    return http.json(405, { ok: false, error: "method_not_allowed" });
  }
  try {
    var logs = await meetingLogStore.listMeetingLogs(20);
    return http.json(200, { ok: true, logs: logs });
  } catch (e) {
    return http.json(500, { ok: false, error: "unavailable" });
  }
}

exports.handler = protectApi.wrapApi(handler, "api-meeting-logs:GET");
