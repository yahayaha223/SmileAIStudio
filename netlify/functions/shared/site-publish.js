"use strict";

/**
 * Corporate homepage FTP publish.
 * Only allowlisted repo paths. Backup before swap. Restore on failure.
 * FTP secrets stay in ftp-client / env.
 */
var path = require("path");
var siteFtpPaths = require("./site-ftp-paths");
var ftpClient = require("./ftp-client");
var sitePublishLog = require("./site-publish-log");

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

function allowedOpBases() {
  return Object.keys(ALLOWED_REPO_TO_REMOTE).map(function (k) {
    return ALLOWED_REPO_TO_REMOTE[k];
  });
}

function isAllowedOpPath(p) {
  var s = String(p || "");
  if (isUnsafePath(s)) return false;
  var suffixes = ["", BAK_SUFFIX, PUBLISHING_SUFFIX, PREPUB_SUFFIX];
  var bases = allowedOpBases();
  var i;
  var j;
  for (i = 0; i < bases.length; i++) {
    for (j = 0; j < suffixes.length; j++) {
      if (s === bases[i] + suffixes[j]) return true;
    }
  }
  return false;
}

function logCtxFields(ctx) {
  ctx = ctx || {};
  return {
    requestId: ctx.requestId || null,
    issueNumber: ctx.issueNumber || null,
    prNumber: ctx.prNumber || null,
    siteRoot: ctx.siteRoot || null,
    ftpCwd: ctx.ftpCwd || null,
    selectedMode: ctx.selectedMode || null,
    pwdBeforeCwd: ctx.pwdBeforeCwd || null,
    pwdAfterCwd: ctx.pwdAfterCwd || null
  };
}

function logStage(ctx, extra) {
  return sitePublishLog.logEvent(Object.assign(logCtxFields(ctx), extra || {}));
}

function failFtpPath(op, remotePath) {
  return fail("invalid_ftp_path", "公開先パスが不正です", {
    failedFile: remotePath || null,
    reasonCode: "invalid_ftp_path",
    ftpOp: op
  });
}

