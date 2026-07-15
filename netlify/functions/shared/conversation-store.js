"use strict";

var kv = require("./kv-store");

var KEY_PREFIX = "conversation:";
var TTL_MS = 24 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function conversationKey(userId) {
  return KEY_PREFIX + String(userId || "unknown");
}

async function getConversation(userId) {
  var data = await kv.kvGet(conversationKey(userId));
  if (!data || typeof data !== "object") return null;
  if (data.expiresAt && new Date(data.expiresAt).getTime() < Date.now()) {
    return Object.assign({}, data, { expired: true });
  }
  return data;
}

async function saveConversation(userId, patch) {
  var current = (await getConversation(userId)) || {};
  if (current.expired) current = {};
  var next = Object.assign({}, current, patch, {
    userId: String(userId),
    updatedAt: nowIso(),
    expiresAt: new Date(Date.now() + TTL_MS).toISOString()
  });
  if (!next.startedAt) next.startedAt = nowIso();
  var ok = await kv.kvSet(conversationKey(userId), next);
  return ok ? next : null;
}

async function clearConversation(userId) {
  return saveConversation(userId, {
    stage: "completed",
    selectedProjectId: "",
    choices: [],
    expired: false
  });
}

module.exports = {
  getConversation: getConversation,
  saveConversation: saveConversation,
  clearConversation: clearConversation,
  TTL_MS: TTL_MS
};
