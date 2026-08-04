"use strict";

var http = require("../http");
var kv = require("../kv-store");
var authKv = require("./auth-kv");
var middleware = require("./middleware");

function mergeCorsOnto(response, event) {
  if (!response || typeof response !== "object") return response;
  var cors = http.corsHeaders(event, { credentials: true });
  var sec = http.securityHeaders();
  response.headers = response.headers || {};
  Object.keys(sec).forEach(function (k) {
    if (response.headers[k] == null) response.headers[k] = sec[k];
  });
  Object.keys(cors).forEach(function (k) {
    response.headers[k] = cors[k];
  });
  return response;
}

/**
 * Wrap an existing handler with auth enforcement.
 * permissionKeyOrResolver: string | (event) => string|null
 */
function wrapApi(innerHandler, permissionKeyOrResolver) {
  return async function (event) {
    kv.connectFromLambdaEvent(event);
    authKv.connectFromLambdaEvent(event);
    if (event.httpMethod === "OPTIONS") return http.options(event);

    var key = typeof permissionKeyOrResolver === "function"
      ? permissionKeyOrResolver(event)
      : permissionKeyOrResolver;

    if (!key) {
      return http.json(400, { ok: false, error: "unknown_action" }, event);
    }

    var guard = await middleware.enforceAccess(event, { permissionKey: key });
    if (!guard.ok) return guard.response;

    var result = await innerHandler(event, guard);
    return mergeCorsOnto(result, event);
  };
}

function parseBodySafe(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch (e) {
    return null;
  }
}

function tasksPermissionKey(event) {
  var method = String(event.httpMethod || "").toUpperCase();
  if (method === "GET") return "api-tasks:GET";
  if (method !== "POST") return null;
  var body = parseBodySafe(event) || {};
  var qs = event.queryStringParameters || {};
  var action = String(body.action || qs.action || "").trim();
  if (!action) return null;
  return "api-tasks:POST:" + action;
}

function knowledgePermissionKey(event) {
  var method = String(event.httpMethod || "").toUpperCase();
  if (method === "GET") return "api-knowledge:GET";
  if (method !== "POST") return null;
  var body = parseBodySafe(event) || {};
  var qs = event.queryStringParameters || {};
  var action = String(body.action || qs.action || "").trim();
  if (!action) return null;
  return "api-knowledge:POST:" + action;
}

module.exports = {
  wrapApi: wrapApi,
  tasksPermissionKey: tasksPermissionKey,
  knowledgePermissionKey: knowledgePermissionKey,
  parseBodySafe: parseBodySafe,
  mergeCorsOnto: mergeCorsOnto
};
