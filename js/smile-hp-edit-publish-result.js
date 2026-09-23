/**
 * Homepage production-publish failure panel.
 * Shows safe diagnostics in Studio and copies a Cursor handoff.
 * Never includes credentials, tokens, API keys, or file bodies.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SmileHpEditPublishResult = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var REASON_JA = {
    ftp_cwd_550: "FTPの作業フォルダへ移動できませんでした",
    ftp_cwd_restore_failed: "FTPの作業フォルダ処理で失敗しました",
    site_cwd_reuses_diary_dir: "公式サイトの作業フォルダが日記フォルダと同じです",
    backup_failed: "公開前バックアップを作成できませんでした",
    upload_failed: "新しいファイルをアップロードできませんでした",
    swap_failed: "新しいファイルへの切替に失敗しました",
    rollback_failed: "元のファイルへの復元に失敗しました",
    pipeline_error: "FTP公開処理の途中でエラーが発生しました",
    invalid_json: "公開リクエストを解析できませんでした",
    response_not_json: "サーバー応答を解析できませんでした"
  };
  var FALLBACK_JA = "公開処理でエラーが発生しました";
  var MAX_FIELD = 200;
  var lastCopy = "";
  var ALLOWED_KEYS = {
    requestId: 1,
    reasonCode: 1,
    failedFile: 1,
    ftpErrorCode: 1,
    userMessage: 1,
    productionUntouched: 1
  };

  function looksUnsafe(text) {
    var blob = String(text == null ? "" : text).toLowerCase();
    if (blob.indexOf("password") >= 0) return true;
    if (blob.indexOf("ftp_user") >= 0) return true;
    if (blob.indexOf("secret") >= 0) return true;
    if (blob.indexOf("apikey") >= 0 || blob.indexOf("api_key") >= 0) return true;
    if (blob.indexOf("github_token") >= 0) return true;
    if (blob.indexOf("bearer ") >= 0) return true;
    return false;
  }

  function sanitizeLine(raw) {
    var s = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
    if (!s) return "";
    if (s.length > MAX_FIELD) s = s.slice(0, MAX_FIELD);
    if (looksUnsafe(s)) return "";
    return s;
  }

  function reasonCodeOf(data) {
    var raw = "";
    if (data && data.reasonCode) raw = data.reasonCode;
    else if (data && data.error) raw = data.error;
    var s = String(raw || "").trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,60}$/.test(s)) return "";
    if (looksUnsafe(s)) return "";
    return s;
  }

  function explainReasonCode(code) {
    var key = reasonCodeOf({ reasonCode: code });
    if (!key) return FALLBACK_JA;
    if (Object.prototype.hasOwnProperty.call(REASON_JA, key)) return REASON_JA[key];
    return FALLBACK_JA;
  }

  function pickSafe(data) {
    var src = data && typeof data === "object" ? data : {};
    var reasonCode = reasonCodeOf(src);
    var failedFile = sanitizeLine(src.failedFile);
    if (failedFile.charAt(0) === "/" || failedFile.indexOf("..") >= 0) failedFile = "";
    var ftpErrorCode = sanitizeLine(src.ftpErrorCode);
    if (ftpErrorCode && !/^[A-Za-z0-9._-]{1,40}$/.test(ftpErrorCode)) ftpErrorCode = "";
    var out = {
      requestId: sanitizeLine(src.requestId),
      reasonCode: reasonCode,
      failedFile: failedFile,
      ftpErrorCode: ftpErrorCode,
      userMessage: sanitizeLine(src.userMessage),
      productionUntouched: src.productionUntouched !== false
    };
    Object.keys(out).forEach(function (k) {
      if (!ALLOWED_KEYS[k]) delete out[k];
    });
    return out;
  }

  function productionLine(safe) {
    if (safe && safe.productionUntouched !== false) {
      return "元のホームページは維持されています";
    }
    return "元のファイルへの復元を確認してください";
  }

  function viewModel(data) {
    var safe = pickSafe(data);
    return {
      title: "公開失敗",
      reasonJa: explainReasonCode(safe.reasonCode),
      failedFile: safe.failedFile,
      ftpErrorCode: safe.ftpErrorCode,
      productionLine: productionLine(safe),
      requestId: safe.requestId,
      safe: safe
    };
  }

  function defaultEscape(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function dlRow(label, value, escapeHtmlFn) {
    if (!value) return "";
    return "<div class=\"hp-edit-publish-result__row\">" +
      "<dt>" + escapeHtmlFn(label) + "</dt>" +
      "<dd>" + escapeHtmlFn(value) + "</dd>" +
      "</div>";
  }

  function failureHtml(data, escapeHtmlFn) {
    var esc = typeof escapeHtmlFn === "function" ? escapeHtmlFn : defaultEscape;
    var vm = viewModel(data);
    return "<p class=\"hp-edit-publish-result__title\">" + esc(vm.title) + "</p>" +
      "<dl class=\"hp-edit-publish-result__dl\">" +
      dlRow("原因", vm.reasonJa, esc) +
      dlRow("失敗したファイル", vm.failedFile, esc) +
      dlRow("FTPエラー", vm.ftpErrorCode, esc) +
      dlRow("本番サイト", vm.productionLine, esc) +
      dlRow("診断ID", vm.requestId, esc) +
      "</dl>";
  }

  function copyHandoff(data) {
    var safe = pickSafe(data);
    var lines = [
      "---",
      "Smile AI Studio ホームページ公開失敗",
      "requestId:",
      safe.requestId || "",
      "reasonCode:",
      safe.reasonCode || "",
      "failedFile:",
      safe.failedFile || "",
      "ftpErrorCode:",
      safe.ftpErrorCode || "",
      "userMessage:",
      safe.userMessage || "",
      "productionUntouched:",
      String(!!safe.productionUntouched),
      "この情報を使って原因を調査してください。",
      "本番FTPは再実行せず、feature branchで修正・テスト・PR作成まで行ってください。",
      "---"
    ];
    var text = lines.join("\n");
    if (looksUnsafe(text)) {
      return [
        "---",
        "Smile AI Studio ホームページ公開失敗",
        "requestId:",
        safe.requestId || "",
        "reasonCode:",
        safe.reasonCode || "",
        "この情報を使って原因を調査してください。",
        "本番FTPは再実行せず、feature branchで修正・テスト・PR作成まで行ってください。",
        "---"
      ].join("\n");
    }
    return text;
  }

  function ensureBox(doc) {
    doc = doc || (typeof document !== "undefined" ? document : null);
    if (!doc || !doc.getElementById) return null;
    var box = doc.getElementById("hp-edit-publish-result");
    if (box) return box;
    var modal = doc.getElementById("hp-edit-modal");
    var body = modal && modal.querySelector ? modal.querySelector(".modal__body") : null;
    var status = doc.getElementById("hp-edit-status");
    if (!body || !doc.createElement) return null;
    box = doc.createElement("div");
    box.id = "hp-edit-publish-result";
    box.className = "simple-diary__result is-error hp-edit-publish-result";
    box.hidden = true;
    box.setAttribute("hidden", "hidden");
    box.setAttribute("role", "alert");
    var inner = doc.createElement("div");
    inner.id = "hp-edit-publish-result-body";
    box.appendChild(inner);
    var btn = doc.createElement("button");
    btn.type = "button";
    btn.id = "btn-hp-edit-publish-copy";
    btn.className = "btn btn--secondary btn--block btn--touch";
    btn.textContent = "Cursorに渡す診断内容をコピー";
    box.appendChild(btn);
    if (status && status.parentNode === body) {
      body.insertBefore(box, status.nextSibling);
    } else if (body.firstChild) {
      body.appendChild(box);
    } else {
      body.appendChild(box);
    }
    return box;
  }

  function clear(box) {
    if (!box) return;
    var body = box.querySelector ? box.querySelector("#hp-edit-publish-result-body") : null;
    if (body) body.innerHTML = "";
    box.hidden = true;
    box.setAttribute("hidden", "hidden");
    lastCopy = "";
  }

  function render(box, data, escapeHtmlFn) {
    if (!box) return { shown: false };
    var body = box.querySelector ? box.querySelector("#hp-edit-publish-result-body") : null;
    if (!body) {
      if (box.querySelector) {
        body = box;
      } else {
        return { shown: false };
      }
    }
    var html = failureHtml(data, escapeHtmlFn);
    if (looksUnsafe(html)) {
      body.textContent = "公開失敗";
    } else {
      body.innerHTML = html;
    }
    lastCopy = copyHandoff(data);
    box.hidden = false;
    box.removeAttribute("hidden");
    return { shown: true };
  }

  function copiedPayload() {
    return looksUnsafe(lastCopy) ? "" : lastCopy;
  }

  return {
    looksUnsafe: looksUnsafe,
    explainReasonCode: explainReasonCode,
    pickSafe: pickSafe,
    viewModel: viewModel,
    failureHtml: failureHtml,
    copyHandoff: copyHandoff,
    ensureBox: ensureBox,
    render: render,
    clear: clear,
    copiedPayload: copiedPayload,
    REASON_JA: REASON_JA,
    FALLBACK_JA: FALLBACK_JA
  };
});
