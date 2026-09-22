"use strict";

/**
 * Server-side FTP adapter. Credentials come only from process.env.
 * Tests inject a memory adapter instead of connecting.
 */
var env = require("./env");
var siteFtpPaths = require("./site-ftp-paths");
var { Readable, Writable } = require("stream");

function getFtpConfig() {
  return {
    host: env.getEnv("FTP_HOST"),
    user: env.getEnv("FTP_USER") || env.getEnv("FTP_USERNAME"),
    password: env.getEnv("FTP_PASSWORD"),
    port: Number(env.getEnv("FTP_PORT", "21")) || 21,
    secure: /^(1|true|yes)$/i.test(env.getEnv("FTP_SECURE", "1")),
    remoteDir: env.getEnv("FTP_REMOTE_DIR"),
    timeoutMs: Number(env.getEnv("FTP_TIMEOUT_MS", "20000")) || 20000
  };
}

function isConfigured(cfg) {
  cfg = cfg || getFtpConfig();
  return !!(cfg.host && cfg.user && cfg.password && cfg.remoteDir);
}

/**
 * Diary connect: never CWD /. If FTP_REMOTE_DIR=/ and diary/ exists, cd diary.
 */
async function enterDiaryRemoteDir(client, remoteDir) {
  var plan = siteFtpPaths.resolveDiaryFtpEnter(remoteDir);
  if (plan && plan.needsRootDirs) {
    var dirs = [];
    try {
      dirs = siteFtpPaths.listDirectoryNames(await client.list("."));
    } catch (eList) {
      return {
        ok: false,
        code: "ftp_list_failed",
        userMessage: "ログイン直後のフォルダ一覧を取得できませんでした"
      };
    }
    plan = siteFtpPaths.resolveDiaryFtpEnter(remoteDir, dirs);
  }
  if (!plan || !plan.ok) {
    return plan || {
      ok: false,
      code: "diary_remote_failed",
      userMessage: "日記FTP先を確認できませんでした"
    };
  }
  if (plan.cd) {
    if (siteFtpPaths.normalizeAbs(plan.cd) === "/") {
      return {
        ok: false,
        code: "diary_remote_cd_slash",
        userMessage: "日記FTP先で CWD / は使いません"
      };
    }
    try {
      await client.cd(plan.cd);
    } catch (eCd) {
      return {
        ok: false,
        code: "diary_remote_failed",
        userMessage: "日記FTP先に入れませんでした"
      };
    }
  }
  return plan;
}

function getSiteFtpConfig() {
  return {
    host: env.getEnv("SITE_FTP_HOST"),
    user: env.getEnv("SITE_FTP_USER"),
    password: env.getEnv("SITE_FTP_PASSWORD"),
    port: Number(env.getEnv("SITE_FTP_PORT", "21")) || 21,
    secure: /^(1|true|yes)$/i.test(env.getEnv("SITE_FTP_SECURE", "1")),
    remoteDir: siteFtpPaths.readConfiguredSiteCwd(),
    timeoutMs: Number(env.getEnv("SITE_FTP_TIMEOUT_MS", "20000")) || 20000,
    siteAccount: true
  };
}

function hasSiteFtpCredentials(cfg) {
  cfg = cfg || getSiteFtpConfig();
  return !!(cfg.host && cfg.user && cfg.password && siteFtpPaths.readConfiguredSiteCwd());
}

function siteFtpNotConfiguredError() {
  var err = new Error("公式サイトFTP接続設定が必要です");
  err.code = "site_ftp_not_configured";
  return err;
}

function isSiteConfigured(cfg) {
  cfg = cfg || getSiteFtpConfig();
  if (!hasSiteFtpCredentials(cfg)) return false;
  var logical = siteFtpPaths.validateSiteRoot(siteFtpPaths.readConfiguredSiteRoot());
  var cwd = siteFtpPaths.validateSiteFtpCwd(cfg.remoteDir || siteFtpPaths.readConfiguredSiteCwd());
  return !!(logical.ok && cwd.ok);
}

