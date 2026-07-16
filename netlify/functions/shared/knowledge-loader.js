"use strict";

var fs = require("fs");
var path = require("path");

var KNOWLEDGE_FILES = [
  "company.md",
  "vision.md",
  "projects.md",
  "events.md",
  "people.md",
  "products.md",
  "faq.md",
  "meeting.md",
  "todo.md"
];

var DEFAULT_MAX_CHARS = Number(process.env.KNOWLEDGE_MAX_CHARS || 12000);

function resolveKnowledgeDir() {
  var candidates = [
    path.join(process.cwd(), "knowledge"),
    path.join(__dirname, "..", "..", "..", "knowledge"),
    path.join(__dirname, "..", "..", "knowledge")
  ];
  for (var i = 0; i < candidates.length; i++) {
    try {
      if (fs.existsSync(candidates[i]) && fs.statSync(candidates[i]).isDirectory()) {
        return candidates[i];
      }
    } catch (e) {
      /* continue */
    }
  }
  return candidates[0];
}

function readOneFile(dir, fileName) {
  var full = path.join(dir, fileName);
  try {
    if (!fs.existsSync(full)) {
      return { file: fileName, ok: false, content: "", error: "missing" };
    }
    var content = fs.readFileSync(full, "utf8");
    return {
      file: fileName,
      ok: true,
      content: String(content || "").trim(),
      error: ""
    };
  } catch (e) {
    return {
      file: fileName,
      ok: false,
      content: "",
      error: e && e.message ? e.message : "read_failed"
    };
  }
}

/**
 * Load all knowledge markdown files.
 * Never throws — returns empty knowledge on failure so chat can continue.
 */
function loadAllKnowledge(options) {
  options = options || {};
  var maxChars = options.maxChars || DEFAULT_MAX_CHARS;
  var dir = resolveKnowledgeDir();
  var files = [];
  var loaded = 0;

  KNOWLEDGE_FILES.forEach(function (name) {
    var item = readOneFile(dir, name);
    if (item.ok && item.content) loaded += 1;
    files.push(item);
  });

  // Also pick up any extra .md files in the folder (future expansion)
  try {
    var listed = fs.readdirSync(dir);
    listed.forEach(function (name) {
      if (!/\.md$/i.test(name)) return;
      if (/^readme\.md$/i.test(name)) return;
      if (KNOWLEDGE_FILES.indexOf(name) !== -1) return;
      var extra = readOneFile(dir, name);
      if (extra.ok && extra.content) loaded += 1;
      files.push(extra);
    });
  } catch (e) {
    /* ignore */
  }

  var blocks = [];
  var total = 0;
  var truncated = false;

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (!f.ok || !f.content) continue;
    var block = "### ファイル: " + f.file + "\n" + f.content;
    if (total + block.length + 2 > maxChars) {
      var remain = maxChars - total - (("### ファイル: " + f.file + "\n").length + 20);
      if (remain > 80) {
        blocks.push("### ファイル: " + f.file + "\n" + f.content.slice(0, remain) + "\n…(省略)");
        total = maxChars;
      }
      truncated = true;
      break;
    }
    blocks.push(block);
    total += block.length + 2;
  }

  var combined = blocks.join("\n\n");
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    stage: "knowledge-load",
    ok: true,
    dirExists: fs.existsSync(dir),
    loadedFiles: loaded,
    chars: combined.length,
    truncated: truncated
  }));

  return {
    ok: loaded > 0,
    dir: dir,
    files: files.map(function (f) {
      return {
        file: f.file,
        ok: f.ok,
        chars: f.content ? f.content.length : 0,
        error: f.error || ""
      };
    }),
    combined: combined,
    truncated: truncated,
    loadedFiles: loaded
  };
}

function buildKnowledgePromptSection(knowledge) {
  if (!knowledge || !knowledge.combined) {
    return [
      "【会社の知識 knowledge】",
      "（読み込めませんでした。一般知識だけで推測せず、未登録として答えてください）"
    ].join("\n");
  }
  return [
    "【会社の知識 knowledge】",
    "以下は株式会社えがおのきろく専用の知識ファイルです。",
    "一般的な知識より、この内容を優先してください。",
    "ここに無い事実は推測せず「まだ登録されていません」と答えてください。",
    knowledge.truncated ? "（長いため一部省略しています）" : "",
    "",
    knowledge.combined
  ].filter(Boolean).join("\n");
}

module.exports = {
  KNOWLEDGE_FILES: KNOWLEDGE_FILES,
  loadAllKnowledge: loadAllKnowledge,
  buildKnowledgePromptSection: buildKnowledgePromptSection,
  resolveKnowledgeDir: resolveKnowledgeDir
};
