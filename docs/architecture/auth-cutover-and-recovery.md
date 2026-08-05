# 認証切替・緊急復旧手順

本番公開・owner 本登録・GitHub push は別依頼で実施する。  
この文書は実装後の運用準備用。

---

## AUTH_ENFORCEMENT_MODE

| 値 | 挙動 | 用途 |
|----|------|------|
| `off` | 認証コードは動くが API は拒否しない | ローカル開発のみ。本番常用禁止 |
| `observe` | 未認証を監査ログへ記録、API は許可 | 移行確認 |
| `enforce` | 未認証・権限不足を拒否 | 本番最終 |
| 未知の値 | **enforce 扱い**（安全側） | — |

### 本番で `off` にする場合（緊急のみ）

1. Netlify UI で環境変数を変更できる権限者のみ実施  
2. 変更前に理由を社内記録  
3. 変更後、監査ログに `AUTH_ENFORCEMENT_MODE` 変更を残す（Functions 再デプロイで有効）  
4. UI に緊急解除ボタンは置かない  
5. 復旧後は速やかに `observe` → `enforce` へ戻し確認  

固定マスターパスワードや緊急解除 URL は設けない。

---

## ロールバック

1. Netlify Deploy 履歴から、認証導入前または直前の正常 Deploy を特定して Publish  
2. 必要なら `AUTH_ENFORCEMENT_MODE=off` を一時設定（上記緊急手順）  
3. Blobs `smile-studio-auth` は残っていても、enforce を止めれば既存 API は復帰  
4. 復旧後にログイン・監査を確認し、再度 enforce へ  

認証導入前 Deploy の ID / 日時は切替作業時に記録すること。

---

## 本番切替チェックリスト（未実施・将来）

1. カスタムドメイン `studio.egaonokiroku.co.jp` を Netlify に接続  
2. `AUTH_RP_ID=studio.egaonokiroku.co.jp`  
3. `AUTH_ALLOWED_ORIGINS=https://studio.egaonokiroku.co.jp`  
4. `AUTH_COOKIE_SECURE=1`  
5. `AUTH_EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `AUTH_EMAIL_FROM`  
6. `AUTH_BOOTSTRAP_ENABLED=1` を短時間だけ有効化し owner 招待 → 無効化  
7. Deploy Preview では本番 RP ID を使わず、プレビュー用 RP / origin のみ  
8. `AUTH_ENFORCEMENT_MODE=observe` で監査確認 → `enforce`  
9. HSTS は独自ドメイン HTTPS 安定後に慎重導入  

---

## Deploy Preview

- `AUTH_RP_ID` はプレビューホスト名（本番 RP と混在禁止）  
- `AUTH_PREVIEW_ORIGIN` に Preview URL を exact 指定  
- 本番用パスキーを Preview で登録しない  
