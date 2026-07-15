# LINE双方向司令塔 — 設定・ローカル確認ガイド

Smile AI Studio v1.5.0 の LINE Messaging API 連携（MVP）です。  
**LINE Notify は使いません。**

---

## 1. できること / できないこと

### 自動で行うこと
- LINEメッセージの送受信
- プロジェクト状況の確認・選択内容の保存
- 今日の最優先の更新
- AI会議ログの自動保存
- 次の選択肢の返信

### 行わないこと（MVP）
- Cursorへの開発指示、コード変更、GitHub commit/push
- Netlify公開、メール送信、取引先連絡、SNS投稿
- 見積・請求の確定、データ削除

外部実行が必要な場合は「実行準備ができました」までで停止します。

---

## 2. 必要な準備（ユーザー側）

1. Node.js 18 以上（ローカル確認用）
2. LINE公式アカウント（Messaging API チャネル）
3. Netlify サイト（本番 Functions / Scheduled Functions）
4. 管理者の LINE User ID

このリポジトリへ秘密情報（Channel Secret / Access Token）をコミットしないでください。

---

## 3. 環境変数

`.env.example` を参考に、Netlify（またはローカル `.env`）へ設定します。

| 変数名 | 説明 |
|--------|------|
| `LINE_CHANNEL_SECRET` | Messaging API Channel Secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | 長期 Channel Access Token |
| `LINE_ADMIN_USER_ID` | 司令塔を操作できる管理者の User ID |
| `APP_BASE_URL` | 公開サイトのベースURL（任意） |
| `OPENAI_API_KEY` | 自然会話AI秘書（Responses API）用。ブラウザには渡しません |
| `OPENAI_MODEL` | 任意。未設定時は `gpt-4.1-mini` |

値そのものは GitHub に保存しません。`.env` は `.gitignore` 済みです。

---

## 4. LINE側の設定手順（画面ごと）

実装時点の公式ドキュメント表記に合わせて、メニュー名が多少異なる場合があります。

### 手順1：LINE公式アカウントを用意
1. [LINE Official Account Manager](https://manager.line.biz/) にログイン
2. 対象の公式アカウントを作成、または選択

### 手順2：Messaging API を有効化
1. 公式アカウント管理画面で **Messaging API** を有効化
2. プロバイダーを選択 / 作成し、チャネルを紐づけ

### 手順3：Channel Secret を確認
1. [LINE Developers Console](https://developers.line.biz/console/) を開く
2. 対象チャネル → **Basic settings**（基本設定）
3. **Channel secret** を控える（コードに直書きしない）

### 手順4：Channel Access Token を発行
1. 同チャネルの **Messaging API** タブ
2. **Channel access token** を発行（長期）
3. 控えて Netlify の環境変数へ登録

### 手順5：Webhook URL を登録（Netlify公開後）
1. Messaging API 設定の Webhook URL に以下を登録  
   `https://<あなたのNetlifyドメイン>/.netlify/functions/line-webhook`
2. **Use webhook** をオン
3. Verify で成功することを確認（署名検証が通る必要があります）

### 手順6：応答設定
1. 公式アカウント側で「あいさつメッセージ」などと競合しないよう調整
2. Messaging API の自動応答と併用する場合は、二重返信に注意

### 手順7：友だち追加と管理者 User ID

`LINE_ADMIN_USER_ID` が未設定のあいだ、Webhook は **管理者取得モード** になります。

1. 公式アカウントを友だち追加する（または何かメッセージを送る）
2. LINE から User ID が返信されます
3. Smile AI Studio → **その他 → LINE司令塔** にも同じ ID が表示されます
4. Netlify → Site configuration → Environment variables で  
   `LINE_ADMIN_USER_ID` = 取得した値 を追加して保存
5. 再デプロイ（または環境変数反映）後、取得モードは自動で終了します

（開発者本人の場合）LINE Developers Console → Basic settings → **Your user ID** でも確認できます。

### 手順8：テスト
1. Smile AI Studio → **その他 → LINE司令塔 → テストメッセージを送る**
2. LINE で「メニュー」と送信し、一覧が返ることを確認

---

## 5. Netlify側の設定

1. Site settings → Environment variables に上記4変数を登録
2. 特に `LINE_ADMIN_USER_ID` は、手順7で取得した User ID を登録
3. `netlify.toml` により Functions と朝送信スケジュールが定義済み  
   - `line-send-morning` : `0 23 * * *`（UTC）= **日本時間 08:00**
4. デプロイ後、Webhook URL を LINE へ登録
5. Scheduled Functions が有効であることを Netlify 管理画面で確認

Webhook URL 例:
`https://<あなたのNetlifyドメイン>/.netlify/functions/line-webhook`

---

## 6. ローカル開発

### 前提
- Node.js `>= 18`
- 依存: `npm install`（`@netlify/blobs`）
- 任意: Netlify CLI（`npx netlify dev`）

### 手順
```bash
cd SmileAIStudio
npm install
copy .env.example .env
# .env に値を記入（ローカル検証時のみ）
npm run test:line
npm run mock:webhook
npx netlify dev
```

- 静的画面: `http://localhost:8888` など（CLIの案内に従う）
- Functions: `http://localhost:8888/.netlify/functions/...`
- 永続化フォールバック: `.data/line-store.json`（gitignore）

### Webhook のローカル確認
- 実LINEからの到達には ngrok 等が必要です（未設定ならモックで確認）
- `npm run mock:webhook` で署名検証・管理者判定・重複除外・数字選択を確認できます

---

## 7. API一覧

| Method | Path | 用途 |
|--------|------|------|
| POST | `/.netlify/functions/line-webhook` | LINE Webhook |
| POST | `/.netlify/functions/line-send-test` | テスト送信 |
| GET | `/.netlify/functions/line-send-morning` | 朝メッセージ（Scheduled） |
| GET | `/.netlify/functions/api-line-status` | 接続状況（秘密はマスク） |
| GET | `/.netlify/functions/api-project-status` | プロジェクト / 今日の最優先 |
| GET | `/.netlify/functions/api-command-history` | 操作履歴 |
| GET | `/.netlify/functions/api-meeting-logs` | 会議ログ（サーバー側） |

---

## 8. LINEコマンド

| 入力 | 動作 |
|------|------|
| 数字 | 表示中の選択肢を選ぶ |
| メニュー | プロジェクト一覧 |
| 状況 | 全プロジェクト状況 |
| 今日 | 今日の最優先 |
| 履歴 | 直近5件の履歴 |
| 取消 | 会話取消 |
| リセット / 会話リセット | 自由会話履歴のみ削除 |
| （自由文） | AI秘書チャッピーが自然返信 |

会話状態（司令塔の数字選択）は約24時間で期限切れです。
自由会話履歴は直近約16件を保持します。

---

## 9. 画面

**その他 → LINE司令塔**

- 環境変数の設定有無（値は出さない）
- 最終Webhook / 最終送信
- 会話ステージ / 今日の最優先
- 朝メッセージプレビュー
- 操作履歴
- テスト送信（確認ダイアログ + 連打防止）
