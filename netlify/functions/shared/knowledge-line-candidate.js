"use strict";

var conversationStore = require("./conversation-store");
var knowledgeStore = require("./knowledge-store");

var CATEGORY_ORDER = [
  "company.md",
  "projects.md",
  "events.md",
  "people.md",
  "products.md",
  "faq.md",
  "meeting.md",
  "todo.md",
  "vision.md"
];

function categoryLabel(file) {
  var meta = knowledgeStore.FILE_META[file];
  var label = meta ? meta.label : file;
  // Spec example: イベント情報（events.md）
  if (file === "events.md") label = "イベント情報";
  if (file === "company.md") label = "会社情報";
  if (file === "people.md") label = "人";
  if (file === "products.md") label = "商品";
  if (file === "projects.md") label = "プロジェクト";
  if (file === "faq.md") label = "FAQ";
  if (file === "meeting.md") label = "会議";
  if (file === "todo.md") label = "TODO";
  if (file === "vision.md") label = "Vision";
  return label + "（" + file + "）";
}

function buildCandidatePrompt(candidate) {
  var file = (candidate && candidate.file) || "meeting.md";
  return [
    "",
    "📌 この内容は会社の知識として保存できます。",
    "カテゴリ：" + categoryLabel(file),
    "① 保存する",
    "② カテゴリ変更",
    "③ 保存しない"
  ].join("\n");
}

function buildCategoryListMessage() {
  var lines = ["カテゴリを選んでください。"];
  CATEGORY_ORDER.forEach(function (file, i) {
    lines.push((i + 1) + "：" + categoryLabel(file));
  });
  lines.push("");
  lines.push("番号で返信してください。取消は『キャンセル』です。");
  return lines.join("\n");
}

function parseChoiceNumber(text) {
  var t = String(text || "").trim();
  var circled = {
    "①": 1, "②": 2, "③": 3, "④": 4, "⑤": 5,
    "⑥": 6, "⑦": 7, "⑧": 8, "⑨": 9, "⑩": 10
  };
  if (circled[t] != null) return circled[t];
  if (/^[①②③]$/.test(t)) return circled[t];
  // "1" / "①保存する" / "1：保存"
  var m = t.match(/^([①②③④⑤⑥⑦⑧⑨⑩]|[1-9]|10)(?:\s*[:：]|[\s　]|$)/);
  if (m) {
    if (circled[m[1]] != null) return circled[m[1]];
    return Number(m[1]);
  }
  if (/^(保存する|保存)$/.test(t)) return 1;
  if (/^(カテゴリ変更|カテゴリ)$/.test(t)) return 2;
  if (/^(保存しない|しない|却下)$/.test(t)) return 3;
  return null;
}

function isKnowledgeCandidateStage(conversation) {
  return !!(
    conversation &&
    !conversation.expired &&
    (conversation.stage === "awaiting-knowledge-save" ||
      conversation.stage === "awaiting-knowledge-category") &&
    conversation.knowledgeCandidate &&
    conversation.knowledgeCandidate.content
  );
}

async function beginCandidatePrompt(userId, candidate) {
  if (!candidate || !candidate.content) return null;
  var queued = await knowledgeStore.addCandidate({
    id: candidate.id,
    file: candidate.file,
    title: candidate.title,
    content: candidate.content,
    sourceText: candidate.sourceText || candidate.content
  });
  var payload = {
    id: (queued && queued.id) || candidate.id || ("kc-line-" + Date.now()),
    file: candidate.file || "meeting.md",
    title: candidate.title || "知識の追記",
    content: candidate.content,
    sourceText: candidate.sourceText || candidate.content
  };
  await conversationStore.saveConversation(userId, {
    stage: "awaiting-knowledge-save",
    selectedProjectId: "",
    choices: ["保存する", "カテゴリ変更", "保存しない"],
    knowledgeCandidate: payload
  });
  return {
    prompt: buildCandidatePrompt(payload),
    candidate: payload
  };
}

async function clearKnowledgeCandidate(userId) {
  var current = await conversationStore.getConversation(userId);
  if (!current || current.expired) return;
  if (
    current.stage !== "awaiting-knowledge-save" &&
    current.stage !== "awaiting-knowledge-category" &&
    !current.knowledgeCandidate
  ) {
    return;
  }
  await conversationStore.saveConversation(userId, {
    stage: "completed",
    choices: [],
    knowledgeCandidate: null
  });
}

