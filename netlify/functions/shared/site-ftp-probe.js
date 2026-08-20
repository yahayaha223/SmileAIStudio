"use strict";

/**
 * Read-only FTP layout probe. pwd + list only. Never STOR / rename / remove / cd.
 * Secrets are not logged.
 */

var MAX_DIRS = 20;
var MAX_NAME = 80;

function fail(code, message, extra) {
  var out = {
    ok: false,
    code: code || "probe_failed",
    userMessage: message || "FTP公開先を確認できませんでした"
  };
  if (extra && typeof extra === "object") {
    Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
  }
  return out;
}

function sanitizeName(raw) {
  var s = String(raw == null ? "" : raw).replace(/\\/g, "/").trim();
  if (!s) return "";
  if (s.indexOf("\0") >= 0) return "";
  if (s === "." || s === "..") return "";
  if (s.indexOf("/") >= 0) return "";
  if (s.length > MAX_NAME) s = s.slice(0, MAX_NAME);
  return s;
}

function sanitizePwd(raw) {
  var s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  if (s.length > 200) s = s.slice(0, 200);
  return s;
}

function isDirectoryEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.isDirectory === true) return true;
  var t = entry.type;
  if (t === 2 || t === "dir" || t === "directory") return true;
  if (typeof t === "string" && String(t).toLowerCase() === "directory") return true;
  return false;
}

function dirNamesOnly(list) {
  var src = Array.isArray(list) ? list : [];
  var out = [];
  var seen = {};
  src.forEach(function (entry) {
    var name = sanitizeName(entry && (entry.name || entry.Name));
    if (!name) return;
    if (!isDirectoryEntry(entry)) return;
    if (seen[name]) return;
    seen[name] = true;
    out.push(name);
  });
  return out.slice(0, MAX_DIRS);
}

function readOnlyFtp(ftp) {
  return {
    pwd: function () { return ftp.pwd(); },
    list: function (dir) { return ftp.list(dir || "."); },
    close: function () {
      if (ftp && typeof ftp.close === "function") return ftp.close();
      return Promise.resolve();
    },
    stor: async function () {
      throw new Error("probe_readonly");
    },
    rename: async function () {
      throw new Error("probe_readonly");
    },
    remove: async function () {
      throw new Error("probe_readonly");
    },
    cd: async function () {
      throw new Error("probe_readonly");
    }
  };
}

function pwdLooksLikePublicHtml(pwd) {
  var s = String(pwd || "").replace(/\\/g, "/");
  return /\/public_html\/?$/i.test(s) || s === "public_html";
}

function logProbe(result) {
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    stage: "site-ftp-probe",
    loginPwd: result && result.loginPwd ? result.loginPwd : null,
    rootDirs: result && result.rootDirs ? result.rootDirs : [],
    publicHtmlHints: result && result.publicHtmlHints ? result.publicHtmlHints : [],
    writeOps: 0
  }));
}

function payloadLooksUnsafe(text) {
  var blob = String(text || "").toLowerCase();
  if (blob.indexOf("password") >= 0) return true;
  if (blob.indexOf("ftp_user") >= 0) return true;
  if (blob.indexOf("secret") >= 0) return true;
  if (blob.indexOf("apikey") >= 0 || blob.indexOf("api_key") >= 0) return true;
  return false;
}

/**
 * @param {object} ftp injected adapter with pwd/list
 */
async function probeLoginLayout(ftp) {
  if (!ftp || typeof ftp.pwd !== "function" || typeof ftp.list !== "function") {
    return fail("ftp_missing", "FTP接続がありません");
  }
  var ro = readOnlyFtp(ftp);
  var loginPwd = "";
  try {
    loginPwd = sanitizePwd(await ro.pwd());
  } catch (ePwd) {
    return fail("ftp_pwd_failed", "ログイン直後の位置を確認できませんでした");
  }

  var rootDirs = [];
  try {
    rootDirs = dirNamesOnly(await ro.list("."));
  } catch (eList) {
    return fail("ftp_list_failed", "ログイン直後のフォルダ一覧を取得できませんでした", {
      loginPwd: loginPwd
    });
  }

  var publicHtmlHints = [];
  if (pwdLooksLikePublicHtml(loginPwd)) {
    publicHtmlHints.push({ at: "login-pwd" });
  }
  if (rootDirs.indexOf("public_html") >= 0) {
    publicHtmlHints.push({ at: "login-list", name: "public_html" });
  }

  var i;
  for (i = 0; i < rootDirs.length; i++) {
    var parent = rootDirs[i];
    if (parent.toLowerCase() === "diary") continue;
    try {
      var childDirs = dirNamesOnly(await ro.list(parent));
      if (childDirs.indexOf("public_html") >= 0) {
        publicHtmlHints.push({ at: "one-level", parent: parent, name: "public_html" });
      }
    } catch (eChild) {
      /* skip unreadable folder */
    }
  }

  var result = {
    ok: true,
    loginPwd: loginPwd,
    rootDirs: rootDirs,
    publicHtmlHints: publicHtmlHints,
    writeOps: 0
  };
  var dumped = JSON.stringify(result);
  if (payloadLooksUnsafe(dumped)) {
    return fail("probe_unsafe", "診断結果に出せない文字が含まれます");
  }
  logProbe(result);
  return result;
}

module.exports = {
  probeLoginLayout: probeLoginLayout,
  readOnlyFtp: readOnlyFtp,
  dirNamesOnly: dirNamesOnly,
  sanitizeName: sanitizeName,
  sanitizePwd: sanitizePwd,
  logProbe: logProbe
};
