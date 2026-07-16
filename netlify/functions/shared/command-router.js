"use strict";

var projectStore = require("./project-store");
var conversationStore = require("./conversation-store");
var historyStore = require("./command-history-store");
var meetingLogStore = require("./meeting-log-store");
var messages = require("./message-builder");
var memoryStore = require("./conversation-memory-store");
var aiSecretary = require("./ai-secretary");
var knowledgeLineCandidate = require("./knowledge-line-candidate");

function normalizeCommand(text) {
  return String(text || "")
    .replace(/\u3000/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[！!。．.]+$/g, "");
}

function mapCommand(normalized) {
  if (!normalized) return { type: "empty" };
  if (/^(メニュー|menu)$/.test(normalized)) return { type: "menu" };
  if (/^(状況|ステータス|status)$/.test(normalized)) return { type: "status" };
  if (/^(今日|きょう|today)$/.test(normalized)) return { type: "today" };
  if (/^(履歴|history)$/.test(normalized)) return { type: "history" };
  if (/^(取消|取り消し|キャンセル|cancel)$/.test(normalized)) return { type: "cancel" };
  if (/^(ヘルプ|help|使い方)$/.test(normalized)) return { type: "help" };
  if (/^(会話リセット|リセット|reset)$/.test(normalized)) return { type: "chat-reset" };
  if (/^\d{1,2}$/.test(normalized)) return { type: "number", value: Number(normalized) };
  // Circled numbers used by AI保存候補
  if (/^[①②③④⑤⑥⑦⑧⑨⑩]$/.test(String(normalized))) {
    var circledMap = { "①": 1, "②": 2, "③": 3, "④": 4, "⑤": 5, "⑥": 6, "⑦": 7, "⑧": 8, "⑨": 9, "⑩": 10 };
    return { type: "number", value: circledMap[normalized] };
  }
  return { type: "freechat", raw: normalized };
}

/**
 * Classify with priority:
 * 1) number during AI knowledge-candidate stage
 * 2) number during active command stage
 * 3) explicit commands
 * 4) free chat
 */
function classifyIncoming(text, conversation) {
  var cmd = mapCommand(normalizeCommand(text));
  var knowledgeStage = knowledgeLineCandidate.isKnowledgeCandidateStage(conversation);
  var activeStage = conversation && !conversation.expired &&
    (conversation.stage === "awaiting-project" ||
      conversation.stage === "awaiting-action" ||
      conversation.stage === "awaiting-confirmation");

  // Also treat "①保存する" style as knowledge choice before freechat
  if (knowledgeStage && knowledgeLineCandidate.parseChoiceNumber(text) != null) {
    return { route: "knowledge-candidate", cmd: cmd };
  }
  if (cmd.type === "number" && knowledgeStage) {
    return { route: "knowledge-candidate", cmd: cmd };
  }
  if (cmd.type === "number" && activeStage) {
    return { route: "command-number", cmd: cmd };
  }
  if (cmd.type === "number" && !activeStage) {
    return { route: "command-number", cmd: cmd };
  }
  if (cmd.type !== "freechat" && cmd.type !== "empty") {
    return { route: "command", cmd: cmd };
  }
  if (cmd.type === "empty") {
    return { route: "empty", cmd: cmd };
  }
  return { route: "freechat", cmd: cmd };
}

async function replyMenu(userId) {
  var projects = await projectStore.listEnabledProjects();
  var priority = await projectStore.getTodayPriority();
  await conversationStore.saveConversation(userId, {
    stage: "awaiting-project",
    selectedProjectId: "",
    choices: projects.map(function (p) { return p.id; })
  });
  return messages.buildMenuMessage(projects, priority);
}