function relativePathDepth(dir) {
  return String(dir || "").replace(/\\/g, "/").split("/").filter(Boolean).length;
}

function parentAbsPath(cwd) {
  var n = siteFtpPaths.normalizeAbs(cwd);
  if (!n || n === "/") return "/";
  var parts = n.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? "/" + parts.join("/") : "/";
}

/**
 * Restore FTP CWD without sending CWD /. Many chroot hosts (Xserver) report
 * PWD=/ but reject CWD / with 550. Use CDUP / ".." instead.
 */
async function restoreFtpWorkingDir(ftp, targetCwd, depth) {
  var targetN = siteFtpPaths.normalizeAbs(targetCwd);
  if (!ftp) {
    var missing = new Error("FTP接続がありません");
    missing.code = "ftp_missing";
    throw missing;
  }
  async function currentPwd() {
    if (typeof ftp.pwd !== "function") return "";
    try {
      return siteFtpPaths.normalizeAbs(await ftp.pwd());
    } catch (ePwd) {
      return "";
    }
  }
  var cur = await currentPwd();
  if (targetN && cur === targetN) {
    return { ok: true, cwd: cur, skippedCdSlash: true };
  }
  if (targetN === "/") {
    var steps = depth > 0 ? depth : 1;
    var i;
    for (i = 0; i < steps + 2; i++) {
      cur = await currentPwd();
      if (cur === "/") {
        return { ok: true, cwd: "/", used: "cdup", skippedCdSlash: true };
      }
      if (typeof ftp.cdup === "function") {
        await ftp.cdup();
      } else if (typeof ftp.cd === "function") {
        await ftp.cd("..");
      } else {
        var noCd = new Error("FTP作業フォルダを元に戻せませんでした");
        noCd.code = "ftp_cwd_restore_failed";
        throw noCd;
      }
    }
    cur = await currentPwd();
    if (cur === "/") {
      return { ok: true, cwd: "/", used: "cdup", skippedCdSlash: true };
    }
    var stuck = new Error("FTP作業フォルダを元に戻せませんでした");
    stuck.code = "ftp_cwd_restore_failed";
    throw stuck;
  }
  if (typeof ftp.cd !== "function") {
    var noRestore = new Error("FTP作業フォルダを元に戻せませんでした");
    noRestore.code = "ftp_cwd_restore_failed";
    throw noRestore;
  }
  await ftp.cd(targetCwd);
  return { ok: true, cwd: targetN || targetCwd, skippedCdSlash: targetN === "/" };
}

async function ensureDirKeepingCwd(ftp, dir) {
  if (!ftp || typeof ftp.ensureDir !== "function" || !dir) {
    return { ok: true, skipped: true };
  }
  var rel = String(dir).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.indexOf("..") >= 0) {
    var badDir = new Error("FTPフォルダが不正です");
    badDir.code = "invalid_ftp_path";
    throw badDir;
  }
  var before = "";
  if (typeof ftp.pwd === "function") {
    before = await ftp.pwd();
  }
  await ftp.ensureDir(rel);
  var after = "";
  if (typeof ftp.pwd === "function") {
    try {
      after = await ftp.pwd();
    } catch (eAfter) {
      after = "";
    }
  }
  var beforeN = siteFtpPaths.normalizeAbs(before);
  var afterN = siteFtpPaths.normalizeAbs(after);
  if (!afterN || afterN === beforeN) {
    return { ok: true, cwd: beforeN || before || null, skippedRestore: true };
  }
  return restoreFtpWorkingDir(ftp, before, relativePathDepth(rel));
}

