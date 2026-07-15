"use strict";

var kv = require("./kv-store");
var defaults = require("./defaults");

var PROJECTS_KEY = "projects";
var PRIORITY_KEY = "todayPriority";
var META_KEY = "lineMeta";

function nowIso() {
  return new Date().toISOString();
}

function normalizeProject(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  var id = String(raw.id || "").trim();
  var name = String(raw.name || "").trim();
  if (!id || !name) return null;
  return {
    id: id,
    name: name,
    icon: String(raw.icon || "📁"),
    description: String(raw.description || ""),
    status: String(raw.status || "準備中"),
    priority: String(raw.priority || "通常"),
    progress: Math.max(0, Math.min(100, Number(raw.progress) || 0)),
    currentIssue: String(raw.currentIssue || ""),
    nextActions: Array.isArray(raw.nextActions)
      ? raw.nextActions.map(function (a) { return String(a || "").trim(); }).filter(Boolean)
      : [],
    enabled: raw.enabled !== false,
    updatedAt: String(raw.updatedAt || nowIso()),
    sortOrder: typeof raw.sortOrder === "number" ? raw.sortOrder : index
  };
}

async function ensureProjects() {
  var existing = await kv.kvGet(PROJECTS_KEY);
  if (Array.isArray(existing) && existing.length) {
    return existing.map(normalizeProject).filter(Boolean);
  }
  var seeded = defaults.DEFAULT_PROJECTS.map(function (p, i) {
    return normalizeProject(Object.assign({}, p, { updatedAt: nowIso() }), i);
  });
  await kv.kvSet(PROJECTS_KEY, seeded);
  return seeded;
}

async function listEnabledProjects() {
  var all = await ensureProjects();
  return all.filter(function (p) { return p.enabled; });
}

async function getProjectById(id) {
  var all = await ensureProjects();
  return all.find(function (p) { return p.id === id; }) || null;
}

async function getProjectByChoiceNumber(num) {
  var enabled = await listEnabledProjects();
  var index = Number(num) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= enabled.length) return null;
  return enabled[index];
}

async function updateProject(id, patch) {
  var all = await ensureProjects();
  var found = false;
  var updated = all.map(function (p) {
    if (p.id !== id) return p;
    found = true;
    return normalizeProject(Object.assign({}, p, patch, { updatedAt: nowIso() }), p.sortOrder);
  });
  if (!found) return null;
  var ok = await kv.kvSet(PROJECTS_KEY, updated);
  if (!ok) return null;
  return updated.find(function (p) { return p.id === id; }) || null;
}

async function getTodayPriority() {
  var value = await kv.kvGet(PRIORITY_KEY);
  if (!value || typeof value !== "object") {
    return { projectId: "", projectName: "", updatedAt: "", note: "" };
  }
  return {
    projectId: String(value.projectId || ""),
    projectName: String(value.projectName || ""),
    updatedAt: String(value.updatedAt || ""),
    note: String(value.note || "")
  };
}

async function setTodayPriority(project) {
  var payload = {
    projectId: project.id,
    projectName: project.name,
    updatedAt: nowIso(),
    note: project.currentIssue || ""
  };
  var ok = await kv.kvSet(PRIORITY_KEY, payload);
  return ok ? payload : null;
}

async function getLineMeta() {
  var meta = await kv.kvGet(META_KEY);
  return meta && typeof meta === "object" ? meta : {};
}

async function patchLineMeta(patch) {
  var current = await getLineMeta();
  var next = Object.assign({}, current, patch, { updatedAt: nowIso() });
  await kv.kvSet(META_KEY, next);
  return next;
}

module.exports = {
  ensureProjects: ensureProjects,
  listEnabledProjects: listEnabledProjects,
  getProjectById: getProjectById,
  getProjectByChoiceNumber: getProjectByChoiceNumber,
  updateProject: updateProject,
  getTodayPriority: getTodayPriority,
  setTodayPriority: setTodayPriority,
  getLineMeta: getLineMeta,
  patchLineMeta: patchLineMeta
};
