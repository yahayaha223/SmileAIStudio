"use strict";

function buildMorningMessage(projects, todayPriority, pendingCount) {
  var lines = [
    "【Smile AI Studio 朝の確認】",
    "おはようございます、YAHA😊",
    "",
    "今日、一番進めたいプロジェクトを選んでください。",
    ""
  ];
  projects.forEach(function (p, i) {
    lines.push((i + 1) + "：" + (p.icon ? p.icon + " " : "") + p.name);
  });
  lines.push("");
  lines.push("数字で返信してください。");
  lines.push("");
  lines.push("現在の最優先：");
  lines.push(todayPriority && todayPriority.projectName ? todayPriority.projectName : "未設定");
  lines.push("未対応の重要事項：");
  lines.push(String(pendingCount == null ? 0 : pendingCount) + "件");
  return lines.join("\n");
}

function buildMenuMessage(projects, todayPriority) {
  return buildMorningMessage(projects, todayPriority, 0).replace(
    "【Smile AI Studio 朝の確認】\nおはようございます、YAHA😊\n\n",
    "【Smile AI Studio メニュー】\n"
  );
}

function buildProjectActionMessage(project) {
  var actions = (project.nextActions && project.nextActions.length)
    ? project.nextActions
    : ["必要な情報を確認する", "今日の最優先にする", "今回は保留する"];
  var lines = [
    "【" + project.name + "】",
    "現在の進捗：",
    (project.status || "—") + "・" + (project.progress || 0) + "%",
    "",
    "現在の課題：",
    project.currentIssue || "（未登録）",
    "",
    "次に進める内容を選んでください。"
  ];
  actions.forEach(function (a, i) {
    lines.push((i + 1) + "：" + a);
  });
  return { text: lines.join("\n"), choices: actions };
}

function buildStatusMessage(projects, todayPriority) {
  var lines = ["【プロジェクト状況】"];
  projects.forEach(function (p) {
    lines.push(
      (p.icon || "") + " " + p.name + " / " + (p.status || "—") + " / " + (p.progress || 0) + "%"
    );
  });
  lines.push("");
  lines.push("今日の最優先：");
  lines.push(todayPriority && todayPriority.projectName ? todayPriority.projectName : "未設定");
  return lines.join("\n");
}

function buildHelpMessage() {
  return [
    "【ヘルプ】",
    "メニュー … プロジェクト一覧",
    "状況 … 全プロジェクト状況",
    "今日 … 今日の最優先",
    "履歴 … 直近の操作履歴",
    "取消 … 司令塔の選択会話を取り消す",
    "数字 … 表示中の選択肢を選ぶ",
    "リセット … 自由会話の履歴だけ消す",
    "",
    "それ以外の文章は、AI秘書チャッピーが自然にお返事します。",
    "※会社データの変更は勝手に行いません。確認が必要なときは聞きます。"
  ].join("\n");
}

function buildTestMessage() {
  return "【Smile AI Studio 接続テスト】\nLINE司令塔との接続に成功しました。";
}

function buildUserIdCaptureMessage(userId) {
  return [
    "【Smile AI Studio】",
    "あなたの LINE User ID を取得しました。",
    "",
    String(userId || ""),
    "",
    "この値を Netlify の環境変数",
    "LINE_ADMIN_USER_ID",
    "に登録してください。",
    "",
    "登録後、この案内は止まり、司令塔コマンドが使えるようになります。",
    "Smile AI Studio の「その他 → LINE司令塔」でも同じ ID を確認できます。"
  ].join("\n");
}

module.exports = {
  buildMorningMessage: buildMorningMessage,
  buildMenuMessage: buildMenuMessage,
  buildProjectActionMessage: buildProjectActionMessage,
  buildStatusMessage: buildStatusMessage,
  buildHelpMessage: buildHelpMessage,
  buildTestMessage: buildTestMessage,
  buildUserIdCaptureMessage: buildUserIdCaptureMessage
};
