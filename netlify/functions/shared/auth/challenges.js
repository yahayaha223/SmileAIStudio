"use strict";

var authKv = require("./auth-kv");
var config = require("./config");
var cryptoUtil = require("./crypto-util");

async function saveChallenge(opts) {
  var cfg = config.getAuthConfig();
  var raw = opts.challenge;
  var challengeHash = cryptoUtil.hashToken(raw);
  var row = {
    challengeHash: challengeHash,
    purpose: opts.purpose,
    userId: opts.userId || null,
    emailNormalized: opts.emailNormalized || null,
    expiresAt: Date.now() + (opts.ttlMs || cfg.challengeTtlMs),
    usedAt: null,
    origin: opts.origin || null,
    meta: opts.meta || null
  };
  await authKv.authSet("challenges/" + challengeHash, row);
  return { raw: raw, row: row };
}

async function consumeChallenge(rawChallenge, purpose) {
  if (!rawChallenge) return { ok: false, reasonCode: "challenge_missing" };
  var challengeHash = cryptoUtil.hashToken(rawChallenge);
  var row = await authKv.authGet("challenges/" + challengeHash);
  if (!row) return { ok: false, reasonCode: "challenge_not_found" };
  if (row.usedAt) return { ok: false, reasonCode: "challenge_used" };
  if (Date.now() > row.expiresAt) return { ok: false, reasonCode: "challenge_expired" };
  if (purpose && row.purpose !== purpose) return { ok: false, reasonCode: "challenge_purpose" };
  row.usedAt = Date.now();
  await authKv.authSet("challenges/" + challengeHash, row);
  return { ok: true, row: row };
}

module.exports = {
  saveChallenge: saveChallenge,
  consumeChallenge: consumeChallenge
};
