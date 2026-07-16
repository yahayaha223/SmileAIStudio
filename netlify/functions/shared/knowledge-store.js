"use strict";

var fs = require("fs");
var path = require("path");
var kv = require("./kv-store");
var loader = require("./knowledge-loader");

var OVERLAY_KEY = "knowledgeOverlays";
var CANDIDATES_KEY = "knowledgeCandidates";

var FILE_META = {
  "company.md": { id: "company", label: "会社情報", icon: "🏢" },
  "vision.md": { id: "vision", label: "Vision", icon: "✨" },
  "projects.md": { id: "projects", label: "プロジェクト", icon: "📁" },
  "events.md": { id: "events", label: "イベント", icon: "🎪" },
  "people.md": { id: "people", label: "人", icon: "👤" },
  "products.md": { id: "products", label: "商品", icon: "🦊" },
  "faq.md": { id: "faq", label: "FAQ", icon: "❓" },
  "meeting.md": { id: "meeting", label: "会議", icon: "🧠" },
  "todo.md": { id: "todo", label: "TODO", icon: "✅" }
};

function nowIso() {
  return new Date().toISOString();
}

function safeFileName(name) {
  var base = path.basename(String(name || "").trim());
  if (!/\.md$/i.test(base)) return "";
  if (base.indexOf("..") !== -1) return "";
  return base;
}

async function getOverlays() {
  var data = await kv.kvGet(OVERLAY_KEY);
  return data && typeof data === "object" ? data : {};
}

async function setOverlays(overlays) {
  return kv.kvSet(OVERLAY_KEY, overlays || {});
}

function readDiskContent(fileName) {
  var dir = loader.resolveKnowledgeDir();
  var full = path.join(dir, fileName);
  try {
    if (!fs.existsSync(full)) return { ok: false, content: "", source: "missing" };
    return { ok: true, content: fs.readFileSync(full, "utf8"), source: "disk" };
  } catch (e) {
    return { ok: false, content: "", source: "error" };
  }
}

function writeDiskContent(fileName, content) {
  var dir = loader.resolveKnowledgeDir();
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), String(content || ""), "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : "write_failed" };
  }
}

async function listKnowledgeDocuments() {
  var overlays = await getOverlays();
  return loader.KNOWLEDGE_FILES.map(function (file) {
    var meta = FILE_META[file] || { id: file, label: file, icon: "📄" };
    var disk = readDiskContent(file);
    var overlay = overlays[file];
    var content = overlay && typeof overlay.content === "string"
      ? overlay.content
      : (disk.content || "");
    var source = overlay && typeof overlay.content === "string" ? "overlay" : disk.source;
    return {
      file: file,
      id: meta.id,
      label: meta.label,
      icon: meta.icon,
      ok: !!(content || disk.ok),
      chars: String(content || "").length,
      updatedAt: (overlay && overlay.updatedAt) || "",
      source: source,
      content: content
    };
  });
}

async function getKnowledgeDocument(fileName) {
  var file = safeFileName(fileName);
  if (!file || loader.KNOWLEDGE_FILES.indexOf(file) === -1) return null;
  var docs = await listKnowledgeDocuments();
  return docs.find(function (d) { return d.file === file; }) || null;
}

async function saveKnowledgeDocument(fileName, content) {
  var file = safeFileName(fileName);
  if (!file || loader.KNOWLEDGE_FILES.indexOf(file) === -1) {
    return { ok: false, error: "invalid_file" };
  }
  var text = String(content == null ? "" : content);
  if (text.length > 100000) {
    return { ok: false, error: "too_large" };
  }

  var disk = writeDiskContent(file, text);
  var overlays = await getOverlays();
  overlays[file] = {
    content: text,
    updatedAt: nowIso(),
    diskWriteOk: !!disk.ok
  };
  var overlayOk = await setOverlays(overlays);
  if (!overlayOk && !disk.ok) {
    return { ok: false, error: "save_failed" };
  }

  console.log(JSON.stringify({
    at: nowIso(),
    stage: "knowledge-save",
    ok: true,
    file: file,
    chars: text.length,
    diskWriteOk: !!disk.ok,
    overlayOk: !!overlayOk
  }));

  return {
    ok: true,
    file: file,
    chars: text.length,
    diskWriteOk: !!disk.ok,
    source: disk.ok ? "disk+overlay" : "overlay"
  };
}

/**
 * Append a titled section to a knowledge markdown file.
 */
