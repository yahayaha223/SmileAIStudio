"use strict";

var authKv = require("./auth-kv");
var cryptoUtil = require("./crypto-util");

/**
 * Simple fixed-window rate limit stored in auth KV.
 * @returns {{ ok: boolean, remaining: number, retryAfterSec?: number }}
 */
async function rateLimit(bucketKey, limit, windowMs) {
  limit = limit || 10;
  windowMs = windowMs || 10 * 60 * 1000;
  var now = Date.now();
  var key = "rateLimit/" + cryptoUtil.sha256Hex(String(bucketKey)).slice(0, 40);
  var row = (await authKv.authGet(key)) || null;
  if (!row || !row.windowStart || now - row.windowStart >= windowMs) {
    row = { windowStart: now, count: 1 };
    await authKv.authSet(key, row);
    return { ok: true, remaining: limit - 1 };
  }
  row.count = (row.count || 0) + 1;
  await authKv.authSet(key, row);
  if (row.count > limit) {
    var retryAfterSec = Math.ceil((row.windowStart + windowMs - now) / 1000);
    return { ok: false, remaining: 0, retryAfterSec: retryAfterSec };
  }
  return { ok: true, remaining: Math.max(0, limit - row.count) };
}

module.exports = {
  rateLimit: rateLimit
};
