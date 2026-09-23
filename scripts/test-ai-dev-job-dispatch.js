"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var github = require(path.join(__dirname, "..", "netlify", "functions", "shared", "github-issues.js"));
var dispatch = require(path.join(__dirname, "..", "netlify", "functions", "shared", "ai-dev-job-dispatch.js"));
var launchCursor = require(path.join(__dirname, "ai-dev-job-launch-cursor.js"));

var ISSUE27_BODY = [
  "# AI DEVELOPMENT TASK",
  "",
  "## User Request",
  "公開した日記を私だけが手軽に消せないかな？",
  "",
  "## Acceptance Criteria",
  "- 依頼内容が満たされている",
  "- 既存の本番安全機構を壊していない",
  "- Passkey認証・日記公開の安全経路を維持",
  "",
  "## Safety Rules",
  "- main直push禁止",
  "- Production Deployは承認制",
  "- FTP本番は承認制",
  "- secretsをcommitしない",
  "- Tokenをブラウザへ送らない",
  "",
  "## Job Kind",
  "general",
  "",
  "## Job Id",
  "job_mudf05cd_k4fxhh",
  "",
  "## Branch",
  "(agent will set)",
  "",
  "## Pull Request",
  "(none yet)",
  "",
  "## Agent Status",
  "READY_FOR_AGENT",
  ""
].join("\n");

function issue27(overrides) {
  return Object.assign({
    number: 27,
    title: "公開した日記を私だけが手軽に消せないかな？",
    body: ISSUE27_BODY,
    labels: [{ name: "ai-dev-job" }]
  }, overrides || {});
}

var passed = 0;
function test(name, fn) {
  var ret = fn();
  if (ret && typeof ret.then === "function") {
    return ret.then(function () {
      passed += 1;
      console.log("OK  " + name);
    });
  }
  passed += 1;
  console.log("OK  " + name);
  return Promise.resolve();
}

