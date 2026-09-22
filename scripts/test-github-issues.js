"use strict";

/**
 * Unit tests for shared/github-issues.js (no network unless mocked fetch).
 */
var assert = require("assert");
var path = require("path");
var github = require(path.join(__dirname, "..", "netlify", "functions", "shared", "github-issues.js"));

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

function restoreEnv(prev) {
  Object.keys(prev).forEach(function (k) {
    if (prev[k] == null) delete process.env[k];
    else process.env[k] = prev[k];
  });
}

function snapshotEnv(keys) {
  var prev = {};
  keys.forEach(function (k) { prev[k] = process.env[k]; });
  return prev;
}

async function run() {
  await test("sanitizeTitle rejects short", function () {
    assert.strictEqual(github.sanitizeTitle("ab").ok, false);
  });

  await test("sanitizeTitle trims long", function () {
    var r = github.sanitizeTitle("x".repeat(200));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.title.length, 120);
  });

  await test("sanitizeBody requires length and adds Agent Status", function () {
    var r = github.sanitizeBody("短い");
    assert.strictEqual(r.ok, false);
    var ok = github.sanitizeBody("これは十分な長さのある開発依頼本文です。受け入れ条件も含みます。");
    assert.strictEqual(ok.ok, true);
    assert.ok(/## Agent Status/.test(ok.body));
    assert.ok(/READY_FOR_AGENT/.test(ok.body));
  });

  await test("parseAgentStatus + map to job statuses", function () {
    assert.strictEqual(github.parseAgentStatus("## Agent Status\nAGENT_WORKING\n"), "AGENT_WORKING");
    assert.strictEqual(github.mapAgentStatusToJobStatus("AGENT_WORKING"), "agent_working");
    assert.strictEqual(github.mapAgentStatusToJobStatus("TESTING"), "testing");
    assert.strictEqual(github.mapAgentStatusToJobStatus("FIXING"), "fixing");
    assert.strictEqual(github.mapAgentStatusToJobStatus("READY_FOR_REVIEW"), "waiting_for_review");
  });

  await test("ensureAgentStatus updates existing block", function () {
    var body = "# T\n\n## Agent Status\nREADY_FOR_AGENT\n";
    var next = github.ensureAgentStatus(body, "TESTING");
    assert.ok(/TESTING/.test(next));
  });

  await test("parseJobId and parsePrFromBody", function () {
    var body = "## Job Id\njob_abc\n\n## Pull Request\n#99\n";
    assert.strictEqual(github.parseJobId(body), "job_abc");
    assert.strictEqual(github.parsePrFromBody(body), 99);
    assert.strictEqual(github.parsePrFromBody("## Pull Request\n(none yet)\n"), null);
  });

  await test("assertRepoAllowed enforces allowlist", function () {
    var cfg = {
      owner: "egao",
      repo: "SmileAIStudio",
      allowlist: ["egao/smileaistudio"]
    };
    assert.strictEqual(github.assertRepoAllowed(cfg, "egao", "SmileAIStudio").ok, true);
    assert.strictEqual(github.assertRepoAllowed(cfg, "other", "repo").ok, false);
  });

  await test("GITHUB_REPOSITORY plus token is enough to configure", function () {
    var keys = ["GITHUB_TOKEN", "GH_TOKEN", "GITHUB_OWNER", "GITHUB_REPO", "GITHUB_REPOSITORY"];
    var prev = snapshotEnv(keys);
    keys.forEach(function (k) { delete process.env[k]; });
    process.env.GITHUB_TOKEN = "test-token-not-real";
    process.env.GITHUB_REPOSITORY = "yahayaha223/SmileAIStudio";
    try {
      assert.strictEqual(github.isConfigured(), true);
      var cfg = github.getGithubConfig();
      assert.strictEqual(cfg.owner, "yahayaha223");
      assert.strictEqual(cfg.repo, "SmileAIStudio");
    } finally {
      restoreEnv(prev);
    }
  });

  await test("isConfigured false without env", function () {
    var keys = ["GITHUB_TOKEN", "GH_TOKEN", "GITHUB_OWNER", "GITHUB_REPO", "GITHUB_REPOSITORY"];
    var prev = snapshotEnv(keys);
    keys.forEach(function (k) { delete process.env[k]; });
    assert.strictEqual(github.isConfigured(), false);
    restoreEnv(prev);
  });

  await test("createIssue returns github_not_configured without token", async function () {
    var keys = ["GITHUB_TOKEN", "GH_TOKEN"];
    var prev = snapshotEnv(keys);
    keys.forEach(function (k) { delete process.env[k]; });
    var r = await github.createIssue({
      title: "Test issue title here",
      body: "これは十分な長さのある開発依頼本文です。受け入れ条件も含みます。"
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, "github_not_configured");
    restoreEnv(prev);
  });

  await test("createIssue mock success path via stub", async function () {
    var origFetch = global.fetch;
    var calls = [];
    process.env.GITHUB_TOKEN = "test-token-not-real";
    process.env.GITHUB_OWNER = "egao";
    process.env.GITHUB_REPO = "SmileAIStudio";
    global.fetch = async function (url, opts) {
      calls.push({
        url: String(url),
        method: (opts && opts.method) || "GET",
        body: opts && opts.body
      });
      var isComment = String(url).indexOf("/comments") >= 0;
      return {
        ok: true,
        status: 201,
        text: async function () {
          if (isComment) {
            return JSON.stringify({ id: 99, body: "READY_FOR_AGENT" });
          }
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
      assert.strictEqual(r.jobStatus, "waiting_for_agent");
      assert.strictEqual(r.kickoffCommentPosted, true);
      assert.ok(calls.length >= 2);
      var commentCall = calls.find(function (c) { return c.url.indexOf("/comments") >= 0; });
      assert.ok(commentCall, "expected kickoff comment POST");
      assert.strictEqual(commentCall.method, "POST");
      var payload = JSON.parse(commentCall.body);
      assert.strictEqual(payload.body, "READY_FOR_AGENT");
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

  await test("isAgentKickoffComment requires exact READY_FOR_AGENT", function () {
    assert.strictEqual(github.isAgentKickoffComment("READY_FOR_AGENT"), true);
    assert.strictEqual(github.isAgentKickoffComment(" READY_FOR_AGENT \n"), true);
    assert.strictEqual(github.isAgentKickoffComment("ready_for_agent"), false);
    assert.strictEqual(github.isAgentKickoffComment("READY_FOR_AGENT please"), false);
    assert.strictEqual(github.AGENT_KICKOFF_COMMENT, "READY_FOR_AGENT");
  });

  await test("shouldStartAgent blocks busy Agent Status even with kickoff comment", function () {
    assert.strictEqual(github.shouldStartAgent("READY_FOR_AGENT", "READY_FOR_AGENT"), true);
    assert.strictEqual(github.shouldStartAgent("AGENT_WORKING", "READY_FOR_AGENT"), false);
    assert.strictEqual(github.shouldStartAgent("TESTING", "READY_FOR_AGENT"), false);
    assert.strictEqual(github.shouldStartAgent("FIXING", "READY_FOR_AGENT"), false);
    assert.strictEqual(github.shouldStartAgent("READY_FOR_REVIEW", "READY_FOR_AGENT"), false);
    assert.strictEqual(github.shouldStartAgent("FAILED", "READY_FOR_AGENT"), false);
    assert.strictEqual(github.shouldStartAgent("COMPLETED", "READY_FOR_AGENT"), false);
    assert.strictEqual(github.shouldStartAgent("READY_FOR_AGENT", "please start"), false);
  });

  await test("createIssue still succeeds if kickoff comment fails", async function () {
    var origFetch = global.fetch;
    process.env.GITHUB_TOKEN = "test-token-not-real";
    process.env.GITHUB_OWNER = "egao";
    process.env.GITHUB_REPO = "SmileAIStudio";
    global.fetch = async function (url) {
      if (String(url).indexOf("/comments") >= 0) {
        return {
          ok: false,
          status: 502,
          text: async function () { return JSON.stringify({ message: "Bad Gateway" }); }
        };
      }
      return {
        ok: true,
        status: 201,
        text: async function () {
          return JSON.stringify({
            number: 43,
            html_url: "https://github.com/egao/SmileAIStudio/issues/43",
            title: "Hello"
          });
        }
      };
    };
    try {
      var r = await github.createIssue({
        title: "Mock issue title two",
        body: "これは十分な長さのある開発依頼本文です。受け入れ条件も含みます。"
      });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.number, 43);
      assert.strictEqual(r.kickoffCommentPosted, false);
    } finally {
      global.fetch = origFetch;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_OWNER;
      delete process.env.GITHUB_REPO;
    }
  });

  await test("syncIssueState mock maps AGENT_WORKING", async function () {
    var origFetch = global.fetch;
    process.env.GITHUB_TOKEN = "test-token-not-real";
    process.env.GITHUB_OWNER = "egao";
    process.env.GITHUB_REPO = "SmileAIStudio";
    global.fetch = async function (url) {
      var u = String(url);
      if (u.indexOf("/search/issues") >= 0) {
        return {
          ok: true,
          status: 200,
          text: async function () { return JSON.stringify({ items: [] }); }
        };
      }
      return {
        ok: true,
        status: 200,
        text: async function () {
          return JSON.stringify({
            number: 7,
            html_url: "https://github.com/egao/SmileAIStudio/issues/7",
            title: "Job",
            state: "open",
            body: "# AI\n\n## Job Id\njob_x\n\n## Agent Status\nAGENT_WORKING\n"
          });
        }
      };
    };
    try {
      var r = await github.syncIssueState(7);
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.sync.agentStatus, "AGENT_WORKING");
      assert.strictEqual(r.sync.status, "agent_working");
      assert.strictEqual(r.sync.jobId, "job_x");
    } finally {
      global.fetch = origFetch;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_OWNER;
      delete process.env.GITHUB_REPO;
    }
  });

  await test("syncIssueState READY_FOR_REVIEW with PR in body", async function () {
    var origFetch = global.fetch;
    process.env.GITHUB_TOKEN = "test-token-not-real";
    process.env.GITHUB_OWNER = "egao";
    process.env.GITHUB_REPO = "SmileAIStudio";
    global.fetch = async function (url) {
      if (String(url).indexOf("/search/issues") >= 0) {
        return {
          ok: true,
          status: 200,
          text: async function () { return JSON.stringify({ items: [] }); }
        };
      }
      return {
        ok: true,
        status: 200,
        text: async function () {
          return JSON.stringify({
            number: 8,
            html_url: "https://github.com/egao/SmileAIStudio/issues/8",
            title: "Job",
            state: "open",
            body: "## Pull Request\n#55\n\n## Agent Status\nREADY_FOR_REVIEW\n"
          });
        }
      };
    };
    try {
      var r = await github.syncIssueState(8);
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.sync.status, "waiting_for_review");
      assert.strictEqual(r.sync.githubPrNumber, 55);
    } finally {
      global.fetch = origFetch;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_OWNER;
      delete process.env.GITHUB_REPO;
    }
  });

  function mockHomepageGithub(opts) {
    opts = opts || {};
    var merged = opts.merged !== false;
    var issueNum = opts.issueNumber || 6;
    var prNum = opts.prNumber || 7;
    var files = opts.files || [
      { filename: "CorporateSite/index.htm" },
      { filename: "CorporateSite/css/top-diary-notice.css" }
    ];
    return async function (url) {
      var u = String(url);
      if (u.indexOf("/search/issues") >= 0) {
        return {
          ok: true,
          status: 200,
          text: async function () {
            return JSON.stringify({ items: opts.searchItems || [] });
          }
        };
      }
      if (u.indexOf("/pulls/" + prNum + "/files") >= 0) {
        return {
          ok: true,
          status: 200,
          text: async function () { return JSON.stringify(files); }
        };
      }
      if (u.indexOf("/pulls/" + prNum) >= 0) {
        return {
          ok: true,
          status: 200,
          text: async function () {
            return JSON.stringify({
              number: prNum,
              merged: merged,
              merged_at: merged ? "2026-08-20T00:00:00Z" : null,
              html_url: "https://github.com/egao/SmileAIStudio/pull/" + prNum,
              base: { ref: opts.baseRef || "main" },
              merge_commit_sha: merged ? "abc123" : null,
              head: { sha: "def456" }
            });
          }
        };
      }
      if (u.indexOf("/issues/" + issueNum) >= 0) {
        return {
          ok: true,
          status: 200,
          text: async function () {
            return JSON.stringify({
              number: issueNum,
              html_url: "https://github.com/egao/SmileAIStudio/issues/" + issueNum,
              title: "HP",
              state: "open",
              body: "## Job Kind\nhomepage-edit\n\n## Pull Request\n#" + prNum +
                "\n\n## Agent Status\nREADY_FOR_REVIEW\n"
            });
          }
        };
      }
      return {
        ok: false,
        status: 404,
        text: async function () { return JSON.stringify({ message: "Not Found" }); }
      };
    };
  }

  await test("empty localStorage still finds Issue #6 / merged PR #7", async function () {
    var origFetch = global.fetch;
    process.env.GITHUB_TOKEN = "test-token-not-real";
    process.env.GITHUB_OWNER = "egao";
    process.env.GITHUB_REPO = "SmileAIStudio";
    global.fetch = mockHomepageGithub({ merged: true });
    try {
      assert.deepStrictEqual(github.DEFAULT_HOMEPAGE_ISSUE_SEEDS, [6]);
      var r = await github.findReadyHomepagePublishes();
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.items.length, 1);
      assert.strictEqual(r.items[0].issueNumber, 6);
      assert.strictEqual(r.items[0].prNumber, 7);
      assert.strictEqual(r.items[0].prMerged, true);
      assert.deepStrictEqual(r.items[0].files, [
        "CorporateSite/index.htm",
        "CorporateSite/css/top-diary-notice.css"
      ]);
    } finally {
      global.fetch = origFetch;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_OWNER;
      delete process.env.GITHUB_REPO;
    }
  });

  await test("unmerged PR is not ready to publish", async function () {
    var origFetch = global.fetch;
    process.env.GITHUB_TOKEN = "test-token-not-real";
    process.env.GITHUB_OWNER = "egao";
    process.env.GITHUB_REPO = "SmileAIStudio";
    global.fetch = mockHomepageGithub({ merged: false });
    try {
      var r = await github.findReadyHomepagePublishes();
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.items.length, 0);
      var gate = github.assertPrMergedToMain({
        ok: true,
        merged: false,
        baseRef: "main"
      });
      assert.strictEqual(gate.ok, false);
      assert.strictEqual(gate.error, "pr_not_merged");
    } finally {
      global.fetch = origFetch;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_OWNER;
      delete process.env.GITHUB_REPO;
    }
  });

  await test("PR not based on main is not ready to publish", async function () {
    var origFetch = global.fetch;
    process.env.GITHUB_TOKEN = "test-token-not-real";
    process.env.GITHUB_OWNER = "egao";
    process.env.GITHUB_REPO = "SmileAIStudio";
    global.fetch = mockHomepageGithub({ merged: true, baseRef: "feature/x" });
    try {
      var r = await github.findReadyHomepagePublishes();
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.items.length, 0);
    } finally {
      global.fetch = origFetch;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_OWNER;
      delete process.env.GITHUB_REPO;
    }
  });

  function decodeSearchQuery(url) {
    try {
      var q = String(url).split("q=")[1] || "";
      q = q.split("&")[0] || "";
      return decodeURIComponent(q.replace(/\+/g, " "));
    } catch (e) {
      return String(url);
    }
  }

  function jsonRes(ok, status, payload) {
    return {
      ok: ok,
      status: status,
      text: async function () { return JSON.stringify(payload); }
    };
  }

  function mockIssue6NoneYetRelatedPr7(opts) {
    opts = opts || {};
    var merged = opts.merged !== false;
    var baseRef = opts.baseRef || "main";
    var files = opts.files !== undefined ? opts.files : [
      { filename: "CorporateSite/index.htm" },
      { filename: "CorporateSite/css/top-diary-notice.css" }
    ];
    var prBody = opts.prBody !== undefined
      ? opts.prBody
      : "Related: https://github.com/egao/SmileAIStudio/issues/6\n";
    var issueBody = "## Job Kind\nhomepage-edit\n\n## Pull Request\n(none yet)\n\n## Agent Status\nREADY_FOR_REVIEW\n";
    return async function (url) {
      var u = String(url);
      if (u.indexOf("/search/issues") >= 0) {
        var q = decodeSearchQuery(u);
        var isPr = /\bis:pr\b/.test(q);
        var mentionsIssue = /issues\/6/.test(q);
        var items = [];
        if (isPr && mentionsIssue && opts.searchEmpty !== true) {
          items = [{
            number: 7,
            pull_request: { url: "https://api.github.com/repos/egao/SmileAIStudio/pulls/7" },
            html_url: "https://github.com/egao/SmileAIStudio/pull/7",
            title: "HP",
            body: prBody
          }];
        }
        if (opts.extraSearchItems && isPr) {
          items = (opts.extraSearchItems || []).concat(items);
        }
        return jsonRes(true, 200, { items: items });
      }
      if (u.indexOf("/issues/6/timeline") >= 0) {
        if (opts.noTimeline) return jsonRes(true, 200, []);
        return jsonRes(true, 200, [{
          event: "cross-referenced",
          source: {
            type: "issue",
            issue: {
              number: 7,
              pull_request: { url: "https://api.github.com/repos/egao/SmileAIStudio/pulls/7" },
              html_url: "https://github.com/egao/SmileAIStudio/pull/7",
              body: prBody
            }
          }
        }]);
      }
      if (u.indexOf("/pulls/7/files") >= 0) {
        return jsonRes(true, 200, files);
      }
      if (u.indexOf("/pulls/7") >= 0) {
        return jsonRes(true, 200, {
          number: 7,
          merged: merged,
          merged_at: merged ? "2026-08-20T00:00:00Z" : null,
          html_url: "https://github.com/egao/SmileAIStudio/pull/7",
          base: { ref: baseRef },
          merge_commit_sha: merged ? "abc123" : null,
          head: { sha: "def456" },
          body: prBody
        });
      }
      if (u.indexOf("/pulls/99") >= 0) {
        return jsonRes(true, 200, {
          number: 99,
          merged: true,
          merged_at: "2026-08-20T00:00:00Z",
          html_url: "https://github.com/egao/SmileAIStudio/pull/99",
          base: { ref: "main" },
          body: "unrelated PR, no issue link"
        });
      }
      if (u.indexOf("/issues/6") >= 0) {
        return jsonRes(true, 200, {
          number: 6,
          html_url: "https://github.com/egao/SmileAIStudio/issues/6",
          title: "HP",
          state: "open",
          body: issueBody
        });
      }
      return jsonRes(false, 404, { message: "Not Found" });
    };
  }

  await test("Issue #6 (none yet) still resolves merged PR #7 via Related URL", async function () {
    var origFetch = global.fetch;
    process.env.GITHUB_TOKEN = "test-token-not-real";
    process.env.GITHUB_OWNER = "egao";
    process.env.GITHUB_REPO = "SmileAIStudio";
    global.fetch = mockIssue6NoneYetRelatedPr7({
      merged: true,
      baseRef: "main",
      noTimeline: true
    });
    try {
      assert.strictEqual(
        github.parsePrFromBody("## Job Kind\nhomepage-edit\n\n## Pull Request\n(none yet)\n"),
        null
      );
      assert.strictEqual(
        github.prBodyReferencesIssue(
          "Related: https://github.com/egao/SmileAIStudio/issues/6",
          6,
          { owner: "egao", repo: "SmileAIStudio" }
        ),
        true
      );
      var related = await github.findRelatedPullRequest(6);
      assert.strictEqual(related.ok, true);
      assert.strictEqual(related.pr.number, 7);
      var r = await github.findReadyHomepagePublishes();
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.items.length, 1);
      assert.strictEqual(r.items[0].issueNumber, 6);
      assert.strictEqual(r.items[0].prNumber, 7);
      assert.strictEqual(r.items[0].prMerged, true);
      assert.strictEqual(r.items[0].status, "ready_for_publish");
      assert.deepStrictEqual(r.items[0].files, [
        "CorporateSite/index.htm",
        "CorporateSite/css/top-diary-notice.css"
      ]);
    } finally {
      global.fetch = origFetch;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_OWNER;
      delete process.env.GITHUB_REPO;
    }
  });

  await test("Issue #6 (none yet) unmerged PR #7 is not ready", async function () {
    var origFetch = global.fetch;
    process.env.GITHUB_TOKEN = "test-token-not-real";
    process.env.GITHUB_OWNER = "egao";
    process.env.GITHUB_REPO = "SmileAIStudio";
    global.fetch = mockIssue6NoneYetRelatedPr7({ merged: false });
    try {
      var r = await github.findReadyHomepagePublishes();
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.items.length, 0);
    } finally {
      global.fetch = origFetch;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_OWNER;
      delete process.env.GITHUB_REPO;
    }
  });

  await test("Issue #6 (none yet) PR #7 not on main is not ready", async function () {
    var origFetch = global.fetch;
    process.env.GITHUB_TOKEN = "test-token-not-real";
    process.env.GITHUB_OWNER = "egao";
    process.env.GITHUB_REPO = "SmileAIStudio";
    global.fetch = mockIssue6NoneYetRelatedPr7({ merged: true, baseRef: "develop" });
    try {
      var r = await github.findReadyHomepagePublishes();
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.items.length, 0);
    } finally {
      global.fetch = origFetch;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_OWNER;
      delete process.env.GITHUB_REPO;
    }
  });

  await test("Issue #6 (none yet) without allowlist files is not ready", async function () {
    var origFetch = global.fetch;
    process.env.GITHUB_TOKEN = "test-token-not-real";
    process.env.GITHUB_OWNER = "egao";
    process.env.GITHUB_REPO = "SmileAIStudio";
    global.fetch = mockIssue6NoneYetRelatedPr7({
      merged: true,
      files: [{ filename: "README.md" }]
    });
    try {
      var r = await github.findReadyHomepagePublishes();
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.items.length, 0);
    } finally {
      global.fetch = origFetch;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_OWNER;
      delete process.env.GITHUB_REPO;
    }
  });

  await test("search hit without Issue #6 in PR body is ignored", async function () {
    var origFetch = global.fetch;
    process.env.GITHUB_TOKEN = "test-token-not-real";
    process.env.GITHUB_OWNER = "egao";
    process.env.GITHUB_REPO = "SmileAIStudio";
    global.fetch = mockIssue6NoneYetRelatedPr7({
      merged: true,
      noTimeline: true,
      searchEmpty: true,
      extraSearchItems: [{
        number: 99,
        pull_request: { url: "https://api.github.com/repos/egao/SmileAIStudio/pulls/99" },
        html_url: "https://github.com/egao/SmileAIStudio/pull/99",
        body: "unrelated"
      }]
    });
    try {
      var related = await github.findRelatedPullRequest(6);
      assert.strictEqual(related.ok, true);
      assert.strictEqual(related.pr, null);
      var r = await github.findReadyHomepagePublishes();
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.items.length, 0);
    } finally {
      global.fetch = origFetch;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_OWNER;
      delete process.env.GITHUB_REPO;
    }
  });

  console.log("\nPassed " + passed + " github-issues tests");
}

run().catch(function (e) {
  console.error(e);
  process.exit(1);
});
