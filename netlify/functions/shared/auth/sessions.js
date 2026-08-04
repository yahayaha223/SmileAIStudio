"use strict";

var authKv = require("./auth-kv");
var config = require("./config");
var cryptoUtil = require("./crypto-util");

function sessionKey(sessionHash) {
  return "sessions/" + sessionHash;
}

async function createSession(user, opts) {
  opts = opts || {};
  var cfg = config.getAuthConfig();
  var now = Date.now();
  var rawId = cryptoUtil.randomToken(32); // 256-bit
  var sessionHash = cryptoUtil.hashToken(rawId);
  var idle = cfg.idleTimeoutMs[user.role] || cfg.idleTimeoutMs.staff;
  var row = {
    sessionHash: sessionHash,
    userId: user.id,
    roleSnapshot: user.role,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + idle,
    absoluteExpiresAt: now + cfg.absoluteSessionMs,
    stepUpUntil: null,
    revokedAt: null,
    deviceName: opts.deviceName || "Unknown device",
    purpose: opts.purpose || "full", // full | passkey_enroll
    csrfToken: cryptoUtil.randomToken(24),
    uaBrief: opts.uaBrief || null,
    ipHash: opts.ipHash || null
  };
  await authKv.authSet(sessionKey(sessionHash), row);
  var uidx = (await authKv.authGet("sessionsByUser/" + user.id)) || { hashes: [] };
  uidx.hashes = [sessionHash].concat(uidx.hashes || []).filter(function (h, i, a) {
    return a.indexOf(h) === i;
  }).slice(0, 40);
  await authKv.authSet("sessionsByUser/" + user.id, uidx);
  return { rawId: rawId, session: row };
}

async function getSessionByRawId(rawId) {
  if (!rawId) return null;
  var sessionHash = cryptoUtil.hashToken(rawId);
  return authKv.authGet(sessionKey(sessionHash));
}

function isSessionActive(session, now) {
  now = typeof now === "number" ? now : Date.now();
  if (!session || session.revokedAt) return { ok: false, code: "REVOKED" };
  if (now > session.absoluteExpiresAt) return { ok: false, code: "ABSOLUTE_EXPIRED" };
  if (now > session.expiresAt) return { ok: false, code: "IDLE_EXPIRED" };
  return { ok: true, code: "OK" };
}

async function touchSession(session, now) {
  now = typeof now === "number" ? now : Date.now();
  var cfg = config.getAuthConfig();
  var idle = cfg.idleTimeoutMs[session.roleSnapshot] || cfg.idleTimeoutMs.staff;
  session.lastSeenAt = now;
  session.expiresAt = Math.min(now + idle, session.absoluteExpiresAt);
  await authKv.authSet(sessionKey(session.sessionHash), session);
  return session;
}

async function revokeSession(sessionHash, reason) {
  var session = await authKv.authGet(sessionKey(sessionHash));
  if (!session) return false;
  session.revokedAt = Date.now();
  session.revokeReason = reason || "revoked";
  await authKv.authSet(sessionKey(sessionHash), session);
  return true;
}

async function revokeAllUserSessions(userId, reason) {
  var uidx = (await authKv.authGet("sessionsByUser/" + userId)) || { hashes: [] };
  for (var i = 0; i < (uidx.hashes || []).length; i++) {
    await revokeSession(uidx.hashes[i], reason || "bulk_revoke");
  }
  return true;
}

async function setStepUp(session, until) {
  session.stepUpUntil = until;
  await authKv.authSet(sessionKey(session.sessionHash), session);
  return session;
}

async function listUserSessions(userId) {
  var uidx = (await authKv.authGet("sessionsByUser/" + userId)) || { hashes: [] };
  var out = [];
  var now = Date.now();
  for (var i = 0; i < (uidx.hashes || []).length; i++) {
    var s = await authKv.authGet(sessionKey(uidx.hashes[i]));
    if (!s) continue;
    out.push({
      sessionId: s.sessionHash,
      deviceName: s.deviceName,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      absoluteExpiresAt: s.absoluteExpiresAt,
      revoked: !!s.revokedAt,
      active: isSessionActive(s, now).ok,
      purpose: s.purpose,
      current: false
    });
  }
  return out;
}

module.exports = {
  createSession: createSession,
  getSessionByRawId: getSessionByRawId,
  isSessionActive: isSessionActive,
  touchSession: touchSession,
  revokeSession: revokeSession,
  revokeAllUserSessions: revokeAllUserSessions,
  setStepUp: setStepUp,
  listUserSessions: listUserSessions,
  sessionKey: sessionKey
};
