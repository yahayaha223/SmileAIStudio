"use strict";

var fs = require("fs");
var path = require("path");

var MEMORY = Object.create(null);
var DATA_DIR = path.join(process.cwd(), ".data");
var DATA_FILE = path.join(DATA_DIR, "line-store.json");
var BLOB_STORE_CACHE = undefined; // undefined=uninitialized, null=unavailable, object=store
var LAST_BLOB_ERROR = "";
var BLOBS_CONNECTED = false;
var BLOB_INIT_FAILED = false;

function isNetlifyRuntime() {
  return !!(
    process.env.NETLIFY ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NETLIFY_DEV
  );
}

function ensureFileStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "{}", "utf8");
  } catch (e) {
    /* ignore */
  }
}

function readFileStore() {
  ensureFileStore();
  try {
    var raw = fs.readFileSync(DATA_FILE, "utf8");
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

function writeFileStore(obj) {
  ensureFileStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), "utf8");
}

function loadBlobsModule() {
  try {
    return require("@netlify/blobs");
  } catch (e) {
    LAST_BLOB_ERROR = e && e.message ? e.message : "blobs_require_failed";
    return null;
  }
}

/**
 * Required for Netlify Functions v1 (exports.handler / Lambda compatibility).
 * Call at the start of every handler before kvGet/kvSet.
 */
function connectFromLambdaEvent(event) {
  BLOB_STORE_CACHE = undefined;
  BLOB_INIT_FAILED = false;
  LAST_BLOB_ERROR = "";
  BLOBS_CONNECTED = false;
  var blobs = loadBlobsModule();
  if (!blobs) return false;
  try {
    if (typeof blobs.connectLambda === "function" && event) {
      blobs.connectLambda(event);
      BLOBS_CONNECTED = true;
    } else {
      // Functions v2 / local: connectLambda may be unnecessary
      BLOBS_CONNECTED = true;
    }
    return true;
  } catch (e) {
    LAST_BLOB_ERROR = e && e.message ? e.message : "connectLambda_failed";
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      stage: "kv-blobs-connect",
      ok: false,
      message: LAST_BLOB_ERROR
    }));
    return false;
  }
}

function getBlobStore() {
  if (BLOB_STORE_CACHE !== undefined) return BLOB_STORE_CACHE;
  if (BLOB_INIT_FAILED) return null;
  var blobs = loadBlobsModule();
  if (!blobs || typeof blobs.getStore !== "function") {
    BLOB_STORE_CACHE = null;
    return null;
  }
  try {
    // Use string form (same as historical project/chat stores).
    // Do NOT set store-level consistency:"strong" — on Functions v1 that can throw
    // BlobsConsistencyError when uncachedEdgeURL is missing, breaking ALL writes.
    BLOB_STORE_CACHE = blobs.getStore("smile-line-command");
    return BLOB_STORE_CACHE;
  } catch (e) {
    LAST_BLOB_ERROR = e && e.message ? e.message : "getStore_failed";
    BLOB_INIT_FAILED = true;
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      stage: "kv-blobs-init",
      ok: false,
      message: LAST_BLOB_ERROR,
      connected: BLOBS_CONNECTED
    }));
    return null;
  }
}

/**
 * Read key. Prefer Netlify Blobs (strong), then in-memory, then local .data file.
 */
async function kvGet(key) {
  var store = getBlobStore();
  if (store) {
    try {
      // Prefer strong read when supported; fall back to eventual.
      var value = null;
      try {
        value = await store.get(key, { type: "json", consistency: "strong" });
      } catch (strongErr) {
        value = await store.get(key, { type: "json" });
      }
      if (value != null) {
        MEMORY[key] = value;
        return value;
      }
    } catch (e) {
      console.log(JSON.stringify({
        at: new Date().toISOString(),
        stage: "kv-blobs-get",
        ok: false,
        key: key,
        message: e && e.message ? e.message : "blobs_get_failed"
      }));
    }
  }
  if (Object.prototype.hasOwnProperty.call(MEMORY, key)) return MEMORY[key];
  var file = readFileStore();
  return Object.prototype.hasOwnProperty.call(file, key) ? file[key] : null;
}

/**
 * Write key. Dual-write Blobs + local file when possible.
 * On Netlify runtime, Blobs success is required for ok=true.
 */
async function kvSet(key, value) {
  var backends = [];
  var blobOk = false;
  var fileOk = false;
  var blobError = "";
  var fileError = "";

  var store = getBlobStore();
  if (store) {
    try {
      await store.setJSON(key, value);
      blobOk = true;
      backends.push("netlify-blobs");
    } catch (e) {
      blobError = e && e.message ? e.message : "blobs_set_failed";
      LAST_BLOB_ERROR = blobError;
      console.log(JSON.stringify({
        at: new Date().toISOString(),
        stage: "kv-blobs-set",
        ok: false,
        key: key,
        message: blobError
      }));
    }
  } else if (isNetlifyRuntime()) {
    blobError = LAST_BLOB_ERROR || "blobs_unavailable";
  }

  MEMORY[key] = value;
  backends.push("memory");

  try {
    var file = readFileStore();
    file[key] = value;
    writeFileStore(file);
    fileOk = true;
    backends.push("file");
  } catch (e) {
    fileError = e && e.message ? e.message : "file_set_failed";
  }

  var ok = isNetlifyRuntime() ? blobOk : (blobOk || fileOk);

  console.log(JSON.stringify({
    at: new Date().toISOString(),
    stage: "kv-set",
    ok: ok,
    key: key,
    backends: backends,
    blobOk: blobOk,
    fileOk: fileOk,
    netlify: isNetlifyRuntime(),
    connected: BLOBS_CONNECTED,
    blobError: blobError || undefined,
    fileError: fileError || undefined
  }));

  return ok;
}

function describeStorage() {
  var store = null;
  try {
    store = getBlobStore();
  } catch (e) {
    store = null;
  }
  return {
    netlify: isNetlifyRuntime(),
    blobsAvailable: !!store,
    blobsConnected: BLOBS_CONNECTED,
    blobStore: store ? "smile-line-command" : "",
    fileStore: DATA_FILE,
    consistency: "eventual(default)+strong-read-fallback",
    lastBlobError: LAST_BLOB_ERROR || ""
  };
}

module.exports = {
  kvGet: kvGet,
  kvSet: kvSet,
  isNetlifyRuntime: isNetlifyRuntime,
  describeStorage: describeStorage,
  connectFromLambdaEvent: connectFromLambdaEvent
};
