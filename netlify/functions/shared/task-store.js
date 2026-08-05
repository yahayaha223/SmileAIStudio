"use strict";

var kv = require("./kv-store");
var parser = require("./task-parser");

var TASKS_KEY = "tasks:v1";

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return "task-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
}

function normalizeTask(raw) {
  if (!raw || typeof raw !== "object") return null;
  var title = String(raw.title || "").trim().slice(0, 120);
  if (!title) return null;
  var status = String(raw.status || "pending");
  if (["pending", "in_progress", "completed", "postponed", "cancelled"].indexOf(status) === -1) {
    status = "pending";
  }
  var priority = String(raw.priority || "normal");
  if (["high", "normal", "low"].indexOf(priority) === -1) priority = "normal";
  return {
    id: String(raw.id || newId()),
    title: title,
    description: String(raw.description || "").slice(0, 2000),
    status: status,
    priority: priority,
    dueDate: String(raw.dueDate || "").slice(0, 10),
    dueTime: String(raw.dueTime || "").slice(0, 5),
    projectId: String(raw.projectId || ""),
    category: String(raw.category || ""),
    sourceType: String(raw.sourceType || "manual"),
    sourceText: String(raw.sourceText || "").slice(0, 500),
    createdAt: String(raw.createdAt || nowIso()),
    updatedAt: String(raw.updatedAt || nowIso()),
    completedAt: String(raw.completedAt || ""),
    postponedFrom: String(raw.postponedFrom || ""),
    tags: Array.isArray(raw.tags)
      ? raw.tags.map(function (x) { return String(x || "").trim(); }).filter(Boolean).slice(0, 20)
      : []
  };
}

async function listAllTasks() {
  var list = await kv.kvGet(TASKS_KEY);
  if (!Array.isArray(list)) return [];
  return list.map(normalizeTask).filter(Boolean);
}

async function saveAllTasks(list) {
  var ok = await kv.kvSet(TASKS_KEY, list);
  return !!ok;
}

async function getTask(id) {
  var all = await listAllTasks();
  return all.find(function (t) { return t.id === id; }) || null;
}

function sortOpenTasks(a, b) {
  var pr = { high: 0, normal: 1, low: 2 };
  var pa = pr[a.priority] != null ? pr[a.priority] : 1;
  var pb = pr[b.priority] != null ? pr[b.priority] : 1;
  if (pa !== pb) return pa - pb;
  var da = a.dueDate || "9999-99-99";
  var db = b.dueDate || "9999-99-99";
  if (da !== db) return da < db ? -1 : 1;
  var ta = a.dueTime || "99:99";
  var tb = b.dueTime || "99:99";
  if (ta !== tb) return ta < tb ? -1 : 1;
  return (a.createdAt || "") < (b.createdAt || "") ? -1 : 1;
}

function isOpen(t) {
  return t && (t.status === "pending" || t.status === "in_progress" || t.status === "postponed");
}

