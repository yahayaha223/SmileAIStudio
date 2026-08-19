"use strict";

/**
 * Unit tests for simple diary publish helpers (no FTP).
 */
var assert = require("assert");
var fs = require("fs");
var path = require("path");

var passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log("OK  " + name);
}

var src = fs.readFileSync(
  path.join(__dirname, "..", "js", "smile-simple-diary-publish.js"),
  "utf8"
);
var script = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
var html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
var perm = fs.readFileSync(
  path.join(__dirname, "..", "netlify", "functions", "shared", "auth", "permissions.js"),
  "utf8"
);

test("orchestrator exports and keeps safety gates", function () {
  assert.ok(/SmileSimpleDiaryPublish/.test(src));
  assert.ok(/runOneButtonPublish/.test(src));
  assert.ok(/enableRealPublishModeWithServerArm/.test(src));
  assert.ok(/runDryRun/.test(src));
  assert.ok(/evaluateEligibility/.test(src));
  assert.ok(/本番公開を有効にする/.test(src));
  assert.ok(/EXECUTE_PHRASE/.test(src));
  assert.ok(/productionUntouched/.test(src));
});

test("UI has confirm + success/fail + retry + details hide", function () {
  assert.ok(/simple-diary-confirm/.test(html));
  assert.ok(/本番ホームページへ公開します|本番へ公開します/.test(html));
  assert.ok(/btn-simple-diary-retry/.test(html));
  assert.ok(/詳細を見る/.test(html));
  assert.ok(/ひとこと文章を書いてください/.test(script));
  assert.ok(/公開できませんでした/.test(script));
  assert.ok(/元のホームページは変更されていません/.test(script));
  assert.ok(/SmileSimpleDiaryPublish/.test(script));
});

test("permissions include github issues owner-only", function () {
  assert.ok(/api-github-issues:POST:create/.test(perm));
  assert.ok(/"api-github-issues:POST:create":\s*\{\s*roles:\s*\["owner"\]/.test(perm));
});

console.log("\nPassed " + passed + " simple-diary-publish tests");
