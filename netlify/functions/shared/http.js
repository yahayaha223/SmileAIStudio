"use strict";

var authConfig = require("./auth/config");

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "Cache-Control": "no-store, no-cache, must-revalidate"
  };
}

function requestOrigin(event) {
  var h = (event && event.headers) || {};
  return h.origin || h.Origin || "";
}

function corsHeaders(event, opts) {
  opts = opts || {};
  var origin = requestOrigin(event);
  var headers = {};
  if (origin && authConfig.isOriginAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
    if (opts.credentials !== false) {
      headers["Access-Control-Allow-Credentials"] = "true";
    }
    headers["Access-Control-Allow-Headers"] =
      opts.allowHeaders || "Content-Type, X-CSRF-Token";
    headers["Access-Control-Allow-Methods"] =
      opts.allowMethods || "GET, POST, DELETE, OPTIONS";
  }
  // No wildcard. If origin missing/disallowed, omit ACAO.
  return headers;
}

function mergeHeaders(base, extra) {
  var out = {};
  Object.keys(base || {}).forEach(function (k) { out[k] = base[k]; });
  Object.keys(extra || {}).forEach(function (k) { out[k] = extra[k]; });
  return out;
}

function readEventBody(event) {
  event = event || {};
  var raw = event.body == null ? "" : String(event.body);
  if (event.isBase64Encoded && raw) {
    try {
      raw = Buffer.from(raw, "base64").toString("utf8");
    } catch (eDec) {
      return "";
    }
  }
  return raw;
}

function parseJsonBody(event) {
  var raw = readEventBody(event);
  if (!String(raw).trim()) return {};
  try {
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch (eParse) {
    return null;
  }
}

function safeJsonStringify(body) {
  try {
    return JSON.stringify(body);
  } catch (eJson) {
    return JSON.stringify({
      ok: false,
      error: "pipeline_error",
      reasonCode: "pipeline_error",
      userMessage: "応答を作れませんでした",
      productionUntouched: true
    });
  }
}

function json(statusCode, body, event, extraHeaders) {
  var headers = mergeHeaders(
    mergeHeaders(
      { "Content-Type": "application/json; charset=utf-8" },
      securityHeaders()
    ),
    corsHeaders(event || null, { credentials: true })
  );
  headers = mergeHeaders(headers, extraHeaders || {});
  return {
    statusCode: statusCode,
    headers: headers,
    multiValueHeaders: extraHeaders && extraHeaders["Set-Cookie"]
      ? undefined
      : undefined,
    body: safeJsonStringify(body)
  };
}

/**
 * JSON with Set-Cookie (array supported via multiValueHeaders).
 */
function jsonWithCookies(statusCode, body, event, setCookies) {
  var headers = mergeHeaders(
    mergeHeaders(
      { "Content-Type": "application/json; charset=utf-8" },
      securityHeaders()
    ),
    corsHeaders(event, { credentials: true })
  );
  var cookies = Array.isArray(setCookies) ? setCookies : [setCookies];
  return {
    statusCode: statusCode,
    headers: headers,
    multiValueHeaders: {
      "Set-Cookie": cookies.filter(Boolean)
    },
    body: safeJsonStringify(body)
  };
}

function text(statusCode, body, event) {
  return {
    statusCode: statusCode,
    headers: mergeHeaders(
      mergeHeaders(
        { "Content-Type": "text/plain; charset=utf-8" },
        securityHeaders()
      ),
      corsHeaders(event, { credentials: true })
    ),
    body: String(body || "")
  };
}

function options(event) {
  var origin = requestOrigin(event);
  if (origin && !authConfig.isOriginAllowed(origin)) {
    return {
      statusCode: 403,
      headers: securityHeaders(),
      body: ""
    };
  }
  return {
    statusCode: 204,
    headers: mergeHeaders(securityHeaders(), corsHeaders(event, {
      credentials: true,
      allowMethods: "GET, POST, DELETE, OPTIONS",
      allowHeaders: "Content-Type, X-CSRF-Token"
    })),
    body: ""
  };
}

/** Legacy helper kept for LINE webhook (no browser CORS). */
function jsonNoCors(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: mergeHeaders(
      { "Content-Type": "application/json; charset=utf-8" },
      securityHeaders()
    ),
    body: safeJsonStringify(body)
  };
}

module.exports = {
  json: json,
  jsonWithCookies: jsonWithCookies,
  text: text,
  options: options,
  jsonNoCors: jsonNoCors,
  securityHeaders: securityHeaders,
  corsHeaders: corsHeaders,
  requestOrigin: requestOrigin,
  readEventBody: readEventBody,
  parseJsonBody: parseJsonBody,
  safeJsonStringify: safeJsonStringify
};
