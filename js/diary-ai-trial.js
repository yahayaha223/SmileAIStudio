"use strict";
(function () {
  var endpoint = "/.netlify/functions/api-diary-ai-trial";
  var status = document.getElementById("status"), button = document.getElementById("run");
  var checkInfo = null;
  function showCheckInfo() {
    var node = document.getElementById("check-info");
    if (!node || !checkInfo) return;
    node.textContent = "確認開始時刻(UTC): " + checkInfo.at + " / CSRF Cookie: " +
      (checkInfo.csrfPresent ? "あり" : "なし") +
      (checkInfo.ref ? " / 照会ID: " + checkInfo.ref : "") +
      "。これは確認時点の結果です。別タブでログインしても自動更新されません。";
  }
  function statusFailure(error) {
    var messages = {
      owner_login_required: "ownerのセッションを確認できません。ログイン済みの場合は再ログインを繰り返さず、この表示をお知らせください。",
      owner_required: "この試験に必要なowner権限を確認できません。",
      csrf_denied: "試験画面の安全確認に失敗しました。再ログインを繰り返さず、この表示をお知らせください。",
      trial_environment_blocked: "試験の配備先・設定条件を確認できません。フラグは変更しないでください。",
      origin_denied: "試験ページのアクセス元を確認できません。",
      invalid_request: "状態確認リクエストの形式が一致しません。",
      trial_unavailable_do_not_retry: "サーバー側の状態確認に失敗しました。再ログインや実行をせず、この表示をお知らせください。"
    };
    var code = error && error.message;
    if (Object.prototype.hasOwnProperty.call(messages, code)) return messages[code] + "（" + code + "）" +
      (code === "trial_unavailable_do_not_retry" && /^D(?:0[1-9]|1[0-3])_C0[0-9]$/.test(error.diagnostic || "") ? " [" + error.diagnostic + "]" : "");
    return "状態確認の通信または応答を確認できません。実行せず、この表示をお知らせください。";
  }
  function csrf() {
    var raw = document.cookie.split(";").map(function (x) { return x.trim(); })
      .find(function (x) { return x.indexOf("smile_studio_csrf=") === 0; });
    return raw ? decodeURIComponent(raw.slice("smile_studio_csrf=".length)) : "";
  }
  async function request(method) {
    var csrfValue = csrf();
    if (method === "GET") {
      checkInfo = { at: new Date().toISOString(), csrfPresent: !!csrfValue, ref: "" };
      showCheckInfo();
    }
    var options = { method: method, credentials: "same-origin", cache: "no-store",
      headers: { "X-CSRF-Token": csrfValue } };
    if (method === "POST") { options.headers["Content-Type"] = "application/json"; options.body = "{}"; }
    var res = await fetch(endpoint, options);
    var data = await res.json();
    if (method === "GET" && checkInfo) {
      if (typeof data.diagnosticRef === "string" && /^[A-Za-z0-9_-]{16}$/.test(data.diagnosticRef)) checkInfo.ref = data.diagnosticRef;
      showCheckInfo();
    }
    if (!res.ok) { var failure = new Error(data.error || "trial_unavailable");
      if (typeof data.diagnostic === "string" && /^D(?:0[1-9]|1[0-3])_C0[0-9]$/.test(data.diagnostic)) failure.diagnostic = data.diagnostic;
      throw failure; }
    return data;
  }
  request("GET").then(function (state) {
    if (!state.owner) throw Error("owner_required");
    document.getElementById("controls").hidden = false;
    document.getElementById("memo").textContent = state.memo;
    button.disabled = !state.enabled || state.consumed;
    status.textContent = state.consumed ? "この試験は実行済みです。再実行できません。" :
      state.enabled ? "ownerを確認しました。承認済みの場合だけ実行してください。" : "試験はOFFです。課金通信は行われません。";
  }).catch(function (error) { status.textContent = statusFailure(error); });
  button.addEventListener("click", async function () {
    if (button.disabled) return;
    if (!window.confirm("固定の架空メモで課金試験を1回実行します。失敗しても再試行しません。承認済みですか？")) return;
    button.disabled = true;
    status.textContent = "処理中です。再実行・再読み込みはせずお待ちください。";
    try {
      var result = await request("POST");
      var output = document.getElementById("result");
      output.hidden = false;
      output.textContent = result.text + "\n\n" + result.model + "\n入力: " + result.usage.input_tokens +
        " / 出力: " + result.usage.output_tokens + " tokens\nモデル利用料見積り: $" + result.estimatedModelCostUSD.toFixed(8);
      status.textContent = "試験が完了しました。結果は未保存・未公開です。試験フラグをOFFにしてください。";
    } catch { status.textContent = "試験を完了できませんでした。通信状態が不明な場合も再試行しないでください。試験フラグをOFFにしてください。"; }
  });
})();
