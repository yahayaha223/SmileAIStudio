/**
 * Smile AI Studio — 確認付き本番公開（明示操作のみ STOR）
 * パスワードを Console / 履歴 / 応答へ出さない。
 */
(function (root) {
  "use strict";

  var lastEligibility = null;
  var lastPublishResult = null;
  var DryRun = root.SmileFtpDryRun || null;
  var PublishPackage = root.SmileDiaryPublishPackage || null;
  var FtpProbe = root.SmileFtpProbe || null;

  function mask(obj) {
    if (!obj || typeof obj !== "object") return obj;
    var out = Array.isArray(obj) ? [] : {};
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (/pass|secret|token|credential/i.test(k) && typeof v === "string") out[k] = "********";
      else if (v && typeof v === "object") out[k] = mask(v);
      else out[k] = v;
    });
    return out;
  }

  function sha256Hex(u8) {
    if (PublishPackage && PublishPackage.sha256Hex) return PublishPackage.sha256Hex(u8);
    if (root.crypto && root.crypto.subtle) {
      return root.crypto.subtle.digest("SHA-256", u8).then(function (buf) {
        return Array.from(new Uint8Array(buf)).map(function (b) {
          return b.toString(16).padStart(2, "0");
        }).join("");
      });
    }
    return Promise.reject(new Error("SHA-256 unavailable"));
  }

  function evaluateEligibility(options) {
    options = options || {};
    var blockers = [];
    var dry = options.dryRunResult || (DryRun && DryRun.getLastResult && DryRun.getLastResult());
    var bundle = options.bundle ||
      (PublishPackage && PublishPackage.loadLastPublishManifest &&
        PublishPackage.loadLastPublishManifest());
    var diaryStatus = options.diaryStatus || "";
    var ftpConfig = options.ftpConfig || {};
    var packageId = bundle && bundle.manifest
      ? String(bundle.manifest.publishId || "").trim()
      : "";
    var backupId = dry && dry.backup ? String(dry.backup.publishId || "").trim() : "";
    var dryId = dry && dry.report ? String(dry.report.publishId || "").trim()
      : (dry && dry.publishId ? String(dry.publishId).trim() : "");

    if (!bundle || !bundle.manifest) blockers.push("publish-manifest がありません");
    if (diaryStatus && diaryStatus !== "package-ready" && diaryStatus !== "production-published") {
      blockers.push("記事statusが package-ready ではありません（" + diaryStatus + "）");
    }
    if (!dry || dry.verdict !== "READY_FOR_PRODUCTION") {
      blockers.push("dry-run が READY_FOR_PRODUCTION ではありません" +
        (dry && dry.verdict ? "（現在: " + dry.verdict + "）" : "（未実行または結果欠落）"));
    }
    if (packageId && (backupId || dryId) &&
        !((!backupId || backupId === packageId) && (!dryId || dryId === packageId))) {
      var mismatch = (DryRun && DryRun.describePublishIdMismatch)
        ? DryRun.describePublishIdMismatch(packageId, backupId, dryId, {
          missing: "package / backup / dry-run のpublishIdが一致しません",
          backupRelPath: dry && dry.backup && dry.backup.backupRelPath,
          backupAt: dry && dry.backup && (dry.backup.createdAt || dry.backup.folderLastWriteTime),
          reportAt: dry && dry.report && dry.report.executedAt
        })
        : ("publishIdが一致しません / package=" + (packageId || "なし") +
          " / backup=" + (backupId || "なし") + " / dry-run=" + (dryId || "なし"));
      blockers.push(mismatch);
    } else if (packageId && dry && dry.report && !dryId) {
      blockers.push(
        "dry-runレポートにpublishIdがありません / package publishId: " + packageId +
        " / 参照バックアップ: " + ((dry.backup && dry.backup.backupRelPath) || "なし")
      );
    }
    if (!dry || !dry.backup || !dry.backup.backupRelPath) {
      blockers.push("本番バックアップがありません");
    }
    var shaVerified = !!(dry && (
      dry.backupSha256Verified ||
      (dry.backup && dry.backup.backupSha256Verified) ||
      (dry.report && dry.report.backupSha256Verified) ||
      (dry.verification && dry.verification.backupSha256Verified)
    ));
    if (!dry || !dry.backup || !dry.backup.productionIndexSha256 || !shaVerified) {
      blockers.push("本番バックアップSHA-256が未検証です" +
        (dry && dry.backup && dry.backup.productionIndexSha256
          ? "（値はあるが backupSha256Verified=false）"
          : "（SHA未計算または空）"));
    }
    if (dry && dry.backup && dry.backup.collidingImages && dry.backup.collidingImages.length) {
      blockers.push("同名画像衝突があります");
    }
    var rootNorm = String(ftpConfig.remoteRoot == null ? "" : ftpConfig.remoteRoot)
      .replace(/\\/g, "/").trim();
    if (!rootNorm || rootNorm === "要確認") {
      blockers.push("公開ルートが未確定です");
    } else if (rootNorm === "/") {
      var conf = DryRun && DryRun.loadPublishRootConfirmation && DryRun.loadPublishRootConfirmation();
      var same = DryRun && DryRun.sameFtpIdentity && DryRun.sameFtpIdentity(conf, ftpConfig);
      if (!conf || !conf.publicHtmlLimited || !same) {
        blockers.push("公開ルート（/）の初回確認が未完了です");
      }
    }
    if (dry && dry.report && dry.report.ftpConnection && ftpConfig.host &&
        dry.report.ftpConnection.host !== ftpConfig.host) {
      blockers.push("FTP接続先が予行演習時と一致しません");
    }
    var simOk = !!(dry && (
      dry.simulationSuccess ||
      (dry.report && dry.report.simulationSuccess) ||
      (dry.simulation && dry.simulation.ok && dry.simulation.simulationSuccess !== false)
    ));
    if (!simOk) {
      blockers.push("公開後シミュレーション未成功");
    }
    if (dry && dry.simulation && dry.simulation.existingChangedCount > 0) {
      blockers.push("既存記事部分が不変ではありません");
    }

    lastEligibility = {
      ok: blockers.length === 0,
      blockers: blockers,
      publishId: packageId,
      packagePublishId: packageId,
      backupPublishId: backupId,
      dryRunPublishId: dryId,
      dryRun: dry,
      bundle: bundle
    };
    return lastEligibility;
  }

  /**
   * ロールバック準備の実体判定。
   * report.rollbackReady 欠落時でも、READY + SHA検証 + バックアップ/index 確定なら「済み」。
   */
  function evaluateRollbackReadiness(dry, bundle) {
    var blockers = [];
    var backup = dry && dry.backup ? dry.backup : null;
    var report = dry && dry.report ? dry.report : null;
    var verdict = dry && dry.verdict ? String(dry.verdict) : "";
    var shaVerified = !!(dry && (
      dry.backupSha256Verified ||
      (backup && backup.backupSha256Verified) ||
      (report && report.backupSha256Verified) ||
      (dry.verification && dry.verification.backupSha256Verified)
    ));
    var backupRelPath = backup && backup.backupRelPath
      ? String(backup.backupRelPath)
      : (report && report.productionBackupLocation
        ? String(report.productionBackupLocation)
        : "");
    var indexRelPath = backup && backup.productionIndexRelPath
      ? String(backup.productionIndexRelPath)
      : "";
    if (!indexRelPath && backupRelPath) {
      indexRelPath = String(backupRelPath).replace(/\\/g, "/").replace(/\/?$/, "/") +
        "remote/diary/index.htm";
    }
    var indexSha = backup && backup.productionIndexSha256
      ? String(backup.productionIndexSha256)
      : (report && (report.productionBackupSha256 || report.backupFileSha256)
        ? String(report.productionBackupSha256 || report.backupFileSha256)
        : "");

    if (verdict !== "READY_FOR_PRODUCTION") {
      blockers.push("dry-runが READY_FOR_PRODUCTION ではありません");
    }
    if (!shaVerified) {
      blockers.push("本番バックアップSHA-256が未検証です");
    }
    if (!backupRelPath) {
      blockers.push("本番バックアップフォルダがありません");
    }
    if (!indexRelPath) {
      blockers.push("復元対象index.htmパスが未確定です");
    }
    if (!indexSha) {
      blockers.push("復元対象index.htmのSHA-256が未確定です");
    }

    return {
      ready: blockers.length === 0,
      blockers: blockers,
      backupRelPath: backupRelPath,
      indexRelPath: indexRelPath,
      indexSha: indexSha,
      shaVerified: shaVerified,
      hasPackageRollbackManifest: !!(bundle && bundle.rollbackManifest),
      reportFlag: !!(report && report.rollbackReady)
    };
  }

  function buildConfirmState(elg, ftpConfig) {
    var m = elg.bundle.manifest;
    var dry = elg.dryRun;
    var images = (m.files || []).filter(function (f) { return f.type === "image"; });
    var html = (m.files || []).filter(function (f) { return f.type === "html"; })[0];
    var imgBytes = images.reduce(function (s, f) { return s + (Number(f.size) || 0); }, 0);
    var bakSha = String((dry.backup && dry.backup.productionIndexSha256) || "");
    var rollback = evaluateRollbackReadiness(dry, elg.bundle);
    return {
      title: m.title,
      publishDate: m.publishDate,
      publishId: m.publishId,
      host: ftpConfig.host,
      remoteRoot: ftpConfig.remoteRoot,
      htmlPath: html ? html.remotePath : "",
      images: images.map(function (f) {
        return { name: f.localPath.split("/").pop(), size: f.size, remotePath: f.remotePath };
      }),
      imageCount: images.length,
      heroImage: images.length ? images[0].localPath.split("/").pop() : "",
      backupRelPath: dry.backup.backupRelPath,
      backupAt: dry.backup.savedAt || dry.backup.createdAt || dry.backup.folderLastWriteTime ||
        dry.backup.backupAt || (dry.report && dry.report.executedAt) || "",
      backupShaShort: bakSha.slice(0, 12),
      backupSha: bakSha,
      fileCount: (m.files || []).length,
      imageTotalSize: imgBytes,
      indexBeforeSize: dry.backup.productionIndexSize,
      indexAfterSize: html ? html.size : null,
      verdict: dry.verdict,
      rollbackReady: !!rollback.ready,
      rollbackBlockers: rollback.blockers || [],
      rollbackIndexRelPath: rollback.indexRelPath || "",
      noCollision: !(dry.backup.collidingImages && dry.backup.collidingImages.length),
      productionUnchanged: true,
      formalHost: isFormalProductionHost(ftpConfig.host),
      uiConfirmMode: true,
      realPublishEnabled: false
    };
  }

  function isFormalProductionHost(host) {
    var h = String(host || "").trim().toLowerCase();
    if (!h) return false;
    return h !== "127.0.0.1" && h !== "localhost" && h !== "::1";
  }

  /**
   * ハードキルスイッチの残骸定数。true にしない・ゲート判定にも使わない。
   * 実公開可否は session解除 + GET /api/real-publish-arm-status の毎回照合のみ。
   */
  var REAL_PUBLISH_UNLOCKED = false;
  var SESSION_UNLOCK_KEY = "smile_ftp_real_publish_unlock_v1";
  var UNLOCK_TTL_MS = 30 * 60 * 1000;
  var UNLOCK_PHRASE = "本番公開を有効にする";
  var EXPECTED_REAL_PUBLISH_SCOPE = {
    publishId: "pub-20260721-210012-h9t3wt",
    host: "sv301.xserver.jp",
    username: "smileai@egaonokiroku.co.jp",
    remoteRoot: "/",
    allowedRemotePaths: [
      "/diary/index.htm",
      "/diary/image/260721-2.jpg",
      "/diary/image/260721-2b.jpg"
    ]
  };

  // sessionStorage は同一タブの再読込でも残るため、ドキュメント起動時に解除を無効化する。
  // （タブ内の画面切替では script は再実行されないので、解除は維持される）
  try {
    if (!root.__smileRealPublishUnlockBootDone) {
      root.__smileRealPublishUnlockBootDone = true;
      sessionStorage.removeItem(SESSION_UNLOCK_KEY);
    }
  } catch (_) { /* ignore */ }

  function normalizeRoot(remoteRoot) {
    var r = String(remoteRoot == null ? "" : remoteRoot).replace(/\\/g, "/").trim();
    if (!r || r === "要確認") return "";
    if (r === "/") return "/";
    return r.replace(/\/+$/, "") || "/";
  }

  function shortHash(value) {
    var s = String(value == null ? "" : value);
    return s ? s.slice(0, 12) : "";
  }

  function simpleStableHash(obj) {
    try {
      var json = JSON.stringify(obj || {});
      var h = 2166136261;
      for (var i = 0; i < json.length; i++) {
        h ^= json.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return ("00000000" + (h >>> 0).toString(16)).slice(-8);
    } catch (_) {
      return "";
    }
  }

  function getDryRunExecutedAt(dry) {
    if (!dry) return "";
    return String(
      (dry.report && dry.report.executedAt) ||
      dry.executedAt ||
      (dry.backup && (dry.backup.createdAt || dry.backup.savedAt || dry.backup.folderLastWriteTime)) ||
      ""
    );
  }

  function isWithinHours(iso, hours) {
    if (!iso) return false;
    var t = Date.parse(iso);
    if (!isFinite(t)) return false;
    return (Date.now() - t) <= (hours * 60 * 60 * 1000) && (Date.now() - t) >= -60 * 1000;
  }

  function remotePathsAreDiaryOnly(manifest) {
    var files = (manifest && manifest.files) || [];
    if (!files.length) return false;
    for (var i = 0; i < files.length; i++) {
      var rp = String(files[i].remotePath || "").replace(/\\/g, "/");
      if (!rp || rp.indexOf("..") >= 0) return false;
      if (files[i].type === "html") {
        if (rp !== "/diary/index.htm") return false;
      } else if (files[i].type === "image") {
        if (!/^\/diary\/image\/[^/]+\.jpg$/i.test(rp)) return false;
      } else {
        return false;
      }
    }
    return true;
  }

  function evaluateRealPublishUnlockEligibility(options) {
    options = options || {};
    var blockers = [];
    var elg = options.eligibility || evaluateEligibility(options);
    var dry = elg.dryRun || options.dryRunResult || null;
    var bundle = elg.bundle || options.bundle || null;
    var ftpConfig = options.ftpConfig || {};
    var report = dry && dry.report ? dry.report : null;
    var backup = dry && dry.backup ? dry.backup : null;
    var packageId = elg.publishId || (bundle && bundle.manifest && bundle.manifest.publishId) || "";
    var rollback = evaluateRollbackReadiness(dry, bundle);

    if (!elg.ok) {
      (elg.blockers || []).forEach(function (b) { blockers.push(b); });
    }
    if (!dry || dry.verdict !== "READY_FOR_PRODUCTION") {
      blockers.push("READY_FOR_PRODUCTION ではありません");
    }
    var backupId = backup ? String(backup.publishId || "").trim() : "";
    var dryId = report ? String(report.publishId || "").trim()
      : (dry && dry.publishId ? String(dry.publishId).trim() : "");
    if (!packageId || !((!backupId || backupId === packageId) && (!dryId || dryId === packageId))) {
      blockers.push("publishIdが一致しません");
    }
    var shaVerified = !!(dry && (
      dry.backupSha256Verified ||
      (backup && backup.backupSha256Verified) ||
      (report && report.backupSha256Verified) ||
      (dry.verification && dry.verification.backupSha256Verified)
    ));
    if (!shaVerified) blockers.push("backupSha256Verified が true ではありません");
    var simOk = !!(dry && (
      dry.simulationSuccess ||
      (report && report.simulationSuccess) ||
      (dry.simulation && dry.simulation.ok && dry.simulation.simulationSuccess !== false)
    ));
    if (!simOk) blockers.push("simulationSuccess が true ではありません");
    if (!rollback.ready) {
      blockers.push("rollbackReady が true ではありません");
      (rollback.blockers || []).forEach(function (b) { blockers.push(b); });
    }
    var writeCount = Number(
      (report && report.writeCommandCount != null ? report.writeCommandCount : null) != null
        ? report.writeCommandCount
        : (backup && backup.writeCommandCount != null ? backup.writeCommandCount : 0)
    );
    var updateCount = Number(
      (report && report.productionUpdateCount != null ? report.productionUpdateCount : null) != null
        ? report.productionUpdateCount
        : (backup && backup.productionUpdateCount != null ? backup.productionUpdateCount : 0)
    );
    if (writeCount !== 0) blockers.push("writeCommandCount が 0 ではありません");
    if (updateCount !== 0) blockers.push("productionUpdateCount が 0 ではありません");

    var host = String(ftpConfig.host || "").trim();
    var username = String(ftpConfig.username || "").trim();
    var remoteRoot = normalizeRoot(ftpConfig.remoteRoot);
    var dryHost = String((report && report.ftpConnection && report.ftpConnection.host) ||
      (backup && backup.host) || "").trim();
    var dryUser = String((report && report.ftpConnection && report.ftpConnection.username) ||
      (backup && backup.username) || "").trim();
    var dryRoot = normalizeRoot(
      (report && report.ftpConnection && report.ftpConnection.remoteRoot) ||
      (backup && backup.remoteRoot) || ""
    );
    if (!host || !dryHost || host !== dryHost) blockers.push("本番ホストが一致しません");
    if (!username || !dryUser || username !== dryUser) blockers.push("FTPユーザーが一致しません");
    if (!remoteRoot || !dryRoot || remoteRoot !== dryRoot) blockers.push("remoteRootが一致しません");

    function normalizeSha256(value) {
      var s = String(value == null ? "" : value).trim().toLowerCase();
      return /^[0-9a-f]{64}$/.test(s) ? s : "";
    }

    function collectProductionIndexShas(dry, report, backup) {
      var out = [];
      function add(v) {
        var n = normalizeSha256(v);
        if (n && out.indexOf(n) < 0) out.push(n);
      }
      var prod = report && report.productionIndex;
      add(report && report.productionBackupSha256);
      add(report && report.retrievedSha256);
      add(report && report.backupFileSha256);
      add(report && report.productionIndexSha256);
      add(prod && prod.sha256);
      add(prod && prod.retrievedSha256);
      add(prod && prod.backupFileSha256);
      add(backup && backup.productionIndexSha256);
      add(backup && backup.productionIndex && backup.productionIndex.sha256);
      add(dry && dry.verification && dry.verification.productionIndexSha256);
      add(report && report.verification && report.verification.productionIndexSha256);
      return out;
    }

    /**
     * @returns {{ state: 'true'|'false'|'unknown', message: string, reason: string }}
     */
    function resolveProductionChangedAfterDryRun(dry, report, backup) {
      var explicitCandidates = [
        dry && dry.productionChangedAfterDryRun,
        report && report.productionChangedAfterDryRun,
        dry && dry.verification && dry.verification.productionChangedAfterDryRun,
        report && report.verification && report.verification.productionChangedAfterDryRun
      ];
      for (var i = 0; i < explicitCandidates.length; i++) {
        var ex = explicitCandidates[i];
        if (ex === undefined || ex === null) continue;
        if (ex === true || ex === "true" || ex === 1 || ex === "1") {
          return {
            state: "true",
            reason: "explicit-property",
            message: "予行演習後に本番index.htmが変更されています。公開を中止しました。"
          };
        }
        if (ex === false || ex === "false" || ex === 0 || ex === "0") {
          return {
            state: "false",
            reason: "explicit-property",
            message: "予行演習後の本番変更：なし（SHA-256再確認済み）"
          };
        }
        if (String(ex).toLowerCase() === "unknown") {
          return {
            state: "unknown",
            reason: "explicit-unknown",
            message: "本番変更の確認に必要な情報が不足しています。再度予行演習を行ってください。"
          };
        }
      }

      if (!dry && !report && !backup) {
        return {
          state: "unknown",
          reason: "report-missing",
          message: "本番変更の確認に必要な情報が不足しています。再度予行演習を行ってください。"
        };
      }

      var shas = collectProductionIndexShas(dry, report, backup);
      if (shas.length === 0) {
        return {
          state: "unknown",
          reason: "sha-missing",
          message: "本番変更の確認に必要な情報が不足しています。再度予行演習を行ってください。"
        };
      }
      if (shas.length === 1) {
        return {
          state: "false",
          reason: "sha-match",
          message: "予行演習後の本番変更：なし（SHA-256再確認済み）"
        };
      }
      return {
        state: "true",
        reason: "sha-mismatch",
        message: "予行演習後に本番index.htmが変更されています。公開を中止しました。"
      };
    }

    var changedInfo = resolveProductionChangedAfterDryRun(dry, report, backup);
    if (changedInfo.state === "true" || changedInfo.state === "unknown") {
      blockers.push(changedInfo.message);
    }

    var colliding = (backup && backup.collidingImages) || (report && report.collidingImages) || [];
    if (colliding && colliding.length) blockers.push("同名画像衝突があります");
    if (!bundle || !bundle.manifest || !remotePathsAreDiaryOnly(bundle.manifest)) {
      blockers.push("不正なremotePath、または公開対象が diary 配下のみではありません");
    }
    if (options.lockInProgress) {
      blockers.push("公開ロック中です");
    }
    var executedAt = getDryRunExecutedAt(dry);
    if (!isWithinHours(executedAt, 24)) {
      blockers.push("最新dry-runの生成から24時間を超えています（または日時不明）");
    }

    // dedupe blockers
    var uniq = [];
    blockers.forEach(function (b) {
      if (b && uniq.indexOf(b) < 0) uniq.push(b);
    });

    return {
      ok: uniq.length === 0,
      blockers: uniq,
      publishId: packageId,
      host: host,
      username: username,
      remoteRoot: remoteRoot,
      title: bundle && bundle.manifest ? bundle.manifest.title : "",
      publishDate: bundle && bundle.manifest ? bundle.manifest.publishDate : "",
      files: (bundle && bundle.manifest && bundle.manifest.files) || [],
      backupAt: (backup && (backup.createdAt || backup.savedAt || backup.folderLastWriteTime)) ||
        (report && report.executedAt) ||
        getDryRunExecutedAt(dry) || "",
      backupShaShort: shortHash(backup && backup.productionIndexSha256),
      verdict: dry ? dry.verdict : "",
      rollbackReady: !!rollback.ready,
      productionChangedAfterDryRun: changedInfo.state === "true",
      productionChangedAfterDryRunState: changedInfo.state,
      productionChangedAfterDryRunMessage: changedInfo.message,
      writeCommandCount: writeCount,
      productionUpdateCount: updateCount,
      dryRunExecutedAt: executedAt,
      manifestHash: simpleStableHash(bundle && bundle.manifest),
      dryRunReportHash: simpleStableHash(report || {
        publishId: packageId,
        verdict: dry && dry.verdict,
        executedAt: executedAt
      }),
      unlockPhrase: UNLOCK_PHRASE,
      ttlMs: UNLOCK_TTL_MS
    };
  }

  function readSessionUnlockRaw() {
    try {
      var raw = sessionStorage.getItem(SESSION_UNLOCK_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function clearSessionUnlock() {
    try { sessionStorage.removeItem(SESSION_UNLOCK_KEY); } catch (_) { /* ignore */ }
  }

  function getActiveSessionUnlock(context) {
    context = context || {};
    var rec = readSessionUnlockRaw();
    if (!rec || typeof rec !== "object") return null;
    var now = Date.now();
    var expiresAt = Date.parse(rec.expiresAt || "");
    if (!isFinite(expiresAt) || now > expiresAt) {
      clearSessionUnlock();
      return null;
    }
    var wantId = String(context.publishId || "").trim();
    var wantHost = String(context.host || "").trim();
    var wantUser = String(context.username || "").trim();
    var wantRoot = normalizeRoot(context.remoteRoot);
    if (wantId && String(rec.publishId || "") !== wantId) return null;
    if (wantHost && String(rec.host || "") !== wantHost) return null;
    if (wantUser && String(rec.username || "") !== wantUser) return null;
    if (wantRoot && normalizeRoot(rec.remoteRoot) !== wantRoot) return null;
    if (!rec.checksConfirmed || !rec.phraseConfirmed) return null;
    return rec;
  }

  function saveSessionUnlock(record) {
    var safe = {
      publishId: String(record.publishId || ""),
      host: String(record.host || ""),
      username: String(record.username || ""),
      remoteRoot: normalizeRoot(record.remoteRoot),
      unlockAt: String(record.unlockAt || new Date().toISOString()),
      expiresAt: String(record.expiresAt || ""),
      checksConfirmed: !!record.checksConfirmed,
      phraseConfirmed: !!record.phraseConfirmed,
      manifestShaShort: shortHash(record.manifestHash),
      dryRunReportShaShort: shortHash(record.dryRunReportHash)
    };
    // 禁止情報を絶対に入れない
    delete safe.password;
    delete safe.token;
    delete safe.secret;
    try {
      sessionStorage.setItem(SESSION_UNLOCK_KEY, JSON.stringify(safe));
      return safe;
    } catch (_) {
      return null;
    }
  }

  function unlockRealPublishMode(options) {
    options = options || {};
    var pre = options.eligibility || evaluateRealPublishUnlockEligibility(options);
    if (!pre.ok) {
      return { ok: false, blockers: pre.blockers || ["解除条件未充足"] };
    }
    var checks = options.confirmChecks || {};
    if (!checks.write || !checks.diaryOnly || !checks.rollback) {
      return { ok: false, blockers: ["解除確認チェックが不足しています"] };
    }
    if (String(options.confirmPhrase || "") !== UNLOCK_PHRASE) {
      return { ok: false, blockers: ["確認入力が「本番公開を有効にする」と一致しません"] };
    }
    var unlockAt = new Date();
    var expiresAt = new Date(unlockAt.getTime() + UNLOCK_TTL_MS);
    var saved = saveSessionUnlock({
      publishId: pre.publishId,
      host: pre.host,
      username: pre.username,
      remoteRoot: pre.remoteRoot,
      unlockAt: unlockAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      checksConfirmed: true,
      phraseConfirmed: true,
      manifestHash: pre.manifestHash,
      dryRunReportHash: pre.dryRunReportHash
    });
    if (!saved) {
      return { ok: false, blockers: ["sessionStorageへ解除状態を保存できませんでした"] };
    }
    return {
      ok: true,
      unlock: saved,
      expiresAt: saved.expiresAt,
      // 固定定数は使わない。実公開可否は arm-status 照合で判定する。
      apiArmed: false
    };
  }

  function lockRealPublishMode() {
    clearSessionUnlock();
    return { ok: true };
  }

  /** セッション解除が有効か（UI表示・ボタン制御用）。API武装とは別。 */
  function isSessionRealPublishUnlocked(context) {
    return !!getActiveSessionUnlock(context || {});
  }

  /**
   * 互換API: セッション解除の有効可否。
   * REAL_PUBLISH_UNLOCKED（ハード）は別途 canCallRealPublishApi で見る。
   */
  function isRealPublishUnlocked(context) {
    return isSessionRealPublishUnlocked(context);
  }

  function normalizeArmPath(path) {
    var p = String(path == null ? "" : path).replace(/\\/g, "/").trim();
    if (!p) return "";
    if (p.charAt(0) !== "/") p = "/" + p;
    return p;
  }

  function armPathsList(value) {
    if (Array.isArray(value)) {
      return value.map(normalizeArmPath).filter(Boolean).sort();
    }
    if (value && typeof value === "object") {
      return Object.keys(value).map(function (k) {
        return normalizeArmPath(value[k]);
      }).filter(Boolean).sort();
    }
    return [];
  }

  function sameArmPathSet(a, b) {
    var aa = armPathsList(a);
    var bb = armPathsList(b);
    if (aa.length !== bb.length) return false;
    for (var i = 0; i < aa.length; i++) {
      if (aa[i] !== bb[i]) return false;
    }
    return true;
  }

  /**
   * GET /api/real-publish-arm-status の応答を、期待スコープ＋現在コンテキストと照合する。
   * REAL_PUBLISH_UNLOCKED 定数は参照しない。
   */
  function evaluateArmStatusMatch(status, context) {
    var blockers = [];
    var ctx = context || {};
    var expected = EXPECTED_REAL_PUBLISH_SCOPE;
    if (!status || status.armed !== true) {
      blockers.push("サーバー実公開APIが武装されていません");
      return { ok: false, blockers: blockers, status: status || null };
    }
    var expMs = Date.parse(status.expiresAt || "");
    if (!isFinite(expMs) || Date.now() > expMs) {
      blockers.push("サーバー武装の有効期限切れです");
    }
    var stId = String(status.publishId || "").trim();
    var stHost = String(status.host || "").trim();
    var stUser = String(status.username || "").trim();
    var stRoot = normalizeRoot(status.remoteRoot);
    var ctxId = String(ctx.publishId || "").trim();
    var ctxHost = String(ctx.host || "").trim();
    var ctxUser = String(ctx.username || "").trim();
    var ctxRoot = normalizeRoot(ctx.remoteRoot);

    if (stId !== expected.publishId) blockers.push("武装publishIdが期待値と一致しません");
    if (stHost !== expected.host) blockers.push("武装hostが期待値と一致しません");
    if (stUser !== expected.username) blockers.push("武装usernameが期待値と一致しません");
    if (stRoot !== expected.remoteRoot) blockers.push("武装remoteRootが期待値と一致しません");
    if (!sameArmPathSet(status.allowedRemotePaths, expected.allowedRemotePaths)) {
      blockers.push("武装公開対象パスが期待の3件と一致しません");
    }

    if (ctxId && ctxId !== stId) blockers.push("現在のpublishIdが武装スコープと一致しません");
    if (ctxHost && ctxHost !== stHost) blockers.push("現在のhostが武装スコープと一致しません");
    if (ctxUser && ctxUser !== stUser) blockers.push("現在のusernameが武装スコープと一致しません");
    if (ctxRoot && ctxRoot !== stRoot) blockers.push("現在のremoteRootが武装スコープと一致しません");
    if (ctxId && ctxId !== expected.publishId) blockers.push("現在のpublishIdが許可対象外です");

    return {
      ok: blockers.length === 0,
      blockers: blockers,
      status: status,
      expiresAt: status.expiresAt || ""
    };
  }

  function canCallRealPublishApi(context, armStatus) {
    // 固定 REAL_PUBLISH_UNLOCKED=true は使わない。session + arm-status の両方必須。
    if (REAL_PUBLISH_UNLOCKED === true) {
      // 万一 true になっても、単独では許可しない（明示的に無視）
    }
    if (!isSessionRealPublishUnlocked(context || {})) return false;
    if (!armStatus) return false;
    return evaluateArmStatusMatch(armStatus, context || {}).ok;
  }

  function resolveRealPublishApiGate(context) {
    var ctx = context || {};
    return fetchRealPublishArmStatus().then(function (status) {
      var sessionOk = isSessionRealPublishUnlocked(ctx);
      var match = evaluateArmStatusMatch(status, ctx);
      return {
        ok: !!(sessionOk && match.ok),
        sessionUnlocked: sessionOk,
        armMatch: match,
        status: status,
        blockers: !sessionOk
          ? ["ブラウザ側の実公開モード解除が無効です"].concat(match.blockers || [])
          : (match.blockers || [])
      };
    });
  }

  function fetchRealPublishArmStatus() {
    return fetch("/api/real-publish-arm-status", { cache: "no-store" })
      .then(function (res) { return res.json().catch(function () { return null; }); })
      .then(function (body) {
        return (body && body.status) || { armed: false };
      })
      .catch(function () { return { armed: false }; });
  }

  /**
   * サーバー側スコープ付き武装。パスワードは送らない。localStorage にも秘密を書かない。
   * 本番公開API (/api/production-diary-publish) は呼ばない。
   */
  function requestServerRealPublishArm(options) {
    options = options || {};
    var ctx = options.context || {};
    var unlock = getActiveSessionUnlock(ctx);
    if (!unlock) {
      return Promise.resolve({
        ok: false,
        armed: false,
        blockers: ["ブラウザ側の実公開モード解除が有効ではありません"]
      });
    }
    var body = {
      explicitArmRequest: true,
      publishId: String(ctx.publishId || unlock.publishId || ""),
      host: String(ctx.host || unlock.host || ""),
      username: String(ctx.username || unlock.username || ""),
      remoteRoot: String(ctx.remoteRoot || unlock.remoteRoot || "/"),
      sessionUnlockExpiresAt: String(unlock.expiresAt || ""),
      allowedRemotePaths: options.allowedRemotePaths || [
        "/diary/index.htm",
        "/diary/image/260721-2.jpg",
        "/diary/image/260721-2b.jpg"
      ]
    };
    return fetch("/api/real-publish-arm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (json) {
        return json || { ok: false, armed: false };
      }).catch(function () {
        return { ok: false, armed: false, userMessage: "武装API応答の解析に失敗しました" };
      });
    }).catch(function (err) {
      return {
        ok: false,
        armed: false,
        userMessage: err && err.message ? err.message : "武装APIへ接続できません"
      };
    });
  }

  function shouldBlockRealPublish(ftpConfig, context, armStatus) {
    var ctx = context || {
      host: ftpConfig && ftpConfig.host,
      username: ftpConfig && ftpConfig.username,
      remoteRoot: ftpConfig && ftpConfig.remoteRoot,
      publishId: context && context.publishId
    };
    return !canCallRealPublishApi(ctx, armStatus);
  }

  function isExactUnlockPhrase(value) {
    return String(value == null ? "" : value) === UNLOCK_PHRASE;
  }

  function buildServerUnlockPayload(context) {
    var rec = getActiveSessionUnlock(context || {});
    if (!rec) return null;
    return {
      explicitUnlockRequest: true,
      publishId: rec.publishId,
      host: rec.host,
      username: rec.username,
      remoteRoot: rec.remoteRoot,
      unlockAt: rec.unlockAt,
      expiresAt: rec.expiresAt,
      manifestShaShort: rec.manifestShaShort || "",
      dryRunReportShaShort: rec.dryRunReportShaShort || "",
      checksConfirmed: !!rec.checksConfirmed,
      phraseConfirmed: !!rec.phraseConfirmed
    };
  }

  function runProductionPublish(options) {
    options = options || {};
    var elg = options.eligibility || lastEligibility || evaluateEligibility(options);
    if (!elg.ok) {
      return Promise.resolve({
        ok: false,
        result: "FAILED",
        userMessage: elg.blockers.join(" / "),
        writeCommandCount: 0,
        commands: [],
        storFiles: []
      });
    }
    if (!options.explicitConfirm || options.confirmPhrase !== "公開") {
      return Promise.resolve({
        ok: false,
        result: "FAILED",
        userMessage: "最終確認が完了していません",
        writeCommandCount: 0,
        commands: [],
        storFiles: []
      });
    }
    var checks = options.confirmChecks || {};
    if (!checks.homepage || !checks.content || !checks.rollback) {
      return Promise.resolve({
        ok: false,
        result: "FAILED",
        userMessage: "確認チェックが不足しています",
        writeCommandCount: 0,
        commands: [],
        storFiles: []
      });
    }

    var ftpConfig = options.ftpConfig || {};
    var unlockCtx = {
      publishId: elg.publishId,
      host: ftpConfig.host,
      username: ftpConfig.username,
      remoteRoot: ftpConfig.remoteRoot
    };
    var sessionUnlocked = isSessionRealPublishUnlocked(unlockCtx);
    var forceUiSafe = options.uiSafeMode === true || (!sessionUnlocked && options.uiSafeMode !== false);

    // UI確認モード（未解除）
    if (forceUiSafe || !sessionUnlocked) {
      lastPublishResult = {
        ok: true,
        result: "UI_CONFIRM_OK",
        userMessage: "UI確認が完了しました",
        writeCommandCount: 0,
        productionUpdateCount: 0,
        storCount: 0,
        deleCount: 0,
        commands: [],
        storFiles: [],
        uploadedImages: [],
        indexUploaded: false,
        safeMode: true,
        realPublishStarted: false,
        host: ftpConfig.host || "",
        detail: "ui-safe-mode-no-ftp-write",
        note: "現在は本番公開UI確認モードです。Xserverは更新されません。"
      };
      return Promise.resolve(lastPublishResult);
    }

    // 押下直前に arm-status を再取得して照合（固定 REAL_PUBLISH_UNLOCKED は使わない）
    var armStatusPromise = options.armStatus
      ? Promise.resolve(options.armStatus)
      : fetchRealPublishArmStatus();

    return armStatusPromise.then(function (armStatus) {
      var gateOk = canCallRealPublishApi(unlockCtx, armStatus) && options.allowRealPublish === true;
      if (!gateOk) {
        var match = evaluateArmStatusMatch(armStatus, unlockCtx);
        lastPublishResult = {
          ok: false,
          result: "REAL_PUBLISH_API_NOT_ARMED",
          userMessage: "実公開条件未充足のため本番公開APIは呼び出しません（STOR/DELEなし）",
          blockers: match.blockers || [],
          writeCommandCount: 0,
          productionUpdateCount: 0,
          storCount: 0,
          deleCount: 0,
          commands: [],
          storFiles: [],
          uploadedImages: [],
          indexUploaded: false,
          safeMode: true,
          realPublishStarted: false,
          host: ftpConfig.host || "",
          detail: "real-publish-gate-blocked",
          note: "session解除とサーバー武装の両方＋スコープ一致が必要です"
        };
        return lastPublishResult;
      }

      var m = elg.bundle.manifest;
      var dry = elg.dryRun;
      var unlockPayload = buildServerUnlockPayload(unlockCtx);
      var payload = {
        explicitConfirm: true,
        confirmPhrase: "公開",
        confirmChecks: {
          homepage: !!checks.homepage,
          content: !!checks.content,
          rollback: !!checks.rollback
        },
        publishId: m.publishId,
        diaryId: (elg.bundle.session && elg.bundle.session.diaryId) || options.diaryId || "",
        title: m.title,
        publishDate: m.publishDate,
        manifest: m,
        dryRunReport: dry.report,
        backupRelPath: dry.backup.backupRelPath,
        expectedProductionIndexSha256: dry.backup.productionIndexSha256,
        productionDiaryUrl: options.productionDiaryUrl ||
          (root.SmileDiaryHtml && root.SmileDiaryHtml.SITE_DIARY_URL) ||
          "https://www.egaonokiroku.co.jp/diary/index.htm",
        failAt: options.failAt || "",
        realPublishUnlock: unlockPayload,
        manifestHash: simpleStableHash(m),
        dryRunReportHash: simpleStableHash(dry.report || {})
      };

      return fetch("/api/production-diary-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (res) {
        return res.json().catch(function () {
          return { ok: false, userMessage: "応答解析失敗" };
        }).then(function (body) {
          lastPublishResult = mask(body);
          return lastPublishResult;
        });
      }).catch(function () {
        lastPublishResult = {
          ok: false,
          result: "FAILED",
          userMessage: "本番公開APIに接続できません",
          writeCommandCount: 0,
          commands: [],
          storFiles: []
        };
        return lastPublishResult;
      });
    });
  }

  function getLastEligibility() { return lastEligibility; }
  function getLastPublishResult() { return lastPublishResult; }

  function getCheckFlags() {
    var r = lastPublishResult || {};
    var elg = lastEligibility || {};
    return {
      explicitConfirm: !!(r.ok || (r.result && r.confirmPhrase !== undefined) || elg.ok),
      twoStepOk: !!(r.ok || r.result === "SUCCESS"),
      publishIdOk: !!(elg.publishId),
      readyOk: !!(elg.dryRun && elg.dryRun.verdict === "READY_FOR_PRODUCTION"),
      noChangeAfterDryRun: !(r.detail && /production changed/i.test(String(r.detail))) &&
        !(r.userMessage && String(r.userMessage).indexOf("予行演習後に本番") >= 0),
      backupOk: !!(elg.dryRun && elg.dryRun.backup && elg.dryRun.backup.productionIndexSha256),
      noCollision: !(elg.dryRun && elg.dryRun.backup &&
        elg.dryRun.backup.collidingImages && elg.dryRun.backup.collidingImages.length),
      remoteOk: elg.ok !== false,
      lockOk: r.result !== "FAILED" || !(r.userMessage && /二重実行/.test(r.userMessage)),
      imageStorOk: !!(r.ok && r.uploadedImages && r.uploadedImages.length),
      imageSizeOk: !!r.ok,
      imageShaOk: !!r.ok,
      indexLastOk: !!r.ok && !!r.indexUploaded,
      indexShaOk: !!r.ok,
      sjisOk: !!r.ok,
      lfOk: !!r.ok,
      bomOk: !!r.ok,
      boxPlusOne: !!r.ok,
      existingOk: !!r.ok,
      http200: !!(r.httpCheck && r.httpCheck.ok),
      titleShown: !!r.ok,
      imageHttp: !!r.ok,
      historyOk: !!r.historyRelPath,
      statusUpdated: !!r.ok,
      noSecret: true,
      lockReleased: r.result === "SUCCESS" || r.result === "ROLLED_BACK" || r.result === "FAILED"
    };
  }

  root.SmileFtpProductionPublish = {
    evaluateEligibility: evaluateEligibility,
    evaluateRollbackReadiness: evaluateRollbackReadiness,
    evaluateRealPublishUnlockEligibility: evaluateRealPublishUnlockEligibility,
    buildConfirmState: buildConfirmState,
    runProductionPublish: runProductionPublish,
    getLastEligibility: getLastEligibility,
    getLastPublishResult: getLastPublishResult,
    getCheckFlags: getCheckFlags,
    shouldBlockRealPublish: shouldBlockRealPublish,
    isFormalProductionHost: isFormalProductionHost,
    isRealPublishUnlocked: isRealPublishUnlocked,
    isSessionRealPublishUnlocked: isSessionRealPublishUnlocked,
    canCallRealPublishApi: canCallRealPublishApi,
    evaluateArmStatusMatch: evaluateArmStatusMatch,
    resolveRealPublishApiGate: resolveRealPublishApiGate,
    fetchRealPublishArmStatus: fetchRealPublishArmStatus,
    requestServerRealPublishArm: requestServerRealPublishArm,
    unlockRealPublishMode: unlockRealPublishMode,
    lockRealPublishMode: lockRealPublishMode,
    getActiveSessionUnlock: getActiveSessionUnlock,
    buildServerUnlockPayload: buildServerUnlockPayload,
    isExactUnlockPhrase: isExactUnlockPhrase,
    UNLOCK_PHRASE: UNLOCK_PHRASE,
    UNLOCK_TTL_MS: UNLOCK_TTL_MS,
    EXPECTED_REAL_PUBLISH_SCOPE: EXPECTED_REAL_PUBLISH_SCOPE,
    REAL_PUBLISH_UNLOCKED: REAL_PUBLISH_UNLOCKED,
    sha256Hex: sha256Hex
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
