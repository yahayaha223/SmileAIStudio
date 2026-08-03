/**
 * Smile AI Studio — 活動日記画像のホームページ用書き出し
 * Browser: window.SmileDiaryImageExport
 *
 * - IndexedDB / メモリ上の Blob から取得
 * - JPEG 変換（通常 max800 / 拡大 max1600）
 * - ファイル名 YYMMDD-N.jpg / YYMMDD-Nb.jpg
 * - 同日衝突検知（上書きしない）
 * - ZIP 一括書き出し（SmileZip 利用）
 */
(function (root, factory) {
  var api = factory(
    root.SmileMediaDB || null,
    root.SmileDiaryHtml || null,
    root.SmileZip || null
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SmileDiaryImageExport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (MediaDB, DiaryHtml, Zip) {
  "use strict";

  var DISPLAY_MAX = 800;
  var LARGE_MAX = 1600;
  var DISPLAY_QUALITY = 0.85;
  var LARGE_QUALITY = 0.9;
  var EXPORT_NAMES_KEY = "smileAIStudio_exportedImageNames";

  function buildDateKey(isoDate) {
    if (DiaryHtml && typeof DiaryHtml.buildDateKey === "function") {
      return DiaryHtml.buildDateKey(isoDate);
    }
    var s = String(isoDate || "").trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return "";
    return m[1].slice(2) + m[2] + m[3];
  }

  function filePair(dateKey, index1) {
    var base = String(dateKey) + "-" + index1;
    return {
      displayName: base + ".jpg",
      largeName: base + "b.jpg",
      displayPath: "image/" + base + ".jpg",
      largePath: "image/" + base + "b.jpg"
    };
  }

  function loadReservedExportNames() {
    try {
      var raw = localStorage.getItem(EXPORT_NAMES_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (e) {
      return [];
    }
  }

  function rememberExportNames(names) {
    try {
      var set = {};
      loadReservedExportNames().concat(names || []).forEach(function (n) {
        if (n) set[String(n)] = true;
      });
      localStorage.setItem(EXPORT_NAMES_KEY, JSON.stringify(Object.keys(set)));
    } catch (e) { /* ignore */ }
  }

  function collectOccupiedFromEntries(entries, excludeId, dateKey) {
    var occupied = {};
    (entries || []).forEach(function (entry) {
      if (!entry || entry.id === excludeId) return;
      if (buildDateKey(entry.publishDate) !== dateKey) return;
      var imgs = Array.isArray(entry.images) ? entry.images : [];
      imgs.forEach(function (_img, i) {
        var pair = filePair(dateKey, i + 1);
        occupied[pair.displayName] = {
          reason: "他の下書き/記事（同日）",
          entryId: entry.id,
          title: entry.title || ""
        };
        occupied[pair.largeName] = occupied[pair.displayName];
      });
    });
    return occupied;
  }

  function probeCorporateSiteName(name) {
    var paths = [
      "CorporateSite/diary/diary/image/" + name,
      "/CorporateSite/diary/diary/image/" + name
    ];
    var chain = Promise.resolve(false);
    paths.forEach(function (p) {
      chain = chain.then(function (found) {
        if (found) return true;
        return fetch(p, { method: "HEAD", cache: "no-store" }).then(function (res) {
          return !!(res && res.ok);
        }).catch(function () {
          return fetch(p, { method: "GET", cache: "no-store" }).then(function (res) {
            return !!(res && res.ok);
          }).catch(function () { return false; });
        });
      });
    });
    return chain.then(function (ok) {
      return ok ? { name: name, reason: "CorporateSiteに既存ファイルあり" } : null;
    });
  }

  function listCorporateImageFiles() {
    return fetch("/api/local-diary-images-list?t=" + Date.now(), { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("画像一覧APIに失敗しました（HTTP " + res.status + "）");
        return res.json();
      })
      .then(function (json) {
        if (!json || !json.ok) throw new Error((json && json.error) || "画像一覧の取得に失敗");
        return {
          files: Array.isArray(json.files) ? json.files.map(String) : [],
          inconsistencies: Array.isArray(json.inconsistencies) ? json.inconsistencies : [],
          path: json.path || "CorporateSite/diary/diary/image/"
        };
      });
  }

  function validateJpegPairResult(display, large, sourceWidth, sourceHeight) {
    var issues = [];
    if (!display || !display.blob || !large || !large.blob) {
      issues.push("JPEG Blobがありません");
      return { ok: false, issues: issues };
    }
    if (display.blob.type && display.blob.type !== "image/jpeg") {
      issues.push("通常画像MIMEが image/jpeg ではありません: " + display.blob.type);
    }
    if (large.blob.type && large.blob.type !== "image/jpeg") {
      issues.push("拡大画像MIMEが image/jpeg ではありません: " + large.blob.type);
    }
    if (!(display.width >= 1 && display.height >= 1)) issues.push("通常画像の寸法が不正");
    if (!(large.width >= 1 && large.height >= 1)) issues.push("拡大画像の寸法が不正");
    if (!(display.bytes > 0) || !(display.blob.size > 0)) issues.push("通常画像サイズが0");
    if (!(large.bytes > 0) || !(large.blob.size > 0)) issues.push("拡大画像サイズが0");
    // 通常が拡大より不自然に大きくない（面積）
    if (display.width * display.height > large.width * large.height * 1.05) {
      issues.push("通常画像が拡大画像より大きいです");
    }
    // 縦横比
    if (sourceWidth > 0 && sourceHeight > 0) {
      var srcRatio = sourceWidth / sourceHeight;
      var dRatio = display.width / display.height;
      var lRatio = large.width / large.height;
      if (Math.abs(srcRatio - dRatio) > 0.08 || Math.abs(srcRatio - lRatio) > 0.08) {
        issues.push("縦横比が大きく崩れています");
      }
    }
    return { ok: issues.length === 0, issues: issues };
  }

  /**
   * 連番を確保。衝突時は次の空き番号へ進める（上書きしない）。
   * a1 形式は既存規則優先のため、原則連番のみ。
   */
  function allocateIndices(imageCount, dateKey, occupiedMap) {
    var allocations = [];
    var conflicts = [];
    var next = 1;
    for (var i = 0; i < imageCount; i++) {
      var chosen = 0;
      var guard = 0;
      while (guard < 500) {
        var pair = filePair(dateKey, next);
        var hitDisplay = occupiedMap[pair.displayName];
        var hitLarge = occupiedMap[pair.largeName];
        if (!hitDisplay && !hitLarge) {
          chosen = next;
          next += 1;
          break;
        }
        conflicts.push({
          requestedIndex: i + 1,
          existingName: pair.displayName,
          existingLargeName: pair.largeName,
          reason: (hitDisplay && hitDisplay.reason) || (hitLarge && hitLarge.reason) || "同名あり",
          candidateName: filePair(dateKey, next + 1).displayName,
          candidateLargeName: filePair(dateKey, next + 1).largeName,
          action: "上書きせず次の連番を使用します"
        });
        next += 1;
        guard += 1;
      }
      if (!chosen) {
        throw new Error("空きファイル名を確保できませんでした");
      }
      var names = filePair(dateKey, chosen);
      allocations.push({
        order: i,
        index1: chosen,
        displayName: names.displayName,
        largeName: names.largeName,
        displayPath: names.displayPath,
        largePath: names.largePath
      });
      occupiedMap[names.displayName] = { reason: "今回の書き出し予定" };
      occupiedMap[names.largeName] = { reason: "今回の書き出し予定" };
    }
    return { allocations: allocations, conflicts: conflicts };
  }

  function resolveBlobKey(item) {
    if (!item) return "";
    return String(item.libraryImageId || item.id || "").trim();
  }

  function getMemoryBlob(item, memoryItems) {
    if (!item) return null;
    if (item.file && (item.file instanceof Blob)) return item.file;
    if (item.blob && (item.blob instanceof Blob)) return item.blob;
    var list = Array.isArray(memoryItems) ? memoryItems : [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m) continue;
      if (m.id === item.id || m.id === item.libraryImageId ||
          m.libraryImageId === item.id || m.libraryImageId === item.libraryImageId) {
        if (m.file instanceof Blob) return m.file;
        if (m.blob instanceof Blob) return m.blob;
      }
    }
    return null;
  }

  function fetchBlobForImage(item, memoryItems) {
    var mem = getMemoryBlob(item, memoryItems);
    if (mem) {
      return Promise.resolve({ blob: mem, source: "memory" });
    }
    var key = resolveBlobKey(item);
    if (!key || !MediaDB || typeof MediaDB.getDiaryImageBlob !== "function") {
      return Promise.resolve({ blob: null, source: "missing", error: "画像Blobが見つかりません" });
    }
    return MediaDB.getDiaryImageBlob(key).then(function (rec) {
      if (rec && rec.blob) {
        return { blob: rec.blob, source: "indexeddb", record: rec };
      }
      return { blob: null, source: "missing", error: "IndexedDBに画像本体がありません" };
    });
  }

  function isLikelyHeic(blob, fileName) {
    var type = String((blob && blob.type) || "").toLowerCase();
    var name = String(fileName || "").toLowerCase();
    if (type.indexOf("heic") >= 0 || type.indexOf("heif") >= 0) return true;
    if (/\.heic$|\.heif$/i.test(name)) return true;
    return false;
  }

  function revokeUrl(url) {
    if (!url) return;
    try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
  }

  function loadImageElement(blob) {
    return new Promise(function (resolve, reject) {
      if (!blob) {
        reject(new Error("blobが空です"));
        return;
      }
      if (typeof createImageBitmap === "function") {
        var opts = {};
        try { opts.imageOrientation = "from-image"; } catch (e) { /* ignore */ }
        createImageBitmap(blob, opts).then(function (bmp) {
          resolve({ kind: "bitmap", image: bmp, width: bmp.width, height: bmp.height });
        }).catch(function () {
          // fallback without orientation option
          createImageBitmap(blob).then(function (bmp) {
            resolve({ kind: "bitmap", image: bmp, width: bmp.width, height: bmp.height });
          }).catch(function () {
            loadViaHtmlImage(blob).then(resolve).catch(reject);
          });
        });
        return;
      }
      loadViaHtmlImage(blob).then(resolve).catch(reject);
    });
  }

  function loadViaHtmlImage(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        resolve({ kind: "img", image: img, width: w, height: h, objectUrl: url });
      };
      img.onerror = function () {
        revokeUrl(url);
        reject(new Error("画像を読み込めません（形式非対応の可能性）"));
      };
      img.src = url;
    });
  }

  function calcSize(srcW, srcH, maxSide) {
    var w = srcW;
    var h = srcH;
    var max = maxSide || DISPLAY_MAX;
    if (!w || !h) return { width: max, height: max };
    var long = Math.max(w, h);
    if (long <= max) return { width: w, height: h };
    var scale = max / long;
    return {
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale))
    };
  }

  function canvasToJpegBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      if (!canvas || typeof canvas.toBlob !== "function") {
        reject(new Error("Canvas toBlob未対応"));
        return;
      }
      canvas.toBlob(function (blob) {
        if (!blob) {
          reject(new Error("JPEG生成に失敗しました"));
          return;
        }
        resolve(blob);
      }, "image/jpeg", quality);
    });
  }

  function drawToJpeg(source, maxSide, quality) {
    var size = calcSize(source.width, source.height, maxSide);
    var canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    var ctx = canvas.getContext("2d");
    if (!ctx) return Promise.reject(new Error("Canvas 2Dが使えません"));
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.width, size.height);
    try {
      ctx.drawImage(source.image, 0, 0, size.width, size.height);
    } catch (e) {
      return Promise.reject(new Error("Canvas描画に失敗（HEIC等の非対応形式の可能性）"));
    }
    return canvasToJpegBlob(canvas, quality).then(function (blob) {
      return {
        blob: blob,
        width: size.width,
        height: size.height,
        bytes: blob.size || 0
      };
    });
  }

  function convertBlobToJpegPair(blob, meta) {
    meta = meta || {};
    var fileName = meta.fileName || "";
    if (!blob) {
      return Promise.resolve({
        ok: false,
        error: "画像データがありません",
        convertible: false
      });
    }

    return loadImageElement(blob).then(function (source) {
      return drawToJpeg(source, DISPLAY_MAX, DISPLAY_QUALITY).then(function (display) {
        return drawToJpeg(source, LARGE_MAX, LARGE_QUALITY).then(function (large) {
          if (source.kind === "bitmap" && source.image && typeof source.image.close === "function") {
            try { source.image.close(); } catch (e) { /* ignore */ }
          }
          revokeUrl(source.objectUrl);
          return {
            ok: true,
            display: display,
            large: large,
            orientationOk: true,
            sourceWidth: source.width,
            sourceHeight: source.height,
            convertedFrom: String((blob && blob.type) || meta.fileType || "unknown")
          };
        });
      }).catch(function (err) {
        if (source.kind === "bitmap" && source.image && typeof source.image.close === "function") {
          try { source.image.close(); } catch (e2) { /* ignore */ }
        }
        revokeUrl(source.objectUrl);
        throw err;
      });
    }).catch(function (err) {
      var msg = (err && err.message) || "変換に失敗しました";
      if (isLikelyHeic(blob, fileName)) {
        msg = "HEIC/HEIFをこのブラウザでは変換できません。JPEGで撮影するか、事前に変換してください";
      }
      return {
        ok: false,
        error: msg,
        convertible: false,
        heic: isLikelyHeic(blob, fileName)
      };
    });
  }

  function yieldTick() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  /**
   * 書き出し計画（変換前）
   */
  function planExport(entry, options) {
    options = options || {};
    entry = entry || {};
    var dateKey = buildDateKey(entry.publishDate);
    if (!dateKey) {
      return Promise.reject(new Error("公開日が不正です"));
    }
    var images = Array.isArray(entry.images) ? entry.images.slice() : [];
    images.sort(function (a, b) {
      return (Number(a && a.order) || 0) - (Number(b && b.order) || 0);
    });

    var occupied = collectOccupiedFromEntries(options.otherEntries || [], entry.id, dateKey);
    loadReservedExportNames().forEach(function (n) {
      if (/^(\d{6})-/.test(n) && n.indexOf(dateKey + "-") === 0) {
        occupied[n] = occupied[n] || { reason: "過去の書き出し履歴" };
      }
    });
    (options.extraOccupiedNames || []).forEach(function (n) {
      occupied[String(n)] = { reason: "予約済み" };
    });

    var probeMax = Math.max(images.length + 5, 8);
    var probes = [];
    for (var i = 1; i <= probeMax; i++) {
      probes.push(probeCorporateSiteName(dateKey + "-" + i + ".jpg"));
      probes.push(probeCorporateSiteName(dateKey + "-" + i + "b.jpg"));
    }

    return listCorporateImageFiles().catch(function () {
      return { files: [], inconsistencies: [], path: "CorporateSite/diary/diary/image/" };
    }).then(function (listing) {
      if (listing.inconsistencies && listing.inconsistencies.length) {
        var related = listing.inconsistencies.filter(function (inc) {
          return String(inc.base || "").indexOf(dateKey + "-") === 0 ||
            String(inc.displayName || "").indexOf(dateKey + "-") === 0;
        });
        // Any pair inconsistency in folder blocks publish for safety when overlapping date
        // Also block globally if same date prefix appears
        var blocking = listing.inconsistencies.filter(function (inc) {
          var base = String(inc.base || "");
          return base.indexOf(dateKey + "-") === 0;
        });
        if (blocking.length) {
          var detail = blocking.map(function (b) {
            return (b.displayName || "") + "/" + (b.largeName || "") +
              " (通常:" + (b.hasDisplay ? "あり" : "なし") +
              " 拡大:" + (b.hasLarge ? "あり" : "なし") + ")";
          }).join(", ");
          return Promise.reject(new Error(
            "通常/拡大の片割れ不整合があります。自動判断せず停止します: " + detail
          ));
        }
      }
      (listing.files || []).forEach(function (n) {
        occupied[String(n)] = { reason: "CorporateSiteに既存ファイルあり" };
      });
      return Promise.all(probes).then(function (hits) {
        hits.forEach(function (hit) {
          if (hit && hit.name) {
            occupied[hit.name] = { reason: hit.reason };
          }
        });
        var alloc = allocateIndices(images.length, dateKey, occupied);
        var planned = alloc.allocations.map(function (a, idx) {
          var img = images[idx] || {};
          return {
            order: idx,
            index1: a.index1,
            displayName: a.displayName,
            largeName: a.largeName,
            displayPath: a.displayPath,
            largePath: a.largePath,
            altText: String(img.altText || img.caption || entry.title || ("活動日記写真" + a.index1)).trim(),
            caption: String(img.caption || "").trim(),
            sourceFileName: String(img.fileName || "").trim(),
            imageMeta: img,
            displayMax: DISPLAY_MAX,
            largeMax: LARGE_MAX,
            displayQuality: DISPLAY_QUALITY,
            largeQuality: LARGE_QUALITY
          };
        });
        return {
          dateKey: dateKey,
          title: String(entry.title || "").trim(),
          publishDate: entry.publishDate,
          imageCount: images.length,
          planned: planned,
          conflicts: alloc.conflicts,
          occupiedSample: Object.keys(occupied).slice(0, 20),
          listingPath: listing.path,
          listingCount: (listing.files || []).length
        };
      });
    });
  }

  /**
   * 画像を順次変換して書き出し結果を返す（IndexedDBは削除しない）
   */
  function exportImages(entry, options) {
    options = options || {};
    return planExport(entry, options).then(function (plan) {
      var memoryItems = options.memoryItems || [];
      var results = [];
      var chain = Promise.resolve();

      plan.planned.forEach(function (item) {
        chain = chain.then(function () {
          return yieldTick().then(function () {
            return fetchBlobForImage(item.imageMeta, memoryItems).then(function (got) {
              if (!got.blob) {
                results.push({
                  ok: false,
                  order: item.order,
                  index1: item.index1,
                  displayName: item.displayName,
                  largeName: item.largeName,
                  displayPath: item.displayPath,
                  largePath: item.largePath,
                  altText: item.altText,
                  caption: item.caption,
                  error: got.error || "Blob取得失敗",
                  blobSource: got.source
                });
                return;
              }
              return convertBlobToJpegPair(got.blob, {
                fileName: item.sourceFileName || (item.imageMeta && item.imageMeta.fileName),
                fileType: item.imageMeta && item.imageMeta.fileType
              }).then(function (conv) {
                if (!conv.ok) {
                  results.push({
                    ok: false,
                    order: item.order,
                    index1: item.index1,
                    displayName: item.displayName,
                    largeName: item.largeName,
                    displayPath: item.displayPath,
                    largePath: item.largePath,
                    altText: item.altText,
                    caption: item.caption,
                    error: conv.error || "変換失敗",
                    blobSource: got.source,
                    heic: !!conv.heic
                  });
                  return;
                }
                var v = validateJpegPairResult(
                  conv.display, conv.large, conv.sourceWidth, conv.sourceHeight
                );
                if (!v.ok) {
                  results.push({
                    ok: false,
                    order: item.order,
                    index1: item.index1,
                    displayName: item.displayName,
                    largeName: item.largeName,
                    displayPath: item.displayPath,
                    largePath: item.largePath,
                    altText: item.altText,
                    caption: item.caption,
                    error: v.issues.join(" / "),
                    blobSource: got.source
                  });
                  return;
                }
                results.push({
                  ok: true,
                  order: item.order,
                  index1: item.index1,
                  displayName: item.displayName,
                  largeName: item.largeName,
                  displayPath: item.displayPath,
                  largePath: item.largePath,
                  altText: item.altText,
                  caption: item.caption,
                  displayBlob: conv.display.blob,
                  largeBlob: conv.large.blob,
                  displayWidth: conv.display.width,
                  displayHeight: conv.display.height,
                  largeWidth: conv.large.width,
                  largeHeight: conv.large.height,
                  displayBytes: conv.display.bytes,
                  largeBytes: conv.large.bytes,
                  orientationOk: !!conv.orientationOk,
                  blobSource: got.source,
                  sourceWidth: conv.sourceWidth,
                  sourceHeight: conv.sourceHeight,
                  convertedFrom: conv.convertedFrom
                });
              });
            });
          });
        });
      });

      return chain.then(function () {
        var okItems = results.filter(function (r) { return r.ok; });
        var failItems = results.filter(function (r) { return !r.ok; });
        var exportedNames = [];
        okItems.forEach(function (r) {
          exportedNames.push(r.displayName, r.largeName);
        });
        if (exportedNames.length) rememberExportNames(exportedNames);

        return {
          plan: plan,
          results: results,
          okItems: okItems,
          failItems: failItems,
          successCount: okItems.length,
          failCount: failItems.length,
          totalCount: results.length,
          message: buildResultMessage(okItems.length, failItems.length, results.length)
        };
      });
    });
  }

  function buildResultMessage(okCount, failCount, total) {
    if (!total) return "書き出す画像がありません";
    if (failCount === 0) return "画像を書き出しました（" + okCount + "枚）";
    if (okCount === 0) return total + "枚すべて変換できませんでした";
    return total + "枚中" + okCount + "枚を書き出しました。" + failCount + "枚は変換できませんでした";
  }

  function buildImagesOnlyZip(exportResult) {
    var folder = "homepage-export-" + ((exportResult.plan && exportResult.plan.dateKey) || "diary");
    var entries = [];
    (exportResult.okItems || []).forEach(function (item) {
      entries.push({
        name: folder + "/diary/image/" + item.displayName,
        data: item.displayBlob
      });
      entries.push({
        name: folder + "/diary/image/" + item.largeName,
        data: item.largeBlob
      });
    });
    if (!Zip || typeof Zip.buildZipFromEntries !== "function") {
      return Promise.reject(new Error("SmileZipが読み込まれていません"));
    }
    return Zip.buildZipFromEntries(entries).then(function (blob) {
      return {
        blob: blob,
        fileName: folder + "-images.zip",
        entryCount: entries.length
      };
    });
  }

  function buildHtmlAndImagesZip(exportResult, htmlBundle) {
    var dateKey = (exportResult.plan && exportResult.plan.dateKey) ||
      (htmlBundle && htmlBundle.article && htmlBundle.article.dateKey) ||
      "diary";
    var folder = "homepage-export-" + dateKey;
    var entries = [];
    if (htmlBundle) {
      if (htmlBundle.articleFile) {
        entries.push({
          name: folder + "/" + (htmlBundle.articleFileName || ("diary-entry-" + dateKey + ".html")),
          data: htmlBundle.articleFile
        });
      }
      if (htmlBundle.newsFile) {
        entries.push({
          name: folder + "/" + (htmlBundle.newsFileName || ("news-list-update-" + dateKey + ".html")),
          data: htmlBundle.newsFile
        });
      }
      if (htmlBundle.combinedFile) {
        entries.push({
          name: folder + "/" + (htmlBundle.combinedFileName || ("homepage-html-export-" + dateKey + ".html")),
          data: htmlBundle.combinedFile
        });
      }
    }
    (exportResult.okItems || []).forEach(function (item) {
      entries.push({
        name: folder + "/diary/image/" + item.displayName,
        data: item.displayBlob
      });
      entries.push({
        name: folder + "/diary/image/" + item.largeName,
        data: item.largeBlob
      });
    });
    if (!Zip || typeof Zip.buildZipFromEntries !== "function") {
      return Promise.reject(new Error("SmileZipが読み込まれていません"));
    }
    return Zip.buildZipFromEntries(entries).then(function (blob) {
      return {
        blob: blob,
        fileName: folder + ".zip",
        entryCount: entries.length,
        folder: folder
      };
    });
  }

  function downloadBlob(fileName, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName || "export.zip";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { revokeUrl(url); }, 2000);
    return true;
  }

  /** 成功した画像だけを HTML 生成用 images 配列へ */
  function toHtmlImages(okItems) {
    return (okItems || []).map(function (item, i) {
      return {
        order: i,
        index1: item.index1 || (i + 1),
        fileName: item.displayName,
        largeFileName: item.largeName,
        path: item.displayPath,
        largePath: item.largePath,
        altText: item.altText,
        caption: item.caption,
        width: item.displayWidth,
        height: item.displayHeight,
        largeWidth: item.largeWidth,
        largeHeight: item.largeHeight,
        exportOk: true
      };
    });
  }

  function runSelfCheck() {
    var report = {
      zip: !!(Zip && typeof Zip.buildZipFromEntries === "function"),
      mediaDb: !!(MediaDB && typeof MediaDB.getDiaryImageBlob === "function"),
      diaryHtml: !!(DiaryHtml && typeof DiaryHtml.buildExportBundle === "function"),
      canvas: !!(typeof document !== "undefined" && document.createElement("canvas").getContext),
      createImageBitmap: typeof createImageBitmap === "function"
    };
    return report;
  }

  /** システムチェック用: 1x1 PNG → JPEG ペア生成 */
  function generateTestJpegPair() {
    var canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 48;
    var ctx = canvas.getContext("2d");
    if (!ctx) return Promise.reject(new Error("canvas不可"));
    ctx.fillStyle = "#336699";
    ctx.fillRect(0, 0, 32, 48);
    ctx.fillStyle = "#fff";
    ctx.fillRect(8, 8, 16, 32);
    return canvasToJpegBlob(canvas, 0.9).then(function (blob) {
      return convertBlobToJpegPair(blob, { fileName: "test.png", fileType: "image/png" });
    });
  }

  return {
    DISPLAY_MAX: DISPLAY_MAX,
    LARGE_MAX: LARGE_MAX,
    DISPLAY_QUALITY: DISPLAY_QUALITY,
    LARGE_QUALITY: LARGE_QUALITY,
    buildDateKey: buildDateKey,
    filePair: filePair,
    planExport: planExport,
    exportImages: exportImages,
    buildImagesOnlyZip: buildImagesOnlyZip,
    buildHtmlAndImagesZip: buildHtmlAndImagesZip,
    downloadBlob: downloadBlob,
    toHtmlImages: toHtmlImages,
    convertBlobToJpegPair: convertBlobToJpegPair,
    fetchBlobForImage: fetchBlobForImage,
    listCorporateImageFiles: listCorporateImageFiles,
    validateJpegPairResult: validateJpegPairResult,
    allocateIndices: allocateIndices,
    runSelfCheck: runSelfCheck,
    generateTestJpegPair: generateTestJpegPair,
    loadReservedExportNames: loadReservedExportNames
  };
});
