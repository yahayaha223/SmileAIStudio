"use strict";

/**
 * Isolated KV for auth (separate from LINE store).
 * Environment-separated:
 *   - Blobs store: smile-studio-auth | smile-studio-auth-staging | smile-studio-auth-local
 *   - Key prefix: production/ | staging/ | local/
 * File fallback: .data/auth-store-<env>.json
 */
var fs = require("fs");
var path = require("path");
var config = require("./config");

var MEMORY = Object.create(null);
var DATA_DIR = path.join(process.cwd(), ".data");
var BLOB_STORE_CACHE = undefined;
var LAST_BLOB_ERROR = "";
var CACHED_STORE_NAME = "";

function isNetlifyRuntime() {
  return !!(
    process.env.NETLIFY ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NETLIFY_DEV
  );
}

function authEnvironment() {
  return config.getAuthEnvironment();
}

function storeNameForEnv() {
  var envName = authEnvironment();
  if (envName === "production") return "smile-studio-auth";
  return "smile-studio-auth-" + envName;
}

function dataFileForEnv() {
  return path.join(DATA_DIR, "auth-store-" + authEnvironment() + ".json");
}

function namespacedKey(key) {
  var prefix = config.getAuthDataPrefix();
  var k = String(key || "");
  if (k.indexOf(prefix) === 0) return k;
  return prefix + k;
}

function ensureFileStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    var file = dataFileForEnv();
    if (!fs.existsSync(file)) fs.writeFileSync(file, "{}", "utf8");
  } catch (e) { /* ignore */ }
}

function readFileStore() {
  ensureFileStore();
  try {
    var parsed = JSON.parse(fs.readFileSync(dataFileForEnv(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

function writeFileStore(obj) {
  ensureFileStore();
  fs.writeFileSync(dataFileForEnv(), JSON.stringify(obj), "utf8");
}

function loadBlobsModule() {
  try {
    return require("@netlify/blobs");
  } catch (e) {
    LAST_BLOB_ERROR = e && e.message ? e.message : "blobs_require_failed";
    return null;
  }
}

function connectFromLambdaEvent(event) {
  BLOB_STORE_CACHE = undefined;
  CACHED_STORE_NAME = "";
  LAST_BLOB_ERROR = "";
  var blobs = loadBlobsModule();
  if (!blobs) return false;
  try {
    if (typeof blobs.connectLambda === "function" && event) {
      blobs.connectLambda(event);
    }
    return true;
  } catch (e) {
    LAST_BLOB_ERROR = e && e.message ? e.message : "connectLambda_failed";
    return false;
  }
}

function getBlobStore() {
  var wanted = storeNameForEnv();
  if (BLOB_STORE_CACHE !== undefined && CACHED_STORE_NAME === wanted) {
    return BLOB_STORE_CACHE;
  }
  var blobs = loadBlobsModule();
  if (!blobs || typeof blobs.getStore !== "function") {
    BLOB_STORE_CACHE = null;
    CACHED_STORE_NAME = wanted;
    return null;
  }
  try {
    BLOB_STORE_CACHE = blobs.getStore(wanted);
    CACHED_STORE_NAME = wanted;
    return BLOB_STORE_CACHE;
  } catch (e) {
    LAST_BLOB_ERROR = e && e.message ? e.message : "getStore_failed";
    BLOB_STORE_CACHE = null;
    CACHED_STORE_NAME = wanted;
    return null;
  }
}

async function authGet(key) {
  var nk = namespacedKey(key);
  var store = getBlobStore();
  if (store) {
    try {
      var value = null;
      try {
        value = await store.get(nk, { type: "json", consistency: "strong" });
      } catch (e1) {
        value = await store.get(nk, { type: "json" });
      }
      if (value != null) {
        MEMORY[nk] = value;
        return value;
      }
    } catch (e) { /* fall through */ }
  }
  if (Object.prototype.hasOwnProperty.call(MEMORY, nk)) return MEMORY[nk];
  var file = readFileStore();
  return Object.prototype.hasOwnProperty.call(file, nk) ? file[nk] : null;
}

async function authSet(key, value) {
  var nk = namespacedKey(key);
  var blobOk = false;
  var store = getBlobStore();
  if (store) {
    try {
      await store.setJSON(nk, value);
      blobOk = true;
    } catch (e) {
      LAST_BLOB_ERROR = e && e.message ? e.message : "blobs_set_failed";
    }
  }
  MEMORY[nk] = value;
  var fileOk = false;
  try {
    var file = readFileStore();
    file[nk] = value;
    writeFileStore(file);
    fileOk = true;
  } catch (e) { /* ignore */ }
  return isNetlifyRuntime() ? blobOk : (blobOk || fileOk);
}

async function authDelete(key) {
  var nk = namespacedKey(key);
  var store = getBlobStore();
  if (store && typeof store.delete === "function") {
    try { await store.delete(nk); } catch (e) { /* ignore */ }
  }
  delete MEMORY[nk];
  try {
    var file = readFileStore();
    delete file[nk];
    writeFileStore(file);
  } catch (e) { /* ignore */ }
  return true;
}

/** Test helper: wipe memory+file (not Blobs). */
function resetAuthMemoryForTests() {
  MEMORY = Object.create(null);
  try {
    ensureFileStore();
    writeFileStore({});
  } catch (e) { /* ignore */ }
}

function describeAuthStorage() {
  return {
    environment: authEnvironment(),
    storeName: storeNameForEnv(),
    keyPrefix: config.getAuthDataPrefix(),
    fileStore: dataFileForEnv()
  };
}

module.exports = {
  connectFromLambdaEvent: connectFromLambdaEvent,
  authGet: authGet,
  authSet: authSet,
  authDelete: authDelete,
  resetAuthMemoryForTests: resetAuthMemoryForTests,
  storeNameForEnv: storeNameForEnv,
  namespacedKey: namespacedKey,
  describeAuthStorage: describeAuthStorage,
  STORE_NAME: "smile-studio-auth"
};
