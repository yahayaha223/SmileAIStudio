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

function getSiteFtpConfig() {
  var diary = getFtpConfig();
  return {
    host: diary.host,
    user: diary.user,
    password: diary.password,
    port: diary.port,
    secure: diary.secure,
    timeoutMs: diary.timeoutMs,
    remoteDir: siteFtpPaths.readConfiguredSiteCwd()
  };
}

function isSiteConfigured(cfg) {
  cfg = cfg || getSiteFtpConfig();
  if (!(cfg.host && cfg.user && cfg.password)) return false;
  var logical = siteFtpPaths.validateSiteRoot(siteFtpPaths.readConfiguredSiteRoot());
  var cwd = siteFtpPaths.validateSiteFtpCwd(cfg.remoteDir || siteFtpPaths.readConfiguredSiteCwd());
  return !!(logical.ok && cwd.ok);
}

function createMemoryFtp(initialFiles) {
  var files = {};
  Object.keys(initialFiles || {}).forEach(function (k) {
    files[k] = Buffer.from(initialFiles[k]);
  });
  var ops = [];
  return {
    files: files,
    ops: ops,
    cwd: "/",
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
    list: async function () {
      ops.push({ op: "list" });
      return Object.keys(files).map(function (name) {
        return { name: name, size: files[name].length };
      });
    },
    ensureDir: async function (dir) {
      ops.push({ op: "ensureDir", dir: dir });
    },
    remove: async function (name) {
      delete files[name];
      ops.push({ op: "remove", name: name });
    },
    pwd: async function () {
      ops.push({ op: "pwd" });
      return this.cwd || "/";
    },
    cd: async function (dir) {
      var raw = String(dir || "");
      var target = raw.charAt(0) === "/"
        ? siteFtpPaths.normalizeAbs(raw)
        : siteFtpPaths.normalizeAbs((this.cwd || "/") + "/" + raw);
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
}

async function connectFromEnv(cfg) {
  cfg = cfg || getFtpConfig();
  var allowEmptyDir = !!(cfg && cfg.allowEmptyRemoteDir);
  var ready = allowEmptyDir ? isSiteConfigured(cfg) : isConfigured(cfg);
  if (!ready) {
    var missing = new Error("FTP接続設定が必要です");
    missing.code = "ftp_not_configured";
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
    await client.cd(cfg.remoteDir);
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
      // basic-ftp ensureDir() cds into the created folder; restore CWD.
      var cwd = await client.pwd();
      await client.ensureDir(dir);
      await client.cd(cwd);
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
    close: async function () {
      client.close();
    }
  };
}

async function connectSiteFromEnv() {
  var cfg = getSiteFtpConfig();
  var root = siteFtpPaths.validateSiteRoot(siteFtpPaths.readConfiguredSiteRoot());
  if (!root.ok) {
    var missingRoot = new Error(root.userMessage);
    missingRoot.code = root.code || "ftp_not_configured";
    throw missingRoot;
  }
  var cwd = siteFtpPaths.validateSiteFtpCwd(cfg.remoteDir);
  if (!cwd.ok) {
    var missingCwd = new Error(cwd.userMessage);
    missingCwd.code = cwd.code || "ftp_not_configured";
    throw missingCwd;
  }
  cfg.remoteDir = "";
  cfg.allowEmptyRemoteDir = true;
  var ftp = await connectFromEnv(cfg);
  var entered = await siteFtpPaths.enterSiteFtpCwd(ftp, cwd.cwd);
  if (!entered.ok) {
    try { await ftp.close(); } catch (eClose) { /* ignore */ }
    var badCwd = new Error(entered.userMessage);
    badCwd.code = entered.code || "ftp_cwd_failed";
    throw badCwd;
  }
  return ftp;
}

module.exports = {
  getFtpConfig: getFtpConfig,
  isConfigured: isConfigured,
  getSiteFtpConfig: getSiteFtpConfig,
  isSiteConfigured: isSiteConfigured,
  createMemoryFtp: createMemoryFtp,
  connectFromEnv: connectFromEnv,
  connectSiteFromEnv: connectSiteFromEnv
};
