"use strict";

/**
 * Local unit tests for LINE command center (no network / no LINE API).
 * Run: node scripts/run-line-unit-tests.js
 */

var assert = require("assert");
var path = require("path");

var shared = path.join(__dirname, "..", "netlify", "functions", "shared");
var signature = require(path.join(shared, "line-signature"));
var router = require(path.join(shared, "command-router"));
var messages = require(path.join(shared, "message-builder"));
var env = require(path.join(shared, "env"));
var dedupe = require(path.join(shared, "event-dedupe"));
var defaults = require(path.join(shared, "defaults"));

var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("OK  " + name);
  } catch (e) {
    failed += 1;
    console.log("NG  " + name);
    console.log("    " + (e && e.message ? e.message : e));
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("OK  " + name);
  } catch (e) {
    failed += 1;
    console.log("NG  " + name);
    console.log("    " + (e && e.message ? e.message : e));
  }
}

test("signature: valid HMAC matches", function () {
  var body = '{"events":[]}';
  var secret = "test-secret";
  var sig = signature.createLineSignature(body, secret);
  assert.strictEqual(signature.verifyLineSignature(body, sig, secret), true);
});

test("signature: invalid rejected", function () {
  var body = '{"events":[]}';
  assert.strictEqual(
    signature.verifyLineSignature(body, "bad-signature=======", "test-secret"),
    false
  );
});

test("signature: missing secret rejected", function () {
  assert.strictEqual(signature.verifyLineSignature("{}", "x", ""), false);
});

test("env: maskSecret never echoes value", function () {
  assert.strictEqual(env.maskSecret("super-secret-token"), "設定済み");
  assert.strictEqual(env.maskSecret(""), "未設定");
});

test("commands: normalize / map メニュー", function () {
  assert.strictEqual(router.mapCommand(router.normalizeCommand(" メニュー ")).type, "menu");
  assert.strictEqual(router.mapCommand(router.normalizeCommand("メニュウ")).type, "freechat");
  assert.strictEqual(router.mapCommand(router.normalizeCommand("状況")).type, "status");
  assert.strictEqual(router.mapCommand(router.normalizeCommand("きょう")).type, "today");
  assert.strictEqual(router.mapCommand(router.normalizeCommand("履歴")).type, "history");
  assert.strictEqual(router.mapCommand(router.normalizeCommand("取消")).type, "cancel");
  assert.strictEqual(router.mapCommand(router.normalizeCommand("ヘルプ")).type, "help");
  assert.strictEqual(router.mapCommand(router.normalizeCommand("リセット")).type, "chat-reset");
  assert.strictEqual(router.mapCommand(router.normalizeCommand("こんにちは")).type, "freechat");
  assert.deepStrictEqual(router.mapCommand(router.normalizeCommand("4")), { type: "number", value: 4 });
});

test("messages: morning / test / help / userid capture", function () {
  var projects = defaults.DEFAULT_PROJECTS;
  var morning = messages.buildMorningMessage(projects, { projectName: "豊川稲荷 人形焼き" }, 2);
  assert.ok(morning.indexOf("朝の確認") !== -1);
  assert.ok(morning.indexOf("豊川稲荷") !== -1);
  assert.ok(messages.buildTestMessage().indexOf("接続テスト") !== -1);
  assert.ok(messages.buildHelpMessage().indexOf("メニュー") !== -1);
  var capture = messages.buildUserIdCaptureMessage("Uabcdef0123456789abcdef0123456789");
  assert.ok(capture.indexOf("Uabcdef0123456789abcdef0123456789") !== -1);
  assert.ok(capture.indexOf("LINE_ADMIN_USER_ID") !== -1);
});

