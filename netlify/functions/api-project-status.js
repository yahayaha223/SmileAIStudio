"use strict";

var http = require("./shared/http");
var projectStore = require("./shared/project-store");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return http.options();
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
};