function createMemoryFtp(initialFiles) {
  var files = {};
  Object.keys(initialFiles || {}).forEach(function (k) {
    files[k] = Buffer.from(initialFiles[k]);
  });
  var ops = [];
  var ftp = {
    files: files,
    ops: ops,
    cwd: "/",
    rejectCdSlash: false,
    retr: async function (name) {
      if (!Object.prototype.hasOwnProperty.call(files, name)) {
        var err = new Error("not found: " + name);
        err.code = "not_found";
        throw err;
      }
      ops.push({ op: "retr", name: name });
      return Buffer.from(files[name]);
    },
    stor: async function (name, buf) {
      files[name] = Buffer.from(buf);
      ops.push({ op: "stor", name: name, bytes: Buffer.from(buf).length });
    },
    rename: async function (from, to) {
      if (!Object.prototype.hasOwnProperty.call(files, from)) {
        var err = new Error("missing: " + from);
        err.code = "not_found";
        throw err;
      }
      files[to] = files[from];
      delete files[from];
      ops.push({ op: "rename", from: from, to: to });
    },
    list: async function (dir) {
      ops.push({ op: "list", dir: dir || "." });
      if (typeof this.listEntries === "function") {
        return this.listEntries(dir || ".");
      }
      return Object.keys(files).map(function (name) {
        return { name: name, size: files[name].length };
      });
    },
    ensureDir: async function (dir) {
      var raw = String(dir || "");
      ops.push({ op: "ensureDir", dir: raw });
      if (!raw) return;
      // Mimic basic-ftp: absolute paths CWD /, then CWD each segment.
      if (raw.charAt(0) === "/") {
        await this.cd("/");
      }
      var names = raw.split("/").filter(Boolean);
      var i;
      for (i = 0; i < names.length; i++) {
        await this.cd(names[i]);
      }
    },
    remove: async function (name) {
      delete files[name];
      ops.push({ op: "remove", name: name });
    },
    pwd: async function () {
      ops.push({ op: "pwd" });
      return this.cwd || "/";
    },
    cdup: async function () {
      var from = this.cwd || "/";
      var target = parentAbsPath(from);
      ops.push({ op: "cdup", from: from, target: target });
      this.cwd = target;
    },
    cd: async function (dir) {
      var raw = String(dir || "");
      if (raw === ".." || raw === "../") {
        return this.cdup();
      }
      var target = raw.charAt(0) === "/"
        ? siteFtpPaths.normalizeAbs(raw)
        : siteFtpPaths.normalizeAbs((this.cwd || "/") + "/" + raw);
      if (this.rejectCdSlash && (raw === "/" || target === "/")) {
        ops.push({ op: "cd", dir: raw, target: "/", rejected: true });
        var slashErr = new Error("550 Failed to change directory.");
        slashErr.code = 550;
        throw slashErr;
      }
      ops.push({ op: "cd", dir: raw, target: target });
      if (typeof this.resolveCd === "function") {
        await this.resolveCd(target, raw);
      }
      if (!target) {
        var bad = new Error("550");
        bad.code = 550;
        throw bad;
      }
      this.cwd = target;
    },
    close: async function () {
      ops.push({ op: "close" });
    }
  };
  return ftp;
}

