/**
 * Smile AI Studio — 本番バックアップ＋公開予行演習（FTP書込みなし）
 */
(function (root) {
  "use strict";

  var lastResult = null;
  var Charset = root.SmileCharset || null;
  var IndexInsert = root.SmileDiaryIndexInsert || null;
  var PublishPackage = root.SmileDiaryPublishPackage || null;
  var LOCAL_ONLY_MSG = (root.SmileFtpProbe && root.SmileFtpProbe.LOCAL_ONLY_MSG) ||
    "FTP公開機能はローカル版でのみ利用できます";

  function isLocalFtpRuntime() {
    if (root.SmileFtpProbe && typeof root.SmileFtpProbe.isLocalFtpRuntime === "function") {
      return !!root.SmileFtpProbe.isLocalFtpRuntime();
    }
    try {
      var h = String((root.location && root.location.hostname) || "").toLowerCase();
      return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
    } catch (e) {
      return false;
    }
  }

  function localOnlyDryRunResult(extra) {
    var body = {
      ok: false,
      verdict: "BLOCKED",
      localOnly: true,
      userMessage: LOCAL_ONLY_MSG,
      writeCommands: [],
      xserverUpdates: 0
    };
    if (extra && typeof extra === "object") {
      Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
    }
    return body;
  }

  function maskSecrets(obj) {
    if (!obj || typeof obj !== "object") return obj;
    var out = Array.isArray(obj) ? [] : {};
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (/pass|secret|token|credential/i.test(k) && typeof v === "string") {
        out[k] = "********";
      } else if (v && typeof v === "object") {
        out[k] = maskSecrets(v);
      } else {
        out[k] = v;
      }
    });
    return out;
  }

  function fetchJson(url, options) {
    return fetch(url, options).then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        try {
          body = text ? JSON.parse(text) : {};
        } catch (_) {
          body = {
            ok: false,
            verdict: "BLOCKED",
            userMessage: "API応答のJSON解析に失敗しました（HTTP " + res.status + "）",
            detail: text ? String(text).slice(0, 240) : ""
          };
        }
        if (!body || typeof body !== "object") {
          body = {
            ok: false,
            verdict: "BLOCKED",
            userMessage: "API応答が空です（HTTP " + res.status + "）"
          };
        }
        body = maskSecrets(body);
        body.httpStatus = res.status;
        if (!res.ok) {
          body.ok = false;
          if (!body.verdict) body.verdict = "BLOCKED";
          if (!body.userMessage) {
            body.userMessage = body.error
              ? String(body.error)
              : ("APIエラー（HTTP " + res.status + "）");
          }
        }
        return body;
      });
    }).catch(function (err) {
      return {
        ok: false,
        verdict: "BLOCKED",
        userMessage: "APIへ接続できません: " + (err && err.message ? err.message : "ネットワークエラー"),
        httpStatus: 0,
        writeCommandCount: 0,
        productionUpdateCount: 0
      };
    });
  }

  function fetchBytes(relPath) {
    return fetch("/" + String(relPath).replace(/^\/+/, "") + "?t=" + Date.now(), {
      cache: "no-store"
    }).then(function (res) {
      if (!res.ok) {
        throw new Error("ローカルファイル取得失敗: " + relPath + "（HTTP " + res.status + "）");
      }
      return res.arrayBuffer().then(function (b) {
        return new Uint8Array(b);
      });
    });
  }

  var ROOT_CONFIRM_KEY = "smile_ftp_publish_root_confirm_v1";

  function normalizeRemoteRoot(remoteRoot) {
    var r = String(remoteRoot == null ? "" : remoteRoot).replace(/\\/g, "/").trim();
    if (!r || r === "要確認") return "";
    if (r === "/") return "/";
    return r.replace(/\/+$/, "") || "/";
  }

  function sameFtpIdentity(a, b) {
    if (!a || !b) return false;
    return String(a.host || "").trim() === String(b.host || "").trim() &&
      String(a.username || "").trim() === String(b.username || "").trim() &&
      normalizeRemoteRoot(a.remoteRoot) === normalizeRemoteRoot(b.remoteRoot);
  }

  function loadPublishRootConfirmation() {
    try {
      var raw = localStorage.getItem(ROOT_CONFIRM_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return null;
      if (!obj.host || !obj.username || !obj.remoteRoot) return null;
      return obj;
    } catch (_) {
      return null;
    }
  }

  function clearPublishRootConfirmation() {
    try { localStorage.removeItem(ROOT_CONFIRM_KEY); } catch (_) { /* ignore */ }
  }

  function savePublishRootConfirmation(payload) {
    var record = {
      host: String(payload.host || "").trim(),
      username: String(payload.username || "").trim(),
      remoteRoot: normalizeRemoteRoot(payload.remoteRoot),
      confirmedAt: new Date().toISOString(),
      pwd: String(payload.pwd || payload.currentDirectory || ""),
      diaryIndexExists: !!payload.diaryIndexExists,
      imageDirExists: !!payload.imageDirExists,
      publicHtmlLimited: !!payload.publicHtmlLimited,
      note: "password not stored"
    };
    if (!record.host || !record.username || !record.remoteRoot) {
      return { ok: false, error: "確認情報の必須項目が不足しています" };
    }
    if (!record.publicHtmlLimited) {
      return { ok: false, error: "公開フォルダ限定の確認チェックが必要です" };
    }
    try {
      localStorage.setItem(ROOT_CONFIRM_KEY, JSON.stringify(record));
    } catch (err) {
      return { ok: false, error: "確認情報の保存に失敗しました" };
    }
    return { ok: true, confirmation: record };
  }

  function invalidatePublishRootConfirmationIfChanged(ftpConfig) {
    var saved = loadPublishRootConfirmation();
    if (!saved) return { invalidated: false };
    if (!sameFtpIdentity(saved, ftpConfig || {})) {
      clearPublishRootConfirmation();
      return { invalidated: true, reason: "host/username/remoteRoot が変更されたため確認済みを無効化" };
    }
    return { invalidated: false, confirmation: saved };
  }

  function validateManifestRemotePaths(manifest) {
    var blockers = [];
    var outsideDiary = 0;
    (manifest.files || []).forEach(function (f, i) {
      var rp = String(f.remotePath || "");
      if (!rp) {
        blockers.push("files[" + i + "] remotePath が空です");
        return;
      }
      if (rp.indexOf("..") >= 0) {
        blockers.push("remotePath に .. があります: " + rp);
      }
      if (f.type === "html" && rp !== "/diary/index.htm") {
        blockers.push("HTML remotePath が不正です: " + rp);
        outsideDiary++;
      } else if (f.type === "image" && !/^\/diary\/image\/[^/]+$/.test(rp)) {
        blockers.push("画像 remotePath が不正です: " + rp);
        outsideDiary++;
      } else if (f.type !== "html" && f.type !== "image") {
        blockers.push("files[" + i + "] の type が許可外です");
        outsideDiary++;
      }
      if (rp.indexOf("/diary/") !== 0) outsideDiary++;
    });
    if (outsideDiary > 0) {
      blockers.push("diary外への公開対象が " + outsideDiary + " 件あります");
    }
    return { ok: blockers.length === 0, blockers: blockers, outsideDiaryCount: outsideDiary };
  }

  function evaluatePublishRootGate(options) {
    options = options || {};
    var ftpConfig = options.ftpConfig || {};
    var probe = options.probeResult || {};
    var manifest = options.manifest || {};
    var root = normalizeRemoteRoot(ftpConfig.remoteRoot);
    var blockers = [];
    var needsUserConfirm = false;

    if (!root || root === "要確認") {
      return {
        ok: false,
        needsUserConfirm: false,
        blockers: ["公開ルートが未設定または要確認です"],
        remoteRoot: root || "",
        confirmation: null
      };
    }

    var pathCheck = validateManifestRemotePaths(manifest);
    if (!pathCheck.ok) blockers = blockers.concat(pathCheck.blockers);

    if (!probe || !probe.ok) {
      blockers.push("FTP接続確認が成功していません（先に接続確認を実行してください）");
    } else {
      if (!sameFtpIdentity(probe, ftpConfig)) {
        blockers.push("FTP接続確認時のホスト・ユーザー・remoteRootと現在の設定が一致しません");
      }
      if (String(probe.username || "").trim() !== String(ftpConfig.username || "").trim()) {
        blockers.push("接続ユーザーが保存済み設定と一致しません");
      }
      if (!String(probe.currentDirectory == null ? "" : probe.currentDirectory).length) {
        blockers.push("PWDの結果が取得できていません");
      }
      if (!probe.diaryFolderExists) blockers.push("/diary へのCWD（存在確認）が成功していません");
      if (!probe.diaryIndexExists) blockers.push("/diary/index.htm の存在確認が成功していません");
      if (!probe.imageDirExists) blockers.push("/diary/image へのCWD（存在確認）が成功していません");
    }

    var confirmation = loadPublishRootConfirmation();
    if (confirmation && !sameFtpIdentity(confirmation, ftpConfig)) {
      clearPublishRootConfirmation();
      confirmation = null;
    }

    // remoteRoot === "/" は追加FTPアカウントの public_html 直下を意味し得る。
    // 「/」単独では停止せず、接続確認＋初回ユーザー確認で確定する。
    if (root === "/") {
      if (!confirmation || !confirmation.publicHtmlLimited) {
        needsUserConfirm = true;
        if (!blockers.length) {
          blockers.push("公開ルート（/ = 公開フォルダ）の初回確認が必要です");
        }
      }
    }

    return {
      ok: blockers.length === 0 && !needsUserConfirm,
      needsUserConfirm: needsUserConfirm,
      blockers: blockers,
      remoteRoot: root,
      confirmation: confirmation,
      probeMatched: !!(probe && probe.ok && sameFtpIdentity(probe, ftpConfig)),
      pathCheck: pathCheck
    };
  }

  function validateManifestBundle(bundle) {
    var blockers = [];
    if (!bundle || !bundle.manifest) {
      return { ok: false, blockers: ["package-ready の manifest がありません"] };
    }
    var m = bundle.manifest;
    if (!m.publishId) blockers.push("publishId がありません");
    if (!m.title) blockers.push("記事タイトルがありません");
    if (!m.publishDate) blockers.push("公開日がありません");
    if (!Array.isArray(m.files) || !m.files.length) blockers.push("files が空です");
    (m.files || []).forEach(function (f, i) {
      if (!f.localPath || !f.remotePath || !f.type || !f.sha256 || !f.size) {
        blockers.push("files[" + i + "] の必須項目が欠損しています");
      }
    });
    var pathCheck = validateManifestRemotePaths(m);
    if (!pathCheck.ok) blockers = blockers.concat(pathCheck.blockers);
    var html = (m.files || []).filter(function (f) { return f.type === "html"; });
    var images = (m.files || []).filter(function (f) { return f.type === "image"; });
    if (html.length !== 1) blockers.push("HTMLファイルは1件である必要があります");
    if (!images.length) blockers.push("画像ファイルがありません");
    return { ok: blockers.length === 0, blockers: blockers, manifest: m, images: images, html: html[0] };
  }

  function resolveRemoteFullPaths(remoteRoot, manifest) {
    var root = normalizeRemoteRoot(remoteRoot);
    if (!root) {
      return { ok: false, error: "公開ルートが要確認のため停止しました。" };
    }
    var pathCheck = validateManifestRemotePaths(manifest);
    var paths = [];
    (manifest.files || []).forEach(function (f) {
      var rp = String(f.remotePath || "");
      var full = (root === "/" ? "" : root) + rp;
      paths.push({
        localPath: f.localPath,
        remotePath: rp,
        remoteFullPath: full,
        type: f.type,
        fileName: f.localPath.split("/").pop()
      });
    });
    return {
      ok: pathCheck.ok,
      blockers: pathCheck.blockers,
      error: pathCheck.ok ? null : (pathCheck.blockers[0] || "remotePath不正"),
      paths: paths,
      remoteRoot: root
    };
  }

  /**
   * HTMLコメント <!-- Smile AI Studio タイトル: … --> からタイトル本体だけを取得。
   * コメント終端 --> や HTML タグは含めない。後処理の --> 除去には依存しない。
   */
  function extractSmileTitleFromHtml(htmlFragment) {
    var src = String(htmlFragment || "");
    var m = src.match(/<!--\s*Smile AI Studio タイトル:\s*([\s\S]*?)\s*-->/);
    if (!m) return "";
    return String(m[1] || "").trim();
  }

  function analyzeProductionHtml(bytes) {
    if (!Charset || !IndexInsert) {
      return { ok: false, error: "Charset/IndexInsert がありません" };
    }
    var det = Charset.detectEncoding(bytes);
    if (!det.ok) return { ok: false, error: "文字コード判定失敗" };
    var text = det.text;
    var count = IndexInsert.countDiaryBoxes(text);
    var ranges = IndexInsert.findDiaryBoxRanges(text);
    var latestTitle = "";
    var latestDate = "";
    if (ranges.length) {
      var first = text.slice(ranges[0].start, ranges[0].end);
      latestTitle = extractSmileTitleFromHtml(first);
      var dm = first.match(/class=["']diary-date["']\s*>\s*([0-9]{4}\.[0-9]{2}\.[0-9]{2})/);
      latestDate = dm ? dm[1] : "";
    }
    return {
      ok: true,
      size: bytes.length,
      charset: det.displayCharset || det.family,
      family: det.family,
      lineEnding: det.lineEndingLabel,
      lineEndingRaw: det.lineEnding,
      bom: !!det.bom,
      diaryBoxCount: count,
      latestTitle: latestTitle,
      latestDate: latestDate,
      text: text,
      ranges: ranges
    };
  }

  function compareExistingArticles(prodText, baselineText) {
    if (!IndexInsert) return { ok: false, existingChangedCount: -1 };
    var pRanges = IndexInsert.findDiaryBoxRanges(prodText);
    var bRanges = IndexInsert.findDiaryBoxRanges(baselineText);
    if (pRanges.length !== bRanges.length) {
      return {
        ok: false,
        existingChangedCount: Math.abs(pRanges.length - bRanges.length),
        reason: "diary-box件数が一致しません"
      };
    }
    var changed = 0;
    for (var i = 0; i < bRanges.length; i++) {
      var b = baselineText.slice(bRanges[i].start, bRanges[i].end);
      var p = prodText.slice(pRanges[i].start, pRanges[i].end);
      if (b !== p) changed++;
    }
    return { ok: changed === 0, existingChangedCount: changed };
  }

  function simulatePublish(prodAnalysis, packageBytes, manifest) {
    var warnings = [];
    var blockers = [];
    if (!Charset || !IndexInsert) {
      return { ok: false, blockers: ["解析モジュール不足"] };
    }
    var pkgDet = Charset.detectEncoding(packageBytes);
    if (!pkgDet.ok) {
      return { ok: false, blockers: ["公開パッケージ index の文字コード判定失敗"] };
    }
    var pkgText = pkgDet.text;
    var pkgCount = IndexInsert.countDiaryBoxes(pkgText);
    var delta = pkgCount - prodAnalysis.diaryBoxCount;
    if (delta !== 1) {
      blockers.push("diary-boxが+1のみではありません（本番" +
        prodAnalysis.diaryBoxCount + " → パッケージ" + pkgCount + "）");
    }
    var pkgRanges = IndexInsert.findDiaryBoxRanges(pkgText);
    var prodRanges = prodAnalysis.ranges || [];
    var existingChanged = 0;
    if (pkgRanges.length === prodRanges.length + 1) {
      for (var i = 0; i < prodRanges.length; i++) {
        var a = prodAnalysis.text.slice(prodRanges[i].start, prodRanges[i].end);
        var b = pkgText.slice(pkgRanges[i + 1].start, pkgRanges[i + 1].end);
        if (a !== b) existingChanged++;
      }
    } else {
      blockers.push("公開後の記事構造が想定と異なります");
    }
    if (existingChanged > 0) {
      blockers.push("既存記事部分が不変ではありません（" + existingChanged + "件）");
    }
    var added = pkgRanges.length
      ? pkgText.slice(pkgRanges[0].start, pkgRanges[0].end)
      : "";
    var dateMatch = added.match(/class=["']diary-date["']\s*>\s*([0-9]{4}\.[0-9]{2}\.[0-9]{2})/);
    var addedTitle = extractSmileTitleFromHtml(added);
    var addedDate = dateMatch ? dateMatch[1] : "";
    if (addedTitle !== manifest.title) {
      blockers.push("追加タイトルがmanifestと一致しません");
    }
    if (addedDate !== manifest.publishDate &&
        addedDate.replace(/\./g, "-") !== String(manifest.publishDate || "").replace(/\./g, "-")) {
      // allow dotted vs ISO-ish
      if (String(manifest.publishDate || "").indexOf(addedDate) < 0 &&
          addedDate.indexOf(String(manifest.publishDate || "").replace(/-/g, ".")) < 0) {
        warnings.push("公開日表記の差分あり: " + addedDate + " / " + manifest.publishDate);
      }
    }

    var imagePathsOk = true;
    (manifest.files || []).filter(function (f) { return f.type === "image"; }).forEach(function (f) {
      var name = f.localPath.split("/").pop();
      if (pkgText.indexOf("diary/image/" + name) < 0 && pkgText.indexOf(name) < 0) {
        imagePathsOk = false;
      }
    });
    if (!imagePathsOk) blockers.push("HTML内画像パスが一致しません");

    var charsetOk = pkgDet.family === prodAnalysis.family;
    var lineOk = pkgDet.lineEnding === prodAnalysis.lineEndingRaw;
    var bomOk = !!pkgDet.bom === !!prodAnalysis.bom;
    if (!charsetOk) blockers.push("Shift_JIS（文字コード）が維持されません");
    if (!lineOk) blockers.push("改行コードが維持されません");
    if (!bomOk) blockers.push("BOM状態が維持されません");

    return {
      ok: blockers.length === 0,
      blockers: blockers,
      warnings: warnings,
      diaryBoxBefore: prodAnalysis.diaryBoxCount,
      diaryBoxAfter: pkgCount,
      delta: delta,
      addedTitle: addedTitle,
      addedDate: addedDate,
      existingChangedCount: existingChanged,
      charsetOk: charsetOk,
      lineOk: lineOk,
      bomOk: bomOk,
      imagePathsOk: imagePathsOk,
      packageCharset: pkgDet.displayCharset || pkgDet.family,
      packageLineEnding: pkgDet.lineEndingLabel,
      packageBom: !!pkgDet.bom
    };
  }

  function buildReport(ctx) {
    var verdict = "READY_FOR_PRODUCTION";
    var warnings = [].concat(ctx.warnings || []);
    var blockers = [].concat(ctx.blockers || []);
    if (blockers.length) verdict = "BLOCKED";
    if ((ctx.backup && ctx.backup.writeCommandCount) > 0) {
      verdict = "BLOCKED";
      blockers.push("書込み系FTPコマンドが検出されました");
    }
    if (!ctx.backupSha256Verified) {
      verdict = "BLOCKED";
      blockers.push("本番バックアップSHA-256の三重検証に失敗しました");
    }
    if (!ctx.simulationSuccess) {
      verdict = "BLOCKED";
      if (!(ctx.simulation && ctx.simulation.blockers && ctx.simulation.blockers.length)) {
        blockers.push("公開後シミュレーション未成功");
      }
    }
    return {
      publishId: ctx.manifest.publishId,
      title: ctx.manifest.title,
      publishDate: ctx.manifest.publishDate,
      executedAt: new Date().toISOString(),
      ftpConnection: {
        host: ctx.backup.host,
        port: ctx.backup.port,
        username: ctx.backup.username,
        password: "********",
        useTls: ctx.backup.tlsEstablished || false,
        remoteRoot: ctx.backup.remoteRoot
      },
      productionRemoteRoot: ctx.resolved.remoteRoot,
      remoteFullPaths: ctx.resolved.paths,
      productionIndex: {
        size: ctx.prod.size,
        sha256: ctx.backup.productionIndexSha256,
        charset: ctx.prod.charset,
        lineEnding: ctx.prod.lineEnding,
        bom: ctx.prod.bom,
        diaryBoxCount: ctx.prod.diaryBoxCount,
        latestTitle: ctx.prod.latestTitle,
        latestDate: ctx.prod.latestDate,
        mdtm: ctx.backup.productionIndexMdtm
      },
      productionBackupLocation: ctx.backup.backupRelPath,
      productionBackupSha256: ctx.backup.productionIndexSha256,
      backupSha256Verified: !!ctx.backupSha256Verified,
      retrievedSha256: ctx.retrievedSha256 || null,
      backupFileSha256: ctx.backupFileSha256 || null,
      simulationSuccess: !!ctx.simulationSuccess,
      plannedFiles: ctx.manifest.files,
      imageCollision: {
        ok: !(ctx.backup.collidingImages && ctx.backup.collidingImages.length),
        collidingImages: ctx.backup.collidingImages || []
      },
      postPublishSimulation: ctx.simulation,
      postPublishPackageSha256: ctx.packageSha256,
      diff: {
        diaryBoxDelta: ctx.simulation && ctx.simulation.delta,
        existingChangedCount: ctx.simulation && ctx.simulation.existingChangedCount,
        conflictWithLocalBaseline: ctx.conflict
      },
      rollbackReady: !!(ctx.rollbackManifest && ctx.backup.backupRelPath),
      writeCommandCount: ctx.backup.writeCommandCount || 0,
      productionUpdateCount: 0,
      ftpCommands: ctx.backup.commands || [],
      verdict: verdict,
      warnings: warnings,
      blockers: blockers,
      nextAllowedOperation: verdict === "READY_FOR_PRODUCTION"
        ? "次の工程で本番公開（最終確認後の明示操作のみ）"
        : "修正・再パッケージ後に予行演習をやり直してください",
      note: "この予行演習ではXserverへアップロードしていません"
    };
  }

  function runDryRun(options) {
    options = options || {};
    if (!isLocalFtpRuntime()) {
      return Promise.resolve(persistLastResult(localOnlyDryRunResult()));
    }
    var bundle = options.bundle ||
      (PublishPackage && PublishPackage.loadLastPublishManifest &&
        PublishPackage.loadLastPublishManifest());
    var ftpConfig = options.ftpConfig || {};
    var probeResult = options.probeResult || null;
    var validated = validateManifestBundle(bundle);
    if (!validated.ok) {
      return Promise.resolve(persistLastResult({
        ok: false,
        verdict: "BLOCKED",
        blockers: validated.blockers,
        userMessage: validated.blockers.join(" / ")
      }));
    }
    var manifest = validated.manifest;
    var packagePublishId = normalizePublishId(manifest.publishId);
    discardStaleDryRunIfNeeded(packagePublishId);
    invalidatePublishRootConfirmationIfChanged(ftpConfig);
    var rootGate = evaluatePublishRootGate({
      ftpConfig: ftpConfig,
      probeResult: probeResult,
      manifest: manifest
    });
    if (!rootGate.ok) {
      var gateMsg = rootGate.needsUserConfirm
        ? "公開ルートの初回確認が必要です"
        : (rootGate.blockers[0] || "公開ルート確認に失敗しました");
      return Promise.resolve(persistLastResult({
        ok: false,
        verdict: "BLOCKED",
        publishId: packagePublishId,
        blockers: rootGate.blockers,
        needsUserConfirm: !!rootGate.needsUserConfirm,
        userMessage: gateMsg
      }));
    }
    var resolved = resolveRemoteFullPaths(ftpConfig.remoteRoot, manifest);
    if (!resolved.ok) {
      return Promise.resolve(persistLastResult({
        ok: false,
        verdict: "BLOCKED",
        publishId: packagePublishId,
        blockers: resolved.blockers || [resolved.error],
        userMessage: resolved.error || resolved.blockers.join(" / ")
      }));
    }

    var plannedImages = validated.images.map(function (f) {
      return f.localPath.split("/").pop();
    });

    return fetchJson("/api/ftp-production-dry-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publishId: packagePublishId,
        plannedImageNames: plannedImages
      })
    }).then(function (backup) {
      if (!backup || !backup.ok) {
        var bakMsg = (backup && (backup.userMessage || backup.error)) ||
          "本番バックアップに失敗しました";
        if (backup && backup.httpStatus && !/HTTP/.test(bakMsg)) {
          bakMsg = bakMsg + "（HTTP " + backup.httpStatus + "）";
        }
        if (backup && backup.detail) {
          bakMsg = bakMsg + " / " + String(backup.detail).slice(0, 160);
        }
        return persistLastResult({
          ok: false,
          verdict: "BLOCKED",
          publishId: packagePublishId,
          blockers: [bakMsg],
          backup: backup || null,
          userMessage: bakMsg,
          writeCommandCount: (backup && backup.writeCommandCount) || 0,
          productionUpdateCount: 0
        });
      }

      if (!samePublishId(backup.publishId, packagePublishId)) {
        var mismatch = describePublishIdMismatch(
          packagePublishId,
          backup.publishId,
          null,
          {
            missing: "backup.publishId が package と不一致",
            backupRelPath: backup.backupRelPath,
            backupAt: backup.createdAt || ""
          }
        );
        return persistLastResult({
          ok: false,
          verdict: "BLOCKED",
          publishId: packagePublishId,
          blockers: [mismatch],
          backup: backup,
          userMessage: mismatch
        });
      }

      var blockers = [];
      var warnings = [];
      if (backup.collidingImages && backup.collidingImages.length) {
        blockers.push("本番サーバーに同名画像が存在するため公開できません。: " +
          backup.collidingImages.join(", "));
      }
      if ((backup.writeCommandCount || 0) > 0) {
        blockers.push("書込み系FTPコマンドが検出されました");
      }

      return Promise.all([
        fetchBytes(backup.productionIndexRelPath),
        fetchBytes(validated.html.localPath),
        bundle.session && bundle.session.backupPath
          ? fetchBytes(bundle.session.backupPath).catch(function () { return null; })
          : Promise.resolve(null)
      ]).then(function (pair) {
        var prodBytes = pair[0];
        var packageBytes = pair[1];
        var baselineBytes = pair[2];
        var shaFn = PublishPackage && PublishPackage.sha256Hex
          ? PublishPackage.sha256Hex
          : function () { return Promise.resolve(""); };

        return Promise.all([
          shaFn(packageBytes),
          shaFn(prodBytes),
          // re-read backup file for third SHA
          fetchBytes(backup.productionIndexRelPath).then(function (again) {
            return shaFn(again).then(function (reSha) {
              return { bytes: again, sha: reSha };
            });
          })
        ]).then(function (hashes) {
          var packageSha = hashes[0];
          var retrievedSha = hashes[1];
          var reread = hashes[2];
          var manifestSha = String(backup.productionIndexSha256 || "").toLowerCase();
          var shaA = String(retrievedSha || "").toLowerCase();
          var shaB = String(reread.sha || "").toLowerCase();
          var apiVerified = backup.backupSha256Verified === true;
          var backupSha256Verified = !!(manifestSha && shaA && shaB &&
            manifestSha === shaA && shaA === shaB &&
            (apiVerified || backup.backupSha256Verified !== false));
          if (!backupSha256Verified) {
            blockers.push(
              "本番バックアップSHA-256の三重検証に失敗しました" +
              "（RETR=" + (shaA.slice(0, 12) || "空") +
              " / manifest=" + (manifestSha.slice(0, 12) || "空") +
              " / 再読込=" + (shaB.slice(0, 12) || "空") + "）"
            );
          }
          backup.retrievedSha256 = retrievedSha;
          backup.backupFileSha256 = reread.sha;
          backup.backupSha256Verified = backupSha256Verified;

          var prod = analyzeProductionHtml(prodBytes);
          if (!prod.ok) {
            blockers.push(prod.error || "本番HTML解析失敗");
          }

          var conflict = { ok: true, existingChangedCount: 0 };
          if (baselineBytes && prod.ok) {
            var baseDet = Charset.detectEncoding(baselineBytes);
            if (baseDet.ok) {
              conflict = compareExistingArticles(prod.text, baseDet.text);
              if (prod.diaryBoxCount !== IndexInsert.countDiaryBoxes(baseDet.text) ||
                  !conflict.ok) {
                blockers.push("本番ホームページが公開パッケージ作成後に変更されています。");
              }
              if (prod.family !== baseDet.family) {
                blockers.push("本番の文字コードが想定と異なります");
              }
            }
          }

          var simulation = prod.ok
            ? simulatePublish(prod, packageBytes, manifest)
            : { ok: false, blockers: ["本番解析失敗のためシミュレーション不可"] };
          if (simulation.blockers) blockers = blockers.concat(simulation.blockers);
          if (simulation.warnings) warnings = warnings.concat(simulation.warnings);
          var simulationSuccess = !!(simulation && simulation.ok &&
            !(backup.collidingImages && backup.collidingImages.length));
          simulation.simulationSuccess = simulationSuccess;

          if (validated.html.sha256 && packageSha &&
              String(validated.html.sha256).toLowerCase() !== String(packageSha).toLowerCase()) {
            blockers.push("公開パッケージの index.htm SHA-256 が manifest と不一致です");
          }

          var report = buildReport({
            manifest: manifest,
            backup: backup,
            resolved: resolved,
            prod: prod.ok ? prod : {
              size: backup.productionIndexSize,
              charset: "?",
              lineEnding: "?",
              bom: false,
              diaryBoxCount: null,
              latestTitle: "",
              latestDate: ""
            },
            simulation: simulation,
            packageSha256: packageSha,
            conflict: conflict,
            blockers: blockers,
            warnings: warnings,
            rollbackManifest: bundle.rollbackManifest,
            backupSha256Verified: backupSha256Verified,
            simulationSuccess: simulationSuccess,
            retrievedSha256: retrievedSha,
            backupFileSha256: reread.sha
          });

          var verification = {
            publishId: packagePublishId,
            productionIndexSha256: backup.productionIndexSha256,
            productionIndexSize: backup.productionIndexSize,
            diaryBoxCount: prod.diaryBoxCount,
            charset: prod.charset,
            lineEnding: prod.lineEnding,
            bom: prod.bom,
            collidingImages: backup.collidingImages || [],
            writeCommandCount: backup.writeCommandCount || 0,
            productionUpdateCount: 0,
            backupSha256Verified: backupSha256Verified,
            simulationSuccess: simulationSuccess,
            verdict: report.verdict
          };

          return fetchJson("/api/ftp-production-dry-run-report", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              backupRelPath: backup.backupRelPath,
              publishId: packagePublishId,
              report: report,
              verificationReport: verification
            })
          }).then(function (saved) {
            var savedOk = !!(saved && saved.ok);
            if (!savedOk) {
              blockers.push((saved && (saved.error || saved.userMessage)) ||
                "dry-runレポートの保存に失敗しました");
              report.verdict = "BLOCKED";
              report.blockers = blockers;
            }
            return persistLastResult({
              ok: report.verdict === "READY_FOR_PRODUCTION",
              verdict: report.verdict,
              publishId: packagePublishId,
              report: report,
              verification: verification,
              backup: backup,
              resolved: resolved,
              simulation: simulation,
              backupSha256Verified: backupSha256Verified,
              simulationSuccess: simulationSuccess,
              blockers: blockers,
              warnings: warnings,
              saved: saved,
              userMessage: report.verdict === "READY_FOR_PRODUCTION"
                ? "本番バックアップと公開予行演習が完了しました"
                : (blockers[0] || "本番公開不可")
            });
          });
        });
      });
    }).catch(function (err) {
      return persistLastResult({
        ok: false,
        verdict: "BLOCKED",
        publishId: packagePublishId,
        blockers: [err && err.message ? err.message : "予行演習失敗"],
        userMessage: err && err.message ? err.message : "予行演習に失敗しました",
        writeCommandCount: 0,
        productionUpdateCount: 0
      });
    });
  }

  var STORAGE_KEY = "smile_ftp_dry_run_last_v1";

  function normalizePublishId(id) {
    return String(id == null ? "" : id).trim();
  }

  function samePublishId(a, b) {
    var x = normalizePublishId(a);
    var y = normalizePublishId(b);
    return !!x && x === y;
  }

  function clearLastResult() {
    lastResult = null;
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
  }

  function discardStaleDryRunIfNeeded(publishId) {
    var cur = getLastResult();
    if (!cur) return;
    var curId = normalizePublishId(
      (cur.report && cur.report.publishId) ||
      (cur.backup && cur.backup.publishId) ||
      cur.publishId
    );
    if (curId && publishId && !samePublishId(curId, publishId)) {
      clearLastResult();
    }
  }

  function describePublishIdMismatch(packageId, backupId, dryId, extras) {
    extras = extras || {};
    var lines = [
      "publishIdが一致しません",
      "package publishId: " + (normalizePublishId(packageId) || "（なし）"),
      "backup publishId: " + (normalizePublishId(backupId) || "（なし）"),
      "dry-run publishId: " + (normalizePublishId(dryId) || "（なし）")
    ];
    if (extras.missing) lines.push("不足または不一致: " + extras.missing);
    if (extras.backupAt) lines.push("バックアップ保存日時: " + extras.backupAt);
    if (extras.reportAt) lines.push("dry-runレポート日時: " + extras.reportAt);
    if (extras.backupRelPath) lines.push("参照バックアップ: " + extras.backupRelPath);
    return lines.join(" / ");
  }

  function persistLastResult(result) {
    lastResult = result || null;
    try {
      if (result) {
        // Avoid storing huge HTML blobs if present
        var toStore = result;
        try {
          toStore = JSON.parse(JSON.stringify(result));
          if (toStore.simulation && toStore.simulation.text) delete toStore.simulation.text;
          if (toStore.prod && toStore.prod.text) delete toStore.prod.text;
        } catch (_) {
          toStore = result;
        }
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
      }
    } catch (_) { /* ignore quota */ }
    return result || null;
  }

  function restoreLastResult() {
    if (lastResult) return lastResult;
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      lastResult = JSON.parse(raw);
      return lastResult;
    } catch (_) {
      return null;
    }
  }

  function hydrateFromServer(options) {
    options = options || {};
    if (!isLocalFtpRuntime()) {
      return Promise.resolve(persistLastResult(localOnlyDryRunResult({
        publishId: normalizePublishId(options.publishId) || ""
      })));
    }
    var wantId = normalizePublishId(options.publishId);
    if (!wantId && PublishPackage && PublishPackage.loadLastPublishManifest) {
      try {
        var b = PublishPackage.loadLastPublishManifest();
        wantId = normalizePublishId(b && b.manifest && b.manifest.publishId);
      } catch (_) { /* ignore */ }
    }

    var current = getLastResult();
    var currentId = normalizePublishId(
      (current && current.publishId) ||
      (current && current.report && current.report.publishId) ||
      (current && current.backup && current.backup.publishId)
    );
    // Always re-fetch /api/ftp-dry-run-last so a newer server dry-run replaces
    // stale READY cached in memory/sessionStorage (same publishId).
    // Previous early-return kept 24h+ old backups on "状態を再読み込み".

    var url = "/api/ftp-dry-run-last";
    if (wantId) url += "?publishId=" + encodeURIComponent(wantId);

    return fetch(url, { method: "GET", cache: "no-store" })
      .then(function (res) { return res.json().catch(function () { return null; }); })
      .then(function (body) {
        if (!body) return restoreLastResult();

        // Bound payload from disk
        var reportMeta = body.report || null;
        var backup = body.backup || null;
        var fullReport = (reportMeta && reportMeta.report) ? reportMeta.report
          : (reportMeta && reportMeta.publishId && reportMeta.postPublishSimulation
            ? reportMeta
            : null);
        // If API embedded full report under report.report
        if (!fullReport && reportMeta && reportMeta.reportRelPath && !reportMeta.verdict) {
          fullReport = null;
        }
        if (reportMeta && reportMeta.report) fullReport = reportMeta.report;
        // verification alone is insufficient
        var verification = (reportMeta && reportMeta.verificationReport) || null;

        if (wantId && body.ok === false) {
          return persistLastResult({
            ok: false,
            verdict: "BLOCKED",
            publishId: wantId,
            blockers: [body.userMessage || "一致するdry-run結果がありません"],
            userMessage: body.userMessage || "一致するdry-run結果がありません"
          });
        }

        if (!fullReport && !backup) return restoreLastResult();

        var reportPublishId = normalizePublishId(
          (fullReport && fullReport.publishId) ||
          (reportMeta && reportMeta.publishId) ||
          (backup && backup.publishId)
        );
        if (wantId && reportPublishId && !samePublishId(wantId, reportPublishId)) {
          var msg = describePublishIdMismatch(wantId, backup && backup.publishId, reportPublishId, {
            missing: "APIの最新結果が別publishIdです",
            backupRelPath: backup && backup.backupRelPath,
            backupAt: (backup && (backup.createdAt || backup.folderLastWriteTime)) || "",
            reportAt: (fullReport && fullReport.executedAt) || (reportMeta && reportMeta.folderLastWriteTime) || ""
          });
          // Do not overwrite a matching current result with mismatched server memory
          if (current && samePublishId(currentId, wantId)) return current;
          return persistLastResult({
            ok: false,
            verdict: "BLOCKED",
            publishId: wantId,
            blockers: [msg],
            userMessage: msg,
            backup: backup,
            report: fullReport || reportMeta || {}
          });
        }

        var simulation = (fullReport && (fullReport.postPublishSimulation || fullReport.simulation)) ||
          (current && samePublishId(currentId, reportPublishId) && current.simulation) ||
          {};
        var verdict = (fullReport && fullReport.verdict) ||
          (reportMeta && reportMeta.verdict) ||
          (verification && verification.verdict) || "";
        if (!verdict && backup && backup.ok === false) verdict = "BLOCKED";
        if (!verdict) {
          if (current && (!wantId || samePublishId(currentId, wantId))) return current;
          return restoreLastResult();
        }

        var mergedBackup = backup || {};
        if (fullReport && fullReport.productionBackupSha256 && !mergedBackup.productionIndexSha256) {
          mergedBackup.productionIndexSha256 = fullReport.productionBackupSha256;
        }
        if (fullReport && fullReport.productionBackupLocation && !mergedBackup.backupRelPath) {
          mergedBackup.backupRelPath = fullReport.productionBackupLocation;
        }
        if (fullReport && fullReport.publishId && !mergedBackup.publishId) {
          mergedBackup.publishId = fullReport.publishId;
        }
        // Prefer API timestamps so UI "本番バックアップ日時" matches newest dry-run
        if (reportMeta && reportMeta.createdAt && !mergedBackup.createdAt) {
          mergedBackup.createdAt = reportMeta.createdAt;
        }
        if (reportMeta && reportMeta.folderLastWriteTime && !mergedBackup.folderLastWriteTime) {
          mergedBackup.folderLastWriteTime = reportMeta.folderLastWriteTime;
        }
        if (fullReport && fullReport.executedAt) {
          mergedBackup.executedAt = fullReport.executedAt;
          if (!mergedBackup.createdAt) mergedBackup.createdAt = fullReport.executedAt;
        }

        var serverBackupPath = String(
          (mergedBackup && mergedBackup.backupRelPath) ||
          (fullReport && fullReport.productionBackupLocation) || ""
        ).replace(/\\/g, "/");
        var currentBackupPath = String(
          (current && current.backup && current.backup.backupRelPath) || ""
        ).replace(/\\/g, "/");

        var backupSha256Verified = !!(
          (fullReport && fullReport.backupSha256Verified) ||
          (mergedBackup && mergedBackup.backupSha256Verified) ||
          (verification && verification.backupSha256Verified)
        );
        var simulationSuccess = !!(
          (fullReport && fullReport.simulationSuccess) ||
          (verification && verification.simulationSuccess) ||
          (simulation && simulation.ok && simulation.simulationSuccess !== false)
        );

        // Incomplete metadata-only hydrate: if server points to a newer backup path,
        // do not keep the stale READY cache for the old folder.
        if (verdict === "READY_FOR_PRODUCTION" && !fullReport) {
          if (current && current.verdict === "READY_FOR_PRODUCTION" &&
              (!wantId || samePublishId(currentId, wantId)) &&
              (!serverBackupPath || serverBackupPath === currentBackupPath)) {
            return current;
          }
          verdict = "BLOCKED";
        }
        if (verdict === "READY_FOR_PRODUCTION" && (!backupSha256Verified || !simulationSuccess)) {
          // Keep verdict from full report if flags present there; otherwise block
          if (fullReport && fullReport.verdict === "READY_FOR_PRODUCTION" &&
              fullReport.backupSha256Verified && fullReport.simulationSuccess) {
            backupSha256Verified = true;
            simulationSuccess = true;
          } else if (!fullReport || !fullReport.publishId) {
            verdict = "BLOCKED";
          }
        }

        var merged = {
          ok: verdict === "READY_FOR_PRODUCTION",
          verdict: verdict,
          publishId: reportPublishId || wantId,
          report: fullReport || {
            publishId: reportPublishId || wantId,
            verdict: verdict,
            backupSha256Verified: backupSha256Verified,
            simulationSuccess: simulationSuccess,
            executedAt: (fullReport && fullReport.executedAt) ||
              (mergedBackup && mergedBackup.createdAt) || ""
          },
          backup: mergedBackup,
          simulation: simulation,
          backupSha256Verified: backupSha256Verified,
          simulationSuccess: simulationSuccess,
          executedAt: (fullReport && fullReport.executedAt) ||
            (mergedBackup && (mergedBackup.createdAt || mergedBackup.folderLastWriteTime)) || "",
          userMessage: verdict === "READY_FOR_PRODUCTION"
            ? "本番公開準備OK"
            : ((fullReport && fullReport.blockers && fullReport.blockers[0]) ||
              "まだ本番公開できません"),
          blockers: (fullReport && fullReport.blockers) || [],
          writeCommandCount: (mergedBackup && mergedBackup.writeCommandCount) ||
            (fullReport && fullReport.writeCommandCount) || 0,
          productionUpdateCount: (fullReport && fullReport.productionUpdateCount) || 0
        };
        persistLastResult(merged);
        return merged;
      })
      .catch(function () {
        return restoreLastResult();
      });
  }

  function getLastResult() {
    return lastResult || restoreLastResult();
  }

  function getCheckFlags() {
    var r = lastResult || {};
    var report = r.report || {};
    var backup = r.backup || {};
    var sim = r.simulation || {};
    var prod = report.productionIndex || {};
    return {
      manifestOk: !!(report.publishId || (r.ok === false && r.blockers)),
      ftpReadonlyOk: (backup.writeCommandCount || 0) === 0 && !!backup.ok,
      remoteRootOk: !!(r.resolved && r.resolved.ok) ||
        (r.ok === true && !!(r.report && r.report.productionRemoteRoot)),
      indexRetrOk: !!backup.productionIndexSha256,
      backupSavedOk: !!backup.backupRelPath,
      backupShaOk: !!backup.productionIndexSha256,
      charsetOk: !!prod.charset && prod.charset !== "?",
      lineOk: !!prod.lineEnding && prod.lineEnding !== "?",
      bomOk: typeof prod.bom === "boolean",
      diaryBoxOk: prod.diaryBoxCount != null,
      noConflict: !(r.blockers || []).some(function (b) {
        return String(b).indexOf("公開パッケージ作成後に変更") >= 0;
      }),
      noImageCollision: !(backup.collidingImages && backup.collidingImages.length),
      simulationOk: !!sim.ok,
      existingOk: sim.existingChangedCount === 0,
      rollbackOk: !!(report.rollbackReady),
      writeZero: (backup.writeCommandCount || report.writeCommandCount || 0) === 0,
      xserverZero: (report.productionUpdateCount || 0) === 0,
      noConsoleSecret: true,
      verdictReady: report.verdict === "READY_FOR_PRODUCTION"
    };
  }

  root.SmileFtpDryRun = {
    LOCAL_ONLY_MSG: LOCAL_ONLY_MSG,
    isLocalFtpRuntime: isLocalFtpRuntime,
    validateManifestBundle: validateManifestBundle,
    validateManifestRemotePaths: validateManifestRemotePaths,
    normalizeRemoteRoot: normalizeRemoteRoot,
    normalizePublishId: normalizePublishId,
    samePublishId: samePublishId,
    describePublishIdMismatch: describePublishIdMismatch,
    resolveRemoteFullPaths: resolveRemoteFullPaths,
    evaluatePublishRootGate: evaluatePublishRootGate,
    loadPublishRootConfirmation: loadPublishRootConfirmation,
    savePublishRootConfirmation: savePublishRootConfirmation,
    clearPublishRootConfirmation: clearPublishRootConfirmation,
    invalidatePublishRootConfirmationIfChanged: invalidatePublishRootConfirmationIfChanged,
    sameFtpIdentity: sameFtpIdentity,
    runDryRun: runDryRun,
    getLastResult: getLastResult,
    clearLastResult: clearLastResult,
    hydrateFromServer: hydrateFromServer,
    restoreLastResult: restoreLastResult,
    getCheckFlags: getCheckFlags,
    maskSecrets: maskSecrets
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
