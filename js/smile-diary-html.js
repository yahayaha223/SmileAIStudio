/**
 * Smile AI Studio — 活動日記 → 会社ホームページ用 HTML 生成
 * Browser: window.SmileDiaryHtml
 *
 * 対象サイト構造（CorporateSite / 本番 diary/index.htm）:
 * - 個別記事ページは無く、年別ページ内に .diary-box を先頭追加する形式
 * - 独立した news/ ページは無いため、news一覧は追記用断片として生成
 * - 画像パス想定: image/YYMMDD-N.jpg / image/YYMMDD-Nb.jpg
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SmileDiaryHtml = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SITE_DIARY_URL = "https://www.egaonokiroku.co.jp/diary/index.htm";
  var DEFAULT_IMG_W = 480;
  var DEFAULT_IMG_H = 360;

  function escapeHtml(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDotsDate(isoDate) {
    var s = String(isoDate || "").trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + "." + m[2] + "." + m[3];
    var d = s.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
    if (d) return d[1] + "." + d[2] + "." + d[3];
    return s || "";
  }

  function buildDateKey(isoDate) {
    var dots = formatDotsDate(isoDate);
    var m = dots.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
    if (!m) return "";
    return m[1].slice(2) + m[2] + m[3];
  }

  function buildArticleUrl(isoDate) {
    var key = buildDateKey(isoDate);
    if (!key) return SITE_DIARY_URL;
    return SITE_DIARY_URL + "#diary-" + key;
  }

  function plainTextToDiaryBodyHtml(text) {
    var raw = String(text == null ? "" : text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (!raw) return "";
    var paragraphs = raw.split(/\n{2,}/);
    return paragraphs.map(function (p) {
      return escapeHtml(p).replace(/\n/g, "<br>\n");
    }).join("<br><br>\n");
  }

  function summarizeText(text, maxLen) {
    var t = String(text || "").replace(/\s+/g, " ").trim();
    var n = typeof maxLen === "number" ? maxLen : 80;
    if (t.length <= n) return t;
    return t.slice(0, n) + "…";
  }

  function normalizeImages(images) {
    var list = Array.isArray(images) ? images.slice() : [];
    list.sort(function (a, b) {
      return (Number(a && a.order) || 0) - (Number(b && b.order) || 0);
    });
    return list.filter(Boolean);
  }

  function imageFileNames(dateKey, index1, custom) {
    if (custom && custom.displayPath && custom.largePath) {
      return {
        thumb: custom.displayPath,
        large: custom.largePath,
        width: custom.width || DEFAULT_IMG_W,
        height: custom.height || DEFAULT_IMG_H
      };
    }
    var base = dateKey + "-" + index1;
    return {
      thumb: "image/" + base + ".jpg",
      large: "image/" + base + "b.jpg",
      width: DEFAULT_IMG_W,
      height: DEFAULT_IMG_H
    };
  }

  function buildImageAnchorHtml(dateKey, index1, altText, custom) {
    var names = imageFileNames(dateKey, index1, custom);
    var alt = escapeHtml(altText || "");
    var w = names.width || DEFAULT_IMG_W;
    var h = names.height || DEFAULT_IMG_H;
    var titleAttr = custom && custom.caption
      ? ' title="' + escapeHtml(custom.caption) + '"'
      : "";
    return (
      '<a href="' + names.large + '" rel="lytebox[' + dateKey + ']">' +
      '<img src="' + names.thumb + '" width="' + w + '" height="' + h +
      '" border="0" alt="' + alt + '"' + titleAttr + ">" +
      "</a>"
    );
  }

  function resolveImageAlt(img, title, index1) {
    var alt = String((img && (img.altText || img.caption)) || "").trim();
    if (alt) return alt;
    var t = String(title || "").trim();
    if (t) return t;
    return "活動日記写真" + index1;
  }

  /**
   * 活動日記1件 → diary/index.htm へ挿入する .diary-box HTML
   * @param {object} entry
   * @param {{ imagesOverride?: Array, requireExportOk?: boolean }} [options]
   *   imagesOverride: 書き出し成功画像のみ（fileName/path/width 等）
   *   requireExportOk: true のとき exportOk=false は除外
   */
  function generateDiaryArticleHtml(entry, options) {
    options = options || {};
    entry = entry || {};
    var title = String(entry.title || "").trim();
    var content = String(entry.content || entry.body || "").trim();
    var publishDate = String(entry.publishDate || "").trim();
    var dots = formatDotsDate(publishDate);
    var dateKey = buildDateKey(publishDate);
    if (!dateKey) {
      throw new Error("公開日が不正です（YYYY-MM-DD）");
    }
    if (!content && !title) {
      throw new Error("タイトルまたは本文が必要です");
    }

    var images = Array.isArray(options.imagesOverride)
      ? options.imagesOverride.slice()
      : normalizeImages(entry.images);
    if (options.requireExportOk) {
      images = images.filter(function (img) { return img && img.exportOk !== false; });
    }
    images.sort(function (a, b) {
      return (Number(a && a.order) || 0) - (Number(b && b.order) || 0);
    });

    var imagePlan = images.map(function (img, i) {
      var n = (img && img.index1) || (i + 1);
      var custom = null;
      if (img && (img.path || img.displayPath || img.fileName)) {
        custom = {
          displayPath: img.path || img.displayPath || ("image/" + (img.fileName || "")),
          largePath: img.largePath || ("image/" + (img.largeFileName || "")),
          width: img.width || DEFAULT_IMG_W,
          height: img.height || DEFAULT_IMG_H,
          caption: img.caption || ""
        };
      }
      var names = imageFileNames(dateKey, n, custom);
      return {
        order: i,
        index1: n,
        fileName: String(names.thumb).replace(/^image\//, ""),
        largeFileName: String(names.large).replace(/^image\//, ""),
        path: names.thumb,
        largePath: names.large,
        width: names.width,
        height: names.height,
        altText: resolveImageAlt(img, title, n),
        caption: String((img && img.caption) || "").trim(),
        sourceFileName: String((img && (img.sourceFileName || img.fileName)) || "").trim(),
        exportOk: img && img.exportOk !== false
      };
    });

    var bodyHtml = plainTextToDiaryBodyHtml(content || title);
    var lines = [];
    lines.push('	  <div class="diary-box" id="diary-' + dateKey + '">');
    lines.push('	    <div class="diary-title-box">');
    lines.push('	      <div class="diary-date">' + escapeHtml(dots) + "</div>");
    lines.push("	    </div>");
    if (title) {
      lines.push("	    <!-- Smile AI Studio タイトル: " + escapeHtml(title) + " -->");
    }

    function customFor(img, i) {
      var plan = imagePlan[i];
      if (!plan) return null;
      return {
        displayPath: plan.path,
        largePath: plan.largePath,
        width: plan.width,
        height: plan.height,
        caption: plan.caption
      };
    }

    if (images.length === 0) {
      lines.push('	    <div class="diary-main">');
      lines.push(bodyHtml);
      lines.push("	    </div>");
    } else if (images.length <= 2) {
      var floatClass = images.length === 1 ? "diary-photo-r" : "diary-photo-l";
      var photoSpans = images.map(function (img, i) {
        var plan = imagePlan[i];
        return buildImageAnchorHtml(
          dateKey,
          plan.index1,
          plan.altText,
          customFor(img, i)
        );
      }).join("");
      lines.push('	    <div class="diary-main">');
      lines.push('<span class="' + floatClass + '">' + photoSpans + "</span>" + bodyHtml);
      lines.push("	    </div>");
      images.forEach(function (img, i) {
        if (imagePlan[i] && imagePlan[i].caption) {
          lines.push("	    <!-- caption " + (i + 1) + ": " + escapeHtml(imagePlan[i].caption) + " -->");
        }
      });
    } else {
      var first = images[0];
      var firstPlan = imagePlan[0];
      lines.push('	    <div class="diary-main">');
      lines.push(
        '<span class="diary-photo-r">' +
        buildImageAnchorHtml(dateKey, firstPlan.index1, firstPlan.altText, customFor(first, 0)) +
        "</span>" + bodyHtml
      );
      lines.push("	    </div>");
      lines.push('	    <div class="diary-photobox">');
      for (var i = 1; i < images.length; i++) {
        lines.push(buildImageAnchorHtml(
          dateKey,
          imagePlan[i].index1,
          imagePlan[i].altText,
          customFor(images[i], i)
        ));
      }
      lines.push("	    </div>");
      images.forEach(function (img, i) {
        if (imagePlan[i] && imagePlan[i].caption) {
          lines.push("	    <!-- caption " + (i + 1) + ": " + escapeHtml(imagePlan[i].caption) + " -->");
        }
      });
    }

    lines.push("	  </div>");
    lines.push("");

    var html = lines.join("\n");
    return {
      html: html,
      dateKey: dateKey,
      dotsDate: dots,
      articleUrl: buildArticleUrl(publishDate),
      imagePlan: imagePlan,
      title: title,
      summary: summarizeText(content || title, 80)
    };
  }

  /**
   * news一覧追記用 HTML（独立 news ページは無いため、履歴行＋カード断片を生成）
   * 挿入先の目安:
   * - .history-box 形式 → 更新履歴ページ（#history-base）へ
   * - .news-list-item → トップ等の一覧カード用（手動配置）
   */
  function generateNewsListHtml(entry, articleResult) {
    entry = entry || {};
    var result = articleResult || generateDiaryArticleHtml(entry);
    var title = String(entry.title || result.title || "").trim() || "活動日記";
    var dots = result.dotsDate || formatDotsDate(entry.publishDate);
    var summary = result.summary || summarizeText(entry.content || entry.body || title, 80);
    var url = result.articleUrl || buildArticleUrl(entry.publishDate);
    var thumbPath = "";
    if (result.imagePlan && result.imagePlan.length) {
      thumbPath = result.imagePlan[0].path;
    }
    var thumbAlt = title;
    if (result.imagePlan && result.imagePlan[0] && result.imagePlan[0].altText) {
      thumbAlt = result.imagePlan[0].altText;
    }

    var historyBlock = [
      "<!-- news一覧 / 更新履歴への追記用（#history-base 内の先頭などへ） -->",
      '<div class="history-box">',
      '  <div class="history-date">' + escapeHtml(dots) + "</div>",
      '  <div class="history-contents"><a href="' + escapeHtml(url) + '">' + escapeHtml(title) + "</a></div>",
      "</div>",
      ""
    ].join("\n");

    var cardLines = [
      "<!-- news一覧カード（タイトル・公開日・概要・サムネイル・記事URL） -->",
      '<div class="news-list-item" data-diary-id="' + escapeHtml(result.dateKey) + '">',
      '  <p class="news-list-item__date">' + escapeHtml(dots) + "</p>",
      '  <p class="news-list-item__title"><a href="' + escapeHtml(url) + '">' + escapeHtml(title) + "</a></p>",
      '  <p class="news-list-item__summary">' + escapeHtml(summary) + "</p>"
    ];
    if (thumbPath) {
      cardLines.push(
        '  <p class="news-list-item__thumb"><img src="' + escapeHtml(thumbPath) +
        '" alt="' + escapeHtml(thumbAlt) + '" width="160" height="120" border="0"></p>'
      );
    } else {
      cardLines.push('  <p class="news-list-item__thumb">（サムネイル画像なし）</p>');
    }
    cardLines.push('  <p class="news-list-item__url"><a href="' + escapeHtml(url) + '">' + escapeHtml(url) + "</a></p>");
    cardLines.push("</div>");
    cardLines.push("");

    var insertGuide = [
      "<!-- 配置ガイド -->",
      "<!-- 1. 記事本体: diary/index.htm の #diary-base 内、最初の .diary-box の直前へ article HTML を挿入 -->",
      "<!-- 2. 画像ファイル: diary/image/ へ YYMMDD-N.jpg / YYMMDD-Nb.jpg を配置（別途） -->",
      "<!-- 3. 下記 history-box は更新履歴ページがある場合に追記。無い場合は news-list-item を手動配置 -->",
      "<!-- 4. FTPアップロードは Smile AI Studio からは行いません -->",
      ""
    ].join("\n");

    return {
      html: insertGuide + historyBlock + cardLines.join("\n"),
      historyHtml: historyBlock,
      cardHtml: cardLines.join("\n"),
      title: title,
      publishDate: dots,
      summary: summary,
      thumbnail: thumbPath,
      articleUrl: url
    };
  }

  function buildExportBundle(entry, options) {
    options = options || {};
    var article = generateDiaryArticleHtml(entry, options);
    var news = generateNewsListHtml(entry, article);
    var header = [
      "<!-- Smile AI Studio HTML書き出し -->",
      "<!-- 生成日時: " + new Date().toISOString() + " -->",
      "<!-- 対象: 株式会社えがおのきろく 活動日記（diary/index.htm） -->",
      "<!-- FTPアップロードは含みません。ローカル確認・手動反映用です。 -->",
      ""
    ].join("\n");

    var articleFile =
      header +
      "<!-- ===== 記事HTML（diary/index.htm へ挿入） ===== -->\n" +
      article.html;

    var newsFile =
      header +
      "<!-- ===== news一覧更新HTML（必要部分） ===== -->\n" +
      news.html;

    var combined =
      header +
      "<!-- ===== 記事HTML ===== -->\n" +
      article.html +
      "\n<!-- ===== news一覧更新HTML ===== -->\n" +
      news.html;

    return {
      article: article,
      news: news,
      articleFileName: "diary-entry-" + article.dateKey + ".html",
      newsFileName: "news-list-update-" + article.dateKey + ".html",
      combinedFileName: "homepage-html-export-" + article.dateKey + ".html",
      articleFile: articleFile,
      newsFile: newsFile,
      combinedFile: combined
    };
  }

  function buildPreviewDocument(articleHtml, meta) {
    meta = meta || {};
    var title = escapeHtml(meta.title || "活動日記プレビュー");
    var note = escapeHtml(meta.note || "会社ホームページ風のプレビューです（CSSは簡易再現）。");
    return (
      "<!DOCTYPE html><html lang=\"ja\"><head><meta charset=\"UTF-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
      "<title>" + title + "</title>" +
      "<style>" +
      "body{margin:0;padding:16px;background:#f7f5f0;font-family:sans-serif;color:#333;line-height:1.7;}" +
      ".note{font-size:12px;color:#666;margin:0 0 12px;}" +
      ".diary-box{width:100%;max-width:720px;margin:0 auto 24px;padding:20px 22px;background:#F2EEE2;overflow:hidden;box-sizing:border-box;}" +
      ".diary-date{font-weight:700;margin-bottom:10px;}" +
      ".diary-main{font-size:15px;}" +
      ".diary-photo-l{float:left;padding:5px 10px 5px 0;}" +
      ".diary-photo-r{float:right;padding:5px 0 5px 10px;}" +
      ".diary-photo-l img,.diary-photo-r img{max-width:200px;height:auto;}" +
      ".diary-photobox{clear:both;margin-top:20px;text-align:left;}" +
      ".diary-photobox img{max-width:160px;height:auto;margin:4px;}" +
      ".missing-img{display:inline-block;width:160px;height:120px;background:#ddd;color:#666;font-size:12px;text-align:center;line-height:120px;}" +
      "</style></head><body>" +
      "<p class=\"note\">" + note + "</p>" +
      (articleHtml || "") +
      "</body></html>"
    );
  }

  /** システムチェック・単体テスト用の最小サンプル */
  function generateSampleBundle() {
    return buildExportBundle({
      title: "HTML生成テスト",
      content: "これはHTML生成エンジンのテスト本文です。\n\n2段落目です。",
      publishDate: "2026-07-20",
      images: [
        { order: 0, altText: "テスト写真", caption: "キャプション", fileName: "test.jpg" }
      ]
    });
  }

  return {
    SITE_DIARY_URL: SITE_DIARY_URL,
    escapeHtml: escapeHtml,
    formatDotsDate: formatDotsDate,
    buildDateKey: buildDateKey,
    buildArticleUrl: buildArticleUrl,
    generateDiaryArticleHtml: generateDiaryArticleHtml,
    generateNewsListHtml: generateNewsListHtml,
    buildExportBundle: buildExportBundle,
    buildPreviewDocument: buildPreviewDocument,
    generateSampleBundle: generateSampleBundle
  };
});
