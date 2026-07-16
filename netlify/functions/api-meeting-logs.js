"use strict";

var http = require("./shared/http");
var kv = require("./shared/kv-store");
var meetingLogStore = require("./shared/meeting-log-store");

exports.handler = async function (event) {
  kv.connectFromLambdaEvent(event);
  if (event.httpMethod === "OPTIONS") return http.options();
  if (event.httpMethod !== "GET") {
    return http.json(405, { ok: false, error: "method_not_allowed" });
  }
  try {
    var logs = await meetingLogStore.listMeetingLogs(20);
    return http.json(200, { ok: true, logs: logs });
  } catch (e) {
    return http.json(500, { ok: false, error: "unavailable" });
  }
};
