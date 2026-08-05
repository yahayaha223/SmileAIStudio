# 既存 API 権限表

`AUTH_ENFORCEMENT_MODE=enforce` 時のサーバー側検査。  
`off` / `observe` では拒否しない（observe は監査のみ）。

| API | 操作 | 最低ロール | step-up | 備考 |
|-----|------|------------|---------|------|
| api-tasks | GET | staff | 不要 | 一覧・検索 |
| api-tasks | POST create/update/complete/postpone/sync-todo-md | staff | 不要 | 下書き相当 |
| api-tasks | POST import-todo-md | admin | 不要 | |
| api-tasks | POST delete | owner | **必要** | |
| api-knowledge | GET | staff | 不要 | |
| api-knowledge | POST save / candidate-add | staff | 不要 | |
| api-knowledge | POST candidate-save/reject | admin | 不要 | |
| api-command-history | GET | staff | 不要 | |
| api-meeting-logs | GET | staff | 不要 | |
| api-project-status | GET | staff | 不要 | |
| api-line-status | GET | staff | 不要 | 秘密はマスク表示のみ |
| line-send-test | POST | admin | 不要 | Web からの LINE 送信 |
| api-chat-memory-reset | POST | owner | **必要** | |
| production-publish（予約） | POST | owner | **必要** | admin 公開は初期無効 |
| ftp-upload（予約） | POST | owner | **必要** | |
| user-admin / secrets / backup-restore（予約） | POST | owner | **必要** | |

## LINE Webhook / スケジュール

| 入口 | 認証 |
|------|------|
| line-webhook | LINE 署名 + 許可 User ID（ブラウザセッション対象外、CORS なし） |
| line-send-morning / evening | スケジュール／環境設定（ブラウザセッション対象外） |

## admin の本番公開

初期: **無効**（`AUTH_ADMIN_PUBLISH_ENABLED` 未設定、allowlist 空）。  
将来 owner が機能単位 allowlist または環境変数で許可可能。
