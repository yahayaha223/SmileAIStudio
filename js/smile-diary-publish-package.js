/**
 * Smile AI Studio — 公開パッケージ（FTPなし・Xserver未更新）
 * Browser: window.SmileDiaryPublishPackage
 *
 * 直近のローカル反映セッションから公開対象を確定し、
 * 差分検査・manifest・ZIP・rollback情報を生成する。
 */
(function (root, factory) {
  var api = factory(
    root.SmileZip || null,
    root.SmileCharset || null,
    root.SmileDiaryIndexInsert || null,
    root.SmileDiaryHtml || null
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SmileDiaryPublishPackage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Zip, Charset, IndexInsert, DiaryHtml
) {
  "use strict";

  var SESSION_KEY = "smileAIStudio_lastLocalPublishSession";
  var PACKAGE_KEY = "smileAIStudio_lastPublishPackageMeta";
  var MANIFEST_KEY = "smileAIStudio_lastPublishManifest";
  var ALLOWED_REMOTE_PREFIXES = ["/diary/"];
  var FORBIDDEN_NAME_RE = /(password|passwd|secret|token|apikey|api_key|\.env|private[_\-]?key|credential)/i;

  function nowIso() {
    return new Date().toISOString();
  }

  function stampForFolder() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, "0"); }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function publishId() {
    return "pub-" + stampForFolder() + "-" + Math.random().toString(36).slice(2, 8);
  }

  /**
   * ローカルパス → Xserver想定リモートパス
   * 本番URL: https://www.egaonokiroku.co.jp/diary/index.htm
   * ローカルミラー: CorporateSite/diary/diary/...
   */
  function mapRemotePath(localPath) {
    var p = String(localPath || "").replace(/\\/g, "/");
    if (p === "CorporateSite/diary/diary/index.htm") {
      return { remotePath: "/diary/index.htm", confirmed: true, note: "og:url / SITE_DIARY_URL と一致" };
    }
    var m = p.match(/^CorporateSite\/diary\/diary\/image\/([^/]+)$/i);
    if (m) {
      return {
        remotePath: "/diary/image/" + m[1],
        confirmed: true,
        note: "本番 diary/image 配下"
      };
    }
    return {
      remotePath: "",
      confirmed: false,
      note: "要確認（既存サイト構造から安全に特定できません）"
    };
  }

  function isRemotePathAllowed(remotePath) {
    var r = String(remotePath || "");
    if (!r || r.indexOf("..") >= 0) return false;
    if (r.charAt(0) !== "/") return false;
    return ALLOWED_REMOTE_PREFIXES.some(function (pref) {
      return r === pref.slice(0, -1) || r.indexOf(pref) === 0;
    });
  }

  function toU8(data) {
    if (!data) return new Uint8Array(0);
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return new Uint8Array(data);
  }

  function sha256Hex(bytes) {
    var u8 = toU8(bytes);
    if (typeof crypto !== "undefined" && crypto.subtle && typeof crypto.subtle.digest === "function") {
      return crypto.subtle.digest("SHA-256", u8).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return ("0" + b.toString(16)).slice(-2);
        }).join("");
      });
    }
    // Node fallback when module is required with crypto injected on root
    if (typeof require === "function") {
      try {
        var nodeCrypto = require("crypto");
        return Promise.resolve(nodeCrypto.createHash("sha256").update(Buffer.from(u8)).digest("hex"));
      } catch (e) { /* ignore */ }
    }
    return Promise.reject(new Error("SHA-256 を計算できません（Web Crypto 未対応）"));
  }

  function fetchBytes(relPath) {
    var url = "/" + String(relPath || "").replace(/^\/+/, "") + "?t=" + Date.now();
    return fetch(url, { cache: "no-store" }).then(function (res) {
      if (!res.ok) {
        throw new Error("ファイル取得失敗: " + relPath + " (HTTP " + res.status + ")");
      }
      return res.arrayBuffer().then(function (buf) {
        return toU8(buf);
      });
    });
  }

  function saveSession(session) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (e) { /* ignore */ }
    return session;
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  /**
   * ローカル反映成功直後に呼ぶセッション記録
   */
  function recordLocalPublishSession(options) {
    options = options || {};
    var result = options.result || {};
    var entry = options.entry || {};
    var preview = options.preview || {};
    var identity = (preview.prepared && preview.prepared.identity) || {};
    var dateKey = identity.dateKey ||
      (DiaryHtml && DiaryHtml.buildDateKey
        ? DiaryHtml.buildDateKey(entry.publishDate)
        : "");
    var displayNames = result.displayNames || preview.displayNames || [];
    var largeNames = result.largeNames || preview.largeNames || [];
    var imageNames = [];
    displayNames.forEach(function (n, i) {
      if (n) imageNames.push(n);
      if (largeNames[i]) imageNames.push(largeNames[i]);
    });
    // de-dupe preserve order
    var seen = {};
    imageNames = imageNames.filter(function (n) {
      if (seen[n]) return false;
      seen[n] = true;
      return true;
    });

    var session = {
      publishId: publishId(),
      createdAt: nowIso(),
      diaryId: entry.id || "",
      title: identity.title || entry.title || "",
      publishDate: identity.dotsDate || entry.publishDate || "",
      dateKey: dateKey,
      backupName: result.backupName || preview.backupName || "",
      backupPath: result.backupPath ||
        ("CorporateSite/diary/diary/" + (result.backupName || "")),
      indexLocalPath: "CorporateSite/diary/diary/index.htm",
      imageDir: "CorporateSite/diary/diary/image/",
      imageNames: imageNames,
      beforeCount: result.beforeCount != null
        ? result.beforeCount
        : (preview.prepared && preview.prepared.beforeCount),
      afterCount: result.afterCount != null
        ? result.afterCount
        : (preview.prepared && preview.prepared.afterCount),
      mode: result.mode || preview.mode || "",
      ftpExecuted: false,
      xserverUpdated: false
    };
    return saveSession(session);
  }

  function analyzeHtmlDiff(backupBytes, currentBytes) {
    if (!Charset || !IndexInsert) {
      return { ok: false, error: "文字コード/挿入モジュールがありません", warnings: [] };
    }
    var detBackup = Charset.detectEncoding(backupBytes);
    var detCurrent = Charset.detectEncoding(currentBytes);
    if (!detBackup.ok || !detCurrent.ok) {
      return { ok: false, error: "HTMLの文字コード判定に失敗", warnings: [] };
    }
    var before = detBackup.text;
    var after = detCurrent.text;
    var beforeCount = IndexInsert.countDiaryBoxes(before);
    var afterCount = IndexInsert.countDiaryBoxes(after);
    var delta = afterCount - beforeCount;
    var beforeRanges = IndexInsert.findDiaryBoxRanges(before);
    var afterRanges = IndexInsert.findDiaryBoxRanges(after);
    var existingChanged = 0;
    var warnings = [];

    if (delta !== 1) {
      warnings.push("diary-box増減が +1 ではありません（" + beforeCount + "→" + afterCount + "）");
    }
    if (afterRanges.length !== beforeRanges.length + 1) {
      return {
        ok: false,
        error: "記事構造が想定と異なります",
        warnings: warnings,
        beforeCount: beforeCount,
        afterCount: afterCount,
        delta: delta
      };
    }
    for (var i = 0; i < beforeRanges.length; i++) {
      var b = before.slice(beforeRanges[i].start, beforeRanges[i].end);
      var a = after.slice(afterRanges[i + 1].start, afterRanges[i + 1].end);
      if (b !== a) existingChanged += 1;
    }

    var added = after.slice(afterRanges[0].start, afterRanges[0].end);
    var titleMatch = added.match(/Smile AI Studio タイトル:\s*([^\n\r<]+)/);
    var dateMatch = added.match(/class=["']diary-date["']\s*>\s*([0-9]{4}\.[0-9]{2}\.[0-9]{2})/);

    var charsetOk = detCurrent.family === detBackup.family;
    var lineOk = detCurrent.lineEnding === detBackup.lineEnding && !detCurrent.lineEndingMixed;
    var bomOk = !!detCurrent.bom === !!detBackup.bom;

    var ok = existingChanged === 0 && delta === 1 && charsetOk && lineOk && bomOk;
    return {
      ok: ok,
      error: ok ? "" : (
        existingChanged > 0
          ? "既存記事部分に変更があります（" + existingChanged + "件）。公開パッケージを作成しません。"
          : (warnings[0] || "差分検査に失敗しました")
      ),
      beforeCount: beforeCount,
      afterCount: afterCount,
      delta: delta,
      addedTitle: titleMatch ? titleMatch[1].trim() : "",
      addedDate: dateMatch ? dateMatch[1] : "",
      existingChangedCount: existingChanged,
      charset: detCurrent.displayCharset || detCurrent.family,
      lineEnding: detCurrent.lineEndingLabel,
      bom: !!detCurrent.bom,
      charsetOk: charsetOk,
      lineOk: lineOk,
      bomOk: bomOk,
      warnings: warnings
    };
  }

  function buildSessionFileList(session) {
    var files = [];
    files.push({
      localPath: session.indexLocalPath,
      type: "html",
      changeType: "update",
      required: true
    });
    (session.imageNames || []).forEach(function (name) {
      files.push({
        localPath: session.imageDir + name,
        type: "image",
        changeType: "add",
        required: true,
        fileName: name
      });
    });
    return files;
  }

  function enrichFileEntries(fileSpecs) {
    return Promise.all(fileSpecs.map(function (spec) {
      return fetchBytes(spec.localPath).then(function (bytes) {
        return sha256Hex(bytes).then(function (hash) {
          var mapped = mapRemotePath(spec.localPath);
          return {
            localPath: spec.localPath,
            remotePath: mapped.remotePath,
            remoteConfirmed: mapped.confirmed,
            remoteNote: mapped.note,
            type: spec.type,
            changeType: spec.changeType,
            size: bytes.length,
            sha256: hash,
            fileName: spec.fileName || spec.localPath.split("/").pop(),
            bytes: bytes
          };
        });
      });
    }));
  }

  function runSafetyChecks(session, files, diff) {
    var blockers = [];
    var warnings = [];
    var unconfirmed = [];

    if (!session || !session.backupName) {
      blockers.push("ローカル反映セッションまたはバックアップ情報がありません");
    }
    if (!diff || !diff.ok) {
      blockers.push((diff && diff.error) || "HTML差分検査NG");
    }
    if (diff && diff.existingChangedCount > 0) {
      blockers.push("既存記事が変化しているためパッケージ作成不可");
    }

    var hasIndex = files.some(function (f) { return f.type === "html"; });
    if (!hasIndex) blockers.push("index.htm が公開対象にありません");

    files.forEach(function (f) {
      if (!f.size || f.size <= 0) blockers.push("サイズ0: " + f.localPath);
      if (!f.sha256) blockers.push("SHA-256未生成: " + f.localPath);
      if (FORBIDDEN_NAME_RE.test(f.localPath) || FORBIDDEN_NAME_RE.test(f.fileName || "")) {
        blockers.push("秘密情報らしきファイル名: " + f.localPath);
      }
      if (!f.remoteConfirmed || !f.remotePath) {
        unconfirmed.push(f.localPath + " → リモートパス要確認");
      } else if (!isRemotePathAllowed(f.remotePath)) {
        blockers.push("remotePathが許可範囲外: " + f.remotePath);
      }
      if (f.type === "image") {
        if (!/\.jpe?g$/i.test(f.fileName || "")) {
          blockers.push("JPEG以外の画像: " + f.fileName);
        }
        // JPEG magic SOI
        if (f.bytes && f.bytes.length >= 2 && !(f.bytes[0] === 0xff && f.bytes[1] === 0xd8)) {
          blockers.push("JPEGシグネチャ不正: " + f.fileName);
        }
      }
    });

    // HTML path vs images
    var htmlFile = files.filter(function (f) { return f.type === "html"; })[0];
    if (htmlFile && Charset) {
      var det = Charset.detectEncoding(htmlFile.bytes);
      if (det.ok) {
        (session.imageNames || []).forEach(function (name) {
          if (det.text.indexOf("image/" + name) < 0) {
            blockers.push("HTML内に画像パスがありません: image/" + name);
          }
        });
        if (det.family !== "shift-jis" && det.family !== "windows-31j") {
          blockers.push("文字コードが Shift_JIS/Windows-31J ではありません: " + det.family);
        }
        if (det.lineEndingLabel !== "LF" && det.lineEnding !== "\n") {
          // allow if session expected LF from CorporateSite
          if (det.lineEndingMixed) blockers.push("改行コードが混在しています");
        }
        if (det.bom) blockers.push("BOMあり（元仕様はBOMなし想定）");
      }
    }

    // exclude backups/tmp from package files (should never be in list)
    files.forEach(function (f) {
      if (/index_backup_|_tmp_publish|_verify|password|\.env/i.test(f.localPath)) {
        blockers.push("公開対象外ファイルが含まれています: " + f.localPath);
      }
    });

    // duplicate remote/local names
    var nameSet = {};
    files.forEach(function (f) {
      var key = f.remotePath || f.localPath;
      if (nameSet[key]) blockers.push("同名重複: " + key);
      nameSet[key] = true;
    });

    if (session.ftpExecuted) blockers.push("FTP実行フラグが立っています（異常）");
    if (session.xserverUpdated) blockers.push("Xserver更新フラグが立っています（異常）");

    return {
      ok: blockers.length === 0 && unconfirmed.length === 0,
      blockers: blockers,
      warnings: warnings.concat(diff && diff.warnings ? diff.warnings : []),
      unconfirmed: unconfirmed
    };
  }

  function buildManifest(session, files, diff, checks) {
    return {
      publishId: session.publishId,
      createdAt: nowIso(),
      title: session.title,
      publishDate: session.publishDate,
      dateKey: session.dateKey,
      diaryId: session.diaryId,
      ftpExecuted: false,
      xserverUpdated: false,
      note: "このパッケージ作成ではXserverへ公開されません（FTP未実行）",
      remoteBaseUrl: (DiaryHtml && DiaryHtml.SITE_DIARY_URL) ||
        "https://www.egaonokiroku.co.jp/diary/index.htm",
      diff: {
        diaryBoxBefore: diff.beforeCount,
        diaryBoxAfter: diff.afterCount,
        diaryBoxDelta: diff.delta,
        addedTitle: diff.addedTitle,
        addedDate: diff.addedDate,
        existingChangedCount: diff.existingChangedCount,
        charset: diff.charset,
        lineEnding: diff.lineEnding,
        bom: diff.bom
      },
      checks: {
        ok: checks.ok,
        blockers: checks.blockers,
        warnings: checks.warnings,
        unconfirmed: checks.unconfirmed
      },
      backup: {
        backupName: session.backupName,
        localBackupPath: session.backupPath,
        includedInZip: false
      },
      files: files.map(function (f) {
        return {
          localPath: f.localPath,
          remotePath: f.remotePath,
          remoteConfirmed: f.remoteConfirmed,
          remoteNote: f.remoteNote,
          type: f.type,
          changeType: f.changeType,
          size: f.size,
          sha256: f.sha256
        };
      })
    };
  }

  function buildRollbackManifest(session, files, diff) {
    var images = files.filter(function (f) { return f.type === "image"; });
    return {
      createdAt: nowIso(),
      publishId: session.publishId,
      title: session.title,
      publishDate: session.publishDate,
      updatedFiles: files.filter(function (f) { return f.changeType === "update"; }).map(function (f) {
        return { localPath: f.localPath, remotePath: f.remotePath, sha256: f.sha256 };
      }),
      newlyAddedImages: images.map(function (f) {
        return {
          localPath: f.localPath,
          remotePath: f.remotePath,
          fileName: f.fileName,
          sha256: f.sha256,
          actionOnRollback: "delete"
        };
      }),
      indexBackupName: session.backupName,
      indexBackupLocalPath: session.backupPath,
      indexBackupIncludedInZip: false,
      restoreOrder: [
        "1. FTPで /diary/index.htm をローカルバックアップ（" + session.backupName + "）の内容で置き換える",
        "2. 新規追加した画像ファイルを Xserver の /diary/image/ から削除する",
        "3. ブラウザで日記ページをハードリロードし、記事件数と画像表示を確認する"
      ],
      verificationHashes: files.map(function (f) {
        return { path: f.remotePath || f.localPath, sha256: f.sha256, size: f.size };
      }),
      diaryBoxExpectedAfterRestore: diff.beforeCount,
      note: "バックアップHTML本体はZIPに含めていません。ローカルの backup パスを参照してください。"
    };
  }

  function buildReadmeText(manifest, session) {
    var lines = [];
    lines.push("Smile AI Studio ホームページ公開パッケージ");
    lines.push("========================================");
    lines.push("");
    lines.push("【重要】このZIPの作成・ダウンロードでは Xserver へ公開されません。FTPも実行していません。");
    lines.push("");
    lines.push("記事タイトル: " + (manifest.title || ""));
    lines.push("公開日: " + (manifest.publishDate || ""));
    lines.push("作成日時: " + (manifest.createdAt || ""));
    lines.push("publishId: " + (manifest.publishId || ""));
    lines.push("");
    lines.push("■ 公開対象");
    (manifest.files || []).forEach(function (f) {
      lines.push("- " + f.localPath + " → " + (f.remotePath || "要確認") +
        " (" + f.changeType + ", " + f.size + " bytes)");
    });
    lines.push("");
    lines.push("■ Xserver上の想定配置先");
    lines.push("ベースURL: " + (manifest.remoteBaseUrl || ""));
    lines.push("HTML: /diary/index.htm");
    lines.push("画像: /diary/image/YYMMDD-N.jpg / YYMMDD-Nb.jpg");
    lines.push("");
    lines.push("■ 手動アップロード手順（参考）");
    lines.push("1. FTPクライアントで Xserver に接続する（本アプリからは接続しません）");
    lines.push("2. upload/diary/index.htm をサーバの /diary/index.htm へアップロード（上書き）");
    lines.push("3. upload/diary/image/ 内の新規画像のみを /diary/image/ へアップロード（既存を消さない）");
    lines.push("4. ブラウザで日記ページを確認する");
    lines.push("");
    lines.push("■ 公開前に確認するURL");
    lines.push("- ローカル: http://127.0.0.1:8765/CorporateSite/diary/diary/index.htm");
    lines.push("- 本番予定: " + (manifest.remoteBaseUrl || "https://www.egaonokiroku.co.jp/diary/index.htm"));
    lines.push("");
    lines.push("■ 本番公開後に確認する項目");
    lines.push("- 新記事が一番上に表示されること");
    lines.push("- 画像が表示・拡大できること");
    lines.push("- 文字化けがないこと");
    lines.push("- 既存記事が崩れていないこと");
    lines.push("");
    lines.push("■ 問題発生時の戻し方");
    lines.push("- backup-info/rollback-manifest.json を参照");
    lines.push("- ローカルバックアップ: " + (session.backupPath || session.backupName || ""));
    lines.push("- index.htm をバックアップ内容へ戻し、新規画像を削除");
    lines.push("");
    lines.push("■ 含めないもの");
    lines.push("FTPパスワード / Xserverログイン / GitHubトークン / 秘密鍵 / 環境変数 / IndexedDB元画像 / バックアップHTML本体");
    lines.push("");
    return lines.join("\r\n");
  }

  /**
   * 公開前プレビュー（ZIP作成前）
   */
  function preparePublishPackage(sessionOverride) {
    var session = sessionOverride || loadSession();
    if (!session) {
      return Promise.reject(new Error(
        "直近のローカル反映セッションがありません。先に「画像とHTMLをローカルへ反映」を実行してください。"
      ));
    }

    var specs = buildSessionFileList(session);
    return Promise.all([
      fetchBytes(session.backupPath).catch(function () {
        return fetchBytes("CorporateSite/diary/diary/" + session.backupName);
      }),
      fetchBytes(session.indexLocalPath),
      enrichFileEntries(specs)
    ]).then(function (pair) {
      var backupBytes = pair[0];
      var currentIndexBytes = pair[1];
      var files = pair[2];
      var diff = analyzeHtmlDiff(backupBytes, currentIndexBytes);
      var checks = runSafetyChecks(session, files, diff);
      var manifest = buildManifest(session, files, diff, checks);
      var rollback = buildRollbackManifest(session, files, diff);
      return {
        ok: checks.ok && diff.ok,
        session: session,
        files: files,
        diff: diff,
        checks: checks,
        manifest: manifest,
        rollbackManifest: rollback,
        readmeText: buildReadmeText(manifest, session),
        canCreateZip: checks.ok && diff.ok
      };
    });
  }

  function createPublishZip(preview) {
    if (!preview || !preview.canCreateZip) {
      return Promise.reject(new Error(
        (preview && preview.checks && preview.checks.blockers.join(" / ")) ||
        "安全チェック未通過のためZIPを生成しません"
      ));
    }
    if (!Zip || typeof Zip.buildZipFromEntries !== "function") {
      return Promise.reject(new Error("SmileZip がありません"));
    }
    var stamp = stampForFolder();
    var rootDir = "smile-homepage-publish-" + stamp;
    var manifest = preview.manifest;
    var rollback = preview.rollbackManifest;
    var readme = preview.readmeText;
    var entries = [];

    entries.push({
      name: rootDir + "/publish-manifest.json",
      data: JSON.stringify(manifest, null, 2)
    });
    entries.push({
      name: rootDir + "/README.txt",
      data: readme
    });
    entries.push({
      name: rootDir + "/backup-info/rollback-manifest.json",
      data: JSON.stringify(rollback, null, 2)
    });

    preview.files.forEach(function (f) {
      if (f.type === "html") {
        entries.push({
          name: rootDir + "/upload/diary/index.htm",
          data: f.bytes
        });
      } else if (f.type === "image") {
        entries.push({
          name: rootDir + "/upload/diary/image/" + f.fileName,
          data: f.bytes
        });
      }
    });

    // Final secret scan on entry names + text payloads
    var secretHit = entries.some(function (e) {
      return FORBIDDEN_NAME_RE.test(e.name) ||
        (typeof e.data === "string" && /FTP_PASSWORD|XSERVER_PASS|GITHUB_TOKEN|BEGIN RSA PRIVATE KEY/i.test(e.data));
    });
    if (secretHit) {
      return Promise.reject(new Error("秘密情報らしき内容が検出されたためZIPを生成しません"));
    }

    return Zip.buildZipFromEntries(entries).then(function (blob) {
      var meta = {
        createdAt: nowIso(),
        fileName: rootDir + ".zip",
        rootDir: rootDir,
        publishId: manifest.publishId,
        entryCount: entries.length,
        fileCount: preview.files.length,
        ftpExecuted: false,
        xserverUpdated: false
      };
      try {
        localStorage.setItem(PACKAGE_KEY, JSON.stringify(meta));
        localStorage.setItem(MANIFEST_KEY, JSON.stringify({
          savedAt: nowIso(),
          manifest: manifest,
          rollbackManifest: rollback,
          session: preview.session || null
        }));
      } catch (e) { /* ignore */ }
      return {
        ok: true,
        blob: blob,
        fileName: meta.fileName,
        meta: meta,
        manifest: manifest,
        rollbackManifest: rollback,
        readmeText: readme,
        entries: entries.map(function (e) { return e.name; })
      };
    });
  }

  function loadLastPublishManifest() {
    try {
      var raw = localStorage.getItem(MANIFEST_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function downloadBlob(fileName, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName || "publish.zip";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
    }, 2000);
    return true;
  }

  return {
    SESSION_KEY: SESSION_KEY,
    PACKAGE_KEY: PACKAGE_KEY,
    MANIFEST_KEY: MANIFEST_KEY,
    mapRemotePath: mapRemotePath,
    isRemotePathAllowed: isRemotePathAllowed,
    sha256Hex: sha256Hex,
    recordLocalPublishSession: recordLocalPublishSession,
    loadSession: loadSession,
    saveSession: saveSession,
    clearSession: clearSession,
    analyzeHtmlDiff: analyzeHtmlDiff,
    preparePublishPackage: preparePublishPackage,
    createPublishZip: createPublishZip,
    loadLastPublishManifest: loadLastPublishManifest,
    downloadBlob: downloadBlob,
    buildReadmeText: buildReadmeText,
    runSafetyChecks: runSafetyChecks
  };
});
