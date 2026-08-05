# 認証基盤 — 実装計画（本番前）

本番公開・ユーザー本登録・GitHub push は、各ゲート通過後に別依頼で実施する。

---

## フェーズ 0（完了・本調査）

- [x] 現状構成・秘密情報パス・脅威調査
- [x] 推奨方式決定（Netlify Functions + WebAuthn + Blobs）
- [x] データ/API/権限/監査の設計文書
- [x] ログイン画面ローカル試作
- [x] パスキー対応可否の自動検証（ロジック＋ブラウザ API 検出）
- [x] 設計ユニットテスト

---

## フェーズ 1 — ローカル認証コア（次工程）

1. `@simplewebauthn/server` / `@simplewebauthn/browser` を開発依存で導入（本番ビルド確認）
2. `netlify/functions/shared/auth-*` モジュール:
   - users / credentials / sessions / challenges / audit / rate-limit
3. メモリまたは `.data/auth-store.json` でローカル `netlify dev` 動作
4. ログイン試作を Functions に接続（まだ本番デプロイしない）
5. 自動テスト: WebAuthn モック検証、ロール拒否、セッション失効、step-up

**完了条件**: `netlify dev` 上でパスキー登録・ログイン・ログアウト・権限拒否が再現できる。

---

## フェーズ 2 — 既存 API の保護

1. `http.js` の CORS `*` を廃止し、許可オリジン＋ Credentials 対応
2. `api-tasks` / `api-knowledge` / `api-chat-memory-reset` / `line-send-test` 等に `requireSession` + role
3. GET 系ステータス API も最小限の認証または公開フィールドの削減
4. 静的 `index.html` に未ログイン時リダイレクト（`/auth-local/login.html` → 将来 `/login`）
5. セキュリティヘッダーを `netlify.toml` に追加

**完了条件**: 未認証で変更系 API がすべて 401。staff が公開 API を叩くと 403。

---

## フェーズ 3 — ステップアップとローカル FTP 連携

1. step-up API 実装
2. 本番公開・設定変更 UI を step-up 必須に
3. PowerShell ローカル API が capability token を検証
4. FTP パスワードがレスポンスに含まれないことの回帰テスト

**完了条件**: step-up なしで publish アーム不可。トークン期限切れで不可。

---

## フェーズ 4 — 回復・招待・監査 UI

1. owner 初期招待（環境変数 `OWNER_BOOTSTRAP_EMAIL` + ワンタイム）
2. メール OTP / マジックリンク（送信プロバイダ選定: 要確認）
3. 回復コード（ハッシュ保存）
4. 端末一覧・強制ログアウト画面
5. 監査ログ閲覧（owner のみ）

**要確認**: メール送信に何を使うか（Resend / SendGrid / 手動 owner 招待のみか）。

---

## フェーズ 5 — ステージング検証

1. Netlify Deploy Preview または専用ブランチ（**明示依頼後**）
2. 実機: iPhone Face ID / Windows Hello / Android
3. ペネトレーション観点の手動チェック（列挙、CSRF、CORS）
4. ロールバック手順（Functions のみ戻す／Blobs バックアップ）

---

## フェーズ 6 — 本番導入（明示依頼があるまで実施しない）

1. カスタムドメインの RP ID 確定
2. owner パスキー本登録
3. admin/staff 招待
4. 監視・アラート（連続ログイン失敗）
5. 運用ランブック

---

## 依存・決定が必要な事項

| 項目 | 選択肢 | 推奨 |
|------|--------|------|
| Relying Party ID | `*.netlify.app` / 独自ドメイン | 本番用独自ドメイン推奨 |
| メール送信 | 未導入 / SaaS | フェーズ4前に決定 |
| admin の「許可された公開」範囲 | 要業務定義 | 矢作さん確認 |
| staff の Netlify コンソールアクセス | 禁止が原則 | 禁止 |

---

## リスク

- Netlify Blobs の強整合性限界 → セッション削除の即時性をテスト
- パスキー紛失 → 回復手段をフェーズ4より前に最低限用意
- 既存ブックマーク利用者 → ログイン必須化の案内が必要
