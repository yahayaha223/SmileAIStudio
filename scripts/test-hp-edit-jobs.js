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
    assert.ok(/btn-hp-edit-ftp-probe/.test(html));
    assert.ok(/公式サイトFTPを診断/.test(html));
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

  test("Studio restores approved homepage change from GitHub without localStorage jobs", function () {
    var script = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
    var html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    var api = fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "api-github-issues.js"), "utf8");
    assert.ok(/hp-edit-github-ready/.test(html));
    assert.ok(/smile-hp-edit-github-ready\.js/.test(html));
    assert.ok(html.indexOf("id=\"hp-edit-github-ready\"") < html.indexOf("id=\"hp-edit-request\""));
    assert.ok(/承認済みの変更があります/.test(script));
    assert.ok(/find-ready-site-publish/.test(script));
    assert.ok(/find-ready-site-publish/.test(api));
    assert.ok(/loadGithubReadySitePublishes/.test(script));
    assert.ok(/btn-hp-github-ready-publish/.test(script));
    assert.ok(/公式サイトへ本番反映します/.test(html));
    assert.ok(/btn-hp-edit-publish-yes/.test(html));
    assert.ok(/反映する/.test(html));
    var readyIdx = script.lastIndexOf("btn-hp-github-ready-publish");
    var readyClick = script.slice(readyIdx, readyIdx + 420);
    assert.ok(/showHpPublishConfirm/.test(readyClick));
    assert.ok(!/publishHpEditToSite/.test(readyClick));
    var findBody = script.slice(
      script.indexOf("action: \"find-ready-site-publish\""),
      script.indexOf("action: \"find-ready-site-publish\"") + 80
    );
    assert.ok(!/issueNumbers/.test(findBody));
  });

  test("API items=[] hides card, items=[Issue6/PR7] shows card", function () {
    var ui = require(path.join(__dirname, "..", "js", "smile-hp-edit-github-ready.js"));
    assert.deepStrictEqual(ui.parseReadyItems({ ok: true, items: [] }), []);
    assert.deepStrictEqual(ui.parseReadyItems({ ok: false, items: [{ prNumber: 7 }] }), []);
    var parsed = ui.parseReadyItems({
      ok: true,
      items: [{
        issueNumber: 6,
        issueUrl: "https://github.com/yahayaha223/SmileAIStudio/issues/6",
        prNumber: 7,
        prUrl: "https://github.com/yahayaha223/SmileAIStudio/pull/7"
      }]
    });
    assert.strictEqual(parsed.length, 1);
    var html = ui.cardHtml(parsed[0]);
    assert.ok(/承認済みの変更があります/.test(html));
    assert.ok(/GitHub Issue #6/.test(html));
    assert.ok(/PR #7/.test(html));
    assert.ok(/本番へ反映する/.test(html));

    var hidden = false;
    var box = {
      innerHTML: "x",
      hidden: false,
      classList: { add: function () {}, remove: function () {} },
      setAttribute: function (name, val) { if (name === "hidden") hidden = true; },
      removeAttribute: function (name) { if (name === "hidden") hidden = false; }
    };
    var empty = ui.render(box, []);
    assert.strictEqual(empty.shown, false);
    assert.strictEqual(box.innerHTML, "");
    assert.strictEqual(box.hidden, true);
    var shown = ui.render(box, parsed);
    assert.strictEqual(shown.shown, true);
    assert.strictEqual(shown.count, 1);
    assert.strictEqual(box.hidden, false);
    assert.ok(/承認済みの変更があります/.test(box.innerHTML));
    assert.ok(/本番へ反映する/.test(box.innerHTML));
  });

  test("homepage publish failure UI shows Japanese diagnostics and Cursor copy text", function () {
    var ui = require(path.join(__dirname, "..", "js", "smile-hp-edit-publish-result.js"));
    var script = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
    var html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    assert.ok(/smile-hp-edit-publish-result\.js/.test(html));
    assert.ok(/id="hp-edit-publish-result"/.test(html));
    assert.ok(/Cursorに渡す診断内容をコピー/.test(html));
    assert.ok(/btn-hp-edit-publish-copy/.test(html));
    assert.ok(/SmileHpEditPublishResult/.test(script));
    assert.ok(/failUi\.render/.test(script));
    var publishFn = script.slice(
      script.indexOf("function publishHpEditToSite"),
      script.indexOf("function hpGithubReadyUi")
    );
    var okIdx = publishFn.indexOf("if (data.ok)");
    var elseIdx = publishFn.indexOf("} else {", okIdx);
    var okBlock = publishFn.slice(okIdx, elseIdx);
    assert.ok(/公開済み/.test(okBlock));
    assert.ok(/failUi\.clear/.test(okBlock));
    assert.ok(!/公開失敗/.test(okBlock));

    assert.strictEqual(ui.explainReasonCode("upload_failed"), "新しいファイルをアップロードできませんでした");
    assert.strictEqual(ui.explainReasonCode("ftp_cwd_550"), "FTPの作業フォルダへ移動できませんでした");
    assert.strictEqual(ui.explainReasonCode("backup_failed"), "公開前バックアップを作成できませんでした");
    assert.strictEqual(ui.explainReasonCode("swap_failed"), "新しいファイルへの切替に失敗しました");
    assert.strictEqual(ui.explainReasonCode("unknown_reason_xyz"), "公開処理でエラーが発生しました");
    assert.strictEqual(ui.explainReasonCode(""), "公開処理でエラーが発生しました");

    var data = {
      ok: false,
      reasonCode: "upload_failed",
      failedFile: "css/top-diary-notice.css",
      ftpErrorCode: "550",
      requestId: "spub_test123",
      userMessage: "公開に失敗したため、元のホームページを維持しました",
      productionUntouched: true,
      password: "nope",
      FTP_USER: "hidden",
      buffer: "FILE BODY SHOULD NOT APPEAR"
    };
    var vm = ui.viewModel(data);
    assert.strictEqual(vm.title, "公開失敗");
    assert.strictEqual(vm.reasonJa, "新しいファイルをアップロードできませんでした");
    assert.strictEqual(vm.failedFile, "css/top-diary-notice.css");
    assert.strictEqual(vm.ftpErrorCode, "550");
    assert.strictEqual(vm.productionLine, "元のホームページは維持されています");
    assert.strictEqual(vm.requestId, "spub_test123");
    var shown = ui.failureHtml(data);
    assert.ok(/公開失敗/.test(shown));
    assert.ok(/新しいファイルをアップロードできませんでした/.test(shown));
    assert.ok(/css\/top-diary-notice\.css/.test(shown));
    assert.ok(/>550</.test(shown) || /FTPエラー[\s\S]*550/.test(shown));
    assert.ok(/元のホームページは維持されています/.test(shown));
    assert.ok(/spub_test123/.test(shown));
    assert.ok(shown.toLowerCase().indexOf("password") < 0);
    assert.ok(shown.indexOf("FILE BODY") < 0);

    var copy = ui.copyHandoff(data);
    assert.ok(copy.indexOf("Smile AI Studio ホームページ公開失敗") >= 0);
    assert.ok(copy.indexOf("requestId:\nspub_test123") >= 0);
    assert.ok(copy.indexOf("reasonCode:\nupload_failed") >= 0);
    assert.ok(copy.indexOf("failedFile:\ncss/top-diary-notice.css") >= 0);
    assert.ok(copy.indexOf("ftpErrorCode:\n550") >= 0);
    assert.ok(copy.indexOf("userMessage:\n公開に失敗したため、元のホームページを維持しました") >= 0);
    assert.ok(copy.indexOf("productionUntouched:\ntrue") >= 0);
    assert.ok(copy.indexOf("この情報を使って原因を調査してください。") >= 0);
    assert.ok(copy.indexOf("本番FTPは再実行せず、feature branchで修正・テスト・PR作成まで行ってください。") >= 0);
    assert.ok(copy.toLowerCase().indexOf("password") < 0);
    assert.ok(copy.toLowerCase().indexOf("ftp_user") < 0);
    assert.ok(copy.indexOf("FILE BODY") < 0);
    assert.ok(copy.indexOf("nope") < 0);
    assert.ok(copy.indexOf("hidden") < 0);

    var restored = ui.viewModel({
      reasonCode: "rollback_failed",
      productionUntouched: false
    });
    assert.notStrictEqual(restored.productionLine, "元のホームページは維持されています");
  });

  console.log("\nPassed " + passed + " hp-edit-jobs tests");
}

run();
