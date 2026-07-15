"use strict";

var kv = require("./kv-store");

var HISTORY_KEY = "commandHistory";
var MAX = 50;

function nowIso() {
  return new Date().toISOString();
}

async function addCommandHistory(entry) {
  var list = await kv.kvGet(HISTORY_KEY);
  if (!Array.isArray(list)) list = [];
  var item = {
    id: "cmd-" + Date.now(),
    at: nowIso(),
    type: String(entry.type || "command"),
    summary: String(entry.summary || "").slice(0, 200),
    projectId: String(entry.projectId || ""),
    projectName: String(entry.projectName || ""),
    action: String(entry.action || ""),
    ok: entry.ok !== false
  };
  list.unshift(item);
  list = list.slice(0, MAX);
  var saved = await kv.kvSet(HISTORY_KEY, list);
  return saved ? item : null;
}

async function listCommandHistory(limit) {
  var list = await kv.kvGet(HISTORY_KEY);
  if (!Array.isArray(list)) return [];
  return list.slice(0, limit || 5);
}

module.exports = {
  addCommandHistory: addCommandHistory,
  listCommandHistory: listCommandHistory
};
