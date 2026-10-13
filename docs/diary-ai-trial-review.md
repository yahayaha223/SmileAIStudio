# 日記AI・1回限定試験の配備前レビュー

基準: `95b66b1a8dd16bfc626a7fa2e966b4d099c4ff60`。隔離コードのみ。実API・push・配備・本番設定変更は未実施。

## 差分（12ファイル）

既存変更は `package.json` / `package-lock.json`（固定バージョンの原子的保存SDK別名とオフラインtokenizerを追加、既存依存のバージョン変更なし）、`netlify.toml`（ビルド時の安全判定・token計数と専用Functionの26秒timeout）の3件。

新規9件:

- `netlify/functions/api-diary-ai-trial.js`: 既存ownerセッションを読み取る専用GET/POST。GETは状態確認、POSTは固定試験。
- `netlify/functions/shared/diary-ai-trial.js`: 固定メモ・モデル・通信・専用保存アダプタ。
- `netlify/functions/shared/diary-ai-trial-context.json`: ビルド生成の判定・入力証明。リポジトリ版はproduction=false。
- `scripts/build-diary-ai-trial.js`: production以外を拒否する判定をbundleに固定。秘密値は出力しない。
- `diary-ai-trial.html` / `js/diary-ai-trial.js`: 独立した試験画面。owner確認後だけボタン表示、有効化前は押せない。
- `scripts/test-diary-ai-trial.js` / `scripts/test-diary-ai-trial-delivery.js`: 専用試験。
- この文書。

既存AIパッチ、文字コードパッチ、通常画面、FTP・LINE処理、認証設定・資格情報、既存shared OpenAIクライアントは含めない。通常AIをONにするコードもない。

## 保存領域と内容

この試験口と試験画面は、Netlifyのサイト単位Blobsストア `smile-studio-auth` の `production/sessions/<既存cookieのSHA256>` と `production/users/<session.userId>` をstrong consistencyで読み取る。GET/POSTともセッション延長、cookie更新、監査記録追加、ユーザー・パスキー更新をしない。メモリ/ファイルキャッシュへ退避しない。

唯一の書込みは、別ストア `smile-diary-ai-trial` のキー `fixed-fictional-memo-20261013-v1` の新規作成。JSONは `attempted: true`, `attemptedAt: ISO日時`, `payloadSha256: 固定リクエストのSHA256`, `model: gpt-4.1-mini-2025-04-14` の4項目。userId、メール、セッションID、CSRF、秘密値、生成結果は保存しない。

`onlyIfNew` → `If-None-Match: *` により同時要求でも1件だけ予約。作成成功とETagの両方が確認できた場合だけOpenAIへ送る。SDKが条件付き保存の一部エラーをmodifiedとして返しうる点を補い、403/500/通信失敗はETagのないエラーに変換して停止する。保存通信・生成通信とも不明な失敗を自動再試行しない。

成功・失敗・timeout・再配備後も印は残し、削除/上書き/再有効化用APIは実装しない。既存印があれば別ownerや別セッションでも実行不可。予約後に通信まで到達しなくても1回を消費する。

日記localStorage、写真IndexedDB、FTP、LINE、knowledgeへの読書きはしない。試験画面は別の `/api/auth/session` を呼ばない。既存ログインが有効なら認証ストアへの書込みはゼロ。期限切れでユーザーが普段のログインを行う場合は、既存認証処理が別途動作するので、この試験口の「書込みゼロ」には含めない。

## 認証・課金の条件

productionビルド判定、既存AUTH_ENVIRONMENT=production、既存RP ID=studio.egaonokiroku.co.jp、同ホスト、POSTの厳密なOrigin、full ownerセッション、有効期限・失効確認、現ユーザーのactive owner、CSRFのheader/cookie/session三者一致を全て要求。登録用セッションやadmin/staffでは不可。一般認証のoff/observe設定に影響されない。新しい認証資格情報や認証設定変更は不要。

`DIARY_AI_TRIAL_ENABLED=1` と既存OPENAI_API_KEYがある場合のみ生成可能。`DIARY_AI_ENABLED=1` なら試験口全体を拒否。通常AIは未設定/0を維持する。OFFでもowner状態確認は可能。Preview/branch-deployでは生成・認証ストア読取りの前に拒否する。

