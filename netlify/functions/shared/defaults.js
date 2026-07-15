"use strict";

var DEFAULT_PROJECTS = [
  {
    id: "fuwafuwa",
    name: "Fuwafuwa Panic Manager",
    icon: "🎪",
    description: "ふわふわ・イベント現場管理",
    status: "開発中",
    priority: "高",
    progress: 45,
    currentIssue: "在庫画面のスマホ最適化",
    nextActions: ["在庫入力UXを確認する", "現場テスト項目をまとめる", "今日の最優先にする", "今回は保留する"],
    enabled: true
  },
  {
    id: "gift-canvas",
    name: "GiftCanvas",
    icon: "🎈",
    description: "バルーンギフトのデザイン・注文",
    status: "開発中",
    priority: "通常",
    progress: 40,
    currentIssue: "スマホでのデザイン確認",
    nextActions: ["デザイン確認導線を整理する", "注文フローを見直す", "今日の最優先にする", "今回は保留する"],
    enabled: true
  },
  {
    id: "event-lp",
    name: "イベント相談LP",
    icon: "🌐",
    description: "イベント相談ランディング",
    status: "改善中",
    priority: "通常",
    progress: 55,
    currentIssue: "問い合わせ導線の改善",
    nextActions: ["CTA文言を見直す", "スマホ表示を確認する", "今日の最優先にする", "今回は保留する"],
    enabled: true
  },
  {
    id: "toyokawa-ningyoyaki",
    name: "豊川稲荷 人形焼き",
    icon: "🦊",
    description: "人形焼きのデザイン・製造連携",
    status: "準備中",
    progress: 35,
    priority: "最優先",
    currentIssue: "デザイン決定と製造会社への連絡",
    nextActions: [
      "デザイン案を整理する",
      "製造会社への連絡文を作る",
      "必要な情報を確認する",
      "今日の最優先にする",
      "今回は保留する"
    ],
    enabled: true
  },
  {
    id: "smile-ai-studio",
    name: "Smile AI Studio",
    icon: "🤖",
    description: "会社OS・AI司令塔",
    status: "開発中",
    priority: "高",
    progress: 90,
    currentIssue: "LINE双方向司令塔の運用定着",
    nextActions: ["朝の確認フローを試す", "会議ログ連携を確認する", "今日の最優先にする", "今回は保留する"],
    enabled: true
  }
];

module.exports = {
  DEFAULT_PROJECTS: DEFAULT_PROJECTS
};
