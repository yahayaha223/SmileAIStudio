"use strict";

/**
 * Server-side diary publish: fetch/mutate index.htm, upload images, atomic swap.
 * FTP secrets never leave this module. Tests inject a memory FTP adapter.
 */
var path = require("path");
var env = require("./env");
var mutate = require("./diary-index-mutate");
var ftpClient = require("./ftp-client");

var DEFAULT_PAGE_URL = "https://www.egaonokiroku.co.jp/diary/index.htm";
var MAX_IMAGES = 10;
var MAX_IMAGE_BYTES = 1500 * 1024;
var INDEX_NAME = "index.htm";
var PUBLISHING_NAME = "index.htm.smile-publishing";
var PREPUB_BAK_NAME = "index.htm.smile-prepub-bak";
var SAFETY_BAK_NAME = "index.htm.smile-studio-bak";

function loadCharset() {
  require(path.join(__dirname, "../../../js/smile-cp932-map.js"));
  return require(path.join(__dirname, "../../../js/smile-charset.js"));
}

function loadDiaryHtml() {
  return require(path.join(__dirname, "../../../js/smile-diary-html.js"));
}

function fail(code, message, extra) {
  var out = {
    ok: false,
    code: code || "failed",
    userMessage: message || "公開できませんでした",
    productionUntouched: true,
    pageUrl: env.getEnv("DIARY_PUBLIC_URL", DEFAULT_PAGE_URL)
  };
  if (extra && typeof extra === "object") {
    Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
  }
  return out;
}