モデルは `gpt-4.1-mini-2025-04-14` 固定。架空メモと指示だけ、出力512、20秒の絶対timeout、store=false、tools/historyなし、API呼出し1回。画面やリクエストからメモ・モデル・上限を差し替えられない。結果はtextContentで表示し、保存・公開・自動適用しない。

オフラインo200k_base計数は指示+メモ164 tokens。形式の余裕1024を加え1188としてビルド判定（2000超ならビルド失敗）。API内部の形式部分の正確な実数を測定した値ではない。返却usageも入力2000/出力512以内か検査する。この検査は課金後の確認であり、APIにはドル指定のハード上限を渡していない。

2026-10-13確認の公式単価は入力$0.40/出力$1.60 per million。入力2000+出力512として$0.0016192。固定の短い入力と上限512により現在のモデル単価では$0.01未満。外部の価格改定・税・Netlify費用まで無条件に保証するものではない。実行直前に公式価格を再確認し、変化があれば実行せず再レビューする。

出典: https://developers.openai.com/api/docs/models/gpt-4.1-mini

## 検証

既存104件: auth-policy12, WebAuthn feasibility5, auth-webauthn33, LINE21, simple diary3, publish13, delete13, bundle4。新規endpoint/SDK/通信46件、ビルド/画面8件。合計158件。全てローカル・通信モック、実APIゼロ。本番NetlifyのBlobs権限、実APIの成功/文章品質、実ブラウザー描画は未検証。

再実行は `node scripts/build-diary-ai-trial.js`、`node scripts/test-diary-ai-trial.js`、`node scripts/test-diary-ai-trial-delivery.js`。CONTEXTが未設定のローカルビルドは必ずproduction=false。build/preview判定を変数だけで実行時に解除できない。

## 承認後に必要な操作（現在は実行しない）

1. Netlify `smileaistudio` の現在のPublished deploy IDと基準コミットをユーザーのブラウザーで控える。GitHub接続先が `yahayaha223/SmileAIStudio`、production branchがmainか確認。設定値の表示は非秘密値だけ。既存認証設定が条件に合わない場合は勝手に変更せず停止。
2. 最終パッチのpush/PR/mergeと本番配備の承認後、その差分だけを反映する。ブラウザーが使えなくてもGitHub接続は利用可能だが、現在は未実施。最初の配備は専用フラグ未設定/0で行う。通常AIは未設定/0。
3. ユーザーが既存ownerログインを維持した普段のブラウザーで `https://studio.egaonokiroku.co.jp/diary-ai-trial.html` を開き、「試験はOFF」を確認する。通常の公開ボタンは触らない。既存ログインが切れていれば既存パスキーだけで通常ログインし、新規登録に誘導されたら停止。
4. 1回の課金試験承認と単価再確認後、Netlifyで `DIARY_AI_TRIAL_ENABLED` だけをProduction context / Functions scopeに `1` として設定し再ビルド・配備する。OPENAI_API_KEYは既存値をそのまま使い、表示・コピーしない。AUTH系設定は変更しない。
5. 同じ試験画面を開き直し、owner用試験ボタンを1回押す。画面内の確認は誤操作防止。結果・モデル・usage・見積額だけを報告する。失敗/不明も再クリックしない。
6. ユーザーが専用フラグを `0` に戻し再ビルド・配備する。試験済み印は残す。Netlify環境変数は保存だけで既存配備に反映されないため、ON/OFFのどちらも再配備までを作業範囲に含める。

Netlifyの公式説明: https://docs.netlify.com/build/environment-variables/get-started/

ブラウザー操作不能の間にユーザーにお願いするのは、上記のNetlify画面確認・専用フラグON/OFFと各再配備・専用画面での1回実行。APIキー取得やDevTools操作、日記の公開操作は不要。

## 復旧

異常時はまず専用フラグを0にして再配備、または直前に控えた正常なNetlify deployを本番へ戻す。旧配備に試験口がなければ試験口も消える。環境変数の0は別途確認する。Git側も承認済み手順でこの差分だけをrevertし、次の自動配備で再混入しないようにする。

専用Blobsの試験済み印を削除しない。認証DB・日記・写真・FTPのバックアップ復元は行わない。通常公開/認証を変えていないためデータ巻戻しは不要。コードの本番配備自体には回帰・一時停止のリスクがあるので、既存Studioの表示と既存ログイン確認に失敗した場合は課金試験へ進まない。
