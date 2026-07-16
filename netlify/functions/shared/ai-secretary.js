"use strict";

var env = require("./env");
var openaiClient = require("./openai-client");
var memoryStore = require("./conversation-memory-store");
var promptBuilder = require("./secretary-system-prompt");
var projectStore = require("./project-store");
var knowledgeLoader = require("./knowledge-loader");
var knowledgeStore = require("./knowledge-store");
var knowledgeLineCandidate = require("./knowledge-line-candidate");
var conversationStore = require("./conversation-store");

var MSG_NO_KEY =
  "AI会話機能はまだ設定されていません。\n『メニュー』または『ヘルプ』は利用できます。";
var MSG_API_FAIL =
  "いまAI会話へ接続できませんでした。\n司令塔コマンドは利用できます。";
var MSG_TIMEOUT =
  "いま少し応答が遅れています。\n『メニュー』や『状況』は使えます。少ししてからもう一度話しかけてください。";
var MSG_EMPTY =
  "返事の文章を取り出せませんでした。\nもう一度送るか、『メニュー』『ヘルプ』を試してください。";

function detectCompanyOpCandidate(text) {
  var t = String(text || "");
  if (/保留/.test(t) && /(人形焼き|豊川|プロジェクト|これ)/.test(t)) {
    return {
      kind: "hold_project",
      hint:
        "\n\n（確認）会社データを変更する場合は、あとで司令塔の数字選択で確定できます。\n今すぐ変更しますか？\n1：変更する\n2：変更しない"
    };
  }
  if (/最優先/.test(t) && /(にしたい|にする|へ|にして)/.test(t)) {
    return {
      kind: "set_priority",
      hint:
        "\n\n（確認）今日の最優先を変える場合は、確定前に確認が必要です。\n変更しますか？\n1：変更する\n2：変更しない"
    };
  }
  return null;
}

function pickContentFromMemory(memory, currentText) {
  var messages = (memory && memory.messages) || [];
  for (var i = messages.length - 1; i >= 0; i--) {
    var m = messages[i];
    if (!m || m.role !== "user") continue;
    var c = String(m.content || "").trim();
    if (!c || c === currentText) continue;
    if (knowledgeStore.detectExplicitSaveRequest(c)) continue;
    return c;
  }
  return "";
}

/**
 * LINE explicit save → knowledge-store append (real Markdown update).
 */
async function handleExplicitKnowledgeSave(userId, text) {
  var intent = knowledgeStore.detectExplicitSaveRequest(text);
  if (!intent) return null;

  var content = String(intent.content || "").trim();
  var title = String(intent.title || "").trim();
  var memory = await memoryStore.getChatMemory(userId);

  if (!content) {
    content = pickContentFromMemory(memory, text);
    if (content) {
      var m = content.match(/^(.{2,40}?)(?:（[^）]*）)?(?=は|を|が|。|\n|$)/);
      title = (m && m[0] ? m[0] : content.split(/[。\n]/)[0]).trim().slice(0, 40) || title;
    }
  }

  if (!content) {
    return {
      text:
        "保存する内容が見つかりませんでした。\n" +
        "先に内容を送ってから、「イベント情報に保存しておいて」と送ってください。",
      ok: false,
      kind: "knowledge-save",
      source: "ai-secretary"
    };
  }

  var saved = await knowledgeStore.appendKnowledgeEntry(intent.file, title, content);
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    stage: "line-knowledge-save",
    ok: !!saved.ok,
    file: intent.file,
    title: title,
    error: saved.error || "",
    primarySource: saved.primarySource || "",
    destinations: saved.destinations || null,
    verified: !!saved.verified,
    readSource: saved.readSource || ""
  }));

  if (!saved.ok) {
    return {
      text: "保存に失敗しました。しばらくしてからもう一度お試しください。",
      ok: false,
      kind: "knowledge-save",
      source: "ai-secretary"
    };
  }

  return {
    text: [
      "保存しました。",
      "カテゴリ：" + saved.file,
      "タイトル：" + saved.title
    ].join("\n"),
    ok: true,
    kind: "knowledge-save",
    source: "ai-secretary",
    savedFile: saved.file,
    savedTitle: saved.title
  };
}

async function buildContextSafe() {
  var projects = [];
  var priority = null;
  try {
    projects = await projectStore.listEnabledProjects();
  } catch (e) {
    projects = [];
  }
  try {
    priority = await projectStore.getTodayPriority();
  } catch (e) {
    priority = null;
  }
  return promptBuilder.buildCompanyContextSummary(projects, priority);
}

