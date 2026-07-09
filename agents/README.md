# AI エージェント一覧

Smile AI Studio で利用する AI エージェントの定義・役割・設定を管理します。

## 現在のエージェント

| ID | 名前 | 役割 | 設定 |
|----|------|------|------|
| `general-dev` | 汎用開発エージェント | 実装・テスト・Push・Netlify 確認 | `configs/general-dev.json` |

## 追加予定のエージェント（例）

| ID | 名前 | 役割 |
|----|------|------|
| `lp-specialist` | LP 専門 | イベント相談 LP・キャンペーン LP の文言・CTA 最適化 |
| `admin-tools` | 管理画面専門 | FuwafuwaPanicManager 等の CRUD・業務フロー |
| `reviewer` | レビュー担当 | 差分確認・DEVELOPMENT_RULES 準拠チェック |

## エージェント追加手順

1. `configs/<agent-id>.json` に設定を追加
2. 必要なら `templates/<agent-id>.md` にプロンプト雛形を追加
3. 本ファイルの一覧を更新
4. `.cursor/rules/` に Cursor 用ルールを追加（任意）
5. `docs/onboarding/` に使い方を追記

## 共通ルール

すべてのエージェントは以下を必ず参照します。

- [DEVELOPMENT_RULES.md](../DEVELOPMENT_RULES.md)
- [VISION.md](../VISION.md)
- 対象プロジェクトの `projects/<name>/README.md`