async function connectFromEnv(cfg) {
  cfg = cfg || getFtpConfig();
  var allowEmptyDir = !!(cfg && cfg.allowEmptyRemoteDir);
  var probeOnly = !!(cfg && cfg.probeOnly);
  var ready = probeOnly
    ? !!(cfg.host && cfg.user && cfg.password)
    : (allowEmptyDir ? isSiteConfigured(cfg) : isConfigured(cfg));
  if (!ready) {
    var isSite = !!(cfg && (cfg.siteAccount || cfg.probeOnly || cfg.allowEmptyRemoteDir));
    var missing = isSite
      ? siteFtpNotConfiguredError()
      : new Error("FTP接続設定が必要です");
    if (!isSite) missing.code = "ftp_not_configured";
    throw missing;
  }
  var ftpMod;
  try {
    ftpMod = require("basic-ftp");
  } catch (e) {
    var missingMod = new Error("FTPモジュールがありません");
    missingMod.code = "ftp_module_missing";
    throw missingMod;
  }
  var client = new ftpMod.Client(cfg.timeoutMs);
  client.ftp.verbose = false;
  await client.access({
    host: cfg.host,
    user: cfg.user,
    password: cfg.password,
    port: cfg.port,
    secure: !!cfg.secure
  });
  if (cfg.remoteDir) {
    var diaryEnter = await enterDiaryRemoteDir(client, cfg.remoteDir);
    if (!diaryEnter.ok) {
      try { client.close(); } catch (eCloseDiary) { /* ignore */ }
      var badDiary = new Error(diaryEnter.userMessage || "日記FTP先に入れません");
      badDiary.code = diaryEnter.code || "diary_remote_failed";
      throw badDiary;
    }
  }
  return {
    retr: async function (name) {
      var chunks = [];
      var ws = new Writable({
        write: function (chunk, enc, cb) {
          chunks.push(Buffer.from(chunk));
          cb();
        }
      });
      await client.downloadTo(ws, name);
      return Buffer.concat(chunks);
    },
    stor: async function (name, buf) {
      var rs = Readable.from(Buffer.from(buf));
      await client.uploadFrom(rs, name);
    },
    rename: async function (from, to) {
      await client.rename(from, to);
    },
    list: async function (dir) {
      return client.list(dir || ".");
    },
    ensureDir: async function (dir) {
      if (!dir) return;
      // basic-ftp ensureDir() cds into the folder. Never restore with CWD /
      // (Xserver chroot reports PWD=/ but CWD / often returns 550).
      var cwd = await client.pwd();
      var rel = String(dir).replace(/\\/g, "/").replace(/^\/+/, "");
      await client.ensureDir(rel);
      await restoreFtpWorkingDir({
        pwd: function () { return client.pwd(); },
        cd: function (d) { return client.cd(d); },
        cdup: function () { return client.cdup(); }
      }, cwd, relativePathDepth(rel));
    },
    remove: async function (name) {
      try {
        await client.remove(name);
      } catch (e) { /* missing is fine */ }
    },
    pwd: async function () {
      return client.pwd();
    },
    cd: async function (dir) {
      await client.cd(dir);
    },
    cdup: async function () {
      await client.cdup();
    },
    close: async function () {
      client.close();
    }
  };
}

async function connectLoginOnlyFromEnv() {
  var cfg = getSiteFtpConfig();
  if (!hasSiteFtpCredentials(cfg)) {
    throw siteFtpNotConfiguredError();
  }
  cfg.remoteDir = "";
  cfg.allowEmptyRemoteDir = true;
  cfg.probeOnly = true;
  cfg.siteAccount = true;
  return connectFromEnv(cfg);
}

/**
 * After login: pwd/list first, then cd. Never STOR/rename/remove here.
 * On ftp_cwd_550, return the pre-cd diagnostic and stop.
 */
