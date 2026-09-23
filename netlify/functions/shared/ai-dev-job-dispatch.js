"use strict";

/**
 * Issue → AGENT_WORKING → feature branch → PR READY_FOR_REVIEW.
 * Never merges main, never Production Deploy, never production FTP.
 */
var github = require("./github-issues");

var AGENT_STARTED_MARKER = "<!-- smile-ai-agent-started -->";
var FEATURE_BRANCH_PREFIX = "feature/issue-";

function labelNames(issue) {
  var labels = (issue && issue.labels) || [];
  return labels.map(function (l) {
    return String((l && l.name) || l || "").toLowerCase();
  });
}

function buildFeatureBranchName(issueNumber, title) {
  var n = Number(issueNumber);
  if (!isFinite(n) || n < 1) return null;
  var slug = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug ? FEATURE_BRANCH_PREFIX + n + "-" + slug : FEATURE_BRANCH_PREFIX + n;
}

function hasStartedMarker(comments) {
  var list = Array.isArray(comments) ? comments : [];
  for (var i = 0; i < list.length; i++) {
    if (String((list[i] && list[i].body) || "").indexOf(AGENT_STARTED_MARKER) >= 0) {
      return true;
    }
  }
  return false;
}

function evaluateDispatch(event) {
  event = event || {};
  var issue = event.issue;
  if (!issue || !issue.number) {
    return { start: false, reason: "no_issue" };
  }
  if (!github.hasAiDevJobLabel(issue)) {
    return { start: false, reason: "no_ai_dev_job_label" };
  }
  var status = github.parseAgentStatus(issue.body);
  if (github.BUSY_AGENT_STATUS[status]) {
    return { start: false, reason: "already_busy" };
  }
  if (status !== "READY_FOR_AGENT") {
    return { start: false, reason: "not_ready" };
  }

  var eventName = String(event.eventName || "");
  var action = String(event.action || "");
  if (eventName === "issue_comment" && action === "created") {
    if (!github.isAgentKickoffComment(event.comment && event.comment.body)) {
      return { start: false, reason: "not_kickoff_comment" };
    }
    return { start: true, reason: "kickoff_comment" };
  }
  if (eventName === "issues" && (action === "opened" || action === "labeled")) {
    if (action === "labeled") {
      var added = String((event.label && event.label.name) || "").toLowerCase();
      if (added && added !== "ai-dev-job") {
        return { start: false, reason: "other_label" };
      }
    }
    return { start: true, reason: "issue_ready" };
  }
  return { start: false, reason: "unhandled_event" };
}

