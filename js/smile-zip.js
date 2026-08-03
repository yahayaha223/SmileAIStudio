/**
 * Smile AI Studio — 最小 ZIP（STORE / 無圧縮）
 * JPEG など既圧縮ファイル向け。外部CDN非依存。
 * Browser: window.SmileZip
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SmileZip = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var j = 0; j < 8; j++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(u8) {
    var crc = 0xffffffff;
    for (var i = 0; i < u8.length; i++) {
      crc = CRC_TABLE[(crc ^ u8[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function encodeUtf8(str) {
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(String(str || ""));
    }
    var s = unescape(encodeURIComponent(String(str || "")));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function toU8(data) {
    if (!data) return new Uint8Array(0);
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      throw new Error("Blobは事前にArrayBufferへ変換してください");
    }
    if (typeof data === "string") return encodeUtf8(data);
    return new Uint8Array(data);
  }

  function u16(n) {
    var b = new Uint8Array(2);
    b[0] = n & 0xff;
    b[1] = (n >>> 8) & 0xff;
    return b;
  }

  function u32(n) {
    var b = new Uint8Array(4);
    b[0] = n & 0xff;
    b[1] = (n >>> 8) & 0xff;
    b[2] = (n >>> 16) & 0xff;
    b[3] = (n >>> 24) & 0xff;
    return b;
  }

  function concat(parts) {
    var total = 0;
    parts.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total);
    var off = 0;
    parts.forEach(function (p) {
      out.set(p, off);
      off += p.length;
    });
    return out;
  }

  /**
   * @param {Array<{name:string, data:Uint8Array|ArrayBuffer|string}>} files
   * @returns {Blob}
   */
  function buildZipBlob(files) {
    var list = Array.isArray(files) ? files : [];
    var localParts = [];
    var centralParts = [];
    var offset = 0;
    var count = 0;

    list.forEach(function (file) {
      if (!file || !file.name) return;
      var nameBytes = encodeUtf8(String(file.name).replace(/\\/g, "/"));
      var data = toU8(file.data);
      var crc = crc32(data);
      var localHeader = concat([
        u32(0x04034b50),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        nameBytes
      ]);
      localParts.push(localHeader, data);
      var central = concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes
      ]);
      centralParts.push(central);
      offset += localHeader.length + data.length;
      count += 1;
    });

    var centralDir = concat(centralParts);
    var end = concat([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(count),
      u16(count),
      u32(centralDir.length),
      u32(offset),
      u16(0)
    ]);
    var zipBytes = concat(localParts.concat([centralDir, end]));
    return new Blob([zipBytes], { type: "application/zip" });
  }

  function blobToArrayBuffer(blob) {
    if (!blob) return Promise.resolve(new ArrayBuffer(0));
    if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error || new Error("FileReader failed")); };
      fr.readAsArrayBuffer(blob);
    });
  }

  function buildZipFromEntries(entries) {
    var chain = Promise.resolve([]);
    (entries || []).forEach(function (entry) {
      chain = chain.then(function (acc) {
        if (!entry || !entry.name) return acc;
        if (typeof entry.data === "string" || entry.data instanceof Uint8Array ||
            entry.data instanceof ArrayBuffer) {
          acc.push({ name: entry.name, data: entry.data });
          return acc;
        }
        if (typeof Blob !== "undefined" && entry.data instanceof Blob) {
          return blobToArrayBuffer(entry.data).then(function (buf) {
            acc.push({ name: entry.name, data: buf });
            return acc;
          });
        }
        return acc;
      });
    });
    return chain.then(function (files) {
      return buildZipBlob(files);
    });
  }

  return {
    buildZipBlob: buildZipBlob,
    buildZipFromEntries: buildZipFromEntries,
    blobToArrayBuffer: blobToArrayBuffer,
    crc32: crc32
  };
});