async function restoreOne(ftp, remotePath, originalBytes, ctx) {
  var prepub = remotePath + PREPUB_SUFFIX;
  var bak = remotePath + BAK_SUFFIX;
  if (!isAllowedOpPath(remotePath) || !isAllowedOpPath(prepub) || !isAllowedOpPath(bak)) {
    logStage(ctx, {
      stage: "rollback-fail",
      failedFile: remotePath,
      reasonCode: "invalid_ftp_path"
    });
    return false;
  }
  logStage(ctx, {
    stage: "rollback-start",
    failedFile: remotePath,
    restorePath: remotePath,
    renameFrom: prepub
  });
  try {
    await ftp.rename(prepub, remotePath);
    logStage(ctx, {
      stage: "rollback-success",
      failedFile: remotePath,
      restorePath: remotePath,
      restoreMethod: "rename-prepub"
    });
    return true;
  } catch (e1) {
    if (originalBytes && originalBytes.length) {
      try {
        await ftp.stor(remotePath, originalBytes);
        logStage(ctx, {
          stage: "rollback-success",
          failedFile: remotePath,
          restorePath: remotePath,
          restoreMethod: "stor-original"
        });
        return true;
      } catch (e2) { /* fall through */ }
    }
    try {
      await ftp.rename(bak, remotePath);
      logStage(ctx, {
        stage: "rollback-success",
        failedFile: remotePath,
        restorePath: remotePath,
        restoreMethod: "rename-bak"
      });
      return true;
    } catch (e3) {
      var desc = sitePublishLog.describeFtpError(e3);
      logStage(ctx, {
        stage: "rollback-fail",
        failedFile: remotePath,
        restorePath: remotePath,
        reasonCode: "rollback_failed",
        ftpErrorCode: desc.ftpErrorCode,
        ftpErrorMessage: desc.ftpErrorMessage
      });
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

  var enter = ftp && ftp.siteEnter ? ftp.siteEnter : {};
  var logCtx = {
    requestId: opts.requestId || null,
    issueNumber: opts.issueNumber || null,
    prNumber: opts.prNumber || null,
    siteRoot: plan.siteRoot,
    ftpCwd: cwd || enter.cwd || null,
    selectedMode: opts.selectedMode || enter.selectedMode || (cwd === "/" ? "loginRoot" : "publicHtmlCwd"),
    pwdBeforeCwd: opts.pwdBeforeCwd || enter.pwdBeforeCwd || null,
    pwdAfterCwd: opts.pwdAfterCwd || enter.pwdAfterCwd || null
  };

  siteFtpPaths.logPathPlan(plan, { ftpCwd: cwd || null });
  logStage(logCtx, {
    stage: "site-publish-path-check",
    finalFtpPath: plan.files.map(function (f) { return f.absolutePath; }).join(","),
    skippedCd: !!enter.skippedCd
  });

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
    if (!isAllowedOpPath(mapped.remotePath)) {
      return failFtpPath("plan", mapped.remotePath);
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
  var currentFile = null;
  try {
    for (var i = 0; i < files.length; i++) {
      var item = files[i];
      var remotePath = item.remotePath;
      currentFile = remotePath;
      var bakPath = remotePath + BAK_SUFFIX;
      var publishingPath = remotePath + PUBLISHING_SUFFIX;
      var prepubPath = remotePath + PREPUB_SUFFIX;
      if (
        !isAllowedOpPath(remotePath) ||
        !isAllowedOpPath(bakPath) ||
        !isAllowedOpPath(publishingPath) ||
        !isAllowedOpPath(prepubPath)
      ) {
        return failFtpPath("op", remotePath);
      }

      var dir = parentDir(remotePath);
      if (dir) {
        await ftpClient.ensureDirKeepingCwd(ftp, dir);
      }
      if (typeof ftp.pwd === "function" && cwd === "/") {
        var pwdNow = siteFtpPaths.normalizeAbs(await ftp.pwd());
        if (pwdNow !== "/") {
          var drifted = new Error("FTP作業フォルダが公開ルートからずれました");
          drifted.code = "ftp_cwd_restore_failed";
          throw drifted;
        }
      }

      var originalBytes = null;
      try {
        originalBytes = await ftp.retr(remotePath);
      } catch (eRetr) {
        originalBytes = null;
      }
      originals[remotePath] = originalBytes;

      if (originalBytes && originalBytes.length) {
        logStage(logCtx, {
          stage: "backup-start",
          failedFile: remotePath,
          backupPath: bakPath
        });
        try {
          await ftp.stor(bakPath, originalBytes);
          logStage(logCtx, {
            stage: "backup-success",
            failedFile: remotePath,
            backupPath: bakPath
          });
        } catch (eBak) {
          var bakErr = sitePublishLog.describeFtpError(eBak);
          logStage(logCtx, {
            stage: "backup-fail",
            failedFile: remotePath,
            backupPath: bakPath,
            reasonCode: eBak.code || "backup_failed",
            ftpErrorCode: bakErr.ftpErrorCode,
            ftpErrorMessage: bakErr.ftpErrorMessage
          });
          throw eBak;
        }
      }

      logStage(logCtx, {
        stage: "upload-start",
        failedFile: remotePath,
        uploadPath: publishingPath
      });
      try {
        await ftp.stor(publishingPath, item.buffer);
        logStage(logCtx, {
          stage: "upload-success",
          failedFile: remotePath,
          uploadPath: publishingPath
        });
      } catch (eUp) {
        var upErr = sitePublishLog.describeFtpError(eUp);
        logStage(logCtx, {
          stage: "upload-fail",
          failedFile: remotePath,
          uploadPath: publishingPath,
          reasonCode: eUp.code || "upload_failed",
          ftpErrorCode: upErr.ftpErrorCode,
          ftpErrorMessage: upErr.ftpErrorMessage
        });
        throw eUp;
      }

      try {
        if (originalBytes && originalBytes.length) {
          logStage(logCtx, {
            stage: "rename-start",
            failedFile: remotePath,
            renameFrom: remotePath,
            renameTo: prepubPath
          });
          await ftp.rename(remotePath, prepubPath);
        }
        logStage(logCtx, {
          stage: "rename-start",
          failedFile: remotePath,
          renameFrom: publishingPath,
          renameTo: remotePath
        });
        await ftp.rename(publishingPath, remotePath);
        swapped.push(remotePath);
        logStage(logCtx, {
          stage: "rename-success",
          failedFile: remotePath,
          renameTo: remotePath
        });
      } catch (swapErr) {
        var swapDesc = sitePublishLog.describeFtpError(swapErr);
        logStage(logCtx, {
          stage: "rename-fail",
          failedFile: remotePath,
          reasonCode: "swap_failed",
          ftpErrorCode: swapDesc.ftpErrorCode,
          ftpErrorMessage: swapDesc.ftpErrorMessage
        });
        var restoredThis = await restoreOne(ftp, remotePath, originalBytes, logCtx);
        for (var r = swapped.length - 1; r >= 0; r--) {
          await restoreOne(ftp, swapped[r], originals[swapped[r]], logCtx);
        }
        return fail(
          "swap_failed",
          restoredThis
            ? "公開に失敗したため、元のホームページを維持しました"
            : "公開切替に失敗しました",
          {
            productionUntouched: restoredThis,
            failedFile: remotePath,
            reasonCode: "swap_failed",
            ftpErrorCode: swapDesc.ftpErrorCode,
            ftpErrorMessage: swapDesc.ftpErrorMessage
          }
        );
      }
    }

    logStage(logCtx, {
      stage: "site-publish-success",
      reasonCode: "ok",
      finalFtpPath: files.map(function (f) { return f.absolutePath; }).join(",")
    });
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
    var failDesc = sitePublishLog.describeFtpError(e);
    var failedFile = currentFile;
    if (!failedFile && swapped.length) failedFile = swapped[swapped.length - 1];
    logStage(logCtx, {
      stage: "site-publish-fail",
      failedFile: failedFile,
      reasonCode: e.code || "pipeline_error",
      ftpErrorCode: failDesc.ftpErrorCode,
      ftpErrorMessage: failDesc.ftpErrorMessage
    });
    var allRestored = true;
    for (var j = swapped.length - 1; j >= 0; j--) {
      var okRestore = await restoreOne(ftp, swapped[j], originals[swapped[j]], logCtx);
      if (!okRestore) allRestored = false;
    }
    Object.keys(originals).forEach(function (pName) {
      if (swapped.indexOf(pName) >= 0) return;
      if (originals[pName] && originals[pName].length) {
        /* publishing file may exist; live should still be original */
      }
    });
    return fail(
      e.code || "pipeline_error",
      allRestored
        ? "公開に失敗したため、元のホームページを維持しました"
        : ((e && e.message) || "公開できませんでした"),
      {
        productionUntouched: allRestored,
        failedFile: failedFile,
        reasonCode: e.code || "pipeline_error",
        ftpErrorCode: failDesc.ftpErrorCode,
        ftpErrorMessage: failDesc.ftpErrorMessage
      }
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
  PREPUB_SUFFIX: PREPUB_SUFFIX,
  isAllowedOpPath: isAllowedOpPath
};
