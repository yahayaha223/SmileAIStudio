"use strict";

/**
 * Insert a .diary-box into diary/index.htm without touching the rest of the file.
 */

function detectLineEnding(text) {
  var s = String(text || "");
  if (/\r\n/.test(s)) return "\r\n";
  if (/\r/.test(s)) return "\r";
  return "\n";
}

function findInsertIndex(html) {
  html = String(html || "");
  var firstBox = html.search(/<div\s+class=["']diary-box["']/i);
  if (firstBox === -1) {
    return { index: -1, method: "none", error: "挿入位置を検出できません" };
  }

  var mobileOpen = html.search(/<div\s+class=["']year-navi-mobile["']/i);
  if (mobileOpen >= 0 && mobileOpen < firstBox) {
    var selectClose = html.indexOf("</select>", mobileOpen);
    if (selectClose > 0 && selectClose < firstBox) {
      var afterSelect = html.indexOf("</div>", selectClose);
      if (afterSelect > 0 && afterSelect < firstBox) {
        return {
          index: afterSelect + "</div>".length,
          method: "after-year-navi-mobile",
          firstBoxIndex: firstBox
        };
      }
    }
  }

  var pcOpen = html.search(/<div\s+class=["']year-navi-pc["']/i);
  if (pcOpen >= 0 && pcOpen < firstBox) {
    var pcChunk = html.slice(pcOpen, firstBox);
    var lastClose = pcChunk.lastIndexOf("</div>");
    if (lastClose >= 0) {
      return {
        index: pcOpen + lastClose + "</div>".length,
        method: "after-year-navi-pc",
        firstBoxIndex: firstBox
      };
    }
  }

  return { index: firstBox, method: "before-first-diary-box", firstBoxIndex: firstBox };
}

function normalizeArticleHtml(articleHtml, lineEnding) {
  var html = String(articleHtml || "").trim();
  if (!html) return "";
  var nl = lineEnding || "\n";
  html = html.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (nl !== "\n") html = html.split("\n").join(nl);
  if (html.indexOf("diary-box") === -1) {
    throw new Error("挿入する記事HTMLに .diary-box がありません");
  }
  var pad = nl + nl;
  return pad + html + nl;
}

function verifyShellPreserved(beforeHtml, afterHtml, insertSnippet) {
  var insertAt = findInsertIndex(beforeHtml);
  if (insertAt.index < 0) {
    return { ok: false, error: "挿入位置なし" };
  }
  var expected = beforeHtml.slice(0, insertAt.index) + insertSnippet + beforeHtml.slice(insertAt.index);
  if (expected !== afterHtml) {
    return { ok: false, error: "追加以外の差分があります" };
  }
  return { ok: true };
}

function insertArticle(beforeHtml, articleHtml) {
  var before = String(beforeHtml || "");
  var insertAt = findInsertIndex(before);
  if (insertAt.index < 0) {
    return { ok: false, error: insertAt.error || "挿入位置を検出できません" };
  }
  var snippet;
  try {
    snippet = normalizeArticleHtml(articleHtml, detectLineEnding(before));
  } catch (e) {
    return { ok: false, error: (e && e.message) || "記事HTMLが不正です" };
  }
  var after = before.slice(0, insertAt.index) + snippet + before.slice(insertAt.index);
  var shell = verifyShellPreserved(before, after, snippet);
  if (!shell.ok) {
    return { ok: false, error: shell.error || "既存HTMLを保てませんでした" };
  }
  return {
    ok: true,
    beforeHtml: before,
    afterHtml: after,
    insertSnippet: snippet,
    insertAt: insertAt
  };
}

module.exports = {
  detectLineEnding: detectLineEnding,
  findInsertIndex: findInsertIndex,
  normalizeArticleHtml: normalizeArticleHtml,
  verifyShellPreserved: verifyShellPreserved,
  insertArticle: insertArticle
};