function todayIsoDate() {
  var d = new Date();
  function p(n) { return String(n).padStart(2, "0"); }
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function parseDataUrl(dataUrl) {
  var m = String(dataUrl || "").match(/^data:([^;]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) return null;
  var buf;
  try {
    buf = Buffer.from(String(m[2]).replace(/\s+/g, ""), "base64");
  } catch (e) {
    return null;
  }
  if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
  return { mime: m[1], buffer: buf };
}

function sanitizeImages(raw) {
  var src = Array.isArray(raw) ? raw : [];
  var out = [];
  src.slice(0, MAX_IMAGES).forEach(function (img, i) {
    if (!img) return;
    var parsed = parseDataUrl(img.dataUrl || img.dataURL);
    if (!parsed) return;
    out.push({
      order: typeof img.order === "number" ? img.order : i,
      caption: String(img.caption || "").slice(0, 120),
      altText: String(img.altText || "").slice(0, 120),
      mime: parsed.mime,
      buffer: parsed.buffer,
      index1: i + 1
    });
  });
  return out;
}

function sanitizeEntry(raw) {
  raw = raw || {};
  var title = String(raw.title || "").trim().slice(0, 120);
  var content = String(raw.content || raw.body || "").trim().slice(0, 20000);
  var publishDate = String(raw.publishDate || "").trim() || todayIsoDate();
  var id = String(raw.id || "").trim().slice(0, 80);
  if (!content) return { ok: false, error: "本文が必要です" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publishDate)) {
    return { ok: false, error: "公開日が不正です" };
  }
  return {
    ok: true,
    entry: {
      id: id || ("diary_" + Date.now()),
      title: title || content.slice(0, 40),
      content: content,
      body: content,
      publishDate: publishDate
    }
  };
}

async function restoreLiveIndex(ftp, originalBytes) {
  try {
    await ftp.rename(PREPUB_BAK_NAME, INDEX_NAME);
    return true;
  } catch (e1) {
    try {
      await ftp.stor(INDEX_NAME, originalBytes);
      return true;
    } catch (e2) {
      return false;
    }
  }
}

/**
 * @param {object} opts
 * @param {boolean} opts.userConfirmed
 * @param {object} opts.entry
 * @param {Array} opts.images
 * @param {object} opts.ftp  injected adapter
 */
async function publishDiaryOnServer(opts) {
  opts = opts || {};
  if (!opts.userConfirmed) {
    return fail("confirm_required", "公開確認が必要です");
  }
  var entryRes = sanitizeEntry(opts.entry);
  if (!entryRes.ok) {
    return fail("invalid_entry", entryRes.error);
  }
  var images = sanitizeImages(opts.images);
  var ftp = opts.ftp;
  if (!ftp || typeof ftp.retr !== "function") {
    return fail("ftp_missing", "FTP接続がありません");
  }

  var Charset = loadCharset();
  var DiaryHtml = loadDiaryHtml();
  var originalBytes = null;
  var swapped = false;

  try {
    originalBytes = await ftp.retr(INDEX_NAME);
    if (!originalBytes || !originalBytes.length) {
      return fail("index_missing", "index.htm を取得できませんでした");
    }

    var det = Charset.detectEncoding(originalBytes);
    if (!det || !det.ok) {
      return fail("charset_failed", (det && det.error) || "文字コード判定に失敗しました");
    }

    var imagePlan = images.map(function (img, i) {
      return {
        order: i,
        index1: i + 1,
        caption: img.caption,
        altText: img.altText,
        exportOk: true
      };
    });

    var article = DiaryHtml.generateDiaryArticleHtml(entryRes.entry, {
      imagesOverride: imagePlan
    });
    var inserted = mutate.insertArticle(det.text, article.html);
    if (!inserted.ok) {
      return fail("insert_failed", inserted.error || "index.htm への挿入に失敗しました");
    }

    var family = det.family;
    if ((!family || family === "unknown") && Charset.normalizeFamily) {
      family = Charset.normalizeFamily(det.decoderLabel || det.metaCharset || "").family;
    }
    var encoded = Charset.encodeText(inserted.afterHtml, family, {
      bom: !!(det.bom && family === "utf-8")
    });
    if (!encoded || !encoded.ok || !encoded.bytes) {
      return fail("encode_failed", (encoded && encoded.error) || "文字コードを保てませんでした");
    }
    var newIndexBytes = Buffer.from(encoded.bytes);

    if (opts.dryRunOnly) {
      await ftp.list(".");
      return {
        ok: true,
        code: "dry_run_ready",
        userMessage: "公開前点検に成功しました",
        productionUntouched: true,
        pageUrl: env.getEnv("DIARY_PUBLIC_URL", DEFAULT_PAGE_URL),
        diaryCountAfter: (inserted.afterHtml.match(/class=["']diary-box["']/g) || []).length
      };
    }

    await ftp.stor(SAFETY_BAK_NAME, originalBytes);

    if (images.length) {
      if (typeof ftp.ensureDir === "function") {
        await ftp.ensureDir("image");
      }
      for (var i = 0; i < images.length; i++) {
        var plan = article.imagePlan && article.imagePlan[i];
        var fileName = plan && plan.fileName
          ? String(plan.fileName).replace(/^image\//, "")
          : (article.dateKey + "-" + (i + 1) + ".jpg");
        var largeName = plan && plan.largeFileName
          ? String(plan.largeFileName).replace(/^image\//, "")
          : (article.dateKey + "-" + (i + 1) + "b.jpg");
        var temp = "image/" + fileName + ".smile-uploading";
        var finalPath = "image/" + fileName;
        var largeTemp = "image/" + largeName + ".smile-uploading";
        var largeFinal = "image/" + largeName;
        await ftp.stor(temp, images[i].buffer);
        await ftp.rename(temp, finalPath);
        await ftp.stor(largeTemp, images[i].buffer);
        await ftp.rename(largeTemp, largeFinal);
      }
    }

    await ftp.stor(PUBLISHING_NAME, newIndexBytes);

    try {
      await ftp.rename(INDEX_NAME, PREPUB_BAK_NAME);
      swapped = true;
      await ftp.rename(PUBLISHING_NAME, INDEX_NAME);
      swapped = false;
    } catch (swapErr) {
      var restored = await restoreLiveIndex(ftp, originalBytes);
      return fail(
        "swap_failed",
        restored
          ? "公開切替に失敗したため、元のホームページを維持しました"
          : "公開切替に失敗しました",
        { productionUntouched: restored, detail: String((swapErr && swapErr.message) || "").slice(0, 160) }
      );
    }

    return {
      ok: true,
      code: "published",
      userMessage: "日記を公開しました",
      productionUntouched: false,
      pageUrl: env.getEnv("DIARY_PUBLIC_URL", DEFAULT_PAGE_URL),
      diaryId: entryRes.entry.id,
      imageCount: images.length,
      history: {
        diaryId: entryRes.entry.id,
        publishedAt: new Date().toISOString(),
        imageCount: images.length,
        indexBackup: SAFETY_BAK_NAME
      }
    };
  } catch (e) {
    if (swapped && originalBytes) {
      var recovered = await restoreLiveIndex(ftp, originalBytes);
      return fail(
        e.code || "pipeline_error",
        recovered
          ? "公開に失敗したため、元のホームページを維持しました"
          : ((e && e.message) || "公開できませんでした"),
        { productionUntouched: recovered }
      );
    }
    return fail(
      e.code || "pipeline_error",
      (e && e.message) || "公開できませんでした",
      { productionUntouched: true }
    );
  } finally {
    if (ftp && typeof ftp.close === "function") {
      try { await ftp.close(); } catch (eClose) { /* ignore */ }
    }
  }
}

module.exports = {
  publishDiaryOnServer: publishDiaryOnServer,
  sanitizeEntry: sanitizeEntry,
  sanitizeImages: sanitizeImages,
  parseDataUrl: parseDataUrl,
  fail: fail,
  ftpClient: ftpClient,
  DEFAULT_PAGE_URL: DEFAULT_PAGE_URL,
  INDEX_NAME: INDEX_NAME,
  PUBLISHING_NAME: PUBLISHING_NAME,
  PREPUB_BAK_NAME: PREPUB_BAK_NAME,
  SAFETY_BAK_NAME: SAFETY_BAK_NAME
};