async function run() {
  await test("label + READY_FOR_AGENT で kickoff する", function () {
    var d = dispatch.evaluateDispatch({
      eventName: "issues",
      action: "opened",
      issue: issue27()
    });
    assert.strictEqual(d.start, true);
    assert.strictEqual(d.reason, "issue_ready");
  });

  await test("READY_FOR_AGENT コメントでも kickoff する", function () {
    var d = dispatch.evaluateDispatch({
      eventName: "issue_comment",
      action: "created",
      issue: issue27(),
      comment: { body: "READY_FOR_AGENT" }
    });
    assert.strictEqual(d.start, true);
    assert.strictEqual(d.reason, "kickoff_comment");
  });

  await test("ai-dev-job が無いと起動しない", function () {
    var d = dispatch.evaluateDispatch({
      eventName: "issues",
      action: "opened",
      issue: issue27({ labels: [] })
    });
    assert.strictEqual(d.start, false);
    assert.strictEqual(d.reason, "no_ai_dev_job_label");
  });

  await test("AGENT_WORKING の Issue は二重起動しない", function () {
    var body = github.ensureAgentStatus(ISSUE27_BODY, "AGENT_WORKING");
    var d = dispatch.evaluateDispatch({
      eventName: "issue_comment",
      action: "created",
      issue: issue27({ body: body }),
      comment: { body: "READY_FOR_AGENT" }
    });
    assert.strictEqual(d.start, false);
    assert.strictEqual(d.reason, "already_busy");
  });

  await test("開始マーカーがあれば再起動しない", async function () {
    var r = await dispatch.dispatchAiDevJob({
      eventName: "issues",
      action: "opened",
      issue: issue27()
    }, {
      listComments: async function () {
        return [{ body: dispatch.AGENT_STARTED_MARKER + "\nalready" }];
      }
    });
    assert.strictEqual(r.started, false);
    assert.strictEqual(r.reason, "already_started_marker");
    assert.strictEqual(r.mergeToMain, false);
  });

  await test("開始時に AGENT_WORKING と branch を記録する", async function () {
    var stored = {};
    var comments = [];
    var branches = [];
    var ops = [];
    var r = await dispatch.dispatchAiDevJob({
      eventName: "issues",
      action: "opened",
      issue: issue27()
    }, {
      getIssue: async function () {
        return { ok: true, issue: issue27() };
      },
      listComments: async function () { return []; },
      updateIssue: async function (number, patch) {
        ops.push("update");
        stored.number = number;
        stored.body = patch.body;
        return { ok: true };
      },
      postComment: async function (number, body) {
        ops.push("comment");
        comments.push({ number: number, body: body });
        return { ok: true };
      },
      ensureBranch: async function (branch, fromRef) {
        ops.push("branch");
        branches.push({ branch: branch, fromRef: fromRef });
        return { ok: true };
      }
    });
    assert.deepStrictEqual(ops, ["branch", "update", "comment"]);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.started, true);
    assert.strictEqual(r.agentStatus, "AGENT_WORKING");
    assert.strictEqual(r.branch, "feature/issue-27");
    assert.strictEqual(r.mergeToMain, false);
    assert.strictEqual(r.productionDeploy, false);
    assert.strictEqual(r.productionFtp, false);
    assert.strictEqual(github.parseAgentStatus(stored.body), "AGENT_WORKING");
    assert.strictEqual(github.parseBranchName(stored.body), "feature/issue-27");
    assert.ok(comments[0].body.indexOf(dispatch.AGENT_STARTED_MARKER) >= 0);
    assert.ok(comments[0].body.indexOf("feature/issue-27") >= 0);
    assert.deepStrictEqual(branches, [{ branch: "feature/issue-27", fromRef: "main" }]);
  });

  await test("再読込で READY_FOR_AGENT でなければ二重起動しない", async function () {
    var r = await dispatch.dispatchAiDevJob({
      eventName: "issues",
      action: "opened",
      issue: issue27()
    }, {
      getIssue: async function () {
        return {
          ok: true,
          issue: issue27({
            body: github.ensureAgentStatus(ISSUE27_BODY, "AGENT_WORKING")
          })
        };
      },
      listComments: async function () { return []; }
    });
    assert.strictEqual(r.started, false);
    assert.strictEqual(r.reason, "already_busy");
  });

  await test("PR作成後に READY_FOR_REVIEW と PR番号を書く", async function () {
    var stored = {};
    var issue = issue27({
      body: github.ensureAgentStatus(
        github.replaceIssueSection(ISSUE27_BODY, "Branch", "feature/issue-27"),
        "AGENT_WORKING"
      )
    });
    var pr = {
      number: 99,
      body: "Related: https://github.com/yahayaha223/SmileAIStudio/issues/27",
      base: { ref: "main" },
      head: { ref: "feature/issue-27" }
    };
    var ready = dispatch.evaluatePrReady(pr, issue);
    assert.strictEqual(ready.update, true);
    var r = await dispatch.markReadyForReview(pr, issue, {
      updateIssue: async function (number, patch) {
        stored.number = number;
        stored.body = patch.body;
        return { ok: true };
      }
    });
    assert.strictEqual(r.updated, true);
    assert.strictEqual(r.agentStatus, "READY_FOR_REVIEW");
    assert.strictEqual(r.mergeToMain, false);
    assert.strictEqual(github.parseAgentStatus(stored.body), "READY_FOR_REVIEW");
    assert.strictEqual(github.parsePrFromBody(stored.body), 99);
    assert.strictEqual(github.parseBranchName(stored.body), "feature/issue-27");
  });

  await test("main merge / deploy / FTP フラグは常に false", function () {
    var ready = dispatch.evaluatePrReady({
      number: 1,
      merged: true,
      base: { ref: "main" },
      head: { ref: "feature/issue-27" },
      body: "#27"
    }, issue27());
    assert.strictEqual(ready.update, false);
    assert.strictEqual(ready.reason, "pr_already_merged");
  });

  await test("branch作成失敗時は AGENT_WORKING にも開始コメントにもしない", async function () {
    var stored = null;
    var comments = [];
    var cursorCalls = 0;
    var r = await dispatch.dispatchAiDevJob({
      eventName: "issues",
      action: "opened",
      issue: issue27()
    }, {
      getIssue: async function () {
        return { ok: true, issue: issue27() };
      },
      listComments: async function () { return []; },
      updateIssue: async function (number, patch) {
        stored = patch.body;
        return { ok: true };
      },
      postComment: async function (number, body) {
        comments.push(body);
        return { ok: true };
      },
      ensureBranch: async function () {
        return { ok: false, error: "base_ref_missing" };
      },
      launchCursorAgent: async function () {
        cursorCalls += 1;
        return { launched: true, reason: "should_not_run" };
      }
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.started, false);
    assert.strictEqual(r.reason, "base_ref_missing");
    assert.strictEqual(r.agentStatus, "READY_FOR_AGENT");
    assert.strictEqual(r.cursor.launched, false);
    assert.strictEqual(cursorCalls, 0);
    assert.strictEqual(stored, null);
    assert.strictEqual(comments.length, 0);
    assert.ok(!comments.some(function (c) { return String(c).indexOf("AI作業を開始しました") >= 0; }));
  });

  await test("Issue #27本文が実際の Cursor prompt に入る", async function () {
    var captured = "";
    var prev = process.env.CURSOR_API_KEY;
    process.env.CURSOR_API_KEY = "test-cursor-key-not-real";
    try {
      var live = issue27();
      var r = await launchCursor.run({
        state: { started: true, issueNumber: 27, branch: "feature/issue-27" },
        getIssue: async function (number) {
          assert.strictEqual(Number(number), 27);
          return { ok: true, issue: live };
        },
        launchWithSdk: async function (prompt, branch) {
          captured = prompt;
          assert.strictEqual(branch, "feature/issue-27");
          return { launched: false, reason: "dry_run" };
        },
        includePrompt: true
      });
      assert.strictEqual(r.reason, "dry_run");
      assert.ok(captured.indexOf("公開した日記を私だけが手軽に消せないかな？") >= 0);
      assert.ok(captured.indexOf("Issue number: 27") >= 0);
      assert.ok(captured.indexOf("Issue title: 公開した日記を私だけが手軽に消せないかな？") >= 0);
      assert.ok(captured.indexOf("job_mudf05cd_k4fxhh") >= 0);
      assert.ok(captured.indexOf("Acceptance Criteria") >= 0);
      assert.ok(captured.indexOf("依頼内容が満たされている") >= 0);
      assert.ok(captured.indexOf("Safety Rules") >= 0);
      assert.ok(captured.indexOf("main直push禁止") >= 0);
      assert.ok(captured.indexOf("title: \"\"") < 0);
      var built = dispatch.buildCursorAgentPrompt(live, "feature/issue-27");
      assert.ok(built.indexOf("公開した日記を私だけが手軽に消せないかな？") >= 0);
      assert.strictEqual(dispatch.extractIssueSection(live.body, "Job Id"), "job_mudf05cd_k4fxhh");
    } finally {
      if (prev == null) delete process.env.CURSOR_API_KEY;
      else process.env.CURSOR_API_KEY = prev;
    }
  });

  await test("Cursor起動はキーが無いと行わない", async function () {
    var prev = process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_API_KEY;
    try {
      assert.strictEqual(dispatch.shouldLaunchCursor({}), false);
      var r = await launchCursor.run({ state: { started: true, issueNumber: 27, branch: "feature/issue-27" } });
      assert.strictEqual(r.launched, false);
      assert.strictEqual(r.reason, "cursor_key_missing");
    } finally {
      if (prev == null) delete process.env.CURSOR_API_KEY;
      else process.env.CURSOR_API_KEY = prev;
    }
  });

  await test("workflow は merge/deploy/FTP を含まない", function () {
    var kick = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "ai-dev-job.yml"), "utf8");
    var pr = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "ai-dev-job-pr.yml"), "utf8");
    assert.ok(/ai-dev-job-dispatch\.js/.test(kick));
    assert.ok(/concurrency:/.test(kick));
    assert.ok(/ai-dev-job-\$\{\{ github.event.issue.number \}\}/.test(kick));
    assert.ok(!/gh pr merge/.test(kick + pr));
    assert.ok(!/netlify deploy/.test(kick + pr));
    assert.ok(!/ftp/i.test(kick + pr) || /never FTP/i.test(kick + pr));
    assert.ok(!/Production Deploy/i.test(kick) || /Never/.test(pr));
    assert.ok(/pr-ready/.test(pr));
    assert.ok(!/CURSOR_API_KEY=/.test(kick.split("\n").filter(function (l) {
      return /echo/.test(l);
    }).join("\n")));
  });

  await test("replaceIssueSection は Branch / PR だけ書き換える", function () {
    var next = github.replaceIssueSection(ISSUE27_BODY, "Branch", "feature/issue-27");
    next = github.replaceIssueSection(next, "Pull Request", "#99");
    assert.strictEqual(github.parseBranchName(next), "feature/issue-27");
    assert.strictEqual(github.parsePrFromBody(next), 99);
    assert.ok(next.indexOf("公開した日記を私だけが手軽に消せないかな？") >= 0);
    assert.ok(github.hasAiDevJobLabel(issue27()));
  });

  await test("Studio sync が Agent Status を読める", function () {
    var body = github.ensureAgentStatus(ISSUE27_BODY, "READY_FOR_REVIEW");
    body = github.replaceIssueSection(body, "Pull Request", "#99");
    assert.strictEqual(github.mapAgentStatusToJobStatus("READY_FOR_REVIEW", { githubPrNumber: 99 }), "waiting_for_review");
    assert.strictEqual(github.parsePrFromBody(body), 99);
  });

  console.log("\nPassed " + passed + " ai-dev-job-dispatch tests");
}

run().catch(function (e) {
  console.error(e);
  process.exit(1);
});
