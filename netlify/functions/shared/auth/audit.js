"use strict";

var cryptoUtil = require("./crypto-util");
var authKv = require("./auth-kv");
var config = require("./config");

var FORBIDDEN = {
  password: 1,
  token: 1,
  secret: 1,
  ftpPassword: 1,
  apiKey: 1,
  cookie: 1,
  resendApiKey: 1,
  privateKey: 1,
  authorization: 1
};

function sanitizeMeta(meta) {
  var out = {};
  if (!meta || typeof meta !== "object") return out;
  Object.keys(meta).forEach(function (k) {
    if (FORBIDDEN[k]) return;
    var lk = String(k).toLowerCase();
    if (lk.indexOf("password") !== -1 || lk.indexOf("token") !== -1 || lk.indexOf("secret") !== -1) return;
    var v = meta[k];
    if (typeof v === "string" && v.length > 200) v = v.slice(0, 200);
    out[k] = v;
  });
  return out;
}

async function recordAudit(entry) {
  var cfg = config.getAuthConfig();
  var id = cryptoUtil.newId("aud");
  var day = new Date().toISOString().slice(0, 10);
  var row = {
    id: id,
    event: String(entry.event || "unknown"),
    actorUserId: entry.actorUserId || null,
    role: entry.role || null,
    target: entry.target || null,
    success: !!entry.success,
    reasonCode: entry.reasonCode || null,
    timestamp: entry.timestamp || new Date().toISOString(),
    requestId: entry.requestId || cryptoUtil.newId("req"),
    ipHash: entry.ipHash || null,
    uaBrief: entry.uaBrief ? String(entry.uaBrief).slice(0, 80) : null,
    meta: sanitizeMeta(entry.meta)
  };
  await authKv.authSet("auditLogs/" + day + "/" + id, row);
  // append index (bounded)
  var idxKey = "auditLogs/index/" + day;
  var idx = (await authKv.authGet(idxKey)) || { ids: [] };
  idx.ids = [id].concat(idx.ids || []).slice(0, 500);
  await authKv.authSet(idxKey, idx);

  // Never log secrets; structured summary only
  console.log(JSON.stringify({
    at: row.timestamp,
    stage: "auth-audit",
    event: row.event,
    success: row.success,
    reasonCode: row.reasonCode,
    actor: row.actorUserId ? "set" : null,
    requestId: row.requestId
  }));
  return row;
}

function clientIp(event) {
  var h = (event && event.headers) || {};
  var xf = h["x-forwarded-for"] || h["X-Forwarded-For"] || "";
  if (xf) return String(xf).split(",")[0].trim();
  return h["client-ip"] || h["Client-Ip"] || "";
}

function uaBrief(event) {
  var h = (event && event.headers) || {};
  return String(h["user-agent"] || h["User-Agent"] || "").slice(0, 80);
}

function ipHashForEvent(event) {
  var cfg = config.getAuthConfig();
  return cryptoUtil.dailyIpHash(clientIp(event), cfg.ipHashSalt);
}

module.exports = {
  recordAudit: recordAudit,
  sanitizeMeta: sanitizeMeta,
  clientIp: clientIp,
  uaBrief: uaBrief,
  ipHashForEvent: ipHashForEvent
};