async function handleActionSelection(userId, project, choiceIndex) {
  var built = messages.buildProjectActionMessage(project);
  var action = built.choices[choiceIndex];
  if (!action) {
    return { text: "選択肢の番号が範囲外です。もう一度数字で選んでください。", ok: false };
  }

  if (action.indexOf("保留") !== -1) {
    await conversationStore.clearConversation(userId);
    await historyStore.addCommandHistory({
      type: "hold",
      summary: project.name + " を保留",
      projectId: project.id,
      projectName: project.name,
      action: action,
      ok: true
    });
    return {
      text: "了解しました。\n「" + project.name + "」は今回保留にしました。\n『メニュー』でやり直せます。",
      ok: true
    };
  }

  if (action.indexOf("最優先") !== -1) {
    var updated = await projectStore.updateProject(project.id, { priority: "最優先" });
    var priority = await projectStore.setTodayPriority(updated || project);
    if (!updated || !priority) {
      return { text: "保存に失敗しました。しばらくしてからもう一度お試しください。", ok: false };
    }
    var nextHint = (built.choices[0] && built.choices[0].indexOf("最優先") === -1)
      ? built.choices[0]
      : (project.currentIssue || "課題を確認する");
    var log = await meetingLogStore.saveMeetingLog({
      id: "meeting-line-" + Date.now(),
      date: new Date().toISOString(),
      title: project.name + "を今日の最優先に設定",
      category: "経営",
      content:
        "LINE朝確認への返信により、\n" +
        project.name + "を今日の最優先として進めることを決定。\n" +
        "現在の課題：" + (project.currentIssue || "（未登録）"),
      summary:
        project.name + "を本日の最優先へ変更し、\n次に「" + nextHint + "」を行う。",
      sourceType: "line-command",
      sourceText: "action=" + action,
      selectedProjectId: project.id,
      selectedAction: action,
      userId: userId,
      createdAt: new Date().toISOString()
    });
    if (!log) {
      return {
        text: "最優先の更新は途中まで進みましたが、会議ログの保存に失敗しました。状態を確認してください。",
        ok: false
      };
    }
    await historyStore.addCommandHistory({
      type: "set-priority",
      summary: project.name + " を今日の最優先に設定",
      projectId: project.id,
      projectName: project.name,
      action: action,
      ok: true
    });
    await conversationStore.clearConversation(userId);
    return {
      text: [
        "了解しました。",
        "今日の最優先を",
        "「" + project.name + "」",
        "へ変更しました。",
        "",
        "次にやること：",
        nextHint,
        "",
        "Smile AI Studioの会議ログにも自動保存しました。",
        "",
        "※外部への自動実行（連絡・公開・コード変更）は行っていません。"
      ].join("\n"),
      ok: true
    };
  }

  await historyStore.addCommandHistory({
    type: "prepare-action",
    summary: project.name + " / " + action + "（実行準備）",
    projectId: project.id,
    projectName: project.name,
    action: action,
    ok: true
  });
  await meetingLogStore.saveMeetingLog({
    id: "meeting-line-" + Date.now(),
    date: new Date().toISOString(),
    title: project.name + "：" + action,
    category: "経営",
    content:
      "LINE司令塔で「" + action + "」を選択。\n" +
      "今回は実行準備まで。外部送信・コード変更は行わない。",
    summary: project.name + "について「" + action + "」の実行準備を記録しました。",
    sourceType: "line-command",
    sourceText: "action=" + action,
    selectedProjectId: project.id,
    selectedAction: action,
    userId: userId,
    createdAt: new Date().toISOString()
  });
  await conversationStore.saveConversation(userId, {
    stage: "awaiting-confirmation",
    selectedProjectId: project.id,
    choices: ["はい", "いいえ"]
  });
  return {
    text: [
      "実行準備ができました。",
      "対象：" + project.name,
      "内容：" + action,
      "",
      "今回のMVPでは、ここで停止します。",
      "外部への自動実行は行いません。",
      "",
      "『メニュー』で最初に戻れます。"
    ].join("\n"),
    ok: true
  };
}

