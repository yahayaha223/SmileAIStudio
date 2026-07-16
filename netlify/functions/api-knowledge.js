"use strict";

var http = require("./shared/http");
var knowledgeLoader = require("./shared/knowledge-loader");

/**
 * GET: list / preview company knowledge files (no secrets).
 * Foundation for future「会社の知識」編集画面.
 */
exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return http.options();
  if (event.httpMethod !== "GET") {
    return http.json(405, { ok: false, error: "method_not_allowed" });
  }

  try {
    var knowledge = knowledgeLoader.loadAllKnowledge();
    var includeContent = String((event.queryStringParameters && event.queryStringParameters.full) || "") === "1";
    var files = [];

    if (includeContent) {
      var dir = knowledgeLoader.resolveKnowledgeDir();
      var fs = require("fs");
      var path = require("path");
      knowledge.files.forEach(function (meta) {
        var content = "";
        try {
          content = fs.readFileSync(path.join(dir, meta.file), "utf8");
        } catch (e) {
          content = "";
        }
        files.push({
          file: meta.file,
          ok: meta.ok,
          chars: meta.chars,
          content: content
        });
      });
    } else {
      files = knowledge.files;
    }

    return http.json(200, {
      ok: true,
      loadedFiles: knowledge.loadedFiles,
      truncated: knowledge.truncated,
      files: files
    });
  } catch (e) {
    return http.json(500, { ok: false, error: "unavailable" });
  }
};