async function appendKnowledgeEntry(fileName, title, body) {
  var file = safeFileName(fileName);
  if (!file || loader.KNOWLEDGE_FILES.indexOf(file) === -1) {
    return { ok: false, error: "invalid_file" };
  }
  var safeTitle = String(title || "追記").trim().slice(0, 120) || "追記";
  var safeBody = String(body || "").trim().slice(0, 4000);
  if (!safeBody) return { ok: false, error: "empty_content" };

  var doc = await getKnowledgeDocument(file);
  var base = doc ? String(doc.content || "") : "";
  var append =
    (base ? (/\n$/.test(base) ? "\n" : "\n\n") : "") +
    "## " + safeTitle + "\n" +
    safeBody + "\n" +
    "（追記: " + nowIso().slice(0, 10) + "）\n";

  var saved = await saveKnowledgeDocument(file, base + append);
  if (!saved.ok) return saved;
  return {
    ok: true,
    file: file,
    title: safeTitle,
    chars: saved.chars,
    diskWriteOk: saved.diskWriteOk,
    source: saved.source
  };
}

/**
 * Detect explicit LINE save request: 「〜に保存しておいて」
 * Returns { file, title, content } or null.
 */
function detectExplicitSaveRequest(userText) {
  var t = String(userText || "").trim();
  if (!t) return null;
  if (!/(保存して|保存しておいて|メモして|知識に入れて|knowledgeに)/i.test(t)) {
    return null;
  }

  var file = "";
  if (/イベント情報|イベント/.test(t)) file = "events.md";
  else if (/会社情報|会社概要/.test(t)) file = "company.md";
  else if (/人(の情報|名|員)?|people|スタッフ|担当/.test(t)) file = "people.md";
  else if (/TODO|やること|todo/i.test(t)) file = "todo.md";
  else if (/商品|製品|人形焼き|products/.test(t)) file = "products.md";
  else if (/Vision|ミッション|ビジョン|mission/i.test(t)) file = "vision.md";
  else if (/プロジェクト|projects/.test(t)) file = "projects.md";
  else if (/FAQ|よくある質問/i.test(t)) file = "faq.md";
  else if (/会議|ミーティング|meeting/i.test(t)) file = "meeting.md";
  else file = "meeting.md";

  var content = t
    .replace(/(を)?(イベント情報|会社情報|人の情報|商品情報|プロジェクト情報|Vision|ビジョン|TODO|会議メモ|FAQ|知識|knowledge)?(へ|に)?(保存しておいて|保存して|メモして|入れて).*$/i, "")
    .replace(/^(イベント情報|会社情報|人|商品|TODO|Vision|プロジェクト|FAQ|会議)(へ|に)\s*/i, "")
    .trim();

  // If only the save instruction remains, content is empty → caller uses chat memory
  if (/^(保存しておいて|保存して|メモして)$/.test(content) || content.length < 2) {
    content = "";
  }

  var title = content
    ? (content.match(/^(.{2,40}?)(?:（[^）]*）)?(?=は|を|が|。|\n|$)/) || [])[0] || content.split(/[。\n]/)[0].trim().slice(0, 40)
    : (FILE_META[file] ? FILE_META[file].label + "の追記" : "追記");
  title = String(title || "").trim().slice(0, 40) || "追記";

  return {
    file: file,
    title: title,
    content: content,
    sourceText: t
  };
}

/**
 * Effective knowledge for AI prompts: disk + overlays (overlay wins).
 */
async function loadEffectiveKnowledge(options) {
  options = options || {};
  var maxChars = options.maxChars || Number(process.env.KNOWLEDGE_MAX_CHARS || 12000);
  var docs = await listKnowledgeDocuments();
  var loaded = 0;
  var blocks = [];
  var total = 0;
  var truncated = false;

  for (var i = 0; i < docs.length; i++) {
    var d = docs[i];
    var body = String(d.content || "").trim();
    if (!body) continue;
    loaded += 1;
    var block = "### ファイル: " + d.file + "\n" + body;
    if (total + block.length + 2 > maxChars) {
      var remain = maxChars - total - (("### ファイル: " + d.file + "\n").length + 20);
      if (remain > 80) {
        blocks.push("### ファイル: " + d.file + "\n" + body.slice(0, remain) + "\n…(省略)");
      }
      truncated = true;
      break;
    }
    blocks.push(block);
    total += block.length + 2;
  }

  var combined = blocks.join("\n\n");
  console.log(JSON.stringify({
    at: nowIso(),
    stage: "knowledge-load-effective",
    ok: true,
    loadedFiles: loaded,
    chars: combined.length,
    truncated: truncated
  }));

  return {
    ok: loaded > 0,
    combined: combined,
    truncated: truncated,
    loadedFiles: loaded,
    files: docs.map(function (d) {
      return {
        file: d.file,
        ok: d.ok,
        chars: d.chars,
        label: d.label,
        source: d.source
      };
    })
  };
}