test("env: bootstrap mode when admin missing", function () {
  var prevSecret = process.env.LINE_CHANNEL_SECRET;
  var prevToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  var prevAdmin = process.env.LINE_ADMIN_USER_ID;
  process.env.LINE_CHANNEL_SECRET = "sec";
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "tok";
  delete process.env.LINE_ADMIN_USER_ID;
  var cfg = env.getLineConfig();
  assert.strictEqual(env.isAdminBootstrapMode(cfg), true);
  assert.strictEqual(env.assertWebhookReady(cfg).length, 0);
  assert.ok(env.assertLineConfigured(cfg).indexOf("LINE_ADMIN_USER_ID") !== -1);
  process.env.LINE_ADMIN_USER_ID = "Uadmin";
  assert.strictEqual(env.isAdminBootstrapMode(env.getLineConfig()), false);
  if (prevSecret == null) delete process.env.LINE_CHANNEL_SECRET; else process.env.LINE_CHANNEL_SECRET = prevSecret;
  if (prevToken == null) delete process.env.LINE_CHANNEL_ACCESS_TOKEN; else process.env.LINE_CHANNEL_ACCESS_TOKEN = prevToken;
  if (prevAdmin == null) delete process.env.LINE_ADMIN_USER_ID; else process.env.LINE_ADMIN_USER_ID = prevAdmin;
});

test("messages: project actions use nextActions", function () {
  var p = defaults.DEFAULT_PROJECTS.find(function (x) { return x.id === "toyokawa-ningyoyaki"; });
  var built = messages.buildProjectActionMessage(p);
  assert.ok(built.text.indexOf("デザイン案を整理する") !== -1);
  assert.ok(built.choices.indexOf("今日の最優先にする") !== -1);
});

test("dedupe: same event id skipped", function () {
  assert.strictEqual(dedupe.rememberEvent("evt-1"), false);
  assert.strictEqual(dedupe.rememberEvent("evt-1"), true);
  assert.strictEqual(dedupe.rememberEvent("evt-2"), false);
});

test("defaults: five standard projects", function () {
  assert.strictEqual(defaults.DEFAULT_PROJECTS.length, 5);
  assert.ok(defaults.DEFAULT_PROJECTS.some(function (p) { return p.id === "toyokawa-ningyoyaki"; }));
});