async function replyAsSecretary(userId, text) {
  var config = env.getLineConfig();
  if (!config.openaiApiKey) {
    // Still allow knowledge save without OpenAI
    var saveWithoutAi = await handleExplicitKnowledgeSave(userId, text);
    if (saveWithoutAi) return saveWithoutAi;
    return { text: MSG_NO_KEY, ok: false, kind: "chat", source: "ai-secretary" };
  }

  // Explicit save must update Markdown for real — do not only "say" saved.
  var saveResult = await handleExplicitKnowledgeSave(userId, text);
  if (saveResult) {
    try {
      await memoryStore.appendChatMessages(userId, [
        { role: "user", content: text },
        { role: "assistant", content: saveResult.text }
      ]);
    } catch (e) { /* ignore */ }
    try {
      await projectStore.patchLineMeta({ lastAiReplyAt: new Date().toISOString() });
    } catch (e2) { /* ignore */ }
    return saveResult;
  }

  var companyContext = await buildContextSafe();
  var knowledge;
  try {
    knowledge = await knowledgeStore.loadEffectiveKnowledge();
  } catch (e) {
    console.log("[ai-secretary] knowledge load failed", e && e.message ? e.message : e);
    try {
      knowledge = knowledgeLoader.loadAllKnowledge();
    } catch (e2) {
      knowledge = { ok: false, combined: "", loadedFiles: 0 };
    }
  }
  var knowledgeSection = knowledgeLoader.buildKnowledgePromptSection(knowledge);
  var instructions = promptBuilder.buildSecretarySystemPrompt(companyContext, knowledgeSection);
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    stage: "ai-secretary-knowledge",
    knowledgeOk: !!knowledge.ok,
    loadedFiles: knowledge.loadedFiles || 0,
    knowledgeChars: knowledge.combined ? knowledge.combined.length : 0
  }));
  var memory = await memoryStore.getChatMemory(userId);
  var input = (memory.messages || []).map(function (m) {
    return { role: m.role, content: m.content };
  });
  input.push({ role: "user", content: String(text || "").slice(0, 1500) });

  var result;
  try {
    result = await openaiClient.createResponse(config.openaiApiKey, {
      instructions: instructions,
      input: input
    });
  } catch (err) {
    console.log("[ai-secretary] OpenAI call threw");
    console.log("[openai-error] status=", 0);
    console.log("[openai-error] message=", err && err.message ? err.message : err);
    console.log("[openai-error] stack=", err && err.stack ? err.stack : "");
    return { text: MSG_API_FAIL, ok: false, kind: "chat", source: "ai-secretary" };
  }

  console.log("[debug] ai-secretary OpenAI result.text=", result && result.text != null ? String(result.text) : result && result.text);

  if (!result.ok) {
    console.log("[ai-secretary] OpenAI call failed; LINE gets safe fallback only");
    console.log("[openai-error] status=", result.status);
    console.log("[openai-error] message=", result.message || result.error || "");
    console.log("[openai-error] stack=", result.stack || "");
    var failText = result.error === "timeout" ? MSG_TIMEOUT : MSG_API_FAIL;
    return { text: failText, ok: false, kind: "chat", source: "ai-secretary" };
  }

  var reply = String(result.text == null ? "" : result.text).trim().slice(0, 1800);
  if (!reply) {
    console.log("[debug] ai-secretary empty text after OpenAI ok=true — using MSG_EMPTY");
    reply = MSG_EMPTY;
  }

  var candidate = detectCompanyOpCandidate(text);
  if (candidate && candidate.hint && reply.indexOf("変更しますか") === -1) {
    reply = reply + candidate.hint;
  }

  // AI保存候補: 「保存して」なしでも提案（司令塔確認と同時には出さない）
  var knowledgePromptAttached = false;
  try {
    if (!candidate && !knowledgeStore.detectExplicitSaveRequest(text)) {
      var saveCand = knowledgeStore.detectKnowledgeSaveCandidate(text);
      if (saveCand) {
        var started = await knowledgeLineCandidate.beginCandidatePrompt(userId, saveCand);
        if (started && started.prompt && reply.indexOf("会社の知識として保存できます") === -1) {
          // Keep room for prompt within LINE length budget
          reply = String(reply).slice(0, 1400) + started.prompt;
          knowledgePromptAttached = true;
        }
      }
    }
  } catch (candErr) {
    console.log("[ai-secretary] knowledge candidate prompt failed",
      candErr && candErr.message ? candErr.message : candErr);
  }

  // If no knowledge candidate this turn, clear stale LINE candidate stage on free chat
  if (!knowledgePromptAttached) {
    try {
      var conv = await conversationStore.getConversation(userId);
      if (knowledgeLineCandidate.isKnowledgeCandidateStage(conv) &&
          knowledgeLineCandidate.parseChoiceNumber(text) == null) {
        await knowledgeLineCandidate.clearKnowledgeCandidate(userId);
      }
    } catch (e) { /* ignore */ }
  }

  try {
    await memoryStore.appendChatMessages(userId, [
      { role: "user", content: text },
      { role: "assistant", content: reply }
    ]);
  } catch (memErr) {
    console.log("[ai-secretary] chat memory save failed (reply still returned)");
    console.log("[openai-error] message=", memErr && memErr.message ? memErr.message : memErr);
    console.log("[openai-error] stack=", memErr && memErr.stack ? memErr.stack : "");
  }

  try {
    await projectStore.patchLineMeta({
      lastAiReplyAt: new Date().toISOString()
    });
  } catch (e) {
    /* ignore */
  }

  console.log("[debug] ai-secretary returning text=", reply);

  return {
    text: reply,
    ok: true,
    kind: knowledgePromptAttached
      ? "knowledge-candidate"
      : (candidate ? "confirm_candidate" : "chat"),
    pendingOp: candidate ? candidate.kind : (knowledgePromptAttached ? "knowledge-save" : ""),
    source: "ai-secretary"
  };
}

module.exports = {
  replyAsSecretary: replyAsSecretary,
  detectCompanyOpCandidate: detectCompanyOpCandidate,
  handleExplicitKnowledgeSave: handleExplicitKnowledgeSave,
  MSG_NO_KEY: MSG_NO_KEY,
  MSG_API_FAIL: MSG_API_FAIL,
  MSG_TIMEOUT: MSG_TIMEOUT,
  MSG_EMPTY: MSG_EMPTY
};
