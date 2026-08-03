/**
 * Smile AI Studio — 文字コード判定・再エンコード（CDN非依存）
 * Browser: window.SmileCharset
 *
 * 対応: UTF-8 / Shift_JIS / Windows-31J (CP932)
 * SJISエンコードは js/smile-cp932-map.js (SmileCp932Map) を使用
 */
(function (root, factory) {
  var api = factory(root.SmileCp932Map || null);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SmileCharset = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Cp932Map) {
  "use strict";

  var UTF8_BOM = [0xef, 0xbb, 0xbf];

  function toU8(buffer) {
    if (!buffer) return new Uint8Array(0);
    if (buffer instanceof Uint8Array) return buffer;
    if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
    return new Uint8Array(buffer);
  }

  function hasUtf8Bom(u8) {
    return u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf;
  }

  function detectLineEndingInfo(text) {
    var s = String(text || "");
    var crlf = (s.match(/\r\n/g) || []).length;
    var lfOnly = (s.match(/(^|[^\r])\n/g) || []).length;
    // count lone CR
    var crOnly = (s.match(/\r(?!\n)/g) || []).length;
    // Better LF count: total \n minus those that are part of \r\n
    var totalLf = (s.match(/\n/g) || []).length;
    var pureLf = totalLf - crlf;
    var mixed = false;
    var ending = "\n";
    var label = "LF";
    if (crlf > 0 && pureLf === 0 && crOnly === 0) {
      ending = "\r\n";
      label = "CRLF";
    } else if (crOnly > 0 && crlf === 0 && pureLf === 0) {
      ending = "\r";
      label = "CR";
    } else if (crlf > 0 && (pureLf > 0 || crOnly > 0)) {
      mixed = true;
      ending = "\r\n";
      label = "CRLF（混在あり）";
    } else if (pureLf > 0) {
      ending = "\n";
      label = "LF";
    }
    return {
      ending: ending,
      label: label,
      mixed: mixed,
      counts: { crlf: crlf, lf: pureLf, cr: crOnly }
    };
  }

  function extractMetaCharset(text) {
    var s = String(text || "");
    var reasons = [];
    var http = s.match(
      /<meta\b[^>]*http-equiv\s*=\s*["']?Content-Type["']?[^>]*>/i
    );
    if (http) {
      var cm = http[0].match(/charset\s*=\s*["']?\s*([a-zA-Z0-9_\-]+)/i);
      if (cm) {
        reasons.push("meta http-equiv Content-Type: " + cm[1]);
        return { label: cm[1], reasons: reasons, source: "http-equiv" };
      }
    }
    var meta = s.match(/<meta\b[^>]*charset\s*=\s*["']?\s*([a-zA-Z0-9_\-]+)/i);
    if (meta) {
      reasons.push("meta charset: " + meta[1]);
      return { label: meta[1], reasons: reasons, source: "meta-charset" };
    }
    return { label: "", reasons: reasons, source: "none" };
  }

  function normalizeFamily(label) {
    var raw = String(label || "").trim();
    // strip separators: Shift_JIS / shift-jis / Windows-31J → comparable form
    var s = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!s) return { family: "unknown", canonical: "", display: "" };
    if (s === "utf8" || s.indexOf("utf8") === 0) {
      return { family: "utf-8", canonical: "utf-8", display: raw || "UTF-8" };
    }
    if (s === "windows31j" || s === "cswindows31j" || s === "cp932" || s === "ms932") {
      return { family: "windows-31j", canonical: "windows-31j", display: raw || "Windows-31J" };
    }
    if (
      s === "shiftjis" ||
      s === "sjis" ||
      s === "csshiftjis" ||
      s === "xsjis" ||
      s === "mskanji"
    ) {
      return { family: "shift-jis", canonical: "shift-jis", display: raw || "Shift_JIS" };
    }
    return { family: "unknown", canonical: s, display: raw };
  }

  function scoreDecodedText(text) {
    var s = String(text || "");
    var score = 0;
    var jp = (s.match(/[ぁ-んァ-ン一-龥]/g) || []).length;
    score += Math.min(jp, 500);
    if (/diary-box|えがお|活動/.test(s)) score += 50;
    // mojibake penalties
    if (/�/.test(s)) score -= 200;
    if (/Ã.|Â.|ã[-Ÿ]/.test(s)) score -= 150;
    if (jp === 0 && /diary-box/.test(s)) score -= 80;
    return score;
  }

  function tryDecode(u8, label) {
    try {
      var dec = new TextDecoder(label, { fatal: false });
      var text = dec.decode(u8);
      return { ok: true, text: text, label: label, score: scoreDecodedText(text) };
    } catch (e) {
      return { ok: false, text: "", label: label, score: -9999, error: e && e.message };
    }
  }

  /**
   * 元ファイルの文字コードを判定
   * @param {ArrayBuffer|Uint8Array} buffer
   */
  function detectEncoding(buffer) {
    var u8 = toU8(buffer);
    var reasons = [];
    var bom = hasUtf8Bom(u8);
    if (bom) reasons.push("UTF-8 BOM (EF BB BF) を検出");

    var head = u8;
    if (bom) head = u8.subarray(3);
    // Probe meta via utf-8 and latin1-ish
    var utfProbe = tryDecode(head.slice(0, Math.min(head.length, 1200)), "utf-8");
    var metaInfo = extractMetaCharset(utfProbe.text || "");
    if (!metaInfo.label) {
      // try shift-jis probe for meta
      var sjisProbe = tryDecode(head.slice(0, Math.min(head.length, 1200)), "shift-jis");
      metaInfo = extractMetaCharset(sjisProbe.text || "");
    }
    if (metaInfo.label) {
      reasons = reasons.concat(metaInfo.reasons);
    }

    var metaFam = normalizeFamily(metaInfo.label);
    var candidates = [];
    function addCandidate(label, why) {
      if (!label) return;
      candidates.push({ label: label, why: why });
    }
    if (bom) addCandidate("utf-8", "BOM");
    if (metaFam.canonical) addCandidate(metaFam.canonical, "meta");
    if (metaFam.family === "shift-jis") addCandidate("windows-31j", "meta近縁");
    if (metaFam.family === "windows-31j") addCandidate("shift-jis", "meta近縁");
    addCandidate("shift-jis", "既定候補");
    addCandidate("windows-31j", "既定候補");
    addCandidate("utf-8", "既定候補");

    var best = null;
    var seen = {};
    candidates.forEach(function (c) {
      if (seen[c.label]) return;
      seen[c.label] = true;
      var body = bom && c.label === "utf-8" ? head : u8;
      // For utf-8 with BOM, decode without BOM bytes for cleaner text
      var decoded = tryDecode(c.label === "utf-8" && bom ? head : u8, c.label);
      if (!decoded.ok) return;
      var bonus = 0;
      if (metaFam.canonical && c.label === metaFam.canonical) bonus += 100;
      if (bom && c.label === "utf-8") bonus += 120;
      if (metaFam.family === "shift-jis" && (c.label === "shift-jis" || c.label === "windows-31j")) {
        bonus += 40;
      }
      var row = {
        label: c.label,
        why: c.why,
        score: decoded.score + bonus,
        text: decoded.text
      };
      if (!best || row.score > best.score) best = row;
    });

    if (!best) {
      return {
        ok: false,
        error: "文字コードを判定できませんでした",
        bom: bom,
        reasons: reasons
      };
    }

    var familyInfo = normalizeFamily(best.label);
    // Prefer meta display spelling when same family
    var display = metaInfo.label || familyInfo.display || best.label;
    if (familyInfo.family === "utf-8") display = bom ? "UTF-8 (BOM)" : (metaInfo.label || "UTF-8");
    if (familyInfo.family === "shift-jis" && metaFam.family === "shift-jis" && metaInfo.label) {
      display = metaInfo.label;
    }
    if (familyInfo.family === "windows-31j" && metaInfo.label) {
      display = metaInfo.label;
    }

    reasons.push("採用: " + display + "（内部ラベル " + best.label + ", score=" + best.score + "）");

    var lineInfo = detectLineEndingInfo(best.text);
    if (lineInfo.mixed) reasons.push("改行コードが混在しています");

    return {
      ok: true,
      family: familyInfo.family,
      decoderLabel: best.label,
      displayCharset: display,
      metaCharset: metaInfo.label || "",
      metaSource: metaInfo.source,
      bom: bom,
      reasons: reasons,
      text: best.text,
      lineEnding: lineInfo.ending,
      lineEndingLabel: lineInfo.label,
      lineEndingMixed: lineInfo.mixed,
      lineEndingCounts: lineInfo.counts,
      bytes: u8
    };
  }

  function getCp932Map() {
    // Prefer live global (script order / late load), fall back to factory capture
    var live = null;
    try {
      if (typeof globalThis !== "undefined" && globalThis.SmileCp932Map) {
        live = globalThis.SmileCp932Map;
      } else if (typeof window !== "undefined" && window.SmileCp932Map) {
        live = window.SmileCp932Map;
      }
    } catch (e) { /* ignore */ }
    if (!live) live = Cp932Map;
    if (!live || !live.encode) return null;
    return live.encode;
  }

  /**
   * 文字列を指定ファミリでエンコード
   * @returns {{ ok: boolean, bytes?: Uint8Array, unmappable?: Array, error?: string }}
   */
  function encodeText(text, family, options) {
    options = options || {};
    var s = String(text || "");
    var fam = normalizeFamily(family).family;
    if (fam === "unknown") fam = String(family || "").toLowerCase();

    if (fam === "utf-8") {
      var utf = new TextEncoder().encode(s);
      if (options.bom) {
        var withBom = new Uint8Array(3 + utf.length);
        withBom.set(UTF8_BOM, 0);
        withBom.set(utf, 3);
        return { ok: true, bytes: withBom, unmappable: [], outputCharset: "UTF-8", bom: true };
      }
      return { ok: true, bytes: utf, unmappable: [], outputCharset: "UTF-8", bom: false };
    }

    if (fam === "shift-jis" || fam === "windows-31j" || fam === "shift_jis") {
      var map = getCp932Map();
      if (!map) {
        return {
          ok: false,
          error: "CP932マップ (SmileCp932Map) が読み込まれていません",
          unmappable: []
        };
      }
      var out = [];
      var unmappable = [];
      for (var i = 0; i < s.length; i++) {
        var cp = s.charCodeAt(i);
        // surrogate pair
        if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
          var low = s.charCodeAt(i + 1);
          if (low >= 0xdc00 && low <= 0xdfff) {
            var full = ((cp - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
            unmappable.push({
              char: s.slice(i, i + 2),
              codePoint: full,
              index: i,
              reason: "補助文字はCP932にマップできません"
            });
            i += 1;
            continue;
          }
        }
        if (cp <= 0x7f) {
          out.push(cp);
          continue;
        }
        var bytes = map[cp];
        if (!bytes || !bytes.length) {
          unmappable.push({
            char: s.charAt(i),
            codePoint: cp,
            index: i,
            reason: "CP932に存在しない文字"
          });
          continue;
        }
        for (var b = 0; b < bytes.length; b++) out.push(bytes[b] & 0xff);
      }
      if (unmappable.length) {
        return {
          ok: false,
          error: "変換不能文字が " + unmappable.length + " 件あります",
          unmappable: unmappable,
          outputCharset: fam === "windows-31j" ? "Windows-31J" : "Shift_JIS"
        };
      }
      return {
        ok: true,
        bytes: new Uint8Array(out),
        unmappable: [],
        outputCharset: fam === "windows-31j" ? "Windows-31J" : "Shift_JIS",
        bom: false
      };
    }

    return { ok: false, error: "未対応の文字コードです: " + family, unmappable: [] };
  }

  function decodeBytes(bytes, decoderLabel) {
    var u8 = toU8(bytes);
    var label = decoderLabel || "utf-8";
    var bom = hasUtf8Bom(u8);
    var target = u8;
    if (bom && normalizeFamily(label).family === "utf-8") {
      target = u8.subarray(3);
    }
    try {
      var text = new TextDecoder(label, { fatal: false }).decode(target);
      return { ok: true, text: text, bom: bom };
    } catch (e) {
      return { ok: false, text: "", error: e && e.message, bom: bom };
    }
  }

  function preserveMetaCharset(text, detection) {
    // Do NOT rewrite meta — keep original spelling. Caller must encode to match.
    return String(text || "");
  }

  /**
   * 書き出し前の再検証
   */
  function verifyRoundTrip(originalText, encodedBytes, detection) {
    var decoded = decodeBytes(encodedBytes, detection.decoderLabel);
    var issues = [];
    if (!decoded.ok) {
      issues.push("再デコードに失敗: " + (decoded.error || ""));
      return { ok: false, issues: issues };
    }
    if (decoded.text !== originalText) {
      // find first diff
      var a = originalText;
      var b = decoded.text;
      var idx = 0;
      var max = Math.min(a.length, b.length);
      while (idx < max && a.charAt(idx) === b.charAt(idx)) idx += 1;
      issues.push(
        "再デコード一致に失敗（位置 " + idx + "付近: 元「" +
        a.slice(idx, idx + 12) + "」≠ 再「" + b.slice(idx, idx + 12) + "」）"
      );
    }
    if (detection.bom && !hasUtf8Bom(toU8(encodedBytes))) {
      issues.push("元はUTF-8 BOM付きですが、出力にBOMがありません");
    }
    if (!detection.bom && hasUtf8Bom(toU8(encodedBytes)) && detection.family === "utf-8") {
      issues.push("元はBOMなしですが、出力にBOMが付いています");
    }
    var lineOut = detectLineEndingInfo(decoded.text);
    if (lineOut.ending !== detection.lineEnding && !detection.lineEndingMixed) {
      issues.push(
        "改行コードが変化しています（元 " + detection.lineEndingLabel +
        " → 出 " + lineOut.label + "）"
      );
    }
    return {
      ok: issues.length === 0,
      issues: issues,
      decodedLength: decoded.text.length,
      originalLength: originalText.length
    };
  }

  function hasMojibake(text) {
    var s = String(text || "");
    if (/�/.test(s)) return true;
    if (/Ã.|Â.|ã[-Ÿ]|ï¿½/.test(s)) return true;
    if (/diary-box/.test(s) && !/[ぁ-んァ-ン一-龥]/.test(s)) return true;
    return false;
  }

  function encodeForSameCharset(text, detection) {
    if (!detection || !detection.ok) {
      return { ok: false, error: "文字コード判定結果がありません", canPublish: false };
    }
    var family = detection.family;
    if (family === "unknown" && detection.decoderLabel) {
      family = normalizeFamily(detection.decoderLabel).family;
    }
    if (family === "unknown" && detection.metaCharset) {
      family = normalizeFamily(detection.metaCharset).family;
    }
    if (family === "unknown") {
      return {
        ok: false,
        error: "文字コードを特定できないため書き出しを停止しました（UTF-8への自動切替はしません）",
        canPublish: false
      };
    }
    // Keep detection.family in sync when recovered from decoder/meta
    detection.family = family;
    var encoded = encodeText(text, family, { bom: !!detection.bom && family === "utf-8" });
    if (!encoded.ok) {
      return {
        ok: false,
        error: encoded.error || "エンコード失敗",
        unmappable: encoded.unmappable || [],
        canPublish: false,
        outputCharset: encoded.outputCharset || detection.displayCharset
      };
    }
    var round = verifyRoundTrip(text, encoded.bytes, detection);
    if (!round.ok) {
      return {
        ok: false,
        error: "再検証失敗: " + round.issues.join(" / "),
        roundTrip: round,
        unmappable: [],
        canPublish: false,
        outputCharset: encoded.outputCharset
      };
    }
    if (hasMojibake(text)) {
      return {
        ok: false,
        error: "文字化けの可能性があるため書き出しを停止しました",
        canPublish: false
      };
    }
    var mime = family === "utf-8"
      ? "text/html;charset=utf-8"
      : "text/html;charset=Shift_JIS";
    return {
      ok: true,
      bytes: encoded.bytes,
      blob: new Blob([encoded.bytes], { type: mime }),
      outputCharset: detection.displayCharset || encoded.outputCharset,
      decoderLabel: detection.decoderLabel,
      bom: !!detection.bom,
      unmappable: [],
      roundTrip: round,
      canPublish: true,
      encodingNote: ""
    };
  }

  return {
    detectEncoding: detectEncoding,
    detectLineEndingInfo: detectLineEndingInfo,
    extractMetaCharset: extractMetaCharset,
    normalizeFamily: normalizeFamily,
    encodeText: encodeText,
    decodeBytes: decodeBytes,
    verifyRoundTrip: verifyRoundTrip,
    encodeForSameCharset: encodeForSameCharset,
    hasUtf8Bom: hasUtf8Bom,
    hasMojibake: hasMojibake,
    preserveMetaCharset: preserveMetaCharset
  };
});
