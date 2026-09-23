"use strict";

/**
 * Server-side diary delete: list or remove one .diary-box from diary/index.htm.
 * Uses the same diary FTP path as publish. Never touches homepage SITE_FTP_*.
 */
require("../../../js/smile-cp932-map.js");
var Charset = require("../../../js/smile-charset.js");
var env = require("./env");
var mutate = require("./diary-index-mutate");
var diaryPublish = require("./diary-publish");
var ftpClient = require("./ftp-client");

var DEFAULT_PAGE_URL = diaryPublish.DEFAULT_PAGE_URL;
var INDEX_NAME = diaryPublish.INDEX_NAME;
var PUBLISHING_NAME = diaryPublish.PUBLISHING_NAME;
var PREPUB_BAK_NAME = diaryPublish.PREPUB_BAK_NAME;
var SAFETY_BAK_NAME = diaryPublish.SAFETY_BAK_NAME;
var MAX_LIST = 40;

function fail(code, message, extra) {
  var out = {
    ok: false,
    code: code || "failed",
    userMessage: message || "日記を消せませんでした",
    productionUntouched: true,
    pageUrl: env.getEnv("DIARY_PUBLIC_URL", DEFAULT_PAGE_URL)
  };
  if (extra && typeof extra === "object") {
    Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
  }
  return out;
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

function decodeIndexBytes(originalBytes) {
  if (!originalBytes || !originalBytes.length) {
    return { ok: false, result: fail("index_missing", "index.htm を取得できませんでした") };
  }
  var det = Charset.detectEncoding(originalBytes);
  if (!det || !det.ok) {
    return {
      ok: false,
      result: fail("charset_failed", (det && det.error) || "文字コード判定に失敗しました")
    };
  }
  return { ok: true, det: det };
}

function encodeIndexHtml(afterHtml, det) {
  var family = det.family;
  if ((!family || family === "unknown") && Charset.normalizeFamily) {
    family = Charset.normalizeFamily(det.decoderLabel || det.metaCharset || "").family;
  }
  var encoded = Charset.encodeText(afterHtml, family, {
    bom: !!(det.bom && family === "utf-8")
  });
  if (!encoded || !encoded.ok || !encoded.bytes) {
    return {
      ok: false,
      result: fail("encode_failed", (encoded && encoded.error) || "文字コードを保てませんでした")
    };
  }
  return { ok: true, bytes: Buffer.from(encoded.bytes) };
}

async function listDiariesOnServer(opts) {
  opts = opts || {};
  var ftp = opts.ftp;
  if (!ftp || typeof ftp.retr !== "function") {
    return fail("ftp_missing", "FTP接続がありません");
  }
  try {
    var originalBytes = await ftp.retr(INDEX_NAME);
    var decoded = decodeIndexBytes(originalBytes);
    if (!decoded.ok) return decoded.result;
    var listed = mutate.listDiaryArticles(decoded.det.text);
    if (!listed.ok) {
      return fail("parse_failed", listed.error || "日記一覧を読めませんでした");
    }
    return {
      ok: true,
      code: "listed",
      userMessage: "公開中の日記を読みました",
      productionUntouched: true,
      pageUrl: env.getEnv("DIARY_PUBLIC_URL", DEFAULT_PAGE_URL),
      articles: listed.articles.slice(0, MAX_LIST),
      count: listed.count
    };
  } catch (e) {
    return fail(
      e.code || "pipeline_error",
      (e && e.message) || "日記一覧を読めませんでした",
      { productionUntouched: true }
    );
  } finally {
    if (ftp && typeof ftp.close === "function" && !opts.keepOpen) {
      try { await ftp.close(); } catch (eClose) { /* ignore */ }
    }
  }
}

/**
 * @param {object} opts
 * @param {boolean} opts.userConfirmed
 * @param {string} opts.diaryId
 * @param {object} opts.ftp
 */
async function deleteDiaryOnServer(opts) {
  opts = opts || {};
  if (!opts.userConfirmed) {
    return fail("confirm_required", "削除確認が必要です");
  }
  var diaryId = mutate.normalizeDiaryBoxId(opts.diaryId);
  if (!diaryId) {
    return fail("invalid_diary_id", "日記IDが不正です");
  }
  var ftp = opts.ftp;
  if (!ftp || typeof ftp.retr !== "function") {
    return fail("ftp_missing", "FTP接続がありません");
  }

  var originalBytes = null;
  var swapped = false;

  try {
    originalBytes = await ftp.retr(INDEX_NAME);
    var decoded = decodeIndexBytes(originalBytes);
    if (!decoded.ok) return decoded.result;

    var removed = mutate.removeArticle(decoded.det.text, diaryId);
    if (!removed.ok) {
      return fail(removed.code || "remove_failed", removed.error || "日記を消せませんでした");
    }

    var encoded = encodeIndexHtml(removed.afterHtml, decoded.det);
    if (!encoded.ok) return encoded.result;
    var newIndexBytes = encoded.bytes;

    if (opts.dryRunOnly) {
      await ftp.list(".");
      return {
        ok: true,
        code: "dry_run_ready",
        userMessage: "削除前点検に成功しました",
        productionUntouched: true,
        pageUrl: env.getEnv("DIARY_PUBLIC_URL", DEFAULT_PAGE_URL),
        diaryId: diaryId,
        diaryCountAfter: removed.afterCount
      };
    }

    await ftp.stor(SAFETY_BAK_NAME, originalBytes);
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
          ? "削除切替に失敗したため、元のホームページを維持しました"
          : "削除切替に失敗しました",
        { productionUntouched: restored, detail: String((swapErr && swapErr.message) || "").slice(0, 160) }
      );
    }

    return {
      ok: true,
      code: "deleted",
      userMessage: "日記を消しました",
      productionUntouched: false,
      pageUrl: env.getEnv("DIARY_PUBLIC_URL", DEFAULT_PAGE_URL),
      diaryId: diaryId,
      diaryCountAfter: removed.afterCount,
      history: {
        diaryId: diaryId,
        deletedAt: new Date().toISOString(),
        indexBackup: SAFETY_BAK_NAME
      }
    };
  } catch (e) {
    if (swapped && originalBytes) {
      var recovered = await restoreLiveIndex(ftp, originalBytes);
      return fail(
        e.code || "pipeline_error",
        recovered
          ? "削除に失敗したため、元のホームページを維持しました"
          : ((e && e.message) || "日記を消せませんでした"),
        { productionUntouched: recovered }
      );
    }
    return fail(
      e.code || "pipeline_error",
      (e && e.message) || "日記を消せませんでした",
      { productionUntouched: true }
    );
  } finally {
    if (ftp && typeof ftp.close === "function") {
      try { await ftp.close(); } catch (eClose) { /* ignore */ }
    }
  }
}

module.exports = {
  listDiariesOnServer: listDiariesOnServer,
  deleteDiaryOnServer: deleteDiaryOnServer,
  fail: fail,
  ftpClient: ftpClient,
  DEFAULT_PAGE_URL: DEFAULT_PAGE_URL,
  INDEX_NAME: INDEX_NAME
};
