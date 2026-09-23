"use strict";

/**
 * Optional Cursor cloud launch. Runs only when CURSOR_API_KEY is set.
 * Re-fetches the Issue from GitHub before building the prompt.
 * Does not print the key. Does not merge / deploy / FTP.
 */
var fs = require("fs");
var path = require("path");
var github = require(path.join(__dirname, "..", "netlify", "functions", "shared", "github-issues.js"));
var dispatch = require(path.join(__dirname, "..", "netlify", "functions", "shared", "ai-dev-job-dispatch.js"));

function logSafe(payload) {
  console.log(JSON.stringify(payload));
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), ".ai-dev-job-state.json"), "utf8"));
  } catch (e) {
    return {};
  }
}

async function githubGetIssue(number) {
  var n = Number(number);
  if (!isFinite(n) || n < 1) {
    return { ok: false, error: "invalid_issue_number" };
  }
  var cfg = github.getGithubConfig();
  var owner = cfg.owner || "";
  var repo = cfg.repo || "";
  if ((!owner || !repo) && process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY.indexOf("/") > 0) {
    var parts = process.env.GITHUB_REPOSITORY.split("/");
    owner = owner || parts[0];
    repo = repo || parts.slice(1).join("/");
  }
  if (!owner || !repo) {
    return { ok: false, error: "github_not_configured" };
  }
  var token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  var headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "SmileAIStudio-AiDevJob"
  };
  if (token) headers.Authorization = "Bearer " + token;
  var url = (process.env.GITHUB_API_URL || "https://api.github.com") +
    "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) +
    "/issues/" + encodeURIComponent(String(n));
  var res = await fetch(url, { method: "GET", headers: headers });
  var text = await res.text();
  var json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
  if (!res.ok || !json) return { ok: false, error: "issue_fetch_failed" };
  return { ok: true, issue: json };
}

async function resolveIssueForLaunch(opts) {
  opts = opts || {};
  if (opts.issue && opts.issue.number) {
    return { ok: true, issue: opts.issue };
  }
  var number = opts.issueNumber || (opts.state && opts.state.issueNumber);
  var getter = opts.getIssue || githubGetIssue;
  var got = await getter(number);
  if (!got || !got.ok || !got.issue) {
    return { ok: false, error: (got && got.error) || "issue_fetch_failed" };
  }
  return { ok: true, issue: got.issue };
}

async function launchWithSdk(prompt, branch) {
  var Agent;
  try {
    Agent = require("@cursor/sdk").Agent;
  } catch (e) {
    return { launched: false, reason: "cursor_sdk_missing" };
  }
  if (!Agent || typeof Agent.prompt !== "function") {
    return { launched: false, reason: "cursor_sdk_missing" };
  }
  var repo = process.env.GITHUB_REPOSITORY || "yahayaha223/SmileAIStudio";
  var result = await Agent.prompt(prompt, {
    apiKey: process.env.CURSOR_API_KEY,
    model: { id: "composer-2.5" },
    cloud: {
      repos: [{
        url: "https://github.com/" + repo,
        startingRef: branch || "main"
      }],
      autoCreatePR: true
    }
  });
  return {
    launched: true,
    reason: "cursor_cloud",
    status: result && result.status
  };
}

async function run(opts) {
  opts = opts || {};
  var env = opts.env || process.env;
  if (!dispatch.shouldLaunchCursor(env)) {
    var missing = {
      stage: "ai-dev-job-cursor",
      launched: false,
      reason: "cursor_key_missing",
      mergeToMain: false,
      productionDeploy: false,
      productionFtp: false
    };
    logSafe(missing);
    return missing;
  }
  var state = opts.state || readState();
  if (state && state.started === false) {
    var skipped = {
      stage: "ai-dev-job-cursor",
      launched: false,
      reason: "dispatch_not_started",
      mergeToMain: false,
      productionDeploy: false,
      productionFtp: false
    };
    logSafe(skipped);
    return skipped;
  }

  var resolved = await resolveIssueForLaunch(Object.assign({}, opts, { state: state }));
  if (!resolved.ok) {
    var fetchFail = {
      stage: "ai-dev-job-cursor",
      launched: false,
      reason: resolved.error || "issue_fetch_failed",
      mergeToMain: false,
      productionDeploy: false,
      productionFtp: false
    };
    logSafe(fetchFail);
    return fetchFail;
  }

  var prompt = dispatch.buildCursorAgentPrompt(resolved.issue, state.branch);
  var launcher = opts.launchWithSdk || launchWithSdk;
  var launched = await launcher(prompt, state.branch);
  var out = Object.assign({
    stage: "ai-dev-job-cursor",
    issueNumber: resolved.issue.number,
    mergeToMain: false,
    productionDeploy: false,
    productionFtp: false
  }, launched);
  if (opts.includePrompt) out.prompt = prompt;
  logSafe({
    stage: out.stage,
    launched: out.launched,
    reason: out.reason,
    issueNumber: out.issueNumber,
    mergeToMain: false,
    productionDeploy: false,
    productionFtp: false
  });
  return out;
}

if (require.main === module) {
  run().catch(function () {
    logSafe({ stage: "ai-dev-job-cursor", launched: false, reason: "pipeline_error" });
    process.exit(1);
  });
}

module.exports = {
  run: run,
  launchWithSdk: launchWithSdk,
  resolveIssueForLaunch: resolveIssueForLaunch,
  githubGetIssue: githubGetIssue
};
