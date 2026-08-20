"use strict";

/**
 * Corporate homepage FTP publish.
 * Only allowlisted repo paths. Backup before swap. Restore on failure.
 * FTP secrets stay in ftp-client / env.
 */
var path = require("path");
var siteFtpPaths = require("./site-ftp-paths");

var MAX_FILE_BYTES = 1500 * 1024;
var BAK_SUFFIX = ".smile-studio-bak";
var PUBLISHING_SUFFIX = ".smile-publishing";
var PREPUB_SUFFIX = ".smile-prepub-bak";

/** Repo path → live FTP path (site root). */
var ALLOWED_REPO_TO_REMOTE = {
  "CorporateSite/index.htm": "index.htm",
  "CorporateSite/css/top-diary-notice.css": "css/top-diary-notice.css"
};

function fail(code, message, extra) {
  var out = {
    ok: false,
    code: code || "failed",
    userMessage: message || "公開できませんでした",
    productionUntouched: true
  };
  if (extra && typeof extra === "object") {
    Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
  }
  return out;
}

function normalizeRepoPath(raw) {
  var s = String(raw || "").replace(/\\/g, "/").trim();
  if (!s) return "";
  s = s.replace(/^\.\//, "");
  return s;
}

function isUnsafePath(p) {
  var s = String(p || "");
  if (!s) return true;
  if (s.indexOf("\0") >= 0) return true;
  if (s.charAt(0) === "/" || s.charAt(0) === "\\") return true;
  if (/^[a-zA-Z]:/.test(s)) return true;
  var parts = s.split("/");
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === ".." || parts[i] === "") return true;
  }
  return false;
}

function mapAllowedRepoPath(repoPath) {
  var key = normalizeRepoPath(repoPath);
  if (isUnsafePath(key)) return null;
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_REPO_TO_REMOTE, key)) return null;
  var remote = ALLOWED_REPO_TO_REMOTE[key];
  if (isUnsafePath(remote)) return null;
  return { repoPath: key, remotePath: remote };
}

function filterAllowedFiles(filenames) {
  var src = Array.isArray(filenames) ? filenames : [];
  var out = [];
  var seen = {};
  src.forEach(function (name) {
    var mapped = mapAllowedRepoPath(name);
    if (!mapped) return;
    if (seen[mapped.remotePath]) return;
    seen[mapped.remotePath] = true;
    out.push(mapped);
  });
  return out;
}

function parentDir(remotePath) {
  var dir = path.posix.dirname(String(remotePath || ""));
  if (!dir || dir === ".") return "";
  return dir;
}

async function restoreOne(ftp, remotePath, originalBytes) {
  try {
    await ftp.rename(remotePath + PREPUB_SUFFIX, remotePath);
    return true;
  } catch (e1) {
    if (originalBytes && originalBytes.length) {
      try {
        await ftp.stor(remotePath, originalBytes);
        return true;
      } catch (e2) { /* fall through */ }
    }
    try {
      await ftp.rename(remotePath + BAK_SUFFIX, remotePath);
      return true;
    } catch (e3) {
      return false;
    }
  }
}

/**
 * @param {object} opts
 * @param {boolean} opts.userConfirmed
 * @param {Array<{repoPath:string, remotePath:string, buffer:Buffer}>} opts.files
 * @param {object} opts.ftp
 */
