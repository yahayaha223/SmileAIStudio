"use strict";

var config = require("./config");

function buildCookie(name, value, opts) {
  opts = opts || {};
  var cfg = config.getAuthConfig();
  var parts = [name + "=" + value];
  parts.push("Path=" + (opts.path || "/"));
  if (opts.maxAge != null) parts.push("Max-Age=" + String(opts.maxAge));
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  if (opts.secure != null ? opts.secure : cfg.cookieSecure) parts.push("Secure");
  parts.push("SameSite=" + (opts.sameSite || "Lax"));
  // Domain intentionally omitted (host-only)
  if (opts.clear) {
    parts = [name + "=", "Path=/", "Max-Age=0"];
    if (opts.httpOnly !== false) parts.push("HttpOnly");
    if (opts.secure != null ? opts.secure : cfg.cookieSecure) parts.push("Secure");
    parts.push("SameSite=" + (opts.sameSite || "Lax"));
  }
  return parts.join("; ");
}

function parseCookies(event) {
  var h = (event && event.headers) || {};
  var raw = h.cookie || h.Cookie || "";
  var out = Object.create(null);
  String(raw).split(";").forEach(function (part) {
    var i = part.indexOf("=");
    if (i === -1) return;
    var k = part.slice(0, i).trim();
    var v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function sessionCookie(rawId, maxAgeSec) {
  var cfg = config.getAuthConfig();
  return buildCookie(cfg.cookieSession, encodeURIComponent(rawId), {
    httpOnly: true,
    secure: cfg.cookieSecure,
    sameSite: "Lax",
    maxAge: maxAgeSec != null ? maxAgeSec : Math.floor(cfg.absoluteSessionMs / 1000)
  });
}

function clearSessionCookie() {
  var cfg = config.getAuthConfig();
  return buildCookie(cfg.cookieSession, "", { clear: true, httpOnly: true });
}

function csrfCookie(token, maxAgeSec) {
  var cfg = config.getAuthConfig();
  // Readable by JS for double-submit
  return buildCookie(cfg.cookieCsrf, encodeURIComponent(token), {
    httpOnly: false,
    secure: cfg.cookieSecure,
    sameSite: "Lax",
    maxAge: maxAgeSec != null ? maxAgeSec : Math.floor(cfg.absoluteSessionMs / 1000)
  });
}

function clearCsrfCookie() {
  var cfg = config.getAuthConfig();
  return buildCookie(cfg.cookieCsrf, "", { clear: true, httpOnly: false });
}

module.exports = {
  buildCookie: buildCookie,
  parseCookies: parseCookies,
  sessionCookie: sessionCookie,
  clearSessionCookie: clearSessionCookie,
  csrfCookie: csrfCookie,
  clearCsrfCookie: clearCsrfCookie
};
