/**
 * Smile AI Studio — diary/index.htm への活動日記挿入
 * Browser: window.SmileDiaryIndexInsert
 *
 * - ダウンロード書き出し（バックアップ＋更新HTML）
 * - ローカル反映（バックアップ作成後に CorporateSite の index.htm を更新）
 * - FTP / GitHub / Xserver は行わない
 */
(function (root, factory) {
  var api = factory(root.SmileDiaryHtml || null, root.SmileCharset || null);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SmileDiaryIndexInsert = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (DiaryHtml, Charset) {
  "use strict";

  function detectLineEnding(text) {
    if (Charset && typeof Charset.detectLineEndingInfo === "function") {
      return Charset.detectLineEndingInfo(text).ending;
    }
    if (/\r\n/.test(text)) return "\r\n";
    if (/\r/.test(text)) return "\r";
    return "\n";
  }

  function detectCharset(text) {
    if (Charset && typeof Charset.extractMetaCharset === "function") {
      var meta = Charset.extractMetaCharset(text);
      if (meta && meta.label) return meta.label;
    }
    var m = String(text || "").match(/charset\s*=\s*["']?\s*([a-zA-Z0-9_\-]+)/i);
    if (m && m[1]) return m[1];
    return "Shift_JIS";
  }

  function normalizeCharsetLabel(label) {
    if (Charset && typeof Charset.normalizeFamily === "function") {
      var fam = Charset.normalizeFamily(label);
      return fam.canonical || fam.family || "shift-jis";
    }
    var s = String(label || "").toLowerCase().replace(/[_]/g, "");
    if (s === "shiftjis" || s === "sjis" || s === "csshiftjis" || s === "windows31j") {
      return "shift-jis";
    }
    if (s.indexOf("utf") === 0) return "utf-8";
    return "shift-jis";
  }

  function decodeArrayBuffer(buffer, preferredLabel) {
    if (Charset && typeof Charset.detectEncoding === "function") {
      var det = Charset.detectEncoding(buffer);
      if (det.ok) {
        return { text: det.text, usedCharset: det.decoderLabel, ok: true, detection: det };
      }
      return { text: "", usedCharset: preferredLabel || "", ok: false, error: det.error || "判定失敗" };
    }
    var labels = [];
    var pref = normalizeCharsetLabel(preferredLabel);
    labels.push(pref);
    if (pref !== "utf-8") labels.push("utf-8");
    if (pref !== "shift-jis") labels.push("shift-jis");
    labels.push("shift_jis", "windows-31j");
    var lastErr = null;
    for (var i = 0; i < labels.length; i++) {
      try {
        var dec = new TextDecoder(labels[i], { fatal: false });
        var text = dec.decode(buffer);
        return { text: text, usedCharset: labels[i], ok: true };
      } catch (e) {
        lastErr = e;
      }
    }
    return {
      text: "",
      usedCharset: preferredLabel || "",
      ok: false,
      error: (lastErr && lastErr.message) || "デコード失敗"
    };
  }

  function countDiaryBoxes(html) {
    var m = String(html || "").match(/<div\s+class=["']diary-box["']/gi);
    return m ? m.length : 0;
  }

  function extractDiaryDates(html) {
    var dates = [];
    var re = /<div\s+class=["']diary-date["']\s*>\s*([0-9]{4}\.[0-9]{2}\.[0-9]{2})\s*<\/div>/gi;
    var m;
    while ((m = re.exec(html))) {
      dates.push(m[1]);
    }
    return dates;
  }

  function extractDiaryIds(html) {
    var ids = [];
    var re = /<div\s+class=["']diary-box["'][^>]*\bid=["']([^"']+)["']/gi;
    var m;
    while ((m = re.exec(html))) {
      ids.push(m[1]);
    }
    // also id before class
    re = /<div\s+[^>]*\bid=["']([^"']+)["'][^>]*class=["']diary-box["']/gi;
    while ((m = re.exec(html))) {
      if (ids.indexOf(m[1]) === -1) ids.push(m[1]);
    }
    return ids;
  }

  function findInsertIndex(html) {
    var firstBox = html.search(/<div\s+class=["']diary-box["']/i);
    if (firstBox === -1) {
      // fallback: after diary-base / year-navi
      var navi = html.search(/<\/div>\s*(?:\r?\n){1,}\s*<div\s+class=["']year-navi-mobile["']/i);
      if (navi >= 0) {
        var closeMobile = html.indexOf("</div>", html.indexOf("year-navi-mobile"));
        // find end of year-navi-mobile block roughly
      }
      var base = html.search(/id=["']diary-base["']/i);
      if (base >= 0) {
        return {
          index: html.length,
          method: "append-fallback",
          error: "既存の .diary-box が見つかりません"
        };
      }
      return { index: -1, method: "none", error: "挿入位置を検出できません" };
    }

    // Prefer after year-navi-mobile closing, else right before first diary-box
    var mobileOpen = html.search(/<div\s+class=["']year-navi-mobile["']/i);
    if (mobileOpen >= 0 && mobileOpen < firstBox) {
      // find matching close of year-navi-mobile: look for </select> then </div>
      var selectClose = html.indexOf("</select>", mobileOpen);
      if (selectClose > 0 && selectClose < firstBox) {
        var afterSelect = html.indexOf("</div>", selectClose);
        if (afterSelect > 0 && afterSelect < firstBox) {
          var insertAt = afterSelect + "</div>".length;
          return { index: insertAt, method: "after-year-navi-mobile", firstBoxIndex: firstBox };
        }
      }
    }

    var pcOpen = html.search(/<div\s+class=["']year-navi-pc["']/i);
    if (pcOpen >= 0 && pcOpen < firstBox) {
      // find end of year-navi-pc before first box
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
    // Ensure leading newline style similar to existing file
    var nl = lineEnding || "\n";
    // Convert internal newlines to file's line ending
    html = html.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (nl !== "\n") html = html.split("\n").join(nl);
    // Existing file uses blank lines before each diary-box
    var pad = nl + nl + nl + nl + nl + nl;
    if (html.indexOf("diary-box") === -1) {
      throw new Error("挿入する記事HTMLに .diary-box がありません");
    }
    return pad + html + nl;
  }

  function buildDateKeyFromDots(dots) {
    var m = String(dots || "").match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
    if (!m) return "";
    return m[1].slice(2) + m[2] + m[3];
  }

  function getArticleIdentity(articleHtml, meta) {
    meta = meta || {};
    var html = String(articleHtml || "");
    var idMatch = html.match(/\bid=["'](diary-[^"']+)["']/i);
    var dateMatch = html.match(/class=["']diary-date["']\s*>\s*([0-9]{4}\.[0-9]{2}\.[0-9]{2})/i);
    var titleMatch = html.match(/Smile AI Studio タイトル:\s*([^-<]+)/);
    var dots = dateMatch ? dateMatch[1] : (meta.dotsDate || "");
    var dateKey = idMatch ? String(idMatch[1]).replace(/^diary-/, "") : buildDateKeyFromDots(dots);
    if (!dateKey && meta.dateKey) dateKey = meta.dateKey;
    return {
      diaryId: idMatch ? idMatch[1] : (dateKey ? "diary-" + dateKey : ""),
      dotsDate: dots,
      dateKey: dateKey,
      title: (titleMatch ? titleMatch[1].trim() : (meta.title || ""))
    };
  }

  function checkDuplicate(sourceHtml, identity) {
    var reasons = [];
    var strongReasons = [];
    var source = String(sourceHtml || "");
    identity = identity || {};

    var idMatched = false;
    if (identity.diaryId) {
      var idRe = new RegExp(
        "id=[\"']" + identity.diaryId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\"']",
        "i"
      );
      if (idRe.test(source)) {
        idMatched = true;
        strongReasons.push("同一diaryId: " + identity.diaryId);
        reasons.push("同一diaryId: " + identity.diaryId);
      }
    }

    var titleMatched = false;
    if (identity.title) {
      var titleComment = "Smile AI Studio タイトル: " + identity.title;
      if (source.indexOf(titleComment) >= 0) {
        titleMatched = true;
        strongReasons.push("同一タイトル: " + identity.title);
        reasons.push("同一タイトル: " + identity.title);
      }
    }

    var dateMatched = false;
    if (identity.dotsDate) {
      var dates = extractDiaryDates(source);
      if (dates.indexOf(identity.dotsDate) >= 0) {
        dateMatched = true;
        reasons.push("同一公開日: " + identity.dotsDate);
      }
    }

    var lyteboxMatched = false;
    if (identity.dateKey && source.indexOf("lytebox[" + identity.dateKey + "]") >= 0) {
      lyteboxMatched = true;
      var lyteReason = "同一日付キー(lytebox): " + identity.dateKey;
      if (reasons.indexOf("同一diaryId: diary-" + identity.dateKey) === -1) {
        reasons.push(lyteReason);
      }
      // diaryId と同じ日付キーなら強い一致扱い
      if (idMatched || (identity.diaryId === "diary-" + identity.dateKey)) {
        if (strongReasons.indexOf(lyteReason) === -1) strongReasons.push(lyteReason);
      }
    }

    // 本文HTMLの一部比較（タイトルコメント＋公開日ブロックが同一なら反映済み）
    var htmlMatched = false;
    if (identity.dotsDate && identity.title) {
      var dateBlock = 'class="diary-date">' + identity.dotsDate;
      var titleBlock = "Smile AI Studio タイトル: " + identity.title;
      if (source.indexOf(dateBlock) >= 0 && source.indexOf(titleBlock) >= 0) {
        htmlMatched = true;
        if (strongReasons.indexOf("同一タイトル: " + identity.title) === -1) {
          strongReasons.push("HTML上のタイトル・公開日が一致");
        }
      }
    }

    // このサイトは公開日＝diaryId（1日1記事）のため、
    // diaryId / タイトル / HTML一致なら「既に反映済み」
    var alreadyReflected = !!(idMatched || titleMatched || htmlMatched ||
      (dateMatched && lyteboxMatched && idMatched));
    // 日付だけ一致（別タイトル想定）も diaryId が同じになるため反映不可
    var dateConflict = !alreadyReflected && dateMatched;
    var isDuplicate = reasons.length > 0;

    var userMessage = "";
    if (alreadyReflected) {
      userMessage = "既に反映済みです";
    } else if (dateConflict) {
      userMessage = "同じ公開日の記事が既にあります（1日1記事のため追加できません）";
    } else if (isDuplicate) {
      userMessage = "同じ記事が存在します。";
    }

    return {
      isDuplicate: isDuplicate,
      alreadyReflected: alreadyReflected,
      dateConflict: dateConflict,
      reasons: reasons,
      strongReasons: strongReasons,
      message: userMessage,
      existingCount: countDiaryBoxes(source),
      existingDates: extractDiaryDates(source).slice(0, 8),
      existingIds: extractDiaryIds(source).slice(0, 8)
    };
  }

  function validateImagePaths(articleHtml) {
    var html = String(articleHtml || "");
    var issues = [];
    var srcRe = /<(?:img|a)\b[^>]*(?:src|href)=["']([^"']+)["']/gi;
    var m;
    var paths = [];
    while ((m = srcRe.exec(html))) {
      var p = m[1];
      if (/^image\//i.test(p) || /\.jpe?g$/i.test(p)) paths.push(p);
    }
    // Only check diary image refs inside article fragment
    var imgSrc = html.match(/<img\b[^>]*src=["']([^"']+)["']/gi) || [];
    imgSrc.forEach(function (tag) {
      var sm = tag.match(/src=["']([^"']+)["']/i);
      if (!sm) return;
      var src = sm[1];
      if (!/^image\/\d{6}-\d+\.jpg$/i.test(src)) {
        issues.push("通常画像パスが仕様外です: " + src);
      }
    });
    var hrefs = html.match(/<a\b[^>]*href=["']([^"']+)["']/gi) || [];
    hrefs.forEach(function (tag) {
      var hm = tag.match(/href=["']([^"']+)["']/i);
      if (!hm) return;
      var href = hm[1];
      if (/^image\//i.test(href) && !/^image\/\d{6}-\d+b\.jpg$/i.test(href)) {
        issues.push("拡大画像パスが仕様外です: " + href);
      }
      // 個別記事ページリンク禁止
      if (/\.htm(?:l)?$/i.test(href) && !/^image\//i.test(href) && href.indexOf("http") !== 0) {
        if (!/^#/.test(href)) {
          issues.push("個別記事ページへの相対リンクは追加しません: " + href);
        }
      }
    });
    return { ok: issues.length === 0, issues: issues, paths: paths };
  }

  function validateStructure(articleHtml) {
    var html = String(articleHtml || "");
    var issues = [];
    if (html.indexOf("diary-box") === -1) issues.push(".diary-box がありません");
    if (html.indexOf("diary-date") === -1) issues.push(".diary-date がありません");
    if (html.indexOf("diary-main") === -1) issues.push(".diary-main がありません");
    var openBox = (html.match(/<div\s+class=["']diary-box["']/gi) || []).length;
    if (openBox !== 1) issues.push("新規 .diary-box は1件である必要があります（現在" + openBox + "）");
    // rough tag balance for div
    var opens = (html.match(/<div\b/gi) || []).length;
    var closes = (html.match(/<\/div>/gi) || []).length;
    if (opens !== closes) {
      issues.push("div の開閉数が一致しません（開" + opens + " / 閉" + closes + "）");
    }
    return { ok: issues.length === 0, issues: issues, openBox: openBox };
  }

  function hasMojibake(text) {
    // Common mojibake markers when SJIS read as Latin1/UTF-8 wrongly
    if (/ã[-Ÿ]|Ã.|ï¿½|�/.test(text)) return true;
    // Expect some Japanese in corporate diary pages
    if (text.indexOf("diary-box") >= 0 && !/[ぁ-んァ-ン一-龥]/.test(text)) {
      return true;
    }
    return false;
  }

  function buildDiffSummary(beforeHtml, afterHtml, insertSnippet) {
    var beforeCount = countDiaryBoxes(beforeHtml);
    var afterCount = countDiaryBoxes(afterHtml);
    var beforeLen = beforeHtml.length;
    var afterLen = afterHtml.length;
    var insertAt = findInsertIndex(beforeHtml);
    var contextBefore = "";
    var contextAfter = "";
    if (insertAt.index >= 0) {
      contextBefore = beforeHtml.slice(Math.max(0, insertAt.index - 120), insertAt.index);
      contextAfter = beforeHtml.slice(insertAt.index, insertAt.index + 120);
    }
    return {
      beforeCount: beforeCount,
      afterCount: afterCount,
      addedCount: afterCount - beforeCount,
      beforeLength: beforeLen,
      afterLength: afterLen,
      lengthDelta: afterLen - beforeLen,
      insertMethod: insertAt.method,
      insertIndex: insertAt.index,
      contextBefore: contextBefore,
      contextAfter: contextAfter,
      insertedPreview: String(insertSnippet || "").slice(0, 500)
    };
  }

  /**
   * UI表示用フィールドを必ず埋める（早期 return でも undefined / 「—」を出さない）
   */
  function finalizePreparedResult(partial, ctx) {
    partial = partial || {};
    ctx = ctx || {};
    var source = String(ctx.sourceHtml || partial.beforeHtml || "");
    var detection = ctx.detection || partial.detection || null;
    var lineInfo = ctx.lineInfo || null;
    if (!lineInfo && Charset && typeof Charset.detectLineEndingInfo === "function" && source) {
      lineInfo = Charset.detectLineEndingInfo(source);
    }
    var charsetMeta = (detection && detection.metaCharset) ||
      partial.charsetMeta ||
      (source ? detectCharset(source) : "");
    var beforeCount = typeof partial.beforeCount === "number"
      ? partial.beforeCount
      : countDiaryBoxes(source);
    var afterCount = typeof partial.afterCount === "number"
      ? partial.afterCount
      : beforeCount;
    var insertAt = partial.insertAt || (source ? findInsertIndex(source) : { index: -1, method: "none" });
    var inputCharset = partial.inputCharset ||
      (detection && detection.displayCharset) ||
      charsetMeta ||
      "";
    var outputCharset = partial.outputCharset ||
      (partial.encodePreflight && partial.encodePreflight.outputCharset) ||
      (partial.ok ? inputCharset : "") ||
      inputCharset ||
      "";
    var lineEnding = partial.lineEnding ||
      (detection && detection.lineEndingLabel) ||
      (lineInfo && lineInfo.label) ||
      "";
    var checks = partial.checks || {};
    var defaultChecks = {
      sourceLoaded: !!source,
      charsetDetected: !!(detection && detection.ok) || !!inputCharset,
      noMojibake: checks.noMojibake != null ? !!checks.noMojibake : true,
      insertPositionFound: !!(insertAt && insertAt.index >= 0),
      existingCountPreserved: afterCount === beforeCount + 1,
      onlyOneAdded: afterCount === beforeCount + 1,
      noDuplicate: !(partial.duplicate && partial.duplicate.isDuplicate),
      imagePathsOk: checks.imagePathsOk != null ? !!checks.imagePathsOk : true,
      structureOk: checks.structureOk != null ? !!checks.structureOk : true,
      originalUntouched: checks.originalUntouched != null ? !!checks.originalUntouched : true,
      outputCharsetMatch: checks.outputCharsetMatch != null ? !!checks.outputCharsetMatch : false,
      roundTripOk: checks.roundTripOk != null ? !!checks.roundTripOk : false,
      noUnmappable: checks.noUnmappable != null ? !!checks.noUnmappable : true,
      lineEndingPreserved: checks.lineEndingPreserved != null
        ? !!checks.lineEndingPreserved
        : !(detection && detection.lineEndingMixed),
      bomPreserved: checks.bomPreserved != null ? !!checks.bomPreserved : true,
      canPublishLocal: checks.canPublishLocal != null ? !!checks.canPublishLocal : false
    };
    Object.keys(defaultChecks).forEach(function (k) {
      if (checks[k] == null) checks[k] = defaultChecks[k];
    });

    var result = {};
    Object.keys(partial).forEach(function (k) { result[k] = partial[k]; });
    result.ok = !!partial.ok;
    result.alreadyReflected = !!partial.alreadyReflected ||
      !!(partial.duplicate && partial.duplicate.alreadyReflected);
    result.dateConflict = !!partial.dateConflict ||
      !!(partial.duplicate && partial.duplicate.dateConflict);
    result.blockers = partial.blockers || (partial.error ? [partial.error] : []);
    result.warnings = partial.warnings || [];
    result.identity = partial.identity || null;
    result.duplicate = partial.duplicate || null;
    result.structure = partial.structure || null;
    result.images = partial.images || null;
    result.insertAt = insertAt;
    result.insertPosition = insertAt;
    result.lineEnding = lineEnding;
    result.lineEndingRaw = partial.lineEndingRaw ||
      (detection && detection.lineEnding) ||
      (lineInfo && lineInfo.ending) ||
      "\n";
    result.lineEndingMixed = !!(partial.lineEndingMixed || (detection && detection.lineEndingMixed) ||
      (lineInfo && lineInfo.mixed));
    result.charsetMeta = charsetMeta;
    result.detection = detection;
    result.encodePreflight = partial.encodePreflight || null;
    result.inputCharset = inputCharset || "—";
    result.outputCharset = outputCharset || inputCharset || "—";
    result.bom = partial.bom != null ? !!partial.bom : !!(detection && detection.bom);
    result.unmappable = partial.unmappable || [];
    result.unmappableCount = typeof partial.unmappableCount === "number"
      ? partial.unmappableCount
      : result.unmappable.length;
    result.canPublish = !!partial.canPublish;
    result.beforeHtml = partial.beforeHtml != null ? partial.beforeHtml : source;
    result.afterHtml = partial.afterHtml != null ? partial.afterHtml : source;
    result.insertSnippet = partial.insertSnippet || "";
    result.beforeCount = beforeCount;
    result.afterCount = afterCount;
    result.articleCount = { before: beforeCount, after: afterCount };
    result.checks = checks;
    result.diff = partial.diff || buildDiffSummary(result.beforeHtml, result.afterHtml, result.insertSnippet);
    result.analysis = partial.analysis ||
      (source ? analyzeIndexStructure(source, detection) : null);
    result.validationResult = {
      ok: !!result.ok,
      canPublish: !!result.canPublish,
      roundTripOk: !!checks.roundTripOk,
      charset: result.inputCharset,
      outputCharset: result.outputCharset,
      lineEnding: result.lineEnding,
      bom: result.bom,
      articleCountBefore: beforeCount,
      articleCountAfter: afterCount,
      insertPosition: insertAt,
      alreadyReflected: !!result.alreadyReflected,
      dateConflict: !!result.dateConflict,
      blockers: result.blockers.slice(),
      error: partial.error || null
    };
    return result;
  }

  /**
   * @param {string} sourceHtml
   * @param {string} articleHtml
   * @param {{ title?: string, dateKey?: string, dotsDate?: string, force?: boolean, detection?: object }} [options]
   */
  function prepareInsert(sourceHtml, articleHtml, options) {
    options = options || {};
    var source = String(sourceHtml || "");
    if (!source) {
      throw new Error("元HTMLが空です");
    }
    var detection = options.detection || null;
    var lineInfo = Charset && Charset.detectLineEndingInfo
      ? Charset.detectLineEndingInfo(source)
      : { ending: detectLineEnding(source), label: "LF", mixed: false };
    var charsetMeta = (detection && detection.metaCharset) || detectCharset(source);
    var ctxBase = { sourceHtml: source, detection: detection, lineInfo: lineInfo };
    var identity = getArticleIdentity(articleHtml, options);
    var dup = checkDuplicate(source, identity);
    if (dup.isDuplicate && !options.force) {
      var existingCount = dup.existingCount != null ? dup.existingCount : countDiaryBoxes(source);
      return finalizePreparedResult({
        ok: false,
        error: dup.message || "同じ記事が存在します。",
        blockers: [dup.message || "同じ記事が存在します。"],
        duplicate: dup,
        alreadyReflected: !!dup.alreadyReflected,
        dateConflict: !!dup.dateConflict,
        identity: identity,
        lineEnding: lineInfo.label || (detection && detection.lineEndingLabel) || "",
        charsetMeta: charsetMeta,
        detection: detection,
        inputCharset: (detection && detection.displayCharset) || charsetMeta,
        outputCharset: (detection && detection.displayCharset) || charsetMeta,
        bom: !!(detection && detection.bom),
        beforeCount: existingCount,
        afterCount: existingCount,
        beforeHtml: source,
        afterHtml: source,
        checks: {
          sourceLoaded: true,
          charsetDetected: !!(detection && detection.ok) || !!charsetMeta,
          noMojibake: !(Charset && Charset.hasMojibake ? Charset.hasMojibake(source) : hasMojibake(source)),
          insertPositionFound: findInsertIndex(source).index >= 0,
          existingCountPreserved: false,
          onlyOneAdded: false,
          noDuplicate: false,
          imagePathsOk: true,
          structureOk: true,
          originalUntouched: true,
          outputCharsetMatch: !!(detection && detection.ok),
          roundTripOk: !!dup.alreadyReflected,
          noUnmappable: true,
          lineEndingPreserved: !(detection && detection.lineEndingMixed),
          bomPreserved: true,
          canPublishLocal: false
        }
      }, ctxBase);
    }

    var struct = validateStructure(articleHtml);
    var images = validateImagePaths(articleHtml);
    var insertAt = findInsertIndex(source);
    if (insertAt.index < 0) {
      return finalizePreparedResult({
        ok: false,
        error: insertAt.error || "挿入位置を検出できません",
        blockers: [insertAt.error || "挿入位置を検出できません"],
        identity: identity,
        structure: struct,
        images: images,
        detection: detection,
        insertAt: insertAt,
        inputCharset: (detection && detection.displayCharset) || charsetMeta,
        outputCharset: (detection && detection.displayCharset) || charsetMeta,
        beforeCount: countDiaryBoxes(source),
        afterCount: countDiaryBoxes(source),
        beforeHtml: source,
        afterHtml: source,
        checks: {
          sourceLoaded: true,
          charsetDetected: !!(detection && detection.ok) || !!charsetMeta,
          insertPositionFound: false,
          existingCountPreserved: false,
          onlyOneAdded: false,
          noDuplicate: !dup.isDuplicate,
          imagePathsOk: images.ok,
          structureOk: struct.ok,
          originalUntouched: true,
          outputCharsetMatch: false,
          roundTripOk: false,
          noUnmappable: true,
          lineEndingPreserved: !(detection && detection.lineEndingMixed),
          bomPreserved: true,
          canPublishLocal: false
        }
      }, ctxBase);
    }

    var lineEnding = (detection && detection.lineEnding) || lineInfo.ending;
    var snippet = normalizeArticleHtml(articleHtml, lineEnding);
    var updated = source.slice(0, insertAt.index) + snippet + source.slice(insertAt.index);
    // Keep meta charset as-is (must match output bytes)
    if (Charset && typeof Charset.preserveMetaCharset === "function") {
      updated = Charset.preserveMetaCharset(updated, detection);
    }
    var beforeCount = countDiaryBoxes(source);
    var afterCount = countDiaryBoxes(updated);

    // Encoding preflight (same charset as source)
    var encodePreflight = { ok: false, unmappable: [], canPublish: false };
    if (detection && Charset && typeof Charset.encodeForSameCharset === "function") {
      encodePreflight = Charset.encodeForSameCharset(updated, detection);
    } else if (!detection) {
      encodePreflight = {
        ok: false,
        error: "文字コード判定結果がありません",
        unmappable: [],
        canPublish: false
      };
    } else {
      encodePreflight = {
        ok: false,
        error: "SmileCharset が読み込まれていません",
        unmappable: [],
        canPublish: false
      };
    }

    var checks = {
      sourceLoaded: true,
      charsetDetected: !!(detection && detection.ok),
      noMojibake: !(Charset && Charset.hasMojibake
        ? (Charset.hasMojibake(source) || Charset.hasMojibake(snippet))
        : (hasMojibake(source) || hasMojibake(snippet))),
      insertPositionFound: insertAt.index >= 0,
      existingCountPreserved: afterCount === beforeCount + 1,
      onlyOneAdded: afterCount === beforeCount + 1,
      noDuplicate: !dup.isDuplicate,
      imagePathsOk: images.ok,
      structureOk: struct.ok,
      originalUntouched: true,
      outputCharsetMatch: !!(encodePreflight && encodePreflight.ok),
      roundTripOk: !!(encodePreflight && encodePreflight.ok && encodePreflight.roundTrip && encodePreflight.roundTrip.ok),
      noUnmappable: !(encodePreflight && encodePreflight.unmappable && encodePreflight.unmappable.length),
      lineEndingPreserved: !(detection && detection.lineEndingMixed),
      bomPreserved: !(detection && detection.family === "utf-8") ||
        !!(encodePreflight && encodePreflight.ok && !!encodePreflight.bom === !!detection.bom),
      canPublishLocal: !!(encodePreflight && encodePreflight.canPublish)
    };

    var blockers = [];
    if (!checks.charsetDetected) blockers.push("元文字コード判定に失敗");
    if (!checks.noMojibake) blockers.push("文字化けの可能性があります");
    if (!checks.insertPositionFound) blockers.push("挿入位置を検出できません");
    if (!checks.onlyOneAdded) blockers.push("新規記事が1件になっていません（前" + beforeCount + "→後" + afterCount + "）");
    if (!checks.noDuplicate) blockers.push(dup.message || "同じ記事が存在します。");
    if (!checks.imagePathsOk) blockers = blockers.concat(images.issues);
    if (!checks.structureOk) blockers = blockers.concat(struct.issues);
    if (detection && detection.lineEndingMixed) {
      blockers.push("改行コードが混在しているため書き出しを停止します");
    }
    if (!checks.bomPreserved) {
      blockers.push("BOM状態が元ファイルと一致しません");
    }
    if (!encodePreflight.ok) {
      blockers.push(encodePreflight.error || "同一文字コードでの再エンコードに失敗");
    }
    if (encodePreflight.unmappable && encodePreflight.unmappable.length) {
      blockers.push("変換不能文字が " + encodePreflight.unmappable.length + " 件あります");
    }

    var warnings = (dup.reasons || []).slice();

    return finalizePreparedResult({
      ok: blockers.length === 0,
      blockers: blockers,
      warnings: warnings,
      identity: identity,
      duplicate: dup,
      structure: struct,
      images: images,
      insertAt: insertAt,
      lineEnding: (detection && detection.lineEndingLabel) || lineInfo.label ||
        (lineEnding === "\r\n" ? "CRLF" : (lineEnding === "\r" ? "CR" : "LF")),
      lineEndingRaw: lineEnding,
      lineEndingMixed: !!(detection && detection.lineEndingMixed) || !!lineInfo.mixed,
      charsetMeta: charsetMeta,
      detection: detection,
      encodePreflight: encodePreflight,
      inputCharset: detection ? detection.displayCharset : charsetMeta,
      outputCharset: encodePreflight.outputCharset || (detection && detection.displayCharset) || charsetMeta || "",
      bom: !!(detection && detection.bom),
      unmappable: encodePreflight.unmappable || [],
      unmappableCount: (encodePreflight.unmappable || []).length,
      canPublish: blockers.length === 0 && !!(encodePreflight && encodePreflight.canPublish),
      beforeHtml: source,
      afterHtml: updated,
      insertSnippet: snippet,
      beforeCount: beforeCount,
      afterCount: afterCount,
      checks: checks,
      diff: buildDiffSummary(source, updated, snippet),
      downloadName: "diary-index-updated-" + (identity.dateKey || "diary") + ".htm",
      backupName: "diary-index-backup-" + timestampStamp() + ".htm",
      localBackupName: backupStampName(),
      analysis: detection
        ? analyzeIndexStructure(source, detection)
        : analyzeIndexStructure(source, null)
    }, ctxBase);
  }

  function timestampStamp() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, "0"); }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function readFileAsSource(file) {
    if (!file) return Promise.reject(new Error("ファイルが選択されていません"));
    return file.arrayBuffer().then(function (buffer) {
      if (Charset && typeof Charset.detectEncoding === "function") {
        var det = Charset.detectEncoding(buffer);
        if (!det.ok) {
          return Promise.reject(new Error(det.error || "文字コード判定に失敗しました"));
        }
        return {
          fileName: file.name || "index.htm",
          byteLength: buffer.byteLength,
          originalBuffer: buffer,
          text: det.text,
          usedCharset: det.decoderLabel,
          metaCharset: det.metaCharset || det.displayCharset,
          displayCharset: det.displayCharset,
          detection: det,
          bom: !!det.bom,
          lineEnding: det.lineEnding,
          lineEndingLabel: det.lineEndingLabel,
          lineEndingMixed: !!det.lineEndingMixed,
          charsetReasons: det.reasons || [],
          diaryCount: countDiaryBoxes(det.text),
          mojibake: Charset.hasMojibake ? Charset.hasMojibake(det.text) : hasMojibake(det.text)
        };
      }
      var decoded = decodeArrayBuffer(buffer, "Shift_JIS");
      if (!decoded.ok || !decoded.text) {
        return Promise.reject(new Error(decoded.error || "HTMLの読み込みに失敗しました"));
      }
      return {
        fileName: file.name || "index.htm",
        byteLength: buffer.byteLength,
        originalBuffer: buffer,
        text: decoded.text,
        usedCharset: decoded.usedCharset,
        metaCharset: detectCharset(decoded.text),
        displayCharset: detectCharset(decoded.text),
        detection: decoded.detection || null,
        bom: false,
        lineEnding: detectLineEnding(decoded.text),
        diaryCount: countDiaryBoxes(decoded.text),
        mojibake: hasMojibake(decoded.text)
      };
    });
  }

  /**
   * 同一文字コードでエンコード。失敗時は UTF-8 に落とさず停止。
   */
  function encodeForDownload(text, detectionOrMeta) {
    if (!Charset || typeof Charset.encodeForSameCharset !== "function") {
      return {
        ok: false,
        error: "SmileCharset が未読込のため書き出しを停止しました（UTF-8への自動切替はしません）",
        canPublish: false
      };
    }
    var detection = detectionOrMeta;
    if (!detection || !detection.family) {
      return {
        ok: false,
        error: "文字コード判定結果がないため書き出しを停止しました",
        canPublish: false
      };
    }
    return Charset.encodeForSameCharset(text, detection);
  }

  function downloadBlob(fileName, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName || "download.htm";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
    }, 2000);
    return true;
  }

  function downloadBackupAndUpdated(prepared, originalBuffer, originalFileName) {
    if (!prepared || !prepared.ok || !prepared.canPublish) {
      throw new Error(
        (prepared && (prepared.error || (prepared.blockers || []).join(" / "))) ||
        "検査に問題があるため書き出せません"
      );
    }
    var detection = prepared.detection;
    if (!detection) {
      throw new Error("文字コード判定結果がないため書き出しを停止しました");
    }
    var encoded = encodeForDownload(prepared.afterHtml, detection);
    if (!encoded.ok || !encoded.blob) {
      var detail = encoded.error || "再エンコード失敗";
      if (encoded.unmappable && encoded.unmappable.length) {
        detail += " / 変換不能: " + encoded.unmappable.slice(0, 5).map(function (u) {
          return "「" + u.char + "」(U+" + u.codePoint.toString(16).toUpperCase() + "@" + u.index + ")";
        }).join(", ");
      }
      throw new Error(detail + "（UTF-8への自動切替は行いません）");
    }

    var backupName = prepared.backupName || ("diary-index-backup-" + timestampStamp() + ".htm");
    var updatedName = prepared.downloadName || "diary-index-updated.htm";

    // 1) Backup = exact original bytes
    var backupBlob = new Blob([originalBuffer], { type: "application/octet-stream" });
    downloadBlob(backupName, backupBlob);

    // 2) Updated file in SAME charset
    return new Promise(function (resolve) {
      setTimeout(function () {
        downloadBlob(updatedName, encoded.blob);
        resolve({
          backupName: backupName,
          updatedName: updatedName,
          encodingNote: "",
          outputCharset: encoded.outputCharset || prepared.outputCharset,
          inputCharset: prepared.inputCharset,
          bom: !!encoded.bom,
          originalFileName: originalFileName || "",
          originalUntouched: true,
          canPublish: true,
          roundTripOk: !!(encoded.roundTrip && encoded.roundTrip.ok)
        });
      }, 400);
    });
  }

  function runSelfCheckSample() {
    var sampleSource = [
      '<!DOCTYPE HTML><html><head><meta http-equiv="Content-Type" content="text/html; charset=Shift_JIS"></head><body>',
      '<div id="diary-base">',
      '<div class="year-navi-mobile"><select><option>2025</option></select></div>',
      "",
      "",
      '	  <div class="diary-box">',
      '	    <div class="diary-title-box"><div class="diary-date">2025.08.26</div></div>',
      '	    <div class="diary-main">既存記事</div>',
      "	  </div>",
      "</div></body></html>"
    ].join("\n");
    var article = [
      '	  <div class="diary-box" id="diary-260720">',
      '	    <div class="diary-title-box">',
      '	      <div class="diary-date">2026.07.20</div>',
      "	    </div>",
      "	    <!-- Smile AI Studio タイトル: 挿入テスト -->",
      '	    <div class="diary-main">',
      '<span class="diary-photo-r"><a href="image/260720-1b.jpg" rel="lytebox[260720]"><img src="image/260720-1.jpg" width="400" height="300" border="0" alt="テスト"></a></span>本文です。',
      "	    </div>",
      "	  </div>",
      ""
    ].join("\n");
    var detection = null;
    if (Charset && typeof Charset.detectEncoding === "function") {
      // Build a SJIS buffer for sample via encode, else utf-8 labeled as shift-jis text-only path
      var enc = Charset.encodeText(sampleSource, "shift-jis", { bom: false });
      if (enc.ok) {
        detection = Charset.detectEncoding(enc.bytes);
        if (detection.ok) {
          sampleSource = detection.text;
        }
      } else {
        detection = {
          ok: true,
          family: "shift-jis",
          decoderLabel: "shift-jis",
          displayCharset: "Shift_JIS",
          metaCharset: "Shift_JIS",
          bom: false,
          lineEnding: "\n",
          lineEndingLabel: "LF",
          lineEndingMixed: false,
          reasons: ["sample-fallback"]
        };
      }
    }
    return prepareInsert(sampleSource, article, {
      title: "挿入テスト",
      dateKey: "260720",
      detection: detection
    });
  }

  function hasMojibakeSafe(text) {
    if (Charset && typeof Charset.hasMojibake === "function") {
      return Charset.hasMojibake(text);
    }
    return hasMojibake(text);
  }

  var CORPORATE_INDEX_REL = "CorporateSite/diary/diary/index.htm";
  var CORPORATE_DIARY_DIR_REL = "CorporateSite/diary/diary";
  var LOCAL_APPLY_API = "/api/local-diary-apply";

  function findDiaryBoxRanges(html) {
    var s = String(html || "");
    var ranges = [];
    var re = /<div\s+class=["']diary-box["'][^>]*>/gi;
    var m;
    while ((m = re.exec(s))) {
      var start = m.index;
      var i = start + m[0].length;
      var depth = 1;
      while (i < s.length && depth > 0) {
        var nextOpen = s.indexOf("<div", i);
        var nextClose = s.indexOf("</div>", i);
        if (nextClose < 0) break;
        if (nextOpen >= 0 && nextOpen < nextClose) {
          depth += 1;
          i = nextOpen + 4;
        } else {
          depth -= 1;
          i = nextClose + 6;
        }
      }
      ranges.push({ start: start, end: i, openTag: m[0] });
    }
    return ranges;
  }

  /**
   * 作業①: index.htm 構造解析
   */
  function analyzeIndexStructure(text, detection) {
    var source = String(text || "");
    var det = detection || null;
    var lineInfo = Charset && Charset.detectLineEndingInfo
      ? Charset.detectLineEndingInfo(source)
      : { ending: detectLineEnding(source), label: "LF", mixed: false, counts: {} };
    var ranges = findDiaryBoxRanges(source);
    var insertAt = findInsertIndex(source);
    var first = ranges.length ? ranges[0] : null;
    var last = ranges.length ? ranges[ranges.length - 1] : null;
    return {
      ok: ranges.length > 0 && insertAt.index >= 0,
      charset: (det && det.displayCharset) || detectCharset(source),
      family: det && det.family,
      decoderLabel: det && det.decoderLabel,
      metaCharset: (det && det.metaCharset) || detectCharset(source),
      bom: !!(det && det.bom),
      lineEnding: (det && det.lineEnding) || lineInfo.ending,
      lineEndingLabel: (det && det.lineEndingLabel) || lineInfo.label,
      lineEndingMixed: !!(det && det.lineEndingMixed) || !!lineInfo.mixed,
      diaryBoxCount: ranges.length,
      diaryBoxRanges: ranges,
      firstDiaryBoxStart: first ? first.start : -1,
      firstDiaryBoxEnd: first ? first.end : -1,
      lastDiaryBoxStart: last ? last.start : -1,
      lastDiaryBoxEnd: last ? last.end : -1,
      insertIndex: insertAt.index,
      insertMethod: insertAt.method,
      dates: extractDiaryDates(source),
      ids: extractDiaryIds(source)
    };
  }

  function backupStampName() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, "0"); }
    return "index_backup_" +
      d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + ".htm";
  }

  function bytesToBase64(u8) {
    var bytes = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
    var CHUNK = 0x8000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += CHUNK) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    }
    return btoa(parts.join(""));
  }

  function loadCorporateIndexFromLocalServer(relPath) {
    var path = relPath || CORPORATE_INDEX_REL;
    return fetch("/" + path.replace(/^\/+/, "") + "?t=" + Date.now(), {
      cache: "no-store"
    }).then(function (res) {
      if (!res.ok) {
        throw new Error("index.htm の読込に失敗しました（HTTP " + res.status + "）。ローカル静的サーバを起動してください。");
      }
      return res.arrayBuffer();
    }).then(function (buffer) {
      if (Charset && typeof Charset.detectEncoding === "function") {
        var det = Charset.detectEncoding(buffer);
        if (!det.ok) {
          throw new Error(det.error || "文字コード判定に失敗しました");
        }
        var analysis = analyzeIndexStructure(det.text, det);
        return {
          fileName: path.split("/").pop() || "index.htm",
          relativePath: path,
          byteLength: buffer.byteLength,
          originalBuffer: buffer,
          text: det.text,
          usedCharset: det.decoderLabel,
          metaCharset: det.metaCharset || det.displayCharset,
          displayCharset: det.displayCharset,
          detection: det,
          bom: !!det.bom,
          lineEnding: det.lineEnding,
          lineEndingLabel: det.lineEndingLabel,
          lineEndingMixed: !!det.lineEndingMixed,
          charsetReasons: det.reasons || [],
          diaryCount: countDiaryBoxes(det.text),
          mojibake: Charset.hasMojibake ? Charset.hasMojibake(det.text) : hasMojibake(det.text),
          analysis: analysis,
          fromCorporatePath: true
        };
      }
      throw new Error("SmileCharset が未読込です");
    });
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
    // Existing boxes byte-identical as substrings
    var beforeRanges = findDiaryBoxRanges(beforeHtml);
    var afterRanges = findDiaryBoxRanges(afterHtml);
    if (afterRanges.length !== beforeRanges.length + 1) {
      return { ok: false, error: "記事件数が +1 になっていません" };
    }
    for (var i = 0; i < beforeRanges.length; i++) {
      var b = beforeHtml.slice(beforeRanges[i].start, beforeRanges[i].end);
      var a = afterHtml.slice(afterRanges[i + 1].start, afterRanges[i + 1].end);
      if (b !== a) {
        return { ok: false, error: "既存記事 #" + (i + 1) + " が変化しています" };
      }
    }
    return { ok: true };
  }

  /**
   * ローカル CorporateSite へ反映（バックアップ作成 → index.htm 書換）
   * ローカル静的サーバ API 経由。FTP/GitHub なし。
   */
  function applyLocalReflect(prepared, options) {
    options = options || {};
    if (!prepared || !prepared.ok || !prepared.canPublish) {
      return Promise.reject(new Error(
        (prepared && (prepared.error || (prepared.blockers || []).join(" / "))) ||
        "検査に問題があるため反映できません"
      ));
    }
    if (prepared.duplicate && prepared.duplicate.isDuplicate) {
      return Promise.reject(new Error(prepared.duplicate.message || "同じ記事が存在します。"));
    }
    var shell = verifyShellPreserved(prepared.beforeHtml, prepared.afterHtml, prepared.insertSnippet);
    if (!shell.ok) {
      return Promise.reject(new Error(shell.error || "HTML構造の保全検査に失敗しました"));
    }
    var detection = prepared.detection;
    var encoded = encodeForDownload(prepared.afterHtml, detection);
    if (!encoded.ok || !encoded.bytes) {
      return Promise.reject(new Error(
        (encoded.error || "再エンコード失敗") + "（UTF-8への自動切替は行いません）"
      ));
    }
    var backupName = options.backupName || backupStampName();
    var indexRel = options.indexRelativePath || CORPORATE_INDEX_REL;
    var body = {
      indexRelativePath: indexRel,
      backupName: backupName,
      updatedBase64: bytesToBase64(encoded.bytes),
      expectedBeforeCount: prepared.beforeCount,
      expectedAfterCount: prepared.afterCount
    };
    return fetch(LOCAL_APPLY_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok || !json || !json.ok) {
          throw new Error((json && json.error) || ("反映APIエラー HTTP " + res.status));
        }
        return {
          ok: true,
          message: "ローカルホームページへ反映しました",
          backupName: json.backupName || backupName,
          backupPath: json.backupPath || (CORPORATE_DIARY_DIR_REL + "/" + backupName),
          indexPath: json.indexPath || indexRel,
          beforeCount: prepared.beforeCount,
          afterCount: prepared.afterCount,
          outputCharset: encoded.outputCharset || prepared.outputCharset,
          bom: !!encoded.bom,
          lineEnding: prepared.lineEnding,
          insertMethod: prepared.insertAt && prepared.insertAt.method,
          identity: prepared.identity,
          shellPreserved: true,
          charsetPreserved: true
        };
      });
    });
  }

  return {
    detectLineEnding: detectLineEnding,
    detectCharset: detectCharset,
    decodeArrayBuffer: decodeArrayBuffer,
    countDiaryBoxes: countDiaryBoxes,
    extractDiaryDates: extractDiaryDates,
    extractDiaryIds: extractDiaryIds,
    findInsertIndex: findInsertIndex,
    findDiaryBoxRanges: findDiaryBoxRanges,
    analyzeIndexStructure: analyzeIndexStructure,
    prepareInsert: prepareInsert,
    finalizePreparedResult: finalizePreparedResult,
    readFileAsSource: readFileAsSource,
    loadCorporateIndexFromLocalServer: loadCorporateIndexFromLocalServer,
    encodeForDownload: encodeForDownload,
    downloadBlob: downloadBlob,
    downloadBackupAndUpdated: downloadBackupAndUpdated,
    applyLocalReflect: applyLocalReflect,
    verifyShellPreserved: verifyShellPreserved,
    backupStampName: backupStampName,
    checkDuplicate: checkDuplicate,
    validateImagePaths: validateImagePaths,
    validateStructure: validateStructure,
    hasMojibake: hasMojibakeSafe,
    runSelfCheckSample: runSelfCheckSample,
    getArticleIdentity: getArticleIdentity,
    CORPORATE_INDEX_REL: CORPORATE_INDEX_REL,
    CORPORATE_DIARY_DIR_REL: CORPORATE_DIARY_DIR_REL
  };
});
