/**
 * Smile AI Studio — FTP接続確認（読み取り専用）フロント
 * パスワードを Console / manifest / ZIP に出さない。
 * Netlify 等の公開ホストではローカル専用APIを呼ばず、案内のみ返す。
 */
(function (root) {
  "use strict";

  var lastResult = null;
  var lastConfigLoadOk = false;
  var lastProbeOk = false;
  var LOCAL_ONLY_MSG = "FTP公開機能はローカル版でのみ利用できます";

  function apiBase() {
    return "";
  }

  /** localhost / 127.0.0.1 / ::1 のみローカル静的サーバAPIを利用する */
  function isLocalFtpRuntime() {
    try {
      var h = String((root.location && root.location.hostname) || "").toLowerCase();
      return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
    } catch (e) {
      return false;
    }
  }

  function localOnlyBody(extra) {
    var body = {
      ok: false,
      localOnly: true,
      userMessage: LOCAL_ONLY_MSG,
      writeExecuted: false,
      deleteExecuted: false,
      uploadExecuted: false
    };
    if (extra && typeof extra === "object") {
      Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
    }
    return body;
  }

  function maskSecretsInObject(obj) {
    if (!obj || typeof obj !== "object") return obj;
    var out = Array.isArray(obj) ? [] : {};
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (/pass|secret|token|credential/i.test(k) && typeof v === "string") {
        out[k] = "********";
      } else if (v && typeof v === "object") {
        out[k] = maskSecretsInObject(v);
      } else {
        out[k] = v;
      }
    });
    return out;
  }

  function safeFetchJson(url, options) {
    return fetch(url, options).then(function (res) {
      return res.json().catch(function () {
        return { ok: false, userMessage: "応答の解析に失敗しました" };
      }).then(function (body) {
        return { httpStatus: res.status, body: maskSecretsInObject(body) };
      });
    });
  }

  function loadConfig() {
    if (!isLocalFtpRuntime()) {
      lastConfigLoadOk = false;
      return Promise.resolve(localOnlyBody());
    }
    return safeFetchJson(apiBase() + "/api/ftp-config", { method: "GET" }).then(function (r) {
      lastConfigLoadOk = !!(r.body && r.body.ok && r.body.config);
      return r.body;
    }).catch(function () {
      lastConfigLoadOk = false;
      return { ok: false, userMessage: "FTP設定APIに接続できません（ローカル静的サーバを起動してください）" };
    });
  }

  function saveConfig(fields) {
    if (!isLocalFtpRuntime()) {
      lastConfigLoadOk = false;
      return Promise.resolve(localOnlyBody());
    }
    var payload = {
      host: String(fields.host || "").trim(),
      port: Number(fields.port) || 21,
      username: String(fields.username || "").trim(),
      password: String(fields.password || ""),
      remoteRoot: String(fields.remoteRoot || "/").trim() || "/",
      useTls: fields.useTls !== false,
      passive: true,
      timeoutMs: Number(fields.timeoutMs) || 25000
    };
    return safeFetchJson(apiBase() + "/api/ftp-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      lastConfigLoadOk = !!(r.body && r.body.ok);
      return r.body;
    });
  }

  function runProbe() {
    if (!isLocalFtpRuntime()) {
      lastResult = localOnlyBody({ category: "ローカル専用" });
      lastProbeOk = false;
      return Promise.resolve(lastResult);
    }
    return safeFetchJson(apiBase() + "/api/ftp-probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    }).then(function (r) {
      lastResult = r.body || null;
      lastProbeOk = !!(lastResult && lastResult.ok);
      return lastResult;
    }).catch(function () {
      lastResult = {
        ok: false,
        category: "その他",
        userMessage: "FTP接続確認APIに届きませんでした",
        writeExecuted: false,
        deleteExecuted: false,
        uploadExecuted: false
      };
      lastProbeOk = false;
      return lastResult;
    });
  }

  function getLastResult() {
    return lastResult;
  }

  function getCheckFlags() {
    var r = lastResult || {};
    var cmds = Array.isArray(r.commands) ? r.commands : [];
    var forbiddenHit = cmds.some(function (c) {
      return /^(STOR|STOU|APPE|DELE|RMD|MKD|RNFR|RNTO|SITE|CHMOD|PUT)\b/i.test(String(c));
    });
    return {
      configLoadOk: lastConfigLoadOk,
      probeOk: lastProbeOk,
      tlsOk: !!(r.tlsEstablished || (r.useTls === false && r.ok)),
      remoteRootOk: !!(r.ok && r.currentDirectory),
      indexExists: !!r.diaryIndexExists,
      imageDirExists: !!r.imageDirExists,
      listOk: r.ok === true && r.imageCount != null,
      sizeOk: r.ok === true && r.diaryIndexSize != null,
      mdtmOk: r.ok === true && !!r.diaryIndexMdtm,
      noWrite: r.writeExecuted !== true && !forbiddenHit,
      noDelete: r.deleteExecuted !== true && !forbiddenHit,
      noConsoleSecret: true,
      localOnly: !isLocalFtpRuntime()
    };
  }

  root.SmileFtpProbe = {
    LOCAL_ONLY_MSG: LOCAL_ONLY_MSG,
    isLocalFtpRuntime: isLocalFtpRuntime,
    loadConfig: loadConfig,
    saveConfig: saveConfig,
    runProbe: runProbe,
    getLastResult: getLastResult,
    getCheckFlags: getCheckFlags,
    maskSecretsInObject: maskSecretsInObject
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
