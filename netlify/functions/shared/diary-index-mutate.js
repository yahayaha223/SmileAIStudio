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

function normalizeDiaryBoxId(raw) {
  var id = String(raw || "").trim();
  if (/^diary-\d{6}$/i.test(id)) return id.toLowerCase();
  if (/^\d{6}$/.test(id)) return "diary-" + id;
  return "";
}

function findMatchingDivEnd(html, openIndex) {
  var gt = html.indexOf(">", openIndex);
  if (gt < 0) return -1;
  var depth = 1;
  var re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = gt + 1;
  var m;
  while ((m = re.exec(html))) {
    if (/^<div\b/i.test(m[0])) {
      depth += 1;
    } else if (/^<\/div/i.test(m[0])) {
      depth -= 1;
      if (depth === 0) return m.index + m[0].length;
    }
  }
  return -1;
}

function findDiaryBoxRanges(html) {
  html = String(html || "");
  var ranges = [];
  var re = /<div\s+(?=[^>]*\bclass=["'][^"']*\bdiary-box\b[^"']*["'])[^>]*>/gi;
  var m;
  while ((m = re.exec(html))) {
    var end = findMatchingDivEnd(html, m.index);
    if (end < 0) {
      return { ok: false, error: "diary-box の終端を検出できません", ranges: ranges };
    }
    var openTag = m[0];
    var idMatch = openTag.match(/\bid=["']([^"']+)["']/i);
    var inner = html.slice(m.index, end);
    ranges.push({
      id: idMatch ? String(idMatch[1]) : "",
      start: m.index,
      end: end,
      html: inner
    });
    re.lastIndex = end;
  }
  return { ok: true, ranges: ranges };
}

function decodeBasicEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function excerptFromBoxHtml(boxHtml) {
  var html = String(boxHtml || "");
  var titleMatch = html.match(/Smile AI Studio タイトル:\s*([^-<]+)/);
  var dateMatch = html.match(/class=["']diary-date["']\s*>\s*([0-9]{4}\.[0-9]{2}\.[0-9]{2})/i);
  var stripped = decodeBasicEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
  if (dateMatch && stripped.indexOf(dateMatch[1]) === 0) {
    stripped = stripped.slice(dateMatch[1].length).trim();
  }
  var title = titleMatch ? titleMatch[1].trim() : "";
  if (!title) title = stripped.slice(0, 40);
  return {
    date: dateMatch ? dateMatch[1] : "",
    title: title,
    excerpt: stripped.slice(0, 80)
  };
}

function listDiaryArticles(html) {
  var found = findDiaryBoxRanges(html);
  if (!found.ok) return found;
  var articles = found.ranges.map(function (range) {
    var meta = excerptFromBoxHtml(range.html);
    return {
      id: range.id || "",
      date: meta.date,
      title: meta.title,
      excerpt: meta.excerpt
    };
  }).filter(function (row) {
    return !!row.id;
  });
  return { ok: true, articles: articles, count: articles.length };
}

function expandRemovedRange(html, start, end) {
  var before = html.slice(0, start);
  var after = html.slice(end);
  var cutStart = start;
  var cutEnd = end;
  if (/\r\n(\r\n)+$/.test(before)) cutStart -= 2;
  else if (/\n\n+$/.test(before)) cutStart -= 1;
  if (cutStart < 0) cutStart = 0;
  if (/^(\r\n)+/.test(after)) cutEnd += 2;
  else if (/^\n+/.test(after)) cutEnd += 1;
  return { start: cutStart, end: cutEnd };
}

function verifyRemovalPreserved(beforeHtml, afterHtml, start, end) {
  var expected = beforeHtml.slice(0, start) + beforeHtml.slice(end);
  if (expected !== afterHtml) {
    return { ok: false, error: "削除以外の差分があります" };
  }
  return { ok: true };
}

function removeArticle(beforeHtml, diaryId) {
  var before = String(beforeHtml || "");
  var id = normalizeDiaryBoxId(diaryId);
  if (!id) {
    return { ok: false, error: "日記IDが不正です", code: "invalid_diary_id" };
  }
  var found = findDiaryBoxRanges(before);
  if (!found.ok) {
    return { ok: false, error: found.error || "日記一覧を読めません", code: "parse_failed" };
  }
  var matches = found.ranges.filter(function (row) {
    return String(row.id || "").toLowerCase() === id;
  });
  if (!matches.length) {
    return { ok: false, error: "指定した日記が見つかりません", code: "not_found" };
  }
  if (matches.length > 1) {
    return { ok: false, error: "同じ日付の日記が複数あるため消せません", code: "ambiguous_id" };
  }
  if (found.ranges.length <= 1) {
    return { ok: false, error: "最後の1件は消せません。公開の仕組みを保つためです", code: "last_article" };
  }
  var target = matches[0];
  var cut = expandRemovedRange(before, target.start, target.end);
  var after = before.slice(0, cut.start) + before.slice(cut.end);
  var shell = verifyRemovalPreserved(before, after, cut.start, cut.end);
  if (!shell.ok) {
    return { ok: false, error: shell.error || "既存HTMLを保てませんでした", code: "shell_changed" };
  }
  var afterFound = findDiaryBoxRanges(after);
  if (!afterFound.ok || afterFound.ranges.length !== found.ranges.length - 1) {
    return { ok: false, error: "削除後の日記件数が想定と違います", code: "count_mismatch" };
  }
  var leftover = afterFound.ranges.some(function (row) {
    return String(row.id || "").toLowerCase() === id;
  });
  if (leftover) {
    return { ok: false, error: "指定した日記を取り除けませんでした", code: "still_present" };
  }
  return {
    ok: true,
    beforeHtml: before,
    afterHtml: after,
    removedId: id,
    removedHtml: target.html,
    beforeCount: found.ranges.length,
    afterCount: afterFound.ranges.length
  };
}

module.exports = {
  detectLineEnding: detectLineEnding,
  findInsertIndex: findInsertIndex,
  normalizeArticleHtml: normalizeArticleHtml,
  verifyShellPreserved: verifyShellPreserved,
  insertArticle: insertArticle,
  normalizeDiaryBoxId: normalizeDiaryBoxId,
  findDiaryBoxRanges: findDiaryBoxRanges,
  listDiaryArticles: listDiaryArticles,
  removeArticle: removeArticle
};