function searchKnowledgeDocuments(docs, query) {
  var q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  var hits = [];
  docs.forEach(function (d) {
    var content = String(d.content || "");
    var label = String(d.label || "");
    var hay = (label + "\n" + d.file + "\n" + content).toLowerCase();
    if (hay.indexOf(q) === -1) return;
    var idx = content.toLowerCase().indexOf(q);
    var snippet = "";
    if (idx >= 0) {
      var start = Math.max(0, idx - 40);
      snippet = content.slice(start, start + 120).replace(/\s+/g, " ");
      if (start > 0) snippet = "…" + snippet;
      if (start + 120 < content.length) snippet += "…";
    } else {
      snippet = content.slice(0, 80).replace(/\s+/g, " ");
    }
    hits.push({
      file: d.file,
      label: d.label,
      icon: d.icon,
      snippet: snippet
    });
  });
  return hits;
}

async function listCandidates() {
  var list = await kv.kvGet(CANDIDATES_KEY);
  if (!Array.isArray(list)) return [];
  return list.filter(function (c) {
    return c && c.status === "pending";
  });
}

async function listAllCandidates() {
  var list = await kv.kvGet(CANDIDATES_KEY);
  return Array.isArray(list) ? list : [];
}

async function addCandidate(entry) {
  var list = await listAllCandidates();
  var item = {
    id: String(entry.id || ("kc-" + Date.now())),
    file: safeFileName(entry.file) || "meeting.md",
    title: String(entry.title || "").slice(0, 120),
    content: String(entry.content || "").slice(0, 4000),
    status: "pending",
    sourceText: String(entry.sourceText || "").slice(0, 500),
    createdAt: nowIso()
  };
  if (!item.title || !item.content) return null;
  list.unshift(item);
  list = list.slice(0, 50);
  var ok = await kv.kvSet(CANDIDATES_KEY, list);
  return ok ? item : null;
}

async function resolveCandidate(id, action) {
  var list = await listAllCandidates();
  var original = null;
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].id === id) {
      original = list[i];
      break;
    }
  }
  if (!original || original.status !== "pending") {
    return { ok: false, error: "not_found" };
  }

  if (action === "save") {
    var doc = await getKnowledgeDocument(original.file);
    var base = doc ? String(doc.content || "") : "";
    var append =
      (base && !/\n$/.test(base) ? "\n\n" : (base ? "\n" : "")) +
      "## " + original.title + "\n" +
      original.content + "\n" +
      "（追記: " + nowIso().slice(0, 10) + "）\n";
    var saved = await saveKnowledgeDocument(original.file, base + append);
    if (!saved.ok) return { ok: false, error: "save_failed" };
  }

  var next = list.map(function (c) {
    if (!c || c.id !== id) return c;
    return Object.assign({}, c, {
      status: action === "save" ? "saved" : "rejected",
      resolvedAt: nowIso()
    });
  });
  var ok = await kv.kvSet(CANDIDATES_KEY, next);
  return ok ? { ok: true, action: action, id: id } : { ok: false, error: "save_failed" };
}

/**
 * Heuristic: user statements that look like durable company facts.
 */
function detectKnowledgeSaveCandidate(userText) {
  var t = String(userText || "").trim();
  if (t.length < 8 || t.length > 400) return null;

  if (/(販売|発売|リリース).*(1[0-2]|[1-9])\s*月|(1[0-2]|[1-9])\s*月.*(販売|発売)/.test(t) ||
      /人形焼き/.test(t) && /(変更|決定|開始|延期)/.test(t)) {
    return {
      file: "products.md",
      title: "商品情報の更新候補",
      content: t,
      sourceText: t
    };
  }
  if (/(イベント|縁日|会場|開催).*(決定|変更|追加)/.test(t)) {
    return {
      file: "events.md",
      title: "イベント情報の更新候補",
      content: t,
      sourceText: t
    };
  }
  if (/(TODO|やること|宿題).*(追加|にする|やって)/.test(t) || /^TODO[:：]/.test(t)) {
    return {
      file: "todo.md",
      title: "TODO候補",
      content: t,
      sourceText: t
    };
  }
  if (/(Mission|Vision|ミッション|ビジョン).*(変更|更新)/.test(t)) {
    return {
      file: "vision.md",
      title: "Vision更新候補",
      content: t,
      sourceText: t
    };
  }
  return null;
}

module.exports = {
  FILE_META: FILE_META,
  listKnowledgeDocuments: listKnowledgeDocuments,
  getKnowledgeDocument: getKnowledgeDocument,
  saveKnowledgeDocument: saveKnowledgeDocument,
  appendKnowledgeEntry: appendKnowledgeEntry,
  loadEffectiveKnowledge: loadEffectiveKnowledge,
  searchKnowledgeDocuments: searchKnowledgeDocuments,
  listCandidates: listCandidates,
  addCandidate: addCandidate,
  resolveCandidate: resolveCandidate,
  detectKnowledgeSaveCandidate: detectKnowledgeSaveCandidate,
  detectExplicitSaveRequest: detectExplicitSaveRequest
};
