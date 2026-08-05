# Smile AI Studio — 認証・安全管理設計（調査・設計版）

**状態**: ローカル設計・試作のみ。本番公開・ユーザー本登録・GitHub push は行わない。  
**日付**: 2026-08-04  
**前提**: 顔画像・生体テンプレートを Smile AI Studio へ保存しない。WebAuthn / Passkey を用いる。

---

## 1. 現状システム構成（調査結果）

| 層 | 実態 |
|----|------|
| フロントエンド | ルートの静的 SPA（`index.html` / `script.js` / `style.css`）。React/Next/Vite なし |
| バックエンド | **Netlify Functions**（`netlify/functions/`）＋ **ローカル PowerShell**（`.static-server.ps1`、ループバック専用） |
| データ | **Netlify Blobs**（本番 KV）。ローカルは `.data/line-store.json` 等。SQL DB なし |
| ホスティング | Smile AI Studio 本体: **Netlify**。公式コーポレート/日記: **Xserver FTPS** |
| API | `api-tasks` / `api-knowledge` / `api-line-status` 等（Functions）。FTP 系は localhost のみ |
| Web 認証 | **なし**（ログイン画面・セッション Cookie・JWT なし） |
| 既存の身元確認 | LINE Webhook のみ（署名＋ `LINE_ADMIN_USER_ID` 許可リスト） |

### 公開 URL とローカル限定

| 区分 | 内容 |
|------|------|
| 公開（Netlify） | 静的コンソール、LINE Webhook、タスク/ナレッジ等 Functions |
| ローカルのみ | FTP 設定・probe・dry-run・本番公開アーム、日記ローカル適用（`127.0.0.1`） |
| 別ホスト | `www.egaonokiroku.co.jp`（CorporateSite）。本認証の対象外（公開サイト） |

### 秘密情報の保存場所（値は記載しない）

| 種類 | 場所 | Git |
|------|------|-----|
| LINE / OpenAI 等 | Netlify 環境変数、ローカル `.env`（example のみコミット） | `.env` は ignore |
| FTP パスワード | `.data/ftp-config.json`（gitignore） | 未追跡 |
| 公開バックアップ | `production-backups/` | ignore |
| ブラウザ | FTP/API キーは保存しない設計。`localStorage` は UI 状態のみ | — |

調査時点: `.env` はローカル未作成、`.data/ftp-config.json` は存在（gitignore 済み）。

---

## 2. 脅威と問題点

| 重大度 | 問題 | 影響 |
|--------|------|------|
| **重大** | Netlify 管理系 API（tasks / knowledge / send-test / memory-reset 等）に **呼び出し元認証がない** | URL を知られれば社内データ改変・LINE 送信悪用の可能性 |
| **重大** | Functions 応答の `Access-Control-Allow-Origin: *` | 任意オリジンからのブラウザ経由呼び出しを容易にする |
| **高** | Web コンソールにログインゲートがない | 公開 SPA 上の管理 UI が「URL 秘匿」依存 |
| **高** | スケジュール Functions / テスト送信が URL 知得で呼び出せる余地 | スパム・情報漏洩リスク |
| **中** | FTP ユーザー名・ホストがソースに固定的に出現 | アカウント推測の材料（パスワード自体は非コミット） |
| **中** | ローカル FTP API はループバック限定だが、プロセス上は認証なし | 同一マシン上の他プロセスからの悪用余地 |
| **低** | `localStorage` に業務下書き等が残る | 共有端末での情報残存（認証導入後も端末ロック前提が必要） |

JavaScript のみの疑似ログインや顔画像の独自照合は採用しない。

---

## 3. 認証基盤の比較と推奨

