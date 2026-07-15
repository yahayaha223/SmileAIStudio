"use strict";

var fs = require("fs");
var path = require("path");

var MEMORY = Object.create(null);
var DATA_DIR = path.join(process.cwd(), ".data");
var DATA_FILE = path.join(DATA_DIR, "line-store.json");

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
  try {
    var blobs = require("@netlify/blobs");
    if (blobs && typeof blobs.getStore === "function") {
      return blobs.getStore("smile-line-command");
    }
  } catch (e) {
    return null;
  }
  return null;
}

async function kvGet(key) {
  var store = getBlobStore();
  if (store) {
    try {
      var value = await store.get(key, { type: "json" });
      return value == null ? null : value;
    } catch (e) {
      /* fall through */
    }
  }
  if (Object.prototype.hasOwnProperty.call(MEMORY, key)) return MEMORY[key];
  var file = readFileStore();
  return Object.prototype.hasOwnProperty.call(file, key) ? file[key] : null;
}

async function kvSet(key, value) {
  var store = getBlobStore();
  if (store) {
    try {
      await store.setJSON(key, value);
      MEMORY[key] = value;
      return true;
    } catch (e) {
      /* fall through to file */
    }
  }
  MEMORY[key] = value;
  try {
    var file = readFileStore();
    file[key] = value;
    writeFileStore(file);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  kvGet: kvGet,
  kvSet: kvSet
};
