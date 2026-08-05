# Auth Staging — Branch Deploy 準備

**まだ GitHub push / Netlify deploy / 本番公開は行わない。**

---

## 予定ブランチと URL

| 項目 | 値 |
|------|-----|
| ブランチ | `auth-staging`（未作成・push 未実施） |
| Netlify サイト名（リポジトリ上の確認） | `smile-ai-studio`（`package.json` / 既存スクリプトの `*.netlify.app` 参照） |
| 想定 Branch Deploy URL | `https://auth-staging--smile-ai-studio.netlify.app` |
| 確定状態 | **サイトスラッグはコード上の慣例から推定。Netlify UI の Site name と一致するかは push 前に UI で要確認** |

本番 RP `studio.egaonokiroku.co.jp` はステージングで使用しない。

---

## WebAuthn（ステージング）

| 変数 | 推奨 |
|------|------|
| `AUTH_RP_ID` | Branch Deploy ホスト名そのもの（例: `auth-staging--smile-ai-studio.netlify.app`） |
| `AUTH_ALLOWED_ORIGINS` | `https://auth-staging--smile-ai-studio.netlify.app` のみ（完全一致） |
| `AUTH_APP_URL` | `https://auth-staging--smile-ai-studio.netlify.app` |

ステージングで登録したパスキーは試験用。本番切替時は再登録。

---

## 環境分離（実装済み）

| 領域 | 方式 |
|------|------|
| Blobs store | `smile-studio-auth-staging`（production は `smile-studio-auth`） |
| Key prefix | `staging/...` vs `production/...` vs `local/...` |
| FTP / 本番公開 / バックアップ復元 / 秘密設定 | `AUTH_ENVIRONMENT≠production` でコード hard-deny |
| LINE スケジュール送信 | production 以外は 403 |
| LINE テスト送信 | staging は `AUTH_STAGING_LINE_TEST_ENABLED=1` のときのみ（既定オフ） |
| メール | 件名・本文に `[STAGING]` / 【STAGING】 |

---

## Branch Deploy 環境変数（値は書かない）

| 変数 | ステージング方針 |
|------|------------------|
| `AUTH_ENVIRONMENT` | `staging` |
| `AUTH_ENFORCEMENT_MODE` | 初期 `off` → 確認後 `observe` → 最後 `enforce` |
| `AUTH_RP_ID` | Branch Deploy ホスト名 |
| `AUTH_RP_NAME` | 例: `Smile AI Studio (STAGING)` |
| `AUTH_ALLOWED_ORIGINS` | Branch Deploy HTTPS origin のみ |
| `AUTH_APP_URL` | Branch Deploy HTTPS URL |
| `AUTH_COOKIE_SECURE` | `true` |
| `AUTH_IP_HASH_SALT` | ステージング専用の新規乱数（本番と共有しない） |
| `AUTH_BOOTSTRAP_ENABLED` | 初期 `0`。owner 試験時のみ短時間 `1` |
| `AUTH_BOOTSTRAP_OWNER_EMAIL` | 試験用メール（本番 owner と混在注意） |
| `AUTH_EMAIL_PROVIDER` | 初期 `console`。Resend 実通は後半 |
| `AUTH_EMAIL_FROM` | 検証済み送信ドメインの From（Resend 準備後） |
| `RESEND_API_KEY` | ステージング用キー（本番キーをコピーしない） |
| `AUTH_TEST_EXPOSE_EMAIL_TOKEN` | `false` |
| `AUTH_ADMIN_PUBLISH_ENABLED` | `false` |
| `AUTH_STAGING_LINE_TEST_ENABLED` | 既定 `false` |
| `LINE_*` / `OPENAI_*` / FTP | **ステージングへ本番秘密をコピーしない** |

Netlify では Branch Deploy context（`auth-staging`）に上記を設定する。

---

## Resend 準備（キー未作成）

- 送信ドメイン候補: 会社ドメイン配下（例: `noreply@…` / `studio@…`）。DNS で SPF/DKIM（必要なら DMARC）が必要
- `AUTH_EMAIL_FROM` は検証済みドメインのアドレス形式
- ステージング件名は必ず `[STAGING]`（実装済み）
- トークン: 10分・1回使用・ハッシュ保存（実装済み）
- ログにトークン・APIキーを出さない（実装済み）
- **今回 Resend API キーは作成・表示・保存しない**

---

## 試験計画（Deploy 後）

1. HTTP・セキュリティヘッダー確認  
2. `AUTH_ENFORCEMENT_MODE=off`  
3. ログイン画面表示（ステージング注意文）  
4. console provider でメールフロー  
5. ステージング owner bootstrap（短時間）  
6. パスキー登録（試験用）  
7. ログアウト  
8. パスキーログイン  
9. セッション期限  
10. CSRF/CORS 拒否  
11. role 検査  
12. step-up  
13. 端末一覧と強制ログアウト  
14. observe  
15. enforce  
16. 未認証で既存 API 拒否  
17. 認証済みで既存機能正常  
18. ステージングから本番 FTP・本番公開ができないこと  
19. Resend 実メール  
20. iPhone Face ID  
21. Windows Hello  
22. Android  

パスキーはステージング用として登録し、本番切替時に再登録する。