| 候補 | 適合性 | 評価 |
|------|--------|------|
| **既存 Netlify Functions へ WebAuthn 実装（推奨）** | Blobs・Functions と一致。秘密は Netlify env。役割・再認証・監査を自前で一貫実装可能 | **最推奨** |
| Supabase Auth | Passkey 対応は強いが、ユーザーDBが Blobs と分裂。FTP ローカル面は別途 | 次点（マネージド優先時） |
| Firebase Authentication | 同様にエコシステム分裂。既存 Blobs との二重管理 | 非推奨（現状） |
| Auth0 / Clerk | Passkey UX が良い。コストとベンダー依存。API 権限検査は結局 Functions 側必須 | 人員増・SaaS 許容なら検討 |
| Cloudflare Access | 入口保護は強いが、hosting 移行と細粒度 owner/admin/staff が弱い | 現状非推奨 |
| 静的 HTML のみで完結 | サーバー側検証不可。要件を満たせない | **不可** |

### 推奨決定

**採用: Netlify Functions 上の WebAuthn / Passkey ＋ Blobs 永続化 ＋ HttpOnly セッション Cookie**

理由:
1. 現行ホスティング・KV を活かせる  
2. 生体情報は端末 OS / Authenticator に留まり、サーバーは公開鍵のみ保持（仕様準拠）  
3. owner/admin/staff とステップアップ再認証を API ごとに強制できる  
4. FTP 秘密は引き続きサーバー／ローカルディスクのみ。ブラウザへ渡さない  

代替導線（メールマジックリンク等）も同一セッション基盤に載せる。

---

## 4. 顔認証の実現方式（生体をサーバー保存しない）

| 端末 | ユーザー体験 | 技術 |
|------|--------------|------|
| iPhone | Face ID（または Touch ID / 端末パスコード） | Safari / WebAuthn platform authenticator（Passkey） |
| Windows PC | Windows Hello | Chrome/Edge + platform authenticator |
| Android | 顔・指紋・端末ロック | Chrome + platform / ハイブリッド Passkey |
| 未対応 | メールワンタイム + パスキー登録誘導 | サーバー発行の短命トークン（パスワードの平文保存なし） |

サーバーが保存するのは **credentialId・公開鍵・signCount・transport・デバイスラベル** のみ。顔画像は扱わない。

---

## 5. セッション方式

- 転送: **HTTPS 必須**（本番）。ローカル試作は `http://127.0.0.1`  
- セッション ID: 32 bytes 以上の CSPRNG、推測困難  
- Cookie: `HttpOnly; Secure; SameSite=Lax`（クロスサイト POST が必要な場合は CSRF トークン併用で `Strict` 検討）  
- ログイン成功時に **セッション ID 再生成**（固定化対策）  
- ログアウトで Blobs 上セッションを削除  
- 無操作タイムアウト: owner **30分**（初期値）、admin/staff は設定可能（初期 60分案）  
- 端末一覧・端末単位強制ログアウト  
- 重要操作前: 短命 `stepUpUntil`（例: 5分）をセッションに付与（パスキー再認証後のみ）

CORS: 認証導入後は `*` を廃止し、`APP_BASE_URL` オリジンのみ許可。Credentialed リクエストは `Access-Control-Allow-Credentials: true`。

---

## 6. 権限設計

| ロール | 権限 |
|--------|------|
| **owner** | 全権限。ユーザー追加削除、権限変更、本番公開、FTP/接続設定、バックアップ復元、セキュリティ設定 |
| **admin** | プロジェクト管理、下書き・確認、許可された公開操作。ユーザー管理・秘密情報閲覧は不可 |
| **staff** | 指示作成、閲覧、下書き保存。本番公開・削除・設定変更は不可 |

すべての API で **サーバー側** `requireRole(...)` / `requireStepUp(...)` を実行。UI 非表示だけでは不十分。

---

## 7. 重要操作の再認証（step-up）

パスキー再認証が必要な操作:
- 本番公開 / FTP アップロード  
- ファイル削除 / バックアップ復元  
- ユーザー追加・削除 / 権限変更  
- 接続情報変更 / API キー変更 / セキュリティ設定変更  

フロー: `POST /auth/step-up/options` → 端末認証 → `POST /auth/step-up/verify` → `stepUpUntil` 付与 → 対象 API。

