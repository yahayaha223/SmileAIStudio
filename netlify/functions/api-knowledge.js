"use strict";

var http = require("./shared/http");
var knowledgeStore = require("./shared/knowledge-store");

function parseBody(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch (e) {
    return null;
  }
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return http.options();

  var qs = event.queryStringParameters || {};
  var action = String(qs.action || "").trim();

  try {
    if (event.httpMethod === "GET") {
      if (action === "candidates") {
        var pending = await knowledgeStore.listCandidates();
        return http.json(200, { ok: true, candidates: pending });
      }
      if (action === "search") {
        var docs = await knowledgeStore.listKnowledgeDocuments();
        var hits = knowledgeStore.searchKnowledgeDocuments(docs, qs.q || "");
        return http.json(200, { ok: true, query: qs.q || "", hits: hits });
      }
      if (action === "file" && qs.file) {
        var doc = await knowledgeStore.getKnowledgeDocument(qs.file);
        if (!doc) return http.json(404, { ok: false, error: "not_found" });
        return http.json(200, { ok: true, document: doc });
      }

      var list = await knowledgeStore.listKnowledgeDocuments();
      var includeContent = String(qs.full || "") === "1";
      return http.json(200, {
        ok: true,
        loadedFiles: list.filter(function (d) { return d.chars > 0; }).length,
        files: list.map(function (d) {
          var row = {
            file: d.file,
            id: d.id,
            label: d.label,
            icon: d.icon,
            ok: d.ok,
            chars: d.chars,
            updatedAt: d.updatedAt,
            source: d.source
          };
          if (includeContent) row.content = d.content;
          return row;
        })
      });
    }

    if (event.httpMethod === "POST") {
      var body = parseBody(event);
      if (!body) return http.json(400, { ok: false, error: "invalid_json" });
      var postAction = String(body.action || action || "").trim();

      if (postAction === "save") {
        // Full replace (Company Brain editor) or append entry (LINE / title+body)
        if (body.title && (body.body != null || body.entry != null) && body.content == null) {
          var appended = await knowledgeStore.appendKnowledgeEntry(
            body.file,
            body.title,
            body.body != null ? body.body : body.entry
          );
          if (!appended.ok) return http.json(400, { ok: false, error: appended.error || "save_failed" });
          return http.json(200, appended);
        }
        var saved = await knowledgeStore.saveKnowledgeDocument(body.file, body.content);
        if (!saved.ok) return http.json(400, { ok: false, error: saved.error || "save_failed" });
        return http.json(200, saved);
      }

      if (postAction === "candidate-save" || postAction === "candidate-reject") {
        var resolved = await knowledgeStore.resolveCandidate(
          body.id,
          postAction === "candidate-save" ? "save" : "reject"
        );
        if (!resolved.ok) return http.json(400, resolved);
        return http.json(200, resolved);
      }

      if (postAction === "candidate-add") {
        var added = await knowledgeStore.addCandidate(body);
        if (!added) return http.json(400, { ok: false, error: "invalid_candidate" });
        return http.json(200, { ok: true, candidate: added });
      }

      return http.json(400, { ok: false, error: "unknown_action" });
    }

    return http.json(405, { ok: false, error: "method_not_allowed" });
  } catch (e) {
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      stage: "api-knowledge",
      ok: false,
      message: e && e.message ? e.message : "error"
    }));
    return http.json(500, { ok: false, error: "unavailable" });
  }
};