async function enterSiteCwdAfterLoginProbe(ftp, requestedCwd) {
  var siteFtpProbe = require("./site-ftp-probe");
  var sitePublishLog = require("./site-publish-log");
  var diagnostic = null;
  try {
    diagnostic = await siteFtpProbe.probeLoginLayout(ftp);
  } catch (eProbe) {
    diagnostic = null;
  }
  var safe = siteFtpProbe.safeDiagnostic(diagnostic);
  var pwdBefore = siteFtpProbe.sanitizePwd(
    (safe && safe.loginPwd) || ""
  );
  if (!pwdBefore && ftp && typeof ftp.pwd === "function") {
    try {
      pwdBefore = siteFtpProbe.sanitizePwd(await ftp.pwd());
    } catch (ePwdBefore) {
      pwdBefore = "";
    }
  }
  var entered = await siteFtpPaths.enterSiteFtpCwd(ftp, requestedCwd, {
    rootDirs: safe && safe.rootDirs ? safe.rootDirs : null
  });
  var pwdAfter = "";
  if (ftp && typeof ftp.pwd === "function") {
    try {
      pwdAfter = siteFtpProbe.sanitizePwd(await ftp.pwd());
    } catch (ePwdAfter) {
      pwdAfter = "";
    }
  }
  entered.pwdBeforeCwd = pwdBefore || null;
  entered.pwdAfterCwd = pwdAfter || null;
  entered.selectedMode = entered.loginRoot ? "loginRoot" : "publicHtmlCwd";
  if (entered.ok) {
    sitePublishLog.logEvent({
      stage: "site-ftp-enter-cwd",
      ftpCwd: entered.cwd || requestedCwd || null,
      pwdBeforeCwd: entered.pwdBeforeCwd,
      pwdAfterCwd: entered.pwdAfterCwd,
      selectedMode: entered.selectedMode,
      skippedCd: !!entered.skippedCd
    });
    return entered;
  }
  sitePublishLog.logEvent({
    stage: "site-ftp-enter-cwd-failed",
    reasonCode: entered.code || "ftp_cwd_failed",
    ftpCwd: entered.ftpCwd || requestedCwd || null,
    pwdBeforeCwd: entered.pwdBeforeCwd,
    pwdAfterCwd: entered.pwdAfterCwd,
    selectedMode: entered.selectedMode
  });
  if (entered.code === "ftp_cwd_550") {
    siteFtpProbe.logCwd550({
      requestedCwd: entered.ftpCwd || requestedCwd,
      diagnostic: safe || diagnostic
    });
  }
  entered.diagnostic = safe;
  return entered;
}

async function connectSiteFromEnv() {
  var cfg = getSiteFtpConfig();
  if (!hasSiteFtpCredentials(cfg)) {
    throw siteFtpNotConfiguredError();
  }
  var root = siteFtpPaths.validateSiteRoot(siteFtpPaths.readConfiguredSiteRoot());
  if (!root.ok) {
    var missingRoot = new Error(root.userMessage);
    missingRoot.code = root.code || "site_ftp_not_configured";
    throw missingRoot;
  }
  var cwd = siteFtpPaths.validateSiteFtpCwd(cfg.remoteDir);
  if (!cwd.ok) {
    var missingCwd = new Error(cwd.userMessage);
    missingCwd.code = cwd.code || "site_ftp_not_configured";
    throw missingCwd;
  }
  cfg.remoteDir = "";
  cfg.allowEmptyRemoteDir = true;
  var ftp = await connectFromEnv(cfg);
  var entered = await enterSiteCwdAfterLoginProbe(ftp, cwd.cwd);
  if (!entered.ok) {
    try { await ftp.close(); } catch (eClose) { /* ignore */ }
    var badCwd = new Error(entered.userMessage);
    badCwd.code = entered.code || "ftp_cwd_failed";
    if (entered.diagnostic) badCwd.diagnostic = entered.diagnostic;
    throw badCwd;
  }
  ftp.siteEnter = {
    cwd: entered.cwd,
    loginRoot: !!entered.loginRoot,
    skippedCd: !!entered.skippedCd,
    selectedMode: entered.selectedMode,
    pwdBeforeCwd: entered.pwdBeforeCwd,
    pwdAfterCwd: entered.pwdAfterCwd
  };
  return ftp;
}

module.exports = {
  getFtpConfig: getFtpConfig,
  isConfigured: isConfigured,
  getSiteFtpConfig: getSiteFtpConfig,
  hasSiteFtpCredentials: hasSiteFtpCredentials,
  isSiteConfigured: isSiteConfigured,
  createMemoryFtp: createMemoryFtp,
  connectFromEnv: connectFromEnv,
  connectLoginOnlyFromEnv: connectLoginOnlyFromEnv,
  enterSiteCwdAfterLoginProbe: enterSiteCwdAfterLoginProbe,
  connectSiteFromEnv: connectSiteFromEnv,
  enterDiaryRemoteDir: enterDiaryRemoteDir,
  restoreFtpWorkingDir: restoreFtpWorkingDir,
  ensureDirKeepingCwd: ensureDirKeepingCwd,
  relativePathDepth: relativePathDepth
};
