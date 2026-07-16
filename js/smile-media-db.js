/**
 * Smile AI Studio — 活動日記画像の端末内一時保管（IndexedDB）
 * Browser: window.SmileMediaDB
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SmileMediaDB = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DB_NAME = "SmileAIStudioMediaDB";
  var DB_VERSION = 1;
  var STORE = "diaryImages";
  var dbPromise = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function checkMediaStorageAvailability() {
    try {
      if (typeof indexedDB === "undefined" || !indexedDB) {
        return { ok: false, reason: "IndexedDB未対応" };
      }
      return { ok: true, reason: "" };
    } catch (e) {
      return { ok: false, reason: (e && e.message) || "IndexedDB確認失敗" };
    }
  }

  function openMediaDatabase() {
    var avail = checkMediaStorageAvailability();
    if (!avail.ok) {
      return Promise.reject(new Error(avail.reason || "IndexedDB利用不可"));
    }
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        dbPromise = null;
        reject(e);
        return;
      }
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: "imageId" });
          store.createIndex("diaryId", "diaryId", { unique: false });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };
      req.onsuccess = function (ev) {
        resolve(ev.target.result);
      };
      req.onerror = function () {
        dbPromise = null;
        reject(req.error || new Error("MediaDB open failed"));
      };
    });
    return dbPromise;
  }

  function idbReq(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function saveDiaryImageBlob(imageData) {
    if (!imageData || !imageData.imageId || !imageData.blob) {
      return Promise.reject(new Error("imageIdとblobが必要です"));
    }
    var now = nowIso();
    var record = {
      imageId: String(imageData.imageId),
      diaryId: String(imageData.diaryId || ""),
      fileName: String(imageData.fileName || ""),
      fileType: String(imageData.fileType || (imageData.blob && imageData.blob.type) || ""),
      fileSize: Number(imageData.fileSize || (imageData.blob && imageData.blob.size) || 0) || 0,
      blob: imageData.blob,
      createdAt: imageData.createdAt || now,
      updatedAt: now
    };
    return openMediaDatabase().then(function (db) {
      var tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      return new Promise(function (resolve, reject) {
        tx.oncomplete = function () { resolve(record.imageId); };
        tx.onerror = function () { reject(tx.error || new Error("save failed")); };
        tx.onabort = function () { reject(tx.error || new Error("save aborted")); };
      });
    }).catch(function (err) {
      console.warn("[SmileMediaDB] saveDiaryImageBlob", err);
      throw err;
    });
  }

  function getDiaryImageBlob(imageId) {
    if (!imageId) return Promise.resolve(null);
    return openMediaDatabase().then(function (db) {
      var tx = db.transaction(STORE, "readonly");
      return idbReq(tx.objectStore(STORE).get(String(imageId)));
    }).then(function (rec) {
      return rec || null;
    }).catch(function (err) {
      console.warn("[SmileMediaDB] getDiaryImageBlob", err);
      return null;
    });
  }

  function getDiaryImagesByDiaryId(diaryId) {
    if (!diaryId) return Promise.resolve([]);
    return openMediaDatabase().then(function (db) {
      var tx = db.transaction(STORE, "readonly");
      return idbReq(tx.objectStore(STORE).index("diaryId").getAll(String(diaryId)));
    }).then(function (list) {
      return list || [];
    }).catch(function (err) {
      console.warn("[SmileMediaDB] getDiaryImagesByDiaryId", err);
      return [];
    });
  }

  function getAllDiaryImageRecords() {
    return openMediaDatabase().then(function (db) {
      var tx = db.transaction(STORE, "readonly");
      return idbReq(tx.objectStore(STORE).getAll());
    }).then(function (list) {
      return list || [];
    }).catch(function (err) {
      console.warn("[SmileMediaDB] getAllDiaryImageRecords", err);
      return [];
    });
  }

  function deleteDiaryImageBlob(imageId) {
    if (!imageId) return Promise.resolve(false);
    return openMediaDatabase().then(function (db) {
      var tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(String(imageId));
      return new Promise(function (resolve, reject) {
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    }).catch(function (err) {
      console.warn("[SmileMediaDB] deleteDiaryImageBlob", err);
      return false;
    });
  }

  function deleteDiaryImagesByDiaryId(diaryId) {
    return getDiaryImagesByDiaryId(diaryId).then(function (list) {
      var chain = Promise.resolve();
      list.forEach(function (rec) {
        chain = chain.then(function () { return deleteDiaryImageBlob(rec.imageId); });
      });
      return chain.then(function () { return list.length; });
    });
  }

  function updateDiaryImageDiaryId(imageId, diaryId) {
    return getDiaryImageBlob(imageId).then(function (rec) {
      if (!rec) return false;
      rec.diaryId = String(diaryId || "");
      rec.updatedAt = nowIso();
      return saveDiaryImageBlob(rec).then(function () { return true; });
    }).catch(function (err) {
      console.warn("[SmileMediaDB] updateDiaryImageDiaryId", err);
      return false;
    });
  }

  function getMediaStorageUsage() {
    return getAllDiaryImageRecords().then(function (list) {
      var bytes = 0;
      var latest = "";
      var diaryIds = {};
      list.forEach(function (rec) {
        bytes += Number(rec.fileSize || (rec.blob && rec.blob.size) || 0) || 0;
        if (!latest || String(rec.updatedAt || "") > latest) latest = rec.updatedAt || "";
        if (rec.diaryId) diaryIds[rec.diaryId] = true;
      });
      return {
        imageCount: list.length,
        totalBytes: bytes,
        diaryCount: Object.keys(diaryIds).length,
        latestAt: latest,
        records: list
      };
    });
  }

  function estimateBrowserStorage() {
    if (typeof navigator === "undefined" || !navigator.storage ||
        typeof navigator.storage.estimate !== "function") {
      return Promise.resolve({ available: false });
    }
    return navigator.storage.estimate().then(function (est) {
      return {
        available: true,
        usage: Number(est.usage || 0) || 0,
        quota: Number(est.quota || 0) || 0
      };
    }).catch(function () {
      return { available: false };
    });
  }

  return {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    STORE: STORE,
    checkMediaStorageAvailability: checkMediaStorageAvailability,
    openMediaDatabase: openMediaDatabase,
    saveDiaryImageBlob: saveDiaryImageBlob,
    getDiaryImageBlob: getDiaryImageBlob,
    getDiaryImagesByDiaryId: getDiaryImagesByDiaryId,
    getAllDiaryImageRecords: getAllDiaryImageRecords,
    deleteDiaryImageBlob: deleteDiaryImageBlob,
    deleteDiaryImagesByDiaryId: deleteDiaryImagesByDiaryId,
    updateDiaryImageDiaryId: updateDiaryImageDiaryId,
    getMediaStorageUsage: getMediaStorageUsage,
    estimateBrowserStorage: estimateBrowserStorage
  };
});