(async function main() {
  await testAsync("router: menu sets awaiting-project", async function () {
    var text = await router.replyMenu("U-test-admin");
    assert.ok(text.indexOf("メニュー") !== -1 || text.indexOf("プロジェクト") !== -1);
    assert.ok(text.indexOf("Fuwafuwa") !== -1 || text.indexOf("数字") !== -1);
  });

  await testAsync("router: expired number reply", async function () {
    var conversationStore = require(path.join(shared, "conversation-store"));
    await conversationStore.saveConversation("U-expired", {
      stage: "awaiting-project",
      choices: ["a"],
      expiresAt: new Date(Date.now() - 1000).toISOString()
    });
    // Force expiry by writing past expiresAt then get+route
    var kv = require(path.join(shared, "kv-store"));
    await kv.kvSet("conversation:U-expired", {
      userId: "U-expired",
      stage: "awaiting-project",
      choices: ["a"],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString()
    });
    var result = await router.routeIncomingText("U-expired", "1");
    assert.ok(result.text.indexOf("期限") !== -1);
  });

  await testAsync("router: project select then set priority + meeting log", async function () {
    var userId = "U-flow-" + Date.now();
    await router.routeIncomingText(userId, "メニュー");
    var pick = await router.routeIncomingText(userId, "4");
    assert.ok(pick.text.indexOf("豊川稲荷") !== -1);
    var actionIdx = 0;
    var lines = pick.text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("最優先") !== -1 && /^\d+：/.test(lines[i])) {
        actionIdx = Number(lines[i].split("：")[0]);
        break;
      }
    }
    assert.ok(actionIdx > 0, "最優先アクションが見つかりません");
    var done = await router.routeIncomingText(userId, String(actionIdx));
    assert.ok(done.text.indexOf("最優先") !== -1);
    assert.ok(done.text.indexOf("自動保存") !== -1);
    assert.strictEqual(done.ok, true);
  });

  var openaiClient = require(path.join(shared, "openai-client"));
  var memoryStore = require(path.join(shared, "conversation-memory-store"));
  var aiSecretary = require(path.join(shared, "ai-secretary"));
  var originalCreate = openaiClient.createResponse;

  await testAsync("freechat: OPENAI_API_KEY missing → safe message", async function () {
    var prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    var result = await router.routeIncomingText("U-nokey", "こんにちは");
    assert.ok(result.text.indexOf("AI会話機能はまだ設定されていません") !== -1);
    assert.ok(result.text.indexOf("メニュー") !== -1);
    if (prev == null) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prev;
  });

  await testAsync("commands still work when OpenAI missing", async function () {
    var prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    var help = await router.routeIncomingText("U-nokey2", "ヘルプ");
    assert.ok(help.text.indexOf("メニュー") !== -1);
    assert.ok(help.source === "command" || help.ok === true);
    var menu = await router.routeIncomingText("U-nokey2", "メニュー");
    assert.ok(menu.text.indexOf("Smile AI Studio") !== -1 || menu.text.indexOf("プロジェクト") !== -1);
    if (prev == null) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prev;
  });

  await testAsync("freechat: mocked OpenAI natural reply + memory", async function () {
    process.env.OPENAI_API_KEY = "sk-test-mock-key";
    var calls = [];
    openaiClient.createResponse = async function (apiKey, options) {
      calls.push({ apiKeyLen: String(apiKey || "").length, inputLen: (options.input || []).length });
      return {
        ok: true,
        text: "こんにちは、YAHA😊\n今日もお疲れさまです。今から何を一緒に進めましょうか？",
        latencyMs: 12,
        error: "",
        usage: { input_tokens: 10, output_tokens: 20 }
      };
    };
    var userId = "U-chat-" + Date.now();
    await memoryStore.clearChatMemory(userId);
    var hello = await router.routeIncomingText(userId, "こんにちは");
    assert.ok(hello.text.indexOf("YAHA") !== -1);
    assert.strictEqual(hello.ok, true);
    assert.ok(calls.length >= 1);
    assert.ok(String(calls[0].apiKeyLen) !== "0");

    openaiClient.createResponse = async function (apiKey, options) {
      var lastUser = (options.input || []).filter(function (m) { return m.role === "user"; }).pop();
      assert.ok((options.input || []).length >= 2, "should include prior memory");
      return {
        ok: true,
        text: "暑い日は無理しない方がいいですね😅\n短時間で進めやすい作業から提案できます。",
        latencyMs: 10,
        error: "",
        usage: null
      };
    };
    var hot = await router.routeIncomingText(userId, "今日は暑くて頭が回らない");
    assert.ok(hot.text.indexOf("暑い") !== -1 || hot.text.indexOf("無理") !== -1);
    var count = await memoryStore.getChatMemoryCount(userId);
    assert.ok(count >= 2);

    var reset = await router.routeIncomingText(userId, "リセット");
    assert.ok(reset.text.indexOf("リセット") !== -1);
    assert.strictEqual(await memoryStore.getChatMemoryCount(userId), 0);
  });

  await testAsync("freechat: OpenAI failure keeps commands usable", async function () {
    process.env.OPENAI_API_KEY = "sk-test-mock-key";
    openaiClient.createResponse = async function () {
      return { ok: false, text: "", error: "openai_http_error", latencyMs: 5, usage: null };
    };
    var fail = await router.routeIncomingText("U-fail", "こんにちは");
    assert.ok(fail.text.indexOf("接続できません") !== -1);
    var help = await router.routeIncomingText("U-fail", "ヘルプ");
    assert.ok(help.text.indexOf("メニュー") !== -1);
  });

  await testAsync("company op candidate does not auto-update", async function () {
    var cand = aiSecretary.detectCompanyOpCandidate("人形焼きは一旦保留かな");
    assert.ok(cand);
    assert.ok(cand.hint.indexOf("変更しますか") !== -1);
  });

  await testAsync("openai extractOutputText", async function () {
    var text = openaiClient.extractOutputText({
      output: [{
        type: "message",
        content: [{ type: "output_text", text: "抽出OK" }]
      }]
    });
    assert.strictEqual(text, "抽出OK");
    var nested = openaiClient.extractOutputText({
      output_text: "helperOK"
    });
    assert.strictEqual(nested, "helperOK");
  });

  openaiClient.createResponse = originalCreate;
  delete process.env.OPENAI_API_KEY;

  console.log("");
  console.log("passed=" + passed + " failed=" + failed);
  process.exit(failed ? 1 : 0);
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
