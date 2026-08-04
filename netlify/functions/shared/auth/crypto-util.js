"use strict";

var crypto = require("crypto");

function randomBytes(n) {
  return crypto.randomBytes(n);
}

function randomToken(byteLength) {
  return randomBytes(byteLength || 32).toString("base64url");
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input), "utf8").digest("hex");
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function hashToken(token) {
  return sha256Hex(String(token || ""));
}

function constantTimeEqual(a, b) {
  var aa = Buffer.from(String(a || ""), "utf8");
  var bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function dailyIpHash(ip, salt) {
  var day = new Date().toISOString().slice(0, 10);
  var raw = String(ip || "unknown") + "|" + day + "|" + String(salt || "");
  return sha256Hex(raw).slice(0, 32);
}

function newId(prefix) {
  return String(prefix || "id") + "_" + randomToken(16);
}

module.exports = {
  randomBytes: randomBytes,
  randomToken: randomToken,
  sha256Hex: sha256Hex,
  sha256Buffer: sha256Buffer,
  hashToken: hashToken,
  constantTimeEqual: constantTimeEqual,
  dailyIpHash: dailyIpHash,
  newId: newId
};