async function handleCommandNumber(userId, cmd, conversation) {
  if (!conversation || conversation.expired) {
    return {
      text: "選択内容の期限が切れています。\n『メニュー』と送信して、もう一度始めてください",
      ok: false
    };
  }
  if (conversation.stage === "awaiting-project") {
    var project = await projectStore.getProjectByChoiceNumber(cmd.value);
    if (!project) {
      return { text: "選択肢の番号が範囲外です。一覧の数字で選んでください。", ok: false };
    }
    var actionMsg = messages.buildProjectActionMessage(project);
    await conversationStore.saveConversation(userId, {
      stage: "awaiting-action",
      selectedProjectId: project.id,
      choices: actionMsg.choices
    });
    return { text: actionMsg.text, ok: true };
  }
  if (conversation.stage === "awaiting-action") {
    var selected = await projectStore.getProjectById(conversation.selectedProjectId);
    if (!selected) {
      await conversationStore.clearConversation(userId);
      return { text: "プロジェクト情報が見つかりません。『メニュー』からやり直してください。", ok: false };
    }
    return handleActionSelection(userId, selected, cmd.value - 1);
  }
  return {
    text: "いま選べる数字の質問がありません。『メニュー』と送ってください。",
    ok: false
  };
}

async function routeIncomingText(userId, text) {
  var conversation = await conversationStore.getConversation(userId);
  var classified = classifyIncoming(text, conversation);
  var cmd = classified.cmd;

  if (classified.route === "empty") {
    return { text: "メッセージが空です。『ヘルプ』で使い方を確認できます。", ok: false };
  }

  if (classified.route === "knowledge-candidate") {
    var knowledgeReply = await knowledgeLineCandidate.handleKnowledgeCandidateReply(
      userId,
      text,
      conversation
    );
    if (knowledgeReply) return knowledgeReply;
  }

  if (classified.route === "command-number") {
    return handleCommandNumber(userId, cmd, conversation);
  }

  if (classified.route === "command") {
    if (cmd.type === "help") return { text: messages.buildHelpMessage(), ok: true, source: "command" };
    if (cmd.type === "menu") {
      await knowledgeLineCandidate.clearKnowledgeCandidate(userId);
      return { text: await replyMenu(userId), ok: true, source: "command" };
    }
    if (cmd.type === "cancel") {
      await conversationStore.clearConversation(userId);
      await knowledgeLineCandidate.clearKnowledgeCandidate(userId);
      return { text: "現在の会話を取り消しました。『メニュー』で再開できます。", ok: true, source: "command" };
    }
    if (cmd.type === "today") {
      var priority = await projectStore.getTodayPriority();
      return {
        text: "【今日の最優先】\n" + (priority.projectName || "未設定") +
          (priority.note ? "\n課題：" + priority.note : ""),
        ok: true,
        source: "command"
      };
    }
    if (cmd.type === "status") {
      var projects = await projectStore.listEnabledProjects();
      var today = await projectStore.getTodayPriority();
      return { text: messages.buildStatusMessage(projects, today), ok: true, source: "command" };
    }
    if (cmd.type === "history") {
      var history = await historyStore.listCommandHistory(5);
      if (!history.length) return { text: "まだ操作履歴がありません。", ok: true, source: "command" };
      return {
        text: "【直近の履歴】\n" + history.map(function (h, i) {
          return (i + 1) + ". " + h.summary;
        }).join("\n"),
        ok: true,
        source: "command"
      };
    }
    if (cmd.type === "chat-reset") {
      await memoryStore.clearChatMemory(userId);
      await knowledgeLineCandidate.clearKnowledgeCandidate(userId);
      return {
        text: "自由会話の履歴をリセットしました。\nプロジェクトや会議ログなどの会社データは消していません。",
        ok: true,
        source: "command"
      };
    }
  }

  // Free chat → AI secretary (OpenAI Responses API)
  return aiSecretary.replyAsSecretary(userId, text);
}

module.exports = {
  normalizeCommand: normalizeCommand,
  mapCommand: mapCommand,
  classifyIncoming: classifyIncoming,
  routeIncomingText: routeIncomingText,
  replyMenu: replyMenu
};