async function savePendingCandidate(userId, pending) {
  var saved = await knowledgeStore.appendKnowledgeEntry(
    pending.file,
    pending.title,
    pending.content
  );
  if (pending.id) {
    try {
      await knowledgeStore.markCandidateStatus(pending.id, saved.ok ? "saved" : "rejected");
    } catch (e) { /* ignore */ }
  }
  await clearKnowledgeCandidate(userId);
  if (!saved.ok) {
    return {
      text: "保存に失敗しました。しばらくしてからもう一度お試しください。",
      ok: false,
      kind: "knowledge-candidate",
      source: "knowledge-line-candidate"
    };
  }
  return {
    text: [
      "保存しました。",
      "カテゴリ：" + saved.file,
      "タイトル：" + saved.title
    ].join("\n"),
    ok: true,
    kind: "knowledge-candidate-saved",
    source: "knowledge-line-candidate",
    savedFile: saved.file,
    savedTitle: saved.title
  };
}

async function handleKnowledgeCandidateReply(userId, text, conversation) {
  if (!isKnowledgeCandidateStage(conversation)) return null;
  var pending = conversation.knowledgeCandidate;
  var n = parseChoiceNumber(text);

  if (conversation.stage === "awaiting-knowledge-save") {
    if (n == null) return null; // let freechat continue; caller may clear
    if (n === 1) {
      return savePendingCandidate(userId, pending);
    }
    if (n === 2) {
      await conversationStore.saveConversation(userId, {
        stage: "awaiting-knowledge-category",
        choices: CATEGORY_ORDER.slice(),
        knowledgeCandidate: pending
      });
      return {
        text: buildCategoryListMessage(),
        ok: true,
        kind: "knowledge-candidate-category",
        source: "knowledge-line-candidate"
      };
    }
    if (n === 3) {
      if (pending.id) {
        try { await knowledgeStore.markCandidateStatus(pending.id, "rejected"); } catch (e) { /* ignore */ }
      }
      await clearKnowledgeCandidate(userId);
      return {
        text: "了解しました。保存しませんでした。",
        ok: true,
        kind: "knowledge-candidate-rejected",
        source: "knowledge-line-candidate"
      };
    }
    return {
      text: "①〜③の番号で選んでください。\n① 保存する\n② カテゴリ変更\n③ 保存しない",
      ok: false,
      kind: "knowledge-candidate",
      source: "knowledge-line-candidate"
    };
  }

  if (conversation.stage === "awaiting-knowledge-category") {
    if (n == null) return null;
    if (n < 1 || n > CATEGORY_ORDER.length) {
      return {
        text: "番号が範囲外です。\n" + buildCategoryListMessage(),
        ok: false,
        kind: "knowledge-candidate-category",
        source: "knowledge-line-candidate"
      };
    }
    var file = CATEGORY_ORDER[n - 1];
    var next = Object.assign({}, pending, { file: file });
    if (next.id) {
      try {
        await knowledgeStore.updateCandidate(next.id, { file: file });
      } catch (e) { /* ignore */ }
    }
    await conversationStore.saveConversation(userId, {
      stage: "awaiting-knowledge-save",
      choices: ["保存する", "カテゴリ変更", "保存しない"],
      knowledgeCandidate: next
    });
    return {
      text: [
        "カテゴリを変更しました。",
        "カテゴリ：" + categoryLabel(file),
        "",
        "① 保存する",
        "② カテゴリ変更",
        "③ 保存しない"
      ].join("\n"),
      ok: true,
      kind: "knowledge-candidate",
      source: "knowledge-line-candidate"
    };
  }

  return null;
}

module.exports = {
  CATEGORY_ORDER: CATEGORY_ORDER,
  categoryLabel: categoryLabel,
  buildCandidatePrompt: buildCandidatePrompt,
  buildCategoryListMessage: buildCategoryListMessage,
  parseChoiceNumber: parseChoiceNumber,
  isKnowledgeCandidateStage: isKnowledgeCandidateStage,
  beginCandidatePrompt: beginCandidatePrompt,
  clearKnowledgeCandidate: clearKnowledgeCandidate,
  handleKnowledgeCandidateReply: handleKnowledgeCandidateReply
};
