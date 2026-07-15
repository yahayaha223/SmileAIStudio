# Smile AI Studio

**株式会社えがおのきろく 専属 AI 開発本部**

Smile AI Studio は、えがおのきろくが手がけるすべてのデジタルプロダクトを AI とともに開発・運用するための統括拠点です。人の創造性を支え、開発のスピードと品質を両立させます。

---

## 理念

> **笑顔をつくる仕事に、人の時間を返す。**

私たちは、AI を「人を置き換える道具」ではなく、「人がもっと人らしい仕事に集中できる環境」をつくる道具として使います。繰り返し作業や定型実装は AI に任せ、企画・デザイン・お客様との対話・品質判断には人が向き合う——そのバランスを常に意識します。

- **統括**: 複数プロジェクトを一つの開発文化のもとで管理する
- **透明性**: ルール・履歴・判断理由を文書化し、誰でも追えるようにする
- **安全**: 既存機能を壊さず、テストと確認を経てから届ける
- **拡張性**: 新しいプロジェクトや AI エージェントを、いつでも追加できる構成にする

---

## 目的

1. **FuwafuwaPanicManager・GiftCanvas・イベント相談 LP** など、全プロジェクトの開発を効率化する
2. **AI エージェント** による実装・テスト・デプロイ確認の標準フローを確立する
3. **開発ルールと依頼テンプレート** を整備し、スマホからでも安全に依頼できるようにする
4. **えがおのきろくの開発文化** を、ドキュメントと実践の両方で育て続ける

---

## 全体構成

```
SmileAIStudio/
├── README.md                 # このファイル（入口）
├── VISION.md                 # なぜ作るのか・開発文化
├── PROJECTS.md               # 管理プロジェクト一覧
├── DEVELOPMENT_RULES.md      # 開発ルール（必読）
├── REQUEST_TEMPLATE.md       # スマホからの依頼テンプレート
├── ROADMAP.md                # 1年計画
│
├── docs/                     # 詳細ドキュメント
│   ├── architecture/         # システム設計・方針
│   ├── guides/               # 手順書・ハウツー
│   └── onboarding/           # 新メンバー・新エージェント向け
│
├── agents/                   # AI エージェント定義
│   ├── README.md             # エージェント一覧と役割
│   ├── templates/            # プロンプト・スキル雛形
│   └── configs/              # エージェント別設定
│
├── projects/                 # 各プロジェクトのメタ情報
│   ├── fuwafuwa-panic-manager/
│   ├── gift-canvas/
│   └── event-consultation-lp/
│
├── templates/                # 依頼・PR・報告などの雛形
│   └── requests/
│
├── scripts/                  # 自動化スクリプト（デプロイ確認など）
│
└── .cursor/                  # Cursor 用ルール・スキル
    └── rules/
```

### ドキュメントの読み方

| 読者 | 最初に読むファイル |
|------|-------------------|
| 依頼者（スマホ含む） | [REQUEST_TEMPLATE.md](./REQUEST_TEMPLATE.md) → [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md) |
| 開発担当・AI エージェント | [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md) → [PROJECTS.md](./PROJECTS.md) |
| 経営・企画 | [VISION.md](./VISION.md) → [ROADMAP.md](./ROADMAP.md) |

### 関連リンク

- [VISION.md](./VISION.md) — ビジョンと開発文化
- [PROJECTS.md](./PROJECTS.md) — プロジェクト一覧
- [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md) — 開発ルール
- [REQUEST_TEMPLATE.md](./REQUEST_TEMPLATE.md) — 依頼テンプレート
- [ROADMAP.md](./ROADMAP.md) — ロードマップ
- [docs/guides/LINE_COMMAND_CENTER.md](./docs/guides/LINE_COMMAND_CENTER.md) — LINE双方向司令塔の設定手順

---

## クイックスタート（開発依頼）

1. [REQUEST_TEMPLATE.md](./REQUEST_TEMPLATE.md) をコピーし、依頼内容を記入する
2. 対象プロジェクト名・優先度・期限を明記する
3. AI エージェントまたは開発担当に渡す
4. 完了後、**開発完了通知** と **Netlify 確認結果** を受け取る

---

*Smile AI Studio — えがおのきろくの AI 開発本部*
