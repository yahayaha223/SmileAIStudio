"use strict";

/**
 * Unit tests for shared/github-issues.js (no network, no secrets).
 */
var assert = require("assert");
var path = require("path");
var github = require(path.join(__dirname, "..", "netlify", "functions", "shared", "github-issues.js"));

var passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log("OK  " + name);
}

test("sanitizeTitle rejects short", function () {
  assert.strictEqual(github.sanitizeTitle("ab").ok, false);
});

test("sanitizeTitle trims long", function () {
  var r = github.sanitizeTitle("x".repeat(200));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.title.length, 120);
});

test("sanitizeBody requires length and adds Agent Status", function () {
  var r = github.sanitizeBody("短い");
  assert.strictEqual(r.ok, false);
  var ok = github.sanitizeBody("これは十分な長さのある開発依頼本文です。受け入れ条件も含みます。");
  assert.strictEqual(ok.ok, true);
  assert.ok(/## Agent Status/.test(ok.body));
  assert.ok(/READY_FOR_AGENT/.test(ok.body));
});

test("ensureAgentStatus updates existing block", function () {
  var body = "# T\n\n## Agent Status\nREADY_FOR_AGENT\n";
  var next = github.ensureAgentStatus(body, "AGENT_WORKING");
  assert.ok(/AGENT_WORKING/.test(next));
  assert.ok(!/READY_FOR_AGENT/.test(next.split("Agent Status")[1].slice(0, 40)));
});

test("assertRepoAllowed enforces allowlist", function () {
  var cfg = {
    owner: "egao",
    repo: "SmileAIStudio",
    allowlist: ["egao/smileaistudio"]
  };
  assert.strictEqual(github.assertRepoAllowed(cfg, "egao", "SmileAIStudio").ok, true);
  assert.strictEqual(github.assertRepoAllowed(cfg, "other", "repo").ok, false);
});

test("isConfigured false without env", function () {
  var prevT = process.env.GITHUB_TOKEN;
  var prevO = process.env.GITHUB_OWNER;
  var prevR = process.env.GITHUB_REPO;
  var prevG = process.env.GH_TOKEN;
  var prevRep = process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_OWNER;
  delete process.env.GITHUB_REPO;
  delete process.env.GITHUB_REPOSITORY;
  assert.strictEqual(github.isConfigured(), false);
  if (prevT != null) process.env.GITHUB_TOKEN = prevT; else delete process.env.GITHUB_TOKEN;
  if (prevG != null) process.env.GH_TOKEN = prevG; else delete process.env.GH_TOKEN;
  if (prevO != null) process.env.GITHUB_OWNER = prevO; else delete process.env.GITHUB_OWNER;
  if (prevR != null) process.env.GITHUB_REPO = prevR; else delete process.env.GITHUB_REPO;
  if (prevRep != null) process.env.GITHUB_REPOSITORY = prevRep; else delete process.env.GITHUB_REPOSITORY;
});

test("createIssue returns github_not_configured without token", async function () {
  var prevT = process.env.GITHUB_TOKEN;
  var prevG = process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  var r = await github.createIssue({
    title: "Test issue title here",
    body: "これは十分な長さのある開発依頼本文です。受け入れ条件も含みます。"
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, "github_not_configured");
  assert.ok(/GitHub接続設定/.test(r.userMessage));
  if (prevT != null) process.env.GITHUB_TOKEN = prevT; else delete process.env.GITHUB_TOKEN;
  if (prevG != null) process.env.GH_TOKEN = prevG; else delete process.env.GH_TOKEN;
});

(async function () {
  await test("createIssue mock success path via stub", async function () {
    // Direct sanitize path already covered; mock fetch for success shape
    var origFetch = global.fetch;
    process.env.GITHUB_TOKEN = "test-token-not-real";
    process.env.GITHUB_OWNER = "egao";
    process.env.GITHUB_REPO = "SmileAIStudio";
    global.fetch = async function () {
      return {
        ok: true,
        status: 201,
        text: async function () {
          return JSON.stringify({
            number: 42,
            html_url: "https://github.com/egao/SmileAIStudio/issues/42",
            title: "Hello"
          });
        }
      };
    };
    try {
      var r = await github.createIssue({
        title: "Mock issue title",
        body: "これは十分な長さのある開発依頼本文です。受け入れ条件も含みます。"
      });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.number, 42);
      assert.ok(r.url.indexOf("/issues/42") > 0);
    } finally {
      global.fetch = origFetch;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_OWNER;
      delete process.env.GITHUB_REPO;
    }
  });

  await test("createIssue mock failure keeps retryable error", async function () {
    var origFetch = global.fetch;
    process.env.GITHUB_TOKEN = "test-token-not-real";
    process.env.GITHUB_OWNER = "egao";
    process.env.GITHUB_REPO = "SmileAIStudio";
    global.fetch = async function () {
      return {
        ok: false,
        status: 502,
        text: async function () {
          return JSON.stringify({ message: "Bad Gateway" });
        }
      };
    };
    try {
      var r = await github.createIssue({
        title: "Mock fail title",
        body: "これは十分な長さのある開発依頼本文です。受け入れ条件も含みます。"
      });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.error, "github_api_failed");
    } finally {
      global.fetch = origFetch;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_OWNER;
      delete process.env.GITHUB_REPO;
    }
  });

  console.log("\nPassed " + passed + " github-issues tests");
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