async function listTasks(filter) {
  filter = filter || {};
  var all = await listAllTasks();
  var today = parser.toYmd(parser.startOfJstDay());
  var tomorrow = parser.addDays(today, 1);
  var weekEnd = (function () {
    var parts = today.split("-").map(Number);
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    var toSun = (7 - d.getDay()) % 7;
    return parser.addDays(today, toSun);
  })();

  var list = all.filter(function (t) {
    if (filter.status === "open") return isOpen(t);
    if (filter.status === "completed") return t.status === "completed";
    if (filter.status) return t.status === filter.status;
    return true;
  });

  if (filter.bucket === "today") {
    list = list.filter(function (t) { return isOpen(t) && t.dueDate === today; });
  } else if (filter.bucket === "tomorrow") {
    list = list.filter(function (t) { return isOpen(t) && t.dueDate === tomorrow; });
  } else if (filter.bucket === "overdue") {
    list = list.filter(function (t) { return isOpen(t) && t.dueDate && t.dueDate < today; });
  } else if (filter.bucket === "week") {
    list = list.filter(function (t) {
      return isOpen(t) && t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd;
    });
  } else if (filter.bucket === "open") {
    list = list.filter(isOpen);
  }

  if (filter.q) {
    var q = String(filter.q).toLowerCase();
    list = list.filter(function (t) {
      var hay = [t.title, t.description, t.tags.join(" "), t.projectId, t.category].join("\n").toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  list = list.slice().sort(sortOpenTasks);
  if (filter.limit) list = list.slice(0, Number(filter.limit) || 50);
  return list;
}

async function createTask(input) {
  var task = normalizeTask(Object.assign({}, input, {
    id: input && input.id ? input.id : newId(),
    createdAt: nowIso(),
    updatedAt: nowIso()
  }));
  if (!task) return { ok: false, error: "invalid_task" };
  var all = await listAllTasks();
  all.unshift(task);
  all = all.slice(0, 500);
  var ok = await saveAllTasks(all);
  if (!ok) return { ok: false, error: "save_failed" };
  return { ok: true, task: task };
}

async function updateTask(id, patch) {
  var all = await listAllTasks();
  var found = null;
  var next = all.map(function (t) {
    if (t.id !== id) return t;
    found = normalizeTask(Object.assign({}, t, patch, { id: t.id, updatedAt: nowIso() }));
    return found;
  });
  if (!found) return { ok: false, error: "not_found" };
  var ok = await saveAllTasks(next);
  if (!ok) return { ok: false, error: "save_failed" };
  return { ok: true, task: found };
}

async function completeTask(id) {
  return updateTask(id, {
    status: "completed",
    completedAt: nowIso()
  });
}

async function postponeTask(id, dueDate, dueTime) {
  var current = await getTask(id);
  if (!current) return { ok: false, error: "not_found" };
  return updateTask(id, {
    status: "postponed",
    postponedFrom: current.dueDate || "",
    dueDate: dueDate || current.dueDate,
    dueTime: dueTime != null ? dueTime : current.dueTime
  });
}

async function deleteTask(id) {
  var all = await listAllTasks();
  var next = all.filter(function (t) { return t.id !== id; });
  if (next.length === all.length) return { ok: false, error: "not_found" };
  var ok = await saveAllTasks(next);
  return ok ? { ok: true } : { ok: false, error: "save_failed" };
}

async function searchTasks(q) {
  return listTasks({ q: q, status: "open" });
}

function normalizeForDup(s) {
  return String(s || "").replace(/\s+/g, "").toLowerCase();
}

async function findSimilarTasks(title) {
  var open = await listTasks({ bucket: "open" });
  var key = normalizeForDup(title);
  if (key.length < 2) return [];
  return open.filter(function (t) {
    var n = normalizeForDup(t.title);
    return n === key || n.indexOf(key) !== -1 || key.indexOf(n) !== -1;
  }).slice(0, 5);
}

async function getDashboardCounts() {
  var today = await listTasks({ bucket: "today" });
  var overdue = await listTasks({ bucket: "overdue" });
  var tomorrow = await listTasks({ bucket: "tomorrow" });
  var open = await listTasks({ bucket: "open" });
  return {
    today: today.length,
    overdue: overdue.length,
    tomorrow: tomorrow.length,
    open: open.length,
    todayTasks: today,
    overdueTasks: overdue
  };
}

module.exports = {
  TASKS_KEY: TASKS_KEY,
  listAllTasks: listAllTasks,
  listTasks: listTasks,
  getTask: getTask,
  createTask: createTask,
  updateTask: updateTask,
  completeTask: completeTask,
  postponeTask: postponeTask,
  deleteTask: deleteTask,
  searchTasks: searchTasks,
  findSimilarTasks: findSimilarTasks,
  getDashboardCounts: getDashboardCounts,
  normalizeTask: normalizeTask,
  isOpen: isOpen
};
