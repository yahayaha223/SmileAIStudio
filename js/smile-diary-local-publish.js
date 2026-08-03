/**
 * Smile AI Studio — 画像＋HTML ローカル一体反映
 * Browser: window.SmileDiaryLocalPublish
 *
 * 処理順:
 * 1 記事・画像検証 → 2 既存名検査 → 3 ファイル名確定 → 4 変換
 * → 5–10 サーバ側トランザクション（一時保存→検証→indexバックアップ→挿入→正式配置）
 * 失敗時はロールバック（index復元・追加画像削除・一時削除）。IndexedDBは不変。
 */
(function (root, factory) {
  var api = factory(
    root.SmileDiaryImageExport || null,
    root.SmileDiaryHtml || null,
    root.SmileDiaryIndexInsert || null,
    root.SmileCharset || null,
    root.SmileMediaDB || null
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SmileDiaryLocalPublish = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  ImageExport, DiaryHtml, IndexInsert, Charset, MediaDB
) {
  "use strict";

  var PUBLISH_API = "/api/local-diary-publish";
  var IMAGE_DIR = "CorporateSite/diary/diary/image/";

  function sessionId() {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result || "");
        var i = s.indexOf(",");
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      reader.onerror = function () { reject(new Error("Base64変換に失敗しました")); };
      reader.readAsDataURL(blob);
    });
  }

  function collectMissingBlobs(entry, memoryItems) {
    var images = Array.isArray(entry.images) ? entry.images.slice() : [];
    images.sort(function (a, b) {
      return (Number(a && a.order) || 0) - (Number(b && b.order) || 0);
    });
    if (!images.length) {
      return Promise.resolve({ ok: true, missing: [], images: [] });
    }
    if (!ImageExport || typeof ImageExport.fetchBlobForImage !== "function") {
      return Promise.resolve({
        ok: false,
        missing: images.map(function (img, i) {
          return {
            index: i + 1,
            id: img && (img.id || img.libraryImageId),
            fileName: img && img.fileName,
            reason: "画像モジュール未読込"
          };
        }),
        images: images
      });
    }
    var missing = [];
    var chain = Promise.resolve();
    images.forEach(function (img, i) {
      chain = chain.then(function () {
        return ImageExport.fetchBlobForImage(img, memoryItems || []).then(function (got) {
          if (!got || !got.blob) {
            missing.push({
              index: i + 1,
              id: (img && (img.libraryImageId || img.id)) || "",
              fileName: (img && img.fileName) || "",
              source: (img && img.source) || "",
              storageStatus: (img && img.storageStatus) || "",
              reason: (got && got.error) || "Blobなし"
            });
          }
        });
      });
    });
    return chain.then(function () {
      return { ok: missing.length === 0, missing: missing, images: images };
    });
  }

  /**
   * 反映前プレビュー（確認画面用）
   */
  function prepareLocalPublish(options) {
    options = options || {};
    var entry = options.entry || {};
    var memoryItems = options.memoryItems || [];
    var source = options.source; // from loadCorporateIndex
    var otherEntries = options.otherEntries || [];

    if (!entry || !entry.publishDate) {
      return Promise.reject(new Error("公開日がありません"));
    }
    if (!source || !source.text || !source.detection) {
      return Promise.reject(new Error("index.htm が読み込まれていません"));
    }
    if (!ImageExport || !DiaryHtml || !IndexInsert) {
      return Promise.reject(new Error("必須モジュールが未読込です"));
    }

    return collectMissingBlobs(entry, memoryItems).then(function (blobCheck) {
      if (!blobCheck.ok) {
        var lines = blobCheck.missing.map(function (m) {
          return "#" + m.index + " id=" + (m.id || "—") +
            " file=" + (m.fileName || "—") + " (" + m.reason + ")";
        });
        var err = new Error(
          "画像データを取得できないため反映できません。\n" + lines.join("\n")
        );
        err.code = "MISSING_BLOBS";
        err.missing = blobCheck.missing;
        throw err;
      }

      var imageCount = blobCheck.images.length;
      if (imageCount === 0) {
        // HTML only path
        var article0 = DiaryHtml.generateDiaryArticleHtml(entry, { imagesOverride: [] });
        var prepared0 = IndexInsert.prepareInsert(source.text, article0.html, {
          title: article0.title || entry.title,
          dateKey: article0.dateKey,
          dotsDate: article0.dotsDate,
          detection: source.detection
        });
        return {
          ok: !!(prepared0.ok && prepared0.canPublish),
          mode: "html-only",
          entry: entry,
          imageCount: 0,
          plannedNames: [],
          displayNames: [],
          largeNames: [],
          convertFails: [],
          duplicate: prepared0.duplicate,
          alreadyReflected: !!prepared0.alreadyReflected,
          prepared: prepared0,
          exportResult: null,
          backupName: prepared0.localBackupName || IndexInsert.backupStampName(),
          imageDir: IMAGE_DIR,
          blockers: prepared0.blockers || [],
          error: prepared0.error || null
        };
      }

      return ImageExport.exportImages(entry, {
        memoryItems: memoryItems,
        otherEntries: otherEntries
      }).then(function (exportResult) {
        if (exportResult.failCount > 0) {
          var fails = (exportResult.failItems || []).map(function (f) {
            return "#" + (f.order + 1) + " " + (f.displayName || "") + ": " + (f.error || "変換失敗");
          });
          var e2 = new Error("変換不能画像があるため反映できません。\n" + fails.join("\n"));
          e2.code = "CONVERT_FAIL";
          e2.failItems = exportResult.failItems;
          throw e2;
        }

        var htmlImages = ImageExport.toHtmlImages(exportResult.okItems || []);
        var article = DiaryHtml.generateDiaryArticleHtml(entry, {
          imagesOverride: htmlImages
        });
        var prepared = IndexInsert.prepareInsert(source.text, article.html, {
          title: article.title || entry.title,
          dateKey: article.dateKey,
          dotsDate: article.dotsDate,
          detection: source.detection
        });

        // Ensure HTML paths match allocated names
        var pathIssues = [];
        (exportResult.okItems || []).forEach(function (item) {
          if (article.html.indexOf(item.displayPath) < 0) {
            pathIssues.push("通常パス不一致: " + item.displayPath);
          }
          if (article.html.indexOf(item.largePath) < 0) {
            pathIssues.push("拡大パス不一致: " + item.largePath);
          }
        });

        var displayNames = (exportResult.okItems || []).map(function (r) { return r.displayName; });
        var largeNames = (exportResult.okItems || []).map(function (r) { return r.largeName; });

        return {
          ok: !!(prepared.ok && prepared.canPublish) && pathIssues.length === 0,
          mode: "images-and-html",
          entry: entry,
          imageCount: exportResult.successCount,
          plannedNames: displayNames.concat(largeNames),
          displayNames: displayNames,
          largeNames: largeNames,
          convertFails: exportResult.failItems || [],
          pathIssues: pathIssues,
          duplicate: prepared.duplicate,
          alreadyReflected: !!prepared.alreadyReflected,
          prepared: prepared,
          exportResult: exportResult,
          articleHtml: article.html,
          backupName: prepared.localBackupName || IndexInsert.backupStampName(),
          imageDir: IMAGE_DIR,
          blockers: (prepared.blockers || []).concat(pathIssues),
          error: prepared.error || (pathIssues.length ? pathIssues.join(" / ") : null)
        };
      });
    });
  }

  /**
   * 一体反映実行
   */
  function publishLocal(preview, options) {
    options = options || {};
    if (!preview || !preview.prepared) {
      return Promise.reject(new Error("反映プレビューがありません"));
    }
    if (!preview.ok || !preview.prepared.ok || !preview.prepared.canPublish) {
      return Promise.reject(new Error(
        preview.error || (preview.blockers || []).join(" / ") || "検査NGのため反映できません"
      ));
    }
    if (preview.duplicate && preview.duplicate.isDuplicate) {
      return Promise.reject(new Error(preview.duplicate.message || "同じ記事が存在します。"));
    }

    var prepared = preview.prepared;
    var detection = prepared.detection;
    var encoded = IndexInsert.encodeForDownload(prepared.afterHtml, detection);
    if (!encoded.ok || !encoded.bytes) {
      return Promise.reject(new Error(
        (encoded.error || "再エンコード失敗") + "（UTF-8への自動切替は行いません）"
      ));
    }

    var shell = IndexInsert.verifyShellPreserved(
      prepared.beforeHtml, prepared.afterHtml, prepared.insertSnippet
    );
    if (!shell.ok) {
      return Promise.reject(new Error(shell.error || "HTML構造保全検査に失敗"));
    }

    var backupName = options.backupName || preview.backupName || IndexInsert.backupStampName();
    var sid = sessionId();
    var imagePayload = [];
    var buildImages = Promise.resolve();

    if (preview.mode === "images-and-html" && preview.exportResult) {
      buildImages = Promise.all(
        (preview.exportResult.okItems || []).map(function (item) {
          return Promise.all([
            blobToBase64(item.displayBlob),
            blobToBase64(item.largeBlob)
          ]).then(function (pair) {
            imagePayload.push({ fileName: item.displayName, base64: pair[0] });
            imagePayload.push({ fileName: item.largeName, base64: pair[1] });
          });
        })
      );
    }

    return buildImages.then(function () {
      // Prefer unified publish API (works for 0 images too)
      function bytesToBase64(u8) {
        var bytes = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
        var CHUNK = 0x8000;
        var parts = [];
        for (var i = 0; i < bytes.length; i += CHUNK) {
          parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
        }
        return btoa(parts.join(""));
      }

      var body = {
        sessionId: sid,
        backupName: backupName,
        updatedIndexBase64: bytesToBase64(encoded.bytes),
        images: imagePayload,
        expectedBeforeCount: prepared.beforeCount,
        expectedAfterCount: prepared.afterCount
      };

      return fetch(PUBLISH_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }).then(function (res) {
        return res.json().then(function (json) {
          if (!res.ok || !json || !json.ok) {
            var msg = (json && (json.message || json.error)) ||
              ("反映APIエラー HTTP " + res.status);
            var err = new Error(msg);
            err.stage = json && json.stage;
            err.rollbackOk = json && json.rollbackOk;
            err.rollbackNotes = json && json.rollbackNotes;
            err.api = json;
            throw err;
          }
          return {
            ok: true,
            message: "画像とローカルホームページへ反映しました",
            backupName: json.backupName || backupName,
            backupPath: json.backupPath,
            indexPath: json.indexPath,
            imageDir: json.imageDir || IMAGE_DIR,
            imageFileCount: json.imageCount || imagePayload.length,
            diaryBoxAdded: 1,
            beforeCount: prepared.beforeCount,
            afterCount: prepared.afterCount,
            displayNames: preview.displayNames || [],
            largeNames: preview.largeNames || [],
            outputCharset: encoded.outputCharset || prepared.outputCharset,
            rollbackNeeded: false,
            rollbackOk: true,
            mode: preview.mode
          };
        });
      });
    });
  }

  function formatMissingBlobsMessage(missing) {
    if (!missing || !missing.length) return "画像データを取得できないため反映できません。";
    return "画像データを取得できないため反映できません。\n" +
      missing.map(function (m) {
        return "不足 #" + m.index + " id=" + (m.id || "—") +
          " file=" + (m.fileName || "—");
      }).join("\n");
  }

  return {
    prepareLocalPublish: prepareLocalPublish,
    publishLocal: publishLocal,
    collectMissingBlobs: collectMissingBlobs,
    formatMissingBlobsMessage: formatMissingBlobsMessage,
    IMAGE_DIR: IMAGE_DIR,
    PUBLISH_API: PUBLISH_API
  };
});
