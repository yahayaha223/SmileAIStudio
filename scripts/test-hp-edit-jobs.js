"use strict";

/**
 * Homepage-edit request must create a GitHub Issue (READY_FOR_AGENT)
 * and never auto-publish production.
 */
var assert = require("assert");
var fs = require("fs");
var path = require("path");
var github = require(path.join(__dirname, "..", "netlify", "functions", "shared", "github-issues.js"));
var DevJobs = require(path.join(__dirname, "..", "js", "smile-dev-jobs.js"));

var passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log("OK  " + name);
}

function hpFn(src) {
  var start = src.indexOf("function submitHpEditRequest(");
  assert.ok(start >= 0, "submitHpEditRequest not found");
  var rest = src.slice(start);
  var end = rest.indexOf("\n  onClick(\"simple-diary-close\"");
  assert.ok(end > 0, "submitHpEditRequest end not found");
  return rest.slice(0, end);
}

async function run() {
  test("HP edit builds Issue payload with READY_FOR_AGENT", function () {
    var job = DevJobs.buildHomepageEditTask("トップページに人形焼きのお知らせを追加したい");
    assert.strictEqual(job.kind, "homepage-edit");
    assert.strictEqual(job.projectId, "corporate-site");
    assert.strictEqual(job.status, "ready_for_issue");
    assert.strictEqual(job.agentStatus, "READY_FOR_AGENT");
    assert.strictEqual(job.approvalRequired, true);
    var md = DevJobs.toIssueMarkdown(job);
    var body = github.sanitizeBody(md);
    assert.strictEqual(body.ok, true, body.error);
    assert.strictEqual(github.parseAgentStatus(body.body), "READY_FOR_AGENT");
    assert.ok(/homepage-edit/.test(md));
    assert.ok(/本番FTP公開しない/.test(md));
    assert.ok(/Production Deployしない/.test(md));
    assert.ok(/mainへmergeしない/.test(md));
    assert.ok(/Do not publish to production/.test(md));
  });

  test("Studio shows 作成中 then 確認してください after PR", function () {
    var job = DevJobs.buildHomepageEditTask("お知らせを追加");
    DevJobs.upsert(job);
    assert.strictEqual(DevJobs.studioProgressMessage(job), "変更案を作成中です");

    DevJobs.applyGithubIssueResult(job, {
      number: 42,
      url: "https://github.com/example/repo/issues/42",
      agentStatus: "READY_FOR_AGENT",
      jobStatus: "waiting_for_agent"
    });
    var waiting = DevJobs.getById(job.id);
    assert.strictEqual(waiting.githubIssueNumber, 42);
    assert.strictEqual(waiting.agentStatus, "READY_FOR_AGENT");
    assert.strictEqual(waiting.status, "waiting_for_agent");
    assert.strictEqual(DevJobs.studioProgressMessage(waiting), "変更案を作成中です");
    assert.ok(/変更案を作成中です/.test(DevJobs.renderProgressHtml(waiting)));

    DevJobs.applyExternalUpdate(waiting, {
      agentStatus: "READY_FOR_REVIEW",
      status: "waiting_for_review",
      githubPrNumber: 7,
      githubPrUrl: "https://github.com/example/repo/pull/7"
    });
    var review = DevJobs.getById(job.id);
    assert.strictEqual(review.status, "waiting_for_review");
    assert.strictEqual(DevJobs.studioProgressMessage(review), "確認してください");
    assert.ok(/確認してください/.test(DevJobs.renderProgressHtml(review)));
  });

  test("PR sync mapping does not mark production published", function () {
    var mapped = github.mapAgentStatusToJobStatus("READY_FOR_REVIEW", { githubPrNumber: 9 });
    assert.strictEqual(mapped, "waiting_for_review");
    assert.notStrictEqual(mapped, "deploying");
    assert.notStrictEqual(mapped, "completed");
  });

  test("submitHpEditRequest creates GitHub Issue and does not publish production", function () {
    var script = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
    var html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    var fn = hpFn(script);
    assert.ok(/buildHomepageEditTask/.test(fn));
    assert.ok(/createGithubIssueForJob\(job\)/.test(fn));
    assert.ok(/READY_FOR_AGENT/.test(fn));
    assert.ok(/変更案を作成中です/.test(fn) || /studioProgressMessage/.test(fn));
    assert.ok(!/HP変更の依頼を保存しました/.test(fn));
    assert.ok(!/job\.status = "planning"/.test(fn));
    assert.ok(!/api-diary-publish/.test(fn));
    assert.ok(!/runProductionPublish/.test(fn));
    assert.ok(!/SmileFtpProductionPublish/.test(fn));
    assert.ok(!/ftp-production-publish/.test(fn));
    assert.ok(/hp-edit-jobs-list/.test(html));
    assert.ok(/変更案の作成を開始します/.test(html));
    assert.ok(/createGithubIssueForJob/.test(script));
    assert.ok(/isDevJobProgressModalOpen/.test(script));
    assert.ok(/hp-edit-modal/.test(script));
  });

  test("Cursor kickoff stays exact READY_FOR_AGENT comment", function () {
    assert.strictEqual(github.AGENT_KICKOFF_COMMENT, "READY_FOR_AGENT");
    assert.strictEqual(github.shouldStartAgent("READY_FOR_AGENT", "READY_FOR_AGENT"), true);
    var job = DevJobs.buildHomepageEditTask("お知らせを目立たせたい");
    assert.strictEqual(github.shouldStartAgent(job.agentStatus, github.AGENT_KICKOFF_COMMENT), true);
  });

  test("merged homepage job is ready to publish, unmerged is not", function () {
    var job = DevJobs.buildHomepageEditTask("お知らせ");
    DevJobs.applyExternalUpdate(job, {
      githubPrNumber: 7,
      prMerged: false,
      status: "waiting_for_review"
    });
    var open = DevJobs.getById(job.id);
    assert.strictEqual(DevJobs.studioProgressMessage(open), "確認してください");
    assert.strictEqual(DevJobs.canPublishToProduction(open), false);
    DevJobs.applyExternalUpdate(open, { githubPrNumber: 7, prMerged: true });
    var merged = DevJobs.getById(job.id);
    assert.strictEqual(merged.status, "ready_for_publish");
    assert.strictEqual(DevJobs.studioProgressMessage(merged), "変更案は承認済みです。本番へ反映できます");
    assert.strictEqual(DevJobs.canPublishToProduction(merged), true);
  });

  test("published homepage job can be republished after merged PR", function () {
    var job = DevJobs.buildHomepageEditTask("ロールバック後の再公開");
    DevJobs.applyExternalUpdate(job, {
      githubPrNumber: 7,
      prMerged: true,
      status: "ready_for_publish"
    });
    var ready = DevJobs.getById(job.id);
    ready.status = "published";
    DevJobs.upsert(ready);
    var published = DevJobs.getById(job.id);
    assert.strictEqual(published.status, "published");
    assert.strictEqual(DevJobs.studioProgressMessage(published), "公開済み");
    assert.strictEqual(DevJobs.canPublishToProduction(published), false);
    assert.strictEqual(DevJobs.canRepublishToProduction(published), true);
    assert.ok(/再公開する/.test(DevJobs.renderProgressHtml(published)));
    published.prMerged = false;
    assert.strictEqual(DevJobs.canRepublishToProduction(published), false);
  });

  console.log("\nPassed " + passed + " hp-edit-jobs tests");
}

run();
