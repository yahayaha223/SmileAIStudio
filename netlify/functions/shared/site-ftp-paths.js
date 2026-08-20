"use strict";

/**
 * Homepage FTP path guards.
 * Never reuse diary FTP_REMOTE_DIR. Secrets are not logged.
 */
var env = require("./env");

var ALLOWED_SITE_ROOT = "/public_html";
var ALLOWED_FINAL_PATHS = {
  "CorporateSite/index.htm": "/public_html/index.htm",
  "CorporateSite/css/top-diary-notice.css": "/public_html/css/top-diary-notice.css"
};
var RELATIVE_FROM_SITE_ROOT = {
  "CorporateSite/index.htm": "index.htm",
  "CorporateSite/css/top-diary-notice.css": "css/top-diary-notice.css"
};

function fail(code, message, extra) {
  var out = {
    ok: false,
    code: code || "invalid_ftp_path",
    userMessage: message || "公開先パスが不正です"
  };
  if (extra && typeof extra === "object") {
    Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
  }
  return out;
}

function normalizeAbs(raw) {
  var s = String(raw || "").replace(/\\/g, "/").trim();
  if (!s) return "";
  if (s.indexOf("\0") >= 0) return "";
  if (/^[a-zA-Z]:/.test(s)) return "";
  if (s.charAt(0) !== "/") s = "/" + s;
  var parts = s.split("/");
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (!part || part === ".") continue;
    if (part === "..") return "";
    out.push(part);
  }
  return "/" + out.join("/");
}

function pathHasDiarySegment(p) {
  var n = normalizeAbs(p);
  if (!n) return true;
  var parts = n.split("/").filter(Boolean);
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].toLowerCase() === "diary") return true;
  }
  return false;
}

function readConfiguredSiteRoot() {
  return env.getEnv("SITE_FTP_REMOTE_DIR") || env.getEnv("FTP_SITE_REMOTE_DIR") || "";
}

function readDiaryRemoteDir() {
  return env.getEnv("FTP_REMOTE_DIR") || "";
}

function readConfiguredSiteCwd() {
  return env.getEnv("SITE_FTP_CWD") || "";
}

function isPlausibleHostname(part) {
  var s = String(part || "");
  if (!s) return false;
  if (s.indexOf("..") >= 0) return false;
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(s);
}

function validateSiteFtpCwd(raw) {
  var n = normalizeAbs(raw);
  if (!n) {
    return fail(
      "site_cwd_required",
      "公式サイトFTP作業フォルダ SITE_FTP_CWD が必要です"
    );
  }
  if (pathHasDiarySegment(n)) {
    return fail(
      "ftp_cwd_is_diary",
      "FTP作業フォルダが日記配下のため、公式サイト公開を中止しました",
      { ftpCwd: n }
    );
  }
  if (!/\/public_html$/i.test(n)) {
    return fail(
      "ftp_cwd_not_site_root",
      "FTP作業フォルダの末尾は public_html である必要があります",
      { ftpCwd: n }
    );
  }
  var parts = n.split("/").filter(Boolean);
  if (parts.length === 2 && !isPlausibleHostname(parts[0])) {
    return fail(
      "invalid_ftp_cwd_domain",
      "FTP作業フォルダのドメインが不正です",
      { ftpCwd: n }
    );
  }
  if (parts.length !== 1 && parts.length !== 2) {
    return fail(
      "invalid_ftp_cwd",
      "FTP作業フォルダの形式が不正です",
      { ftpCwd: n }
    );
  }
  var diary = normalizeAbs(readDiaryRemoteDir());
  if (diary && (n === diary || n.indexOf(diary + "/") === 0)) {
    return fail(
      "site_cwd_reuses_diary_dir",
      "公式サイトFTP作業フォルダに日記用 FTP_REMOTE_DIR は使えません",
      { ftpCwd: n }
    );
  }
  return { ok: true, cwd: n };
}

function validateSiteRoot(raw) {
  var n = normalizeAbs(raw);
  if (!n) {
    return fail(
      "site_root_required",
      "公式サイト公開先 SITE_FTP_REMOTE_DIR=/public_html が必要です"
    );
  }
  if (pathHasDiarySegment(n)) {
    return fail(
      "site_root_must_not_be_diary",
      "公式サイト公開先に日記フォルダは使えません"
    );
  }
  var diary = normalizeAbs(readDiaryRemoteDir());
  if (diary && n === diary) {
    return fail(
      "site_root_reuses_diary_dir",
      "公式サイト公開先に日記用 FTP_REMOTE_DIR は使えません"
    );
  }
  if (n !== ALLOWED_SITE_ROOT) {
    return fail(
      "invalid_site_root",
      "公式サイト公開先は /public_html のみです"
    );
  }
  return { ok: true, root: n };
}

function joinFtpPath(root, rel) {
  var r = normalizeAbs(root);
  var s = String(rel || "").replace(/\\/g, "/").trim().replace(/^\/+/, "");
  if (!r || !s) return "";
  if (s.indexOf("\0") >= 0) return "";
  var parts = s.split("/");
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i] || parts[i] === "." || parts[i] === "..") return "";
  }
  return r + "/" + parts.join("/");
}

