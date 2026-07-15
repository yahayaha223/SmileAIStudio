"use strict";

/**
 * Mock LINE webhook verification without calling LINE API.
 * Run: node scripts/mock-line-webhook.js
 *
 * Sets temporary env for signature / admin checks, then exercises
 * shared modules the same way line-webhook.js would.
 */

var path = require("path");
var shared = path.join(__dirname, "..", "netlify", "functions", "shared");

process.env.LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || "mock-channel-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "mock-access-token";
process.env.LINE_ADMIN_USER_ID = process.env.LINE_ADMIN_USER_ID || "U-mock-admin";

var signature = require(path.join(shared, "line-signature"));
var router = require(path.join(shared, "command-router"));
var env = require(path.join(shared, "env"));
var dedupe = require(path.join(shared, "event-dedupe"));

function buildEvent(text, userId, eventId) {
  return {
    type: "message",
    replyToken: "mock-reply-token",
    timestamp: Date.now(),
    webhookEventId: eventId || ("mock-" + Date.now() + "-" + Math.random()),
    source: { type: "user", userId: userId },
    message: { type: "text", id: "mid", text: text }
  };
}

function verifyAndParse(rawBody, sigHeader, secret) {
  if (!signature.verifyLineSignature(rawBody, sigHeader, secret)) {
    return { status: 401, body: "invalid signature" };
  }
  try {
    return { status: 200, payload: JSON.parse(rawBody) };
  } catch (e) {
    return { status: 400, body: "invalid_json" };
  }
}

async function handleLikeWebhook(payload, config) {
  var replies = [];
  var events = Array.isArray(payload.events) ? payload.events : [];
  for (var i = 0; i < events.length; i++) {
    var ev = events[i] || {};
    if (dedupe.rememberEvent(ev.webhookEventId || ("fallback-" + i))) {
      replies.push({ skipped: true, reason: "duplicate" });
      continue;
    }
    if (ev.type !== "message" || !ev.message || ev.message.type !== "text") continue;
    var userId = ev.source && ev.source.userId ? String(ev.source.userId) : "";
    if (!userId || userId !== config.adminUserId) {
      replies.push({ userId: userId, text: "この機能は管理者専用です" });
      continue;
    }
    var result = await router.routeIncomingText(userId, ev.message.text || "");
    replies.push({ userId: userId, text: result.text, ok: result.ok });
  }
  return replies;
}

(async function main() {
  var config = env.getLineConfig();
  var results = [];

  // 0) bootstrap mode: admin missing → return user id text
  var prevAdmin = process.env.LINE_ADMIN_USER_ID;
  delete process.env.LINE_ADMIN_USER_ID;
  // re-require env after env change - env reads process.env at call time so OK
  var bootConfig = env.getLineConfig();
  var bootBody = JSON.stringify({
    events: [buildEvent("こんにちは", "U-bootstrap-user", "evt-boot-1")]
  });
  var bootSig = signature.createLineSignature(bootBody, bootConfig.channelSecret);
  var bootParsed = verifyAndParse(bootBody, bootSig, bootConfig.channelSecret);
  // Simulate bootstrap reply text (webhook would reply; here we check message builder)
  var captureText = require(path.join(shared, "message-builder"))
    .buildUserIdCaptureMessage("U-bootstrap-user");
  results.push({
    name: "bootstrap mode captures User ID message",
    ok: bootParsed.status === 200 &&
      env.isAdminBootstrapMode(bootConfig) &&
      captureText.indexOf("U-bootstrap-user") !== -1
  });
  if (prevAdmin == null) delete process.env.LINE_ADMIN_USER_ID;
  else process.env.LINE_ADMIN_USER_ID = prevAdmin;
  // refresh config for remaining tests
  config = env.getLineConfig();

  // 1) bad signature
  var badBody = JSON.stringify({ events: [buildEvent("メニュー", config.adminUserId, "evt-bad")] });
  var bad = verifyAndParse(badBody, "not-a-valid-signature========", config.channelSecret);
  results.push({ name: "reject invalid signature", ok: bad.status === 401 });

  // 2) good signature + menu
  var menuBody = JSON.stringify({ events: [buildEvent("メニュー", config.adminUserId, "evt-menu-1")] });
  var menuSig = signature.createLineSignature(menuBody, config.channelSecret);
  var menuParsed = verifyAndParse(menuBody, menuSig, config.channelSecret);
  var menuReplies = await handleLikeWebhook(menuParsed.payload, config);
  results.push({
    name: "accept valid signature + メニュー",
    ok: menuParsed.status === 200 && menuReplies[0] && menuReplies[0].text &&
      menuReplies[0].text.indexOf("Smile AI Studio") !== -1
  });

  // 3) non-admin
  var otherBody = JSON.stringify({ events: [buildEvent("メニュー", "U-other", "evt-other")] });
  var otherSig = signature.createLineSignature(otherBody, config.channelSecret);
  var otherParsed = verifyAndParse(otherBody, otherSig, config.channelSecret);
  var otherReplies = await handleLikeWebhook(otherParsed.payload, config);
  results.push({
    name: "non-admin gets 管理者専用",
    ok: otherReplies[0] && otherReplies[0].text.indexOf("管理者専用") !== -1
  });

  // 4) duplicate event
  var dupBody = JSON.stringify({ events: [buildEvent("状況", config.adminUserId, "evt-dup")] });
  var dupSig = signature.createLineSignature(dupBody, config.channelSecret);
  var dupParsed = verifyAndParse(dupBody, dupSig, config.channelSecret);
  var first = await handleLikeWebhook(dupParsed.payload, config);
  var second = await handleLikeWebhook(dupParsed.payload, config);
  results.push({
    name: "duplicate webhook skipped",
    ok: first[0] && first[0].text && second[0] && second[0].skipped === true
  });

  // 5) number flow
  var pickBody = JSON.stringify({ events: [buildEvent("4", config.adminUserId, "evt-num-4")] });
  var pickSig = signature.createLineSignature(pickBody, config.channelSecret);
  var pickParsed = verifyAndParse(pickBody, pickSig, config.channelSecret);
  // ensure conversation from menu
  await router.routeIncomingText(config.adminUserId, "メニュー");
  var pickReplies = await handleLikeWebhook(pickParsed.payload, config);
  results.push({
    name: "数字4 → 豊川稲荷アクション",
    ok: pickReplies[0] && pickReplies[0].text.indexOf("豊川稲荷") !== -1
  });

  var fail = 0;
  results.forEach(function (r) {
    console.log((r.ok ? "OK" : "NG") + "  " + r.name);
    if (!r.ok) fail += 1;
  });
  console.log("");
  console.log("mock webhook: passed=" + (results.length - fail) + " failed=" + fail);
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
