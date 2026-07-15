# Netlify 確認チェックリスト

各プロジェクトの Push 後に実施する確認項目の共通テンプレートです。  
プロジェクト固有の項目は `projects/<name>/README.md` に追記してください。

## 共通チェック

- [ ] Netlify ビルドが成功している
- [ ] 本番（またはプレビュー）URL でページが開く
- [ ] 今回変更した画面・機能が意図どおり動作する
- [ ] スマホ表示でレイアウト崩れがない
- [ ] 主要導線（トップ → CTA → フォーム等）が通る
- [ ] コンソールに重大なエラーが出ていない

## Netlify 確認後の補足（LINE司令塔）

LINE双方向司令塔を使う場合は、デプロイ後に以下も確認してください。

- [ ] 環境変数 `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_ADMIN_USER_ID` が設定されている
- [ ] Webhook URL: `https://<domain>/.netlify/functions/line-webhook` が LINE に登録され有効
- [ ] Scheduled Function `line-send-morning`（UTC 23:00 = JST 08:00）が有効
- [ ] Smile AI Studio「その他 → LINE司令塔」で接続状況とテスト送信が動く

詳細手順: [`docs/guides/LINE_COMMAND_CENTER.md`](./LINE_COMMAND_CENTER.md)
