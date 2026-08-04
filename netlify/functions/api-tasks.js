"use strict";

var http = require("./shared/http");
var taskStore = require("./shared/task-store");
var taskTodoSync = require("./shared/task-todo-sync");
var knowledgeStore = require("./shared/knowledge-store");
var taskParser = require("./shared/task-parser");
var protectApi = require("./shared/auth/protect-api");

function parseBody(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch (e) {
    return null;
  }
}

async function tasksHandler(event) {
  var qs = event.queryStringParameters || {};

  try {
    if (event.httpMethod === "GET") {
      var action = String(qs.action || "list").trim();
      if (action === "dashboard") {
        var dash = await taskStore.getDashboardCounts();
        return http.json(200, { ok: true, dashboard: dash });
      }
      if (action === "get" && qs.id) {
        var one = await taskStore.getTask(qs.id);
        if (!one) return http.json(404, { ok: false, error: "not_found" });
        return http.json(200, { ok: true, task: one });
      }
      if (action === "search") {
        var hits = await taskStore.searchTasks(qs.q || "");
        return http.json(200, { ok: true, tasks: hits });
      }
      if (action === "import-preview") {
        var doc = await knowledgeStore.getKnowledgeDocument("todo.md");
        var preview = taskTodoSync.previewImportFromMarkdown(doc ? doc.content : "");
        return http.json(200, { ok: true, items: preview });
      }
      var tasks = await taskStore.listTasks({
        bucket: qs.bucket || "",
        status: qs.status || "",
        q: qs.q || "",
        limit: qs.limit ? Number(qs.limit) : 100
      });
      return http.json(200, { ok: true, tasks: tasks });
    }

    if (event.httpMethod === "POST") {
      var body = parseBody(event);
      if (!body) return http.json(400, { ok: false, error: "invalid_json" });
      var postAction = String(body.action || qs.action || "").trim();

      if (postAction === "create") {
        var created = await taskStore.createTask(body.task || body);
        if (!created.ok) return http.json(400, { ok: false, error: created.error || "save_failed" });
        var sync1 = await taskTodoSync.syncTodoMarkdown();
        if (!sync1.ok) return http.json(500, { ok: false, error: "sync_failed" });
        return http.json(200, created);
      }

      if (postAction === "update") {
        if (!body.id) return http.json(400, { ok: false, error: "invalid_id" });
        var updated = await taskStore.updateTask(body.id, body.patch || body.task || body);
        if (!updated.ok) return http.json(400, { ok: false, error: updated.error || "save_failed" });
        var sync2 = await taskTodoSync.syncTodoMarkdown();
        if (!sync2.ok) return http.json(500, { ok: false, error: "sync_failed" });
        return http.json(200, updated);
      }

      if (postAction === "complete") {
        if (!body.id) return http.json(400, { ok: false, error: "invalid_id" });
        var done = await taskStore.completeTask(body.id);
        if (!done.ok) return http.json(400, { ok: false, error: done.error || "save_failed" });
        var sync3 = await taskTodoSync.syncTodoMarkdown();
        if (!sync3.ok) return http.json(500, { ok: false, error: "sync_failed" });
        return http.json(200, done);
      }

      if (postAction === "postpone") {
        if (!body.id) return http.json(400, { ok: false, error: "invalid_id" });
        var dueDate = body.dueDate || "";
        if (!dueDate && body.when) {
          var due = taskParser.parseDue(String(body.when));
          dueDate = due.dueDate;
        }
        if (!dueDate) return http.json(400, { ok: false, error: "invalid_date" });
        var postponed = await taskStore.postponeTask(body.id, dueDate, body.dueTime || "");
        if (!postponed.ok) return http.json(400, { ok: false, error: postponed.error || "save_failed" });
        await taskStore.updateTask(body.id, { status: "pending" });
        var sync4 = await taskTodoSync.syncTodoMarkdown();
        if (!sync4.ok) return http.json(500, { ok: false, error: "sync_failed" });
        var again = await taskStore.getTask(body.id);
        return http.json(200, { ok: true, task: again });
      }

      if (postAction === "delete") {
        if (!body.id) return http.json(400, { ok: false, error: "invalid_id" });
        var deleted = await taskStore.deleteTask(body.id);
        if (!deleted.ok) return http.json(400, { ok: false, error: deleted.error || "save_failed" });
        var sync5 = await taskTodoSync.syncTodoMarkdown();
        if (!sync5.ok) return http.json(500, { ok: false, error: "sync_failed" });
        return http.json(200, { ok: true });
      }

      if (postAction === "sync-todo-md") {
        var sync = await taskTodoSync.syncTodoMarkdown();
        return sync.ok ? http.json(200, sync) : http.json(500, { ok: false, error: "sync_failed" });
      }

      if (postAction === "import-todo-md") {
        var doc2 = await knowledgeStore.getKnowledgeDocument("todo.md");
        var imported = await taskTodoSync.importFromMarkdown(doc2 ? doc2.content : "", {
          dryRun: !!body.dryRun
        });
        return http.json(200, imported);
      }

      return http.json(400, { ok: false, error: "unknown_action" });
    }

    return http.json(405, { ok: false, error: "method_not_allowed" });
  } catch (e) {
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      stage: "api-tasks",
      ok: false,
      message: e && e.message ? e.message : "error"
    }));
    return http.json(500, { ok: false, error: "unavailable" });
  }
}

exports.handler = protectApi.wrapApi(tasksHandler, protectApi.tasksPermissionKey);
