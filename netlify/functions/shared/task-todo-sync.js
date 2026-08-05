"use strict";

var knowledgeStore = require("./knowledge-store");
var taskStore = require("./task-store");
var parser = require("./task-parser");

function section(title, tasks) {
  var lines = ["## " + title];
  if (!tasks.length) {
    lines.push("- （なし）");
    return lines.join("\n");
  }
  tasks.forEach(function (t) {
    var box = t.status === "completed" ? "[x]" : "[ ]";
    lines.push("- " + box + " " + t.title);
    if (t.dueDate) {
      lines.push("  - 期限：" + t.dueDate + (t.dueTime ? " " + t.dueTime : ""));
    }
    if (t.priority && t.priority !== "normal") {
      lines.push("  - 優先度：" + parser.priorityLabelJa(t.priority));
    }
    if (t.projectId) {
      lines.push("  - プロジェクト：" + t.projectId);
    }
    if (t.status === "completed" && t.completedAt) {
      lines.push("  - 完了：" + String(t.completedAt).slice(0, 10));
    }
  });
  return lines.join("\n");
}

async function buildTodoMarkdown() {
  var today = await taskStore.listTasks({ bucket: "today" });
  var overdue = await taskStore.listTasks({ bucket: "overdue" });
  var week = await taskStore.listTasks({ bucket: "week" });
  var completed = await taskStore.listTasks({ status: "completed", limit: 30 });
  // week without today/overdue for readability
  var todaySet = {};
  today.forEach(function (t) { todaySet[t.id] = true; });
  var overdueSet = {};
  overdue.forEach(function (t) { overdueSet[t.id] = true; });
  var weekOnly = week.filter(function (t) { return !todaySet[t.id] && !overdueSet[t.id]; });

  return [
    "# 現在のTODO",
    "",
    "（このファイルはタスク管理の構造化データから自動生成されています。直接編集しても構造化データは変わりません。）",
    "",
    section("期限超過", overdue),
    "",
    section("今日", today),
    "",
    section("今週", weekOnly),
    "",
    section("完了済み", completed.slice(0, 20)),
    ""
  ].join("\n");
}

async function syncTodoMarkdown() {
  var md = await buildTodoMarkdown();
  var saved = await knowledgeStore.saveKnowledgeDocument("todo.md", md);
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    stage: "task-todo-sync",
    ok: !!saved.ok,
    chars: md.length,
    error: saved.error || ""
  }));
  return saved;
}

/**
 * Preview import from legacy todo.md checkboxes (does not write).
 */
function previewImportFromMarkdown(md) {
  var lines = String(md || "").split(/\r?\n/);
  var items = [];
  lines.forEach(function (line) {
    var m = line.match(/^\s*[-*]\s*\[([ xX])\]\s*(.+)$/);
    if (!m) return;
    var done = /x/i.test(m[1]);
    var title = m[2].replace(/\s+/g, " ").trim().slice(0, 120);
    if (!title || /（なし）/.test(title)) return;
    items.push({
      title: title,
      status: done ? "completed" : "pending",
      priority: "normal",
      sourceType: "todo-md-import",
      sourceText: line.trim()
    });
  });
  return items;
}

async function importFromMarkdown(md, options) {
  options = options || {};
  var preview = previewImportFromMarkdown(md);
  var existing = await taskStore.listAllTasks();
  var existingTitles = {};
  existing.forEach(function (t) {
    existingTitles[String(t.title).replace(/\s+/g, "").toLowerCase()] = true;
  });
  var created = [];
  var skipped = 0;
  for (var i = 0; i < preview.length; i++) {
    var item = preview[i];
    var key = item.title.replace(/\s+/g, "").toLowerCase();
    if (existingTitles[key]) {
      skipped += 1;
      continue;
    }
    if (options.dryRun) {
      created.push(item);
      continue;
    }
    var res = await taskStore.createTask(Object.assign({}, item, {
      completedAt: item.status === "completed" ? new Date().toISOString() : ""
    }));
    if (res.ok) {
      created.push(res.task);
      existingTitles[key] = true;
    }
  }
  if (!options.dryRun && created.length) {
    await syncTodoMarkdown();
  }
  return { ok: true, created: created, skipped: skipped, previewCount: preview.length };
}

module.exports = {
  buildTodoMarkdown: buildTodoMarkdown,
  syncTodoMarkdown: syncTodoMarkdown,
  previewImportFromMarkdown: previewImportFromMarkdown,
  importFromMarkdown: importFromMarkdown
};