function extractLinkedIssueNumber(pr) {
  pr = pr || {};
  var text = [pr.title, pr.body].filter(Boolean).join("\n");
  var m = text.match(/#(\d+)\b/);
  if (m) {
    var n = Number(m[1]);
    if (isFinite(n) && n > 0) return n;
  }
  var url = text.match(/\/issues\/(\d+)/i);
  if (url) {
    var fromUrl = Number(url[1]);
    if (isFinite(fromUrl) && fromUrl > 0) return fromUrl;
  }
  return null;
}

function evaluatePrReady(pr, issue) {
  pr = pr || {};
  if (!pr.number) return { update: false, reason: "no_pr" };
  if (pr.merged || pr.merged_at) return { update: false, reason: "pr_already_merged" };
  var base = (pr.base && pr.base.ref) || pr.baseRef || "";
  if (String(base) !== "main") return { update: false, reason: "base_not_main" };
  var head = (pr.head && pr.head.ref) || pr.headRef || "";
  if (String(head).indexOf("feature/") !== 0) return { update: false, reason: "head_not_feature" };
  if (!issue || !github.hasAiDevJobLabel(issue)) {
    return { update: false, reason: "no_ai_dev_job_label" };
  }
  var linked = extractLinkedIssueNumber(pr);
  if (linked && Number(linked) !== Number(issue.number)) {
    return { update: false, reason: "pr_other_issue" };
  }
  if (!linked && !github.prBodyReferencesIssue(pr.body || pr.title, issue.number)) {
    return { update: false, reason: "pr_not_linked" };
  }
  return { update: true, reason: "pr_ready", issueNumber: issue.number, prNumber: pr.number };
}

function safetyFlags() {
  return {
    mergeToMain: false,
    productionDeploy: false,
    productionFtp: false,
    secretsToBrowser: false
  };
}

function buildStartComment(branch) {
  return [
    AGENT_STARTED_MARKER,
    "AI作業を開始しました。",
    "branch: `" + branch + "`",
    "main への merge / Production Deploy / 本番FTP は自動では行いません。"
  ].join("\n");
}

function buildCursorAgentPrompt(issue, branch) {
  var n = issue && issue.number;
  return [
    "You are the Smile AI Studio development agent.",
    "Work on GitHub Issue #" + n + " on branch `" + branch + "`.",
    "Read the Issue body. Follow DEVELOPMENT_RULES.md and .cursor/AI_DEV_JOB_PROTOCOL.md.",
    "Implement with a minimal diff. Run relevant tests.",
    "Open a Pull Request against main. Do not merge.",
    "Mention Issue #" + n + " in the PR body.",
    "Never Production Deploy. Never production FTP. Never change Netlify production env.",
    "Never send secrets to the browser.",
    "",
    "Issue title: " + ((issue && issue.title) || ""),
    "",
    "Issue body:",
    (issue && issue.body) || ""
  ].join("\n");
}

function shouldLaunchCursor(env) {
  env = env || process.env;
  return !!(env.CURSOR_API_KEY && String(env.CURSOR_API_KEY).trim());
}

async function dispatchAiDevJob(event, api) {
  api = api || {};
  var decision = evaluateDispatch(event);
  if (!decision.start) {
    return Object.assign({ ok: true, started: false, reason: decision.reason }, safetyFlags());
  }
  var issue = event.issue;
  if (typeof api.listComments === "function") {
    var comments = await api.listComments(issue.number);
    if (hasStartedMarker(comments)) {
      return Object.assign({ ok: true, started: false, reason: "already_started_marker" }, safetyFlags());
    }
  }
  if (typeof api.getIssue === "function") {
    var latest = await api.getIssue(issue.number);
    if (!latest || !latest.ok || !latest.issue) {
      return Object.assign({
        ok: false,
        started: false,
        reason: (latest && latest.error) || "issue_fetch_failed"
      }, safetyFlags());
    }
    issue = latest.issue;
    if (!github.hasAiDevJobLabel(issue)) {
      return Object.assign({ ok: true, started: false, reason: "no_ai_dev_job_label" }, safetyFlags());
    }
    var liveStatus = github.parseAgentStatus(issue.body);
    if (liveStatus !== "READY_FOR_AGENT") {
      return Object.assign({ ok: true, started: false, reason: "already_busy" }, safetyFlags());
    }
  }

  var branch = buildFeatureBranchName(issue.number, issue.title);
  var nextBody = github.ensureAgentStatus(issue.body || "", "AGENT_WORKING");
  nextBody = github.replaceIssueSection(nextBody, "Branch", branch);

  if (typeof api.updateIssue === "function") {
    var updated = await api.updateIssue(issue.number, { body: nextBody });
    if (updated && updated.ok === false) {
      return Object.assign({
        ok: false,
        started: false,
        reason: updated.error || "status_update_failed"
      }, safetyFlags());
    }
  }
  if (typeof api.postComment === "function") {
    await api.postComment(issue.number, buildStartComment(branch));
  }
  if (typeof api.ensureBranch === "function") {
    await api.ensureBranch(branch, "main");
  }

  var cursor = { launched: false, reason: "cursor_key_missing" };
  if (typeof api.launchCursorAgent === "function") {
    cursor = await api.launchCursorAgent({
      issue: issue,
      branch: branch,
      prompt: buildCursorAgentPrompt(issue, branch)
    });
  }

  return Object.assign({
    ok: true,
    started: true,
    reason: decision.reason,
    issueNumber: issue.number,
    branch: branch,
    agentStatus: "AGENT_WORKING",
    cursor: cursor
  }, safetyFlags());
}

async function markReadyForReview(pr, issue, api) {
  api = api || {};
  var decision = evaluatePrReady(pr, issue);
  if (!decision.update) {
    return Object.assign({ ok: true, updated: false, reason: decision.reason }, safetyFlags());
  }
  var body = issue.body || "";
  body = github.ensureAgentStatus(body, "READY_FOR_REVIEW");
  body = github.replaceIssueSection(body, "Pull Request", "#" + pr.number);
  var head = (pr.head && pr.head.ref) || pr.headRef;
  if (head) body = github.replaceIssueSection(body, "Branch", head);
  if (typeof api.updateIssue === "function") {
    var updated = await api.updateIssue(issue.number, { body: body });
    if (updated && updated.ok === false) {
      return Object.assign({
        ok: false,
        updated: false,
        reason: updated.error || "status_update_failed"
      }, safetyFlags());
    }
  }
  return Object.assign({
    ok: true,
    updated: true,
    reason: "pr_ready",
    issueNumber: issue.number,
    prNumber: pr.number,
    agentStatus: "READY_FOR_REVIEW"
  }, safetyFlags());
}

module.exports = {
  AGENT_STARTED_MARKER: AGENT_STARTED_MARKER,
  evaluateDispatch: evaluateDispatch,
  evaluatePrReady: evaluatePrReady,
  extractLinkedIssueNumber: extractLinkedIssueNumber,
  buildFeatureBranchName: buildFeatureBranchName,
  hasStartedMarker: hasStartedMarker,
  buildStartComment: buildStartComment,
  buildCursorAgentPrompt: buildCursorAgentPrompt,
  shouldLaunchCursor: shouldLaunchCursor,
  dispatchAiDevJob: dispatchAiDevJob,
  markReadyForReview: markReadyForReview,
  labelNames: labelNames
};
