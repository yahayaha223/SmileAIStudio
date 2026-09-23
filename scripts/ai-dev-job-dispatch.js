"use strict";

/**
 * GitHub Actions entry for ai-dev-job dispatch / PR-ready sync.
 * Uses GITHUB_TOKEN only on the server. Never prints token values.
 */
var fs = require("fs");
var path = require("path");
var github = require(path.join(__dirname, "..", "netlify", "functions", "shared", "github-issues.js"));
var dispatch = require(path.join(__dirname, "..", "netlify", "functions", "shared", "ai-dev-job-dispatch.js"));

function readEvent() {
  var file = process.env.GITHUB_EVENT_PATH;
  if (!file) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return {};
  }
}

function apiBase() {
  return process.env.GITHUB_API_URL || "https://api.github.com";
}

async function githubRequest(method, urlPath, payload) {
  var token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  var headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "SmileAIStudio-AiDevJob"
  };
  if (token) headers.Authorization = "Bearer " + token;
  if (payload != null) headers["Content-Type"] = "application/json";
  var res = await fetch(apiBase() + urlPath, {
    method: method,
    headers: headers,
    body: payload == null ? undefined : JSON.stringify(payload)
  });
  var text = await res.text();
  var json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
  return { ok: res.ok, status: res.status, json: json };
}

function repoParts() {
  var cfg = github.getGithubConfig();
  return {
    owner: cfg.owner,
    repo: cfg.repo
  };
}

function issuePath(number) {
  var r = repoParts();
  return "/repos/" + encodeURIComponent(r.owner) + "/" + encodeURIComponent(r.repo) +
    "/issues/" + encodeURIComponent(String(number));
}

function makeApi() {
  return {
    getIssue: async function (number) {
      var res = await githubRequest("GET", issuePath(number));
      if (!res.ok || !res.json) return { ok: false, error: "github_api_failed" };
      return { ok: true, issue: res.json };
    },
    listComments: async function (number) {
      var res = await githubRequest("GET", issuePath(number) + "/comments?per_page=30");
      return (res.ok && Array.isArray(res.json)) ? res.json : [];
    },
    updateIssue: async function (number, patch) {
      var res = await githubRequest("PATCH", issuePath(number), patch);
      return { ok: res.ok, error: res.ok ? null : "github_api_failed" };
    },
    postComment: async function (number, body) {
      var res = await githubRequest("POST", issuePath(number) + "/comments", { body: body });
      return { ok: res.ok };
    },
    ensureBranch: async function (branch, fromRef) {
      var r = repoParts();
      var base = "/repos/" + encodeURIComponent(r.owner) + "/" + encodeURIComponent(r.repo);
      var existing = await githubRequest("GET", base + "/git/ref/heads/" + encodeURIComponent(branch));
      if (existing.ok) return { ok: true, existed: true, branch: branch };
      var src = await githubRequest("GET", base + "/git/ref/heads/" + encodeURIComponent(fromRef || "main"));
      if (!src.ok || !src.json || !src.json.object || !src.json.object.sha) {
        return { ok: false, error: "base_ref_missing" };
      }
      var created = await githubRequest("POST", base + "/git/refs", {
        ref: "refs/heads/" + branch,
        sha: src.json.object.sha
      });
      return { ok: created.ok, existed: false, branch: branch };
    },
    launchCursorAgent: async function (opts) {
      if (!dispatch.shouldLaunchCursor(process.env)) {
        return { launched: false, reason: "cursor_key_missing" };
      }
      return {
        launched: false,
        reason: "cursor_launch_deferred",
        promptChars: String((opts && opts.prompt) || "").length
      };
    }
  };
}

function writeState(result) {
  var out = {
    stage: "ai-dev-job-dispatch",
    ok: !!(result && result.ok),
    started: !!(result && result.started),
    updated: !!(result && result.updated),
    reason: result && result.reason,
    issueNumber: result && result.issueNumber,
    prNumber: result && result.prNumber,
    branch: result && result.branch,
    agentStatus: result && result.agentStatus,
    mergeToMain: false,
    productionDeploy: false,
    productionFtp: false
  };
  console.log(JSON.stringify(out));
  try {
    fs.writeFileSync(path.join(process.cwd(), ".ai-dev-job-state.json"), JSON.stringify(out));
  } catch (e) { /* ignore */ }
  if (process.env.GITHUB_OUTPUT) {
    try {
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        "started=" + (out.started ? "true" : "false") + "\n" +
        "branch=" + (out.branch || "") + "\n" +
        "issueNumber=" + (out.issueNumber || "") + "\n"
      );
    } catch (eOut) { /* ignore */ }
  }
}

async function run() {
  var mode = String(process.argv[2] || "kickoff").replace(/^--/, "");
  var raw = readEvent();
  var api = makeApi();

  if (mode === "pr-ready") {
    var pr = raw.pull_request || raw;
    var linked = dispatch.extractLinkedIssueNumber(pr);
    if (!linked) {
      writeState({ ok: true, updated: false, reason: "pr_not_linked" });
      return;
    }
    var got = await api.getIssue(linked);
    if (!got.ok) {
      writeState({ ok: false, updated: false, reason: got.error || "issue_fetch_failed" });
      process.exitCode = 1;
      return;
    }
    var marked = await dispatch.markReadyForReview(pr, got.issue, api);
    writeState(marked);
    if (!marked.ok) process.exitCode = 1;
    return;
  }

  var event = {
    eventName: process.env.GITHUB_EVENT_NAME || raw.eventName || "",
    action: raw.action || "",
    issue: raw.issue,
    comment: raw.comment,
    label: raw.label
  };
  var result = await dispatch.dispatchAiDevJob(event, api);
  writeState(result);
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  run().catch(function (err) {
    console.log(JSON.stringify({
      stage: "ai-dev-job-dispatch",
      ok: false,
      reason: "pipeline_error"
    }));
    if (err && err.message) console.error(String(err.message).slice(0, 160));
    process.exit(1);
  });
}

module.exports = { readEvent: readEvent, makeApi: makeApi };