async function publishSiteFiles(opts) {
  opts = opts || {};
  if (!opts.userConfirmed) {
    return fail("confirm_required", "公開確認が必要です");
  }
  var ftp = opts.ftp;
  if (!ftp || typeof ftp.retr !== "function") {
    return fail("ftp_missing", "FTP接続がありません");
  }
  var incoming = Array.isArray(opts.files) ? opts.files : [];
  var siteRoot = opts.siteRoot || siteFtpPaths.readConfiguredSiteRoot();
  var repoPaths = [];
  incoming.forEach(function (f) {
    if (f && f.repoPath) repoPaths.push(f.repoPath);
  });
  var plan = siteFtpPaths.resolvePublishPlan(repoPaths, siteRoot);
  if (!plan.ok) {
    if (ftp && typeof ftp.close === "function") {
      try { await ftp.close(); } catch (eClosePlan) { /* ignore */ }
    }
    return fail(plan.code, plan.userMessage, {
      finalFtpPath: plan.finalFtpPath || null
    });
  }

  var cwd = opts.ftpCwd || "";
  if (!cwd && typeof ftp.pwd === "function") {
    try {
      cwd = await ftp.pwd();
    } catch (ePwd) {
      cwd = "";
    }
  }
  if (cwd) {
    var cwdCheck = siteFtpPaths.assertCwdIsHomepageRoot(cwd);
    if (!cwdCheck.ok) {
      if (ftp && typeof ftp.close === "function") {
        try { await ftp.close(); } catch (eCloseCwd) { /* ignore */ }
      }
      return fail(cwdCheck.code, cwdCheck.userMessage, { ftpCwd: cwdCheck.ftpCwd || cwd });
    }
  }

  siteFtpPaths.logPathPlan(plan, { ftpCwd: cwd || null });

  var files = [];
  for (var p = 0; p < plan.files.length; p++) {
    var mapped = plan.files[p];
    var src = null;
    for (var s = 0; s < incoming.length; s++) {
      if (incoming[s] && incoming[s].repoPath === mapped.repoPath) {
        src = incoming[s];
        break;
      }
    }
    var buf = src && src.buffer;
    if (!buf || !buf.length || buf.length > MAX_FILE_BYTES) {
      return fail("no_allowed_files", "公開できるファイルがありません");
    }
    files.push({
      repoPath: mapped.repoPath,
      remotePath: mapped.remotePath,
      absolutePath: mapped.absolutePath,
      buffer: Buffer.from(buf)
    });
  }
  if (!files.length) {
    return fail("no_allowed_files", "公開できるファイルがありません");
  }

  var originals = {};
  var swapped = [];
  try {
    for (var i = 0; i < files.length; i++) {
      var item = files[i];
      var remotePath = item.remotePath;
      var dir = parentDir(remotePath);
      if (dir && typeof ftp.ensureDir === "function") {
        await ftp.ensureDir(dir);
      }

      var originalBytes = null;
      try {
        originalBytes = await ftp.retr(remotePath);
      } catch (eRetr) {
        originalBytes = null;
      }
      originals[remotePath] = originalBytes;

      if (originalBytes && originalBytes.length) {
        await ftp.stor(remotePath + BAK_SUFFIX, originalBytes);
      }

      await ftp.stor(remotePath + PUBLISHING_SUFFIX, item.buffer);

      try {
        if (originalBytes && originalBytes.length) {
          await ftp.rename(remotePath, remotePath + PREPUB_SUFFIX);
        }
        await ftp.rename(remotePath + PUBLISHING_SUFFIX, remotePath);
        swapped.push(remotePath);
      } catch (swapErr) {
        var restoredThis = await restoreOne(ftp, remotePath, originalBytes);
        for (var r = swapped.length - 1; r >= 0; r--) {
          await restoreOne(ftp, swapped[r], originals[swapped[r]]);
        }
        return fail(
          "swap_failed",
          restoredThis
            ? "公開に失敗したため、元のホームページを維持しました"
            : "公開切替に失敗しました",
          { productionUntouched: restoredThis, detail: String((swapErr && swapErr.message) || "").slice(0, 160) }
        );
      }
    }

    return {
      ok: true,
      code: "published",
      userMessage: "公式サイトへ反映しました",
      productionUntouched: false,
      publishedFiles: files.map(function (f) { return f.remotePath; }),
      publishedAbsolutePaths: files.map(function (f) { return f.absolutePath; }),
      history: {
        publishedAt: new Date().toISOString(),
        files: files.map(function (f) { return f.repoPath; }),
        finalFtpPaths: files.map(function (f) { return f.absolutePath; })
      }
    };
  } catch (e) {
    var allRestored = true;
    for (var j = swapped.length - 1; j >= 0; j--) {
      var okRestore = await restoreOne(ftp, swapped[j], originals[swapped[j]]);
      if (!okRestore) allRestored = false;
    }
    Object.keys(originals).forEach(function (p) {
      if (swapped.indexOf(p) >= 0) return;
      if (originals[p] && originals[p].length) {
        /* publishing file may exist; live should still be original */
      }
    });
    return fail(
      e.code || "pipeline_error",
      allRestored
        ? "公開に失敗したため、元のホームページを維持しました"
        : ((e && e.message) || "公開できませんでした"),
      { productionUntouched: allRestored }
    );
  } finally {
    if (ftp && typeof ftp.close === "function") {
      try { await ftp.close(); } catch (eClose) { /* ignore */ }
    }
  }
}

module.exports = {
  publishSiteFiles: publishSiteFiles,
  filterAllowedFiles: filterAllowedFiles,
  mapAllowedRepoPath: mapAllowedRepoPath,
  siteFtpPaths: siteFtpPaths,
  isUnsafePath: isUnsafePath,
  normalizeRepoPath: normalizeRepoPath,
  fail: fail,
  ALLOWED_REPO_TO_REMOTE: ALLOWED_REPO_TO_REMOTE,
  MAX_FILE_BYTES: MAX_FILE_BYTES,
  BAK_SUFFIX: BAK_SUFFIX,
  PUBLISHING_SUFFIX: PUBLISHING_SUFFIX,
  PREPUB_SUFFIX: PREPUB_SUFFIX
};
