"use strict";

var authKv = require("./auth-kv");
var config = require("./config");
var cryptoUtil = require("./crypto-util");

async function issueEmailToken(opts) {
  var cfg = config.getAuthConfig();
  var raw = cryptoUtil.randomToken(32);
  var tokenHash = cryptoUtil.hashToken(raw);
  var row = {
    tokenHash: tokenHash,
    emailNormalized: config.normalizeEmail(opts.email),
    purpose: opts.purpose || "login_or_enroll",
    expiresAt: Date.now() + (opts.ttlMs || cfg.emailTtlMs),
    usedAt: null,
    userId: opts.userId || null
  };
  await authKv.authSet("emailTokens/" + tokenHash, row);
  return { raw: raw, row: row };
}

async function consumeEmailToken(raw) {
  if (!raw) return { ok: false, reasonCode: "token_missing" };
  var tokenHash = cryptoUtil.hashToken(raw);
  var row = await authKv.authGet("emailTokens/" + tokenHash);
  if (!row) return { ok: false, reasonCode: "token_invalid" };
  if (row.usedAt) return { ok: false, reasonCode: "token_used" };
  if (Date.now() > row.expiresAt) return { ok: false, reasonCode: "token_expired" };
  row.usedAt = Date.now();
  await authKv.authSet("emailTokens/" + tokenHash, row);
  return { ok: true, row: row };
}

module.exports = {
  issueEmailToken: issueEmailToken,
  consumeEmailToken: consumeEmailToken
};
