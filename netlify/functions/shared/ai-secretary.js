"use strict";

var env = require("./env");
var openaiClient = require("./openai-client");
var memoryStore = require("./conversation-memory-store");
var promptBuilder = require("./secretary-system-prompt");
var projectStore = require("./project-store");
var knowledgeLoader = require("./knowledge-loader");
var knowledgeStore = require("./knowledge-store");

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
    return { text: MSG_NO_KEY, ok: false, kind: "chat", source: "ai-secretary" };
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

  // Company Brain: queue durable-fact candidates for YAHA approval in the app UI
  try {
    var saveCand = knowledgeStore.detectKnowledgeSaveCandidate(text);
    if (saveCand) {
      var queued = await knowledgeStore.addCandidate(saveCand);
      if (queued && reply.indexOf("保存候補") === -1) {
        reply +=
          "\n\n（Company Brain）この内容を会社の知識へ保存する候補に入れました。\n" +
          "Smile AI Studio → その他 → 会社の脳 で確認できます。";
      }
    }
  } catch (candErr) {
    console.log("[ai-secretary] knowledge candidate queue failed");
  }

  // Do not let memory persistence block LINE reply after a successful OpenAI answer.
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
    kind: candidate ? "confirm_candidate" : "chat",
    pendingOp: candidate ? candidate.kind : "",
    source: "ai-secretary"
  };
}

module.exports = {
  replyAsSecretary: replyAsSecretary,
  detectCompanyOpCandidate: detectCompanyOpCandidate,
  MSG_NO_KEY: MSG_NO_KEY,
  MSG_API_FAIL: MSG_API_FAIL,
  MSG_TIMEOUT: MSG_TIMEOUT,
  MSG_EMPTY: MSG_EMPTY
};
