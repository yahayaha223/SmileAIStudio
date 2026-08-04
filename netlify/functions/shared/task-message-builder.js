"use strict";

var parser = require("./task-parser");

function projectName(task, projects) {
  if (!task.projectId) return "";
  var list = projects || [];
  var p = list.find(function (x) { return x.id === task.projectId; });
  return p ? p.name : task.projectId;
}

function buildAddConfirm(draft) {
  return [
    "✅ タスクとして追加しますか？",
    "内容：",
    draft.title || "",
    "期限：",
    draft.dueLabel || parser.formatDueLabel(draft.dueDate, draft.dueTime) || "未設定",
    "優先度：",
    draft.priorityLabel || parser.priorityLabelJa(draft.priority),
    "1：追加する",
    "2：内容を変更",
    "3：期限を変更",
    "4：追加しない"
  ].join("\n");
}

function buildAmbiguousFriday(weekdayLabel) {
  return [
    "期限が曖昧です。",
    "「" + (weekdayLabel || "金曜日") + "」はどちらですか？",
    "1：今週",
    "2：来週",
    "3：追加しない"
  ].join("\n");
}

function buildDuplicateConfirm(similar, draft) {
  var lines = ["似たタスクがあります。"];
  similar.slice(0, 3).forEach(function (t) {
    lines.push("「" + t.title + "」");
    lines.push("期限：" + parser.formatDueLabel(t.dueDate, t.dueTime));
  });
  lines.push("新しく追加しますか？");
  lines.push("内容：" + (draft.title || ""));
  lines.push("1：追加");
  lines.push("2：既存を使う");
  lines.push("3：中止");
  return lines.join("\n");
}

function buildTaskList(title, tasks, projects) {
  var lines = ["【" + title + "】"];
  if (!tasks || !tasks.length) {
    lines.push("該当する未完了タスクはありません。");
    return lines.join("\n");
  }
  tasks.forEach(function (t, i) {
    lines.push(
      (i + 1) + ". " + parser.priorityEmoji(t.priority) + " " + t.title
    );
    lines.push("   期限：" + parser.formatDueLabel(t.dueDate, t.dueTime));
    var pn = projectName(t, projects);
    if (pn) lines.push("   プロジェクト：" + pn);
    if (t.priority === "low") lines.push("   優先度：低");
  });
  lines.push("");
  lines.push("返信例：");
  lines.push("1 完了");
  lines.push("2 延期");
  lines.push("詳細 1");
  return lines.join("\n");
}

function buildCompleteConfirm(task) {
  return [
    "「" + task.title + "」を完了にしますか？",
    "1：完了する",
    "2：戻る"
  ].join("\n");
}

function buildCompleteDone(task, nextTask) {
  var when = task.completedAt
    ? new Date(task.completedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
    : "";
  var lines = [
    "完了にしました😊",
    task.title,
    "完了日時：" + when
  ];
  if (nextTask) {
    lines.push("");
    lines.push("次の優先タスク：");
    lines.push(nextTask.title);
  }
  return lines.join("\n");
}

function buildPostponeMenu(task) {
  return [
    "「" + task.title + "」をいつに延期しますか？",
    "1：明日",
    "2：来週",
    "3：日付を入力",
    "4：戻る"
  ].join("\n");
}

function buildMorningWithTasks(projects, todayPriority, dash) {
  dash = dash || {};
  var lines = [
    "おはようございます、YAHA😊",
    "",
    "【今日の最優先】",
    todayPriority && todayPriority.projectName ? todayPriority.projectName : "未設定",
    "",
    "【今日のタスク】"
  ];
  if (!dash.today) {
    lines.push("今日が期限のタスクはありません");
  } else {
    lines.push("未完了 " + dash.today + "件");
  }
  if (dash.overdue) {
    lines.push("期限超過 " + dash.overdue + "件");
  }
  lines.push("");
  lines.push("1：タスクを見る");
  lines.push("2：今日の最優先を変更");
  lines.push("3：プロジェクト状況を見る");
  return lines.join("\n");
}

function buildEveningStub(dash) {
  dash = dash || {};
  var done = dash.completedToday != null ? dash.completedToday : 0;
  var total = dash.todayTotal != null ? dash.todayTotal : 0;
  var open = dash.openTitles || [];
  var lines = [
    "今日のタスクは" + total + "件中" + done + "件完了しました。"
  ];
  if (open.length) {
    lines.push("未完了：");
    open.forEach(function (t) { lines.push("・" + t); });
    lines.push("明日に延期しますか？");
    lines.push("1：延期");
    lines.push("2：今日中にやる");
    lines.push("3：そのまま");
  } else {
    lines.push("未完了のタスクはありません。お疲れさまです😊");
  }
  return lines.join("\n");
}

function buildHelpTaskLines() {
  return [
    "【タスク】",
    "今日のタスク / 明日のタスク / 今週のタスク / タスク一覧",
    "完了 / 延期 / タスク検索 ○○",
    "自然な文（例：明日朝倉さんへメール）でも候補を出します。"
  ].join("\n");
}

module.exports = {
  buildAddConfirm: buildAddConfirm,
  buildAmbiguousFriday: buildAmbiguousFriday,
  buildDuplicateConfirm: buildDuplicateConfirm,
  buildTaskList: buildTaskList,
  buildCompleteConfirm: buildCompleteConfirm,
  buildCompleteDone: buildCompleteDone,
  buildPostponeMenu: buildPostponeMenu,
  buildMorningWithTasks: buildMorningWithTasks,
  buildEveningStub: buildEveningStub,
  buildHelpTaskLines: buildHelpTaskLines
};
