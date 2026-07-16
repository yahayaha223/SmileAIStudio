"use strict";

var fs = require("fs");
var path = require("path");

var MEMORY = Object.create(null);
var DATA_DIR = path.join(process.cwd(), ".data");
var DATA_FILE = path.join(DATA_DIR, "line-store.json");
var BLOB_STORE_CACHE = undefined; // undefined=uninitialized, null=unavailable, object=store

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

function getBlobStore() {
  if (BLOB_STORE_CACHE !== undefined) return BLOB_STORE_CACHE;
  try {
    var blobs = require("@netlify/blobs");
    if (blobs && typeof blobs.getStore === "function") {
      // strong: LINE save → Company Brain read must see the same overlay immediately
      BLOB_STORE_CACHE = blobs.getStore({
        name: "smile-line-command",
        consistency: "strong"
      });
      return BLOB_STORE_CACHE;
    }
  } catch (e) {
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      stage: "kv-blobs-init",
      ok: false,
      message: e && e.message ? e.message : "blobs_init_failed"
    }));
  }
  BLOB_STORE_CACHE = null;
  return null;
}

/**
 * Read key. Prefer Netlify Blobs (strong), then in-memory, then local .data file.
 */
async function kvGet(key) {
  var store = getBlobStore();
  if (store) {
    try {
      var value = await store.get(key, { type: "json", consistency: "strong" });
      if (value != null) {
        MEMORY[key] = value;
        return value;
      }
      // Blobs miss: fall through to MEMORY/file (local dual-write / migration)
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
      console.log(JSON.stringify({
        at: new Date().toISOString(),
        stage: "kv-blobs-set",
        ok: false,
        key: key,
        message: blobError
      }));
    }
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
    blobError: blobError || undefined,
    fileError: fileError || undefined
  }));

  return ok;
}

function describeStorage() {
  var hasBlobs = !!getBlobStore();
  return {
    netlify: isNetlifyRuntime(),
    blobsAvailable: hasBlobs,
    blobStore: hasBlobs ? "smile-line-command" : "",
    fileStore: DATA_FILE,
    consistency: "strong"
  };
}

module.exports = {
  kvGet: kvGet,
  kvSet: kvSet,
  isNetlifyRuntime: isNetlifyRuntime,
  describeStorage: describeStorage
};