function resolveOneTarget(repoPath, siteRoot) {
  var key = String(repoPath || "").replace(/\\/g, "/").trim();
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_FINAL_PATHS, key)) {
    return fail("ftp_path_not_allowed", "許可されていない公開ファイルです", { repoPath: key });
  }
  var relative = RELATIVE_FROM_SITE_ROOT[key];
  var absolute = joinFtpPath(siteRoot, relative);
  if (!absolute) {
    return fail("ftp_path_not_allowed", "公開先パスを組み立てられません", { repoPath: key });
  }
  if (key === "CorporateSite/index.htm" && pathHasDiarySegment(absolute)) {
    return fail(
      "homepage_must_not_write_diary",
      "公式トップページを日記フォルダへ公開することはできません",
      { repoPath: key, relativeRemote: relative, finalFtpPath: absolute }
    );
  }
  if (pathHasDiarySegment(absolute)) {
    return fail(
      "homepage_must_not_write_diary",
      "公式サイトファイルを日記フォルダへ公開することはできません",
      { repoPath: key, relativeRemote: relative, finalFtpPath: absolute }
    );
  }
  if (absolute !== ALLOWED_FINAL_PATHS[key]) {
    return fail(
      "ftp_path_not_allowed",
      "公開先パスが許可されていません",
      { repoPath: key, relativeRemote: relative, finalFtpPath: absolute }
    );
  }
  return {
    ok: true,
    repoPath: key,
    remotePath: relative,
    absolutePath: absolute
  };
}

function resolvePublishPlan(repoPaths, siteRootRaw) {
  var rootCheck = validateSiteRoot(siteRootRaw);
  if (!rootCheck.ok) return rootCheck;
  var src = Array.isArray(repoPaths) ? repoPaths : [];
  var files = [];
  var seen = {};
  for (var i = 0; i < src.length; i++) {
    var item = src[i];
    var repoPath = typeof item === "string" ? item : (item && item.repoPath);
    if (!repoPath) continue;
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_FINAL_PATHS, repoPath)) continue;
    var one = resolveOneTarget(repoPath, rootCheck.root);
    if (!one.ok) return one;
    if (seen[one.absolutePath]) continue;
    seen[one.absolutePath] = true;
    files.push(one);
  }
  if (!files.length) {
    return fail("no_allowed_files", "公開できるファイルがありません");
  }
  return {
    ok: true,
    siteRoot: rootCheck.root,
    files: files
  };
}

function assertCwdIsHomepageRoot(cwd) {
  var n = normalizeAbs(cwd);
  if (!n) {
    return fail("ftp_cwd_unknown", "FTPの作業フォルダを確認できませんでした");
  }
  if (pathHasDiarySegment(n)) {
    return fail(
      "ftp_cwd_is_diary",
      "FTP作業フォルダが日記配下のため、公式サイト公開を中止しました",
      { ftpCwd: n }
    );
  }
  if (n !== ALLOWED_SITE_ROOT && !/\/public_html$/i.test(n)) {
    return fail(
      "ftp_cwd_not_site_root",
      "FTP作業フォルダが公式サイトルートではありません",
      { ftpCwd: n }
    );
  }
  return { ok: true, cwd: n };
}

function logPathPlan(plan, extra) {
  var files = plan && Array.isArray(plan.files) ? plan.files : [];
  var payload = {
    at: new Date().toISOString(),
    stage: "site-publish-path-check",
    siteRoot: plan && plan.siteRoot ? plan.siteRoot : null,
    ftpCwd: extra && extra.ftpCwd ? extra.ftpCwd : null,
    files: files.map(function (f) {
      return {
        repoPath: f.repoPath,
        relativeRemote: f.remotePath,
        finalFtpPath: f.absolutePath
      };
    })
  };
  console.log(JSON.stringify(payload));
}

function ftpErrorLooksLike550(err) {
  if (!err) return false;
  var code = err.code != null ? String(err.code) : "";
  var msg = String(err.message || err);
  return code === "550" || /(?:^|\D)550(?:\D|$)/.test(msg);
}

async function enterSiteFtpCwd(ftp, requestedCwd) {
  var check = validateSiteFtpCwd(requestedCwd);
  if (!check.ok) return check;
  if (!ftp || typeof ftp.cd !== "function") {
    return fail("ftp_missing", "FTP接続がありません");
  }
  try {
    await ftp.cd(check.cwd);
  } catch (e) {
    if (ftpErrorLooksLike550(e)) {
      return fail(
        "ftp_cwd_550",
        "公式サイトのFTP作業フォルダに入れません。SITE_FTP_CWD を確認してください",
        { ftpCwd: check.cwd }
      );
    }
    return fail(
      "ftp_cwd_failed",
      "公式サイトのFTP作業フォルダに移動できませんでした",
      { ftpCwd: check.cwd }
    );
  }
  var pwd = "";
  if (typeof ftp.pwd === "function") {
    try {
      pwd = await ftp.pwd();
    } catch (ePwd) {
      pwd = check.cwd;
    }
  } else {
    pwd = check.cwd;
  }
  var cwdCheck = assertCwdIsHomepageRoot(pwd || check.cwd);
  if (!cwdCheck.ok) return cwdCheck;
  return { ok: true, cwd: cwdCheck.cwd };
}

module.exports = {
  ALLOWED_SITE_ROOT: ALLOWED_SITE_ROOT,
  ALLOWED_FINAL_PATHS: ALLOWED_FINAL_PATHS,
  RELATIVE_FROM_SITE_ROOT: RELATIVE_FROM_SITE_ROOT,
  normalizeAbs: normalizeAbs,
  pathHasDiarySegment: pathHasDiarySegment,
  readConfiguredSiteRoot: readConfiguredSiteRoot,
  readConfiguredSiteCwd: readConfiguredSiteCwd,
  readDiaryRemoteDir: readDiaryRemoteDir,
  validateSiteRoot: validateSiteRoot,
  validateSiteFtpCwd: validateSiteFtpCwd,
  joinFtpPath: joinFtpPath,
  resolveOneTarget: resolveOneTarget,
  resolvePublishPlan: resolvePublishPlan,
  assertCwdIsHomepageRoot: assertCwdIsHomepageRoot,
  enterSiteFtpCwd: enterSiteFtpCwd,
  logPathPlan: logPathPlan
};
