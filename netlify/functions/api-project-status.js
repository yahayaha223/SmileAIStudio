"use strict";

var http = require("./shared/http");
var projectStore = require("./shared/project-store");
var protectApi = require("./shared/auth/protect-api");

async function handler(event) {
  if (event.httpMethod !== "GET") {
    return http.json(405, { ok: false, error: "method_not_allowed" });
  }
  try {
    var projects = await projectStore.ensureProjects();
    var todayPriority = await projectStore.getTodayPriority();
    return http.json(200, {
      ok: true,
      projects: projects,
      todayPriority: todayPriority
    });
  } catch (e) {
    return http.json(500, { ok: false, error: "unavailable" });
  }
}

exports.handler = protectApi.wrapApi(handler, "api-project-status:GET");
