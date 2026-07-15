"use strict";

var crypto = require("crypto");

/**
 * Verify LINE Messaging API webhook signature (HMAC-SHA256, Base64).
 * body must be the raw request body string.
 */
function verifyLineSignature(body, signature, channelSecret) {
  if (!channelSecret || !signature || body == null) return false;
  try {
    var digest = crypto
      .createHmac("sha256", channelSecret)
      .update(body, "utf8")
      .digest("base64");
    var a = Buffer.from(digest);
    var b = Buffer.from(String(signature));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

function createLineSignature(body, channelSecret) {
  return crypto
    .createHmac("sha256", channelSecret)
    .update(body, "utf8")
    .digest("base64");
}

module.exports = {
  verifyLineSignature: verifyLineSignature,
  createLineSignature: createLineSignature
};