ローカル FTP API（PowerShell）: Netlify で step-up 済みの短命 **capability token**（署名付き・audience=local-ftp・TTL 短い）をループバック API が検証する設計とする（ブラウザに FTP パスワードは載せない）。

---

## 8. 秘密情報管理

- FTP パスワード・API キーはフロントへ送らない／`localStorage` 禁止／ソース直書き禁止／Git 禁止  
- Netlify 環境変数および `.data/`（gitignore）のみ  
- 画面は伏字。owner でも「再設定のみ」を基本とし、平文再表示を避ける  
- ログ・監査に秘密を出さない（既存のマスク方針を維持・強化）

---

## 9. 監査ログ

記録項目: 操作種別、操作者 userId、日時、対象、成否、必要最小限の IP ハッシュ、User-Agent ハッシュ。  
対象イベント: ログイン成否、ログアウト、パスキー登録削除、新規端末、ユーザー/権限変更、本番公開、FTP、バックアップ/復元、接続設定、重要削除。  
**記録しない**: パスワード、トークン生値、FTP パスワード、API キー。

---

## 10. データ構造（Blobs キー案）

```
auth/users/{userId}
auth/usersByEmail/{emailHash}
auth/credentials/{credentialId}
auth/sessions/{sessionId}
auth/challenges/{challengeId}
auth/invites/{inviteId}
auth/recovery/{userId}          # ハッシュ化された回復コードのみ
auth/audit/{yyyy}/{mm}/{id}
auth/rateLimit/{bucketKey}
```

ユーザー例:
```json
{
  "id": "usr_...",
  "email": "…",
  "role": "owner",
  "displayName": "矢作",
  "disabled": false,
  "createdAt": "…",
  "lastLoginAt": "…"
}
```

クレデンシャル例（公開鍵のみ）:
```json
{
  "credentialId": "…",
  "userId": "usr_…",
  "publicKey": "…",
  "counter": 0,
  "transports": ["internal"],
  "deviceLabel": "iPhone",
  "createdAt": "…"
}
```

---

## 11. API 設計（新規）

| Method | Path | 認証 | 用途 |
|--------|------|------|------|
| POST | `/.netlify/functions/auth-login-options` | なし（レート制限） | WebAuthn 認証開始 |
| POST | `/.netlify/functions/auth-login-verify` | なし | 検証・セッション発行 |
| POST | `/.netlify/functions/auth-register-options` | invite or session | パスキー登録開始 |
| POST | `/.netlify/functions/auth-register-verify` | 同上 | 登録完了 |
| POST | `/.netlify/functions/auth-email-start` | なし（レート制限） | 代替メール OTP/マジックリンク |
| POST | `/.netlify/functions/auth-email-verify` | なし | 初回/回復後セッション |
| POST | `/.netlify/functions/auth-logout` | session | 失効 |
| GET | `/.netlify/functions/auth-me` | session | 自分の権限・端末 |
| GET | `/.netlify/functions/auth-sessions` | session | 端末一覧 |
| DELETE | `/.netlify/functions/auth-sessions` | session | 端末強制ログアウト |
| POST | `/.netlify/functions/auth-step-up-*` | session | 重要操作前再認証 |
| * | 既存 `api-*` | **session + role** | 権限検査追加 |

エラーメッセージはアカウント列挙を避ける共通文言（例:「ログインできませんでした」）。

---

## 12. 攻撃対策チェックリスト

- CSRF: SameSite + 必要なら CSRF トークン  
- XSS: 出力エスケープ、CSP  
- SQLi: SQL 不使用。Blobs キーの入力検証  
- ブルートフォース: IP/email バケットの試行制限  
- セキュリティヘッダー: CSP, `frame-ancestors`/`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`  
- API レート制限  
- 入力値検証（zod 相当の手書きスキーマ可）

---

## 13. ログイン画面要件（ローカル試作で実装）

スマホファースト。表示: ロゴ、見出し、パスキーボタン、メール代替、初回登録、回復導線、会社専用表示、生体非保存の説明。  
共通エラー文言。390 / 375 / PC 対応。

試作パス: `auth-local/login.html`（本番ゲート未接続）。
