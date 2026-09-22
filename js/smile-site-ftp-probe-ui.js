/**
 * Homepage FTP layout probe UI helpers.
 * Read-only display. Diagnoses SITE_FTP_* login. Never logs or shows
 * SITE_FTP_USER / SITE_FTP_PASSWORD / FTP_USER / FTP_PASSWORD / API keys / secrets.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SmileSiteFtpProbeUi = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAX_LINE = 200;
  var MAX_DIRS = 20;

  function looksUnsafe(text) {
    var blob = String(text == null ? "" : text).toLowerCase();
    if (blob.indexOf("password") >= 0) return true;
    if (blob.indexOf("ftp_user") >= 0) return true;
    if (blob.indexOf("secret") >= 0) return true;
    if (blob.indexOf("apikey") >= 0 || blob.indexOf("api_key") >= 0) return true;
    return false;
  }

  function sanitizeLine(raw) {
    var s = String(raw == null ? "" : raw).replace(/[\r\n\0]/g, " ").trim();
    if (!s) return "";
    if (s.length > MAX_LINE) s = s.slice(0, MAX_LINE);
    if (looksUnsafe(s)) return "";
    return s;
  }

  function dirNames(list) {
    var src = Array.isArray(list) ? list : [];
    var out = [];
    var seen = {};
    src.forEach(function (item) {
      var name = sanitizeLine(item);
      if (!name) return;
      if (name.indexOf("/") >= 0) return;
      if (seen[name]) return;
      seen[name] = true;
      out.push(name);
    });
    return out.slice(0, MAX_DIRS);
  }

  function formatHint(hint) {
    if (!hint || typeof hint !== "object") return "";
    if (hint.at === "login-pwd") return "ログイン直後の場所が public_html";
    if (hint.at === "login-list") return "直下の public_html";
    if (hint.at === "one-level") {
      var parent = sanitizeLine(hint.parent);
      if (!parent) return "1階層下の public_html";
      return parent + " / public_html";
    }
    return "";
  }

  function formatSuccess(data) {
    data = data || {};
    var loginPwd = sanitizeLine(data.loginPwd) || "（不明）";
    var dirs = dirNames(data.rootDirs);
    var dirLines = dirs.length ? dirs.join("\n") : "（なし）";
    var hints = Array.isArray(data.publicHtmlHints) ? data.publicHtmlHints : [];
    var hintLines = [];
    hints.forEach(function (h) {
      var line = formatHint(h);
      if (line) hintLines.push(line);
    });
    var hintText = hintLines.length ? hintLines.join("\n") : "（見つかりませんでした）";
    var writeOps = 0;
    var text = [
      "FTP診断完了",
      "",
      "ログイン直後の場所：",
      loginPwd,
      "",
      "見えているフォルダ：",
      dirLines,
      "",
      "public_html候補：",
      hintText,
      "",
      "書込み操作：",
      writeOps + "回"
    ].join("\n");
    if (looksUnsafe(text)) {
      return "FTP診断完了\n\n書込み操作：\n0回";
    }
    return text;
  }

  function formatFailure(data) {
    data = data || {};
    var code = sanitizeLine(data.error || data.code) || "probe_failed";
    var msg = sanitizeLine(data.userMessage) || "FTP公開先を確認できませんでした";
    var text = "エラーコード：" + code + "\n" + msg;
    if (looksUnsafe(text)) {
      return "エラーコード：probe_failed\nFTP公開先を確認できませんでした";
    }
    return text;
  }

  return {
    looksUnsafe: looksUnsafe,
    sanitizeLine: sanitizeLine,
    formatSuccess: formatSuccess,
    formatFailure: formatFailure
  };
});
