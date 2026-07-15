"use strict";

var kv = require("./kv-store");

var LOGS_KEY = "meetingLogs";
var MAX = 100;

function nowIso() {
  return new Date().toISOString();
}

function normalizeLog(raw) {
  if (!raw || typeof raw !== "object") return null;
  var id = String(raw.id || "").trim();
  var title = String(raw.title || "").trim();
  var content = String(raw.content || "").trim();
  if (!id || !title || !content) return null;
  return {
    id: id,
    date: String(raw.date || raw.createdAt || nowIso()),
    title: title,
    category: String(raw.category || "経営"),
    content: content,
    summary: String(raw.summary || ""),
    sourceType: String(raw.sourceType || "line-command"),
    sourceText: String(raw.sourceText || "").slice(0, 2000),
    selectedProjectId: String(raw.selectedProjectId || ""),
    selectedAction: String(raw.selectedAction || ""),
    userId: String(raw.userId || "").slice(0, 64),
    createdAt: String(raw.createdAt || nowIso())
  };
}

async function saveMeetingLog(entry) {
  var normalized = normalizeLog(entry);
  if (!normalized) return null;
  var list = await kv.kvGet(LOGS_KEY);
  if (!Array.isArray(list)) list = [];
  list.unshift(normalized);
  list = list.slice(0, MAX);
  var ok = await kv.kvSet(LOGS_KEY, list);
  return ok ? normalized : null;
}

async function listMeetingLogs(limit) {
  var list = await kv.kvGet(LOGS_KEY);
  if (!Array.isArray(list)) return [];
  return list.map(normalizeLog).filter(Boolean).slice(0, limit || 20);
}

module.exports = {
  saveMeetingLog: saveMeetingLog,
  listMeetingLogs: listMeetingLogs
};
