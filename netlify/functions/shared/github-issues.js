"use strict";

/**
 * Server-side GitHub Issues helper.
 * Token never leaves the server. Repo is allowlisted.
 * Agent Status on Issue body drives developmentJobs status sync.
 */

var ALLOWED_AGENT_STATUS = {
  READY_FOR_AGENT: true,
  AGENT_WORKING: true,
  TESTING: true,
  FIXING: true,
  READY_FOR_REVIEW: true,
  FAILED: true,
  COMPLETED: true
};

/** Exact GitHub Issue comment that starts Cursor Automation. */
var AGENT_KICKOFF_COMMENT = "READY_FOR_AGENT";

/** Agent Status → developmentJobs.status */
var AGENT_STATUS_TO_JOB = {
  READY_FOR_AGENT: "waiting_for_agent",
  AGENT_WORKING: "agent_working",
  TESTING: "testing",
  FIXING: "fixing",
  READY_FOR_REVIEW: "waiting_for_review",
  FAILED: "failed",
  COMPLETED: "completed"
};

function readEnv(name) {
  var v = process.env[name];
  return v == null ? "" : String(v).trim();
}

function getGithubConfig() {
  var token = readEnv("GITHUB_TOKEN") || readEnv("GH_TOKEN");
  var owner = readEnv("GITHUB_OWNER");
  var repo = readEnv("GITHUB_REPO");
  var combined = readEnv("GITHUB_REPOSITORY");
  if ((!owner || !repo) && combined && combined.indexOf("/") > 0) {
    var parts = combined.split("/");
    owner = owner || parts[0];
    repo = repo || parts.slice(1).join("/");
  }
  var allowRaw = readEnv("GITHUB_ALLOWED_REPOS");
  var allowlist = allowRaw
    ? allowRaw.split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean)
    : [];
  var labelsRaw = readEnv("GITHUB_ISSUE_LABELS");
  var defaultLabels = labelsRaw
    ? labelsRaw.split(",").map(function (s) { return s.trim(); }).filter(Boolean)
    : ["ai-dev-job"];

  return {
    token: token,
    owner: owner,
    repo: repo,
    allowlist: allowlist,
    defaultLabels: defaultLabels,
    apiBase: "https://api.github.com"
  };
}

function isConfigured(cfg) {
  cfg = cfg || getGithubConfig();
  return !!(cfg.token && cfg.owner && cfg.repo);
}

function assertRepoAllowed(cfg, owner, repo) {
  var full = String(owner || "").toLowerCase() + "/" + String(repo || "").toLowerCase();
  var expected = String(cfg.owner || "").toLowerCase() + "/" + String(cfg.repo || "").toLowerCase();
  if (!cfg.owner || !cfg.repo) {
    return { ok: false, error: "github_not_configured" };
  }
  if (full !== expected) {
    return { ok: false, error: "repo_not_allowed" };
  }
  if (cfg.allowlist.length) {
    var hit = cfg.allowlist.indexOf(full) !== -1 || cfg.allowlist.indexOf(expected) !== -1;
    if (!hit) return { ok: false, error: "repo_not_allowed" };
  }
  return { ok: true, owner: cfg.owner, repo: cfg.repo };
}

function sanitizeTitle(title) {
  var t = String(title || "").replace(/\s+/g, " ").trim();
  if (t.length < 3) return { ok: false, error: "title_too_short" };
  if (t.length > 120) t = t.slice(0, 120);
  return { ok: true, title: t };
}

function sanitizeBody(body) {
  var b = String(body || "").trim();
  if (b.length < 20) return { ok: false, error: "body_too_short" };
  if (b.length > 60000) b = b.slice(0, 60000);
  if (!/##\s*Agent Status/i.test(b)) {
    b = b.replace(/\s*$/, "") + "\n\n## Agent Status\nREADY_FOR_AGENT\n";
  }
  return { ok: true, body: b };
}

function sanitizeLabels(labels, defaults) {
  var src = Array.isArray(labels) && labels.length ? labels : (defaults || []);
  var out = [];
  var seen = {};
  src.forEach(function (lab) {
    var s = String(lab || "").trim().slice(0, 50);
    if (!s || seen[s]) return;
    if (!/^[a-zA-Z0-9._\-\/\u3040-\u30ff\u4e00-\u9fff]+$/.test(s)) return;
    seen[s] = true;
    out.push(s);
  });
  return out.slice(0, 8);
}

function parseAgentStatus(body) {
  var m = String(body || "").match(/##\s*Agent Status\s*\n\s*([A-Z_]+)/i);
  if (!m) return null;
  var st = String(m[1] || "").trim().toUpperCase();
  return ALLOWED_AGENT_STATUS[st] ? st : null;
}

function isAgentKickoffComment(text) {
  return String(text || "").trim() === AGENT_KICKOFF_COMMENT;
}

var BUSY_AGENT_STATUS = {
  AGENT_WORKING: true,
  TESTING: true,
  FIXING: true,
  READY_FOR_REVIEW: true,
  FAILED: true,
  COMPLETED: true
};

function shouldStartAgent(agentStatus, commentBody) {
  if (!isAgentKickoffComment(commentBody)) return false;
  var st = String(agentStatus || "").trim().toUpperCase();
  if (st !== "READY_FOR_AGENT") return false;
  if (BUSY_AGENT_STATUS[st]) return false;
  return true;
}

function parseJobId(body) {
  var m = String(body || "").match(/##\s*Job Id\s*\n\s*([^\n]+)/i);
  if (!m) return null;
  var id = String(m[1] || "").trim();
  return id || null;
}

function parseBranchName(body) {
  var m = String(body || "").match(/##\s*Branch\s*\n\s*([^\n]+)/i);
  if (!m) return null;
  return String(m[1] || "").trim() || null;
}

function parsePrFromBody(body) {
  var m = String(body || "").match(/##\s*Pull Request\s*\n\s*#?(\d+)/i);
  if (!m) {
    m = String(body || "").match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/i);
  }
  if (!m) return null;
  var n = Number(m[1]);
  return isFinite(n) && n > 0 ? n : null;
}

function ensureAgentStatus(body, status) {
  var st = String(status || "READY_FOR_AGENT").trim().toUpperCase();
  if (!ALLOWED_AGENT_STATUS[st]) st = "READY_FOR_AGENT";
  if (!/##\s*Agent Status/i.test(body)) {
    return String(body || "").replace(/\s*$/, "") + "\n\n## Agent Status\n" + st + "\n";
  }
  return String(body).replace(
    /(##\s*Agent Status\s*\n)([^\n]*)/i,
    "$1" + st
  );
}

function mapAgentStatusToJobStatus(agentStatus, opts) {
  opts = opts || {};
  var st = String(agentStatus || "").toUpperCase();
  if (opts.githubPrNumber && (st === "READY_FOR_REVIEW" || !st)) {
    return "waiting_for_review";
  }
  return AGENT_STATUS_TO_JOB[st] || null;
}

async function githubFetch(cfg, path, method, payload) {
  var url = cfg.apiBase + path;
  var res = await fetch(url, {
    method: method || "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + cfg.token,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "SmileAIStudio-DevJobs",
      "Content-Type": "application/json"
    },
    body: payload == null ? undefined : JSON.stringify(payload)
  });
  var text = await res.text();
  var json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
  return { ok: res.ok, status: res.status, json: json, text: text };
}

async function createIssue(opts) {
  opts = opts || {};
  var cfg = getGithubConfig();
  if (!isConfigured(cfg)) {
    return {
      ok: false,
      error: "github_not_configured",
      userMessage: "GitHub接続設定が必要です"
    };
  }
  var repoGate = assertRepoAllowed(cfg, opts.owner || cfg.owner, opts.repo || cfg.repo);
  if (!repoGate.ok) {
    return {
      ok: false,
      error: repoGate.error,
      userMessage: "GitHub接続設定が必要です"
    };
  }
  var titleRes = sanitizeTitle(opts.title);
  if (!titleRes.ok) {
    return { ok: false, error: titleRes.error, userMessage: "タイトルが不正です" };
  }
  var bodyRes = sanitizeBody(opts.body);
  if (!bodyRes.ok) {
    return { ok: false, error: bodyRes.error, userMessage: "本文が不正です" };
  }
  var body = ensureAgentStatus(bodyRes.body, opts.agentStatus || "READY_FOR_AGENT");
  var labels = sanitizeLabels(opts.labels, cfg.defaultLabels);

  var path = "/repos/" + encodeURIComponent(cfg.owner) + "/" + encodeURIComponent(cfg.repo) + "/issues";
  var res = await githubFetch(cfg, path, "POST", {
    title: titleRes.title,
    body: body,
    labels: labels
  });

  if (!res.ok || !res.json || !res.json.number) {
    var msg = (res.json && (res.json.message || res.json.error)) ||
      ("GitHub API error HTTP " + res.status);
    return {
      ok: false,
      error: "github_api_failed",
      userMessage: "GitHubへの送信に失敗しました",
      detail: String(msg).slice(0, 200),
      httpStatus: res.status
    };
  }

  var agentStatus = parseAgentStatus(body) || "READY_FOR_AGENT";
  var kickoffCommentPosted = false;
  if (agentStatus === "READY_FOR_AGENT") {
    var kick = await postAgentKickoffComment(res.json.number);
    kickoffCommentPosted = !!(kick && kick.ok);
  }

  return {
    ok: true,
    number: res.json.number,
    url: res.json.html_url || res.json.url,
    title: res.json.title,
    agentStatus: agentStatus,
    jobStatus: "waiting_for_agent",
    kickoffCommentPosted: kickoffCommentPosted
  };
}

async function postIssueComment(number, bodyText) {
  var cfg = getGithubConfig();
  if (!isConfigured(cfg)) {
    return { ok: false, error: "github_not_configured", userMessage: "GitHub接続設定が必要です" };
  }
  var n = Number(number);
  if (!isFinite(n) || n < 1) {
    return { ok: false, error: "invalid_issue_number", userMessage: "Issue番号が不正です" };
  }
  var commentBody = String(bodyText == null ? "" : bodyText);
  if (!commentBody) {
    return { ok: false, error: "comment_empty", userMessage: "コメントが空です" };
  }
  if (commentBody.length > 65536) commentBody = commentBody.slice(0, 65536);
  var path = "/repos/" + encodeURIComponent(cfg.owner) + "/" + encodeURIComponent(cfg.repo) +
    "/issues/" + encodeURIComponent(String(n)) + "/comments";
  var res = await githubFetch(cfg, path, "POST", { body: commentBody });
  if (!res.ok) {
    var msg = (res.json && (res.json.message || res.json.error)) ||
      ("GitHub API error HTTP " + res.status);
    return {
      ok: false,
      error: "github_api_failed",
      userMessage: "起動コメントの投稿に失敗しました",
      detail: String(msg).slice(0, 200),
      httpStatus: res.status
    };
  }
  return {
    ok: true,
    commentId: res.json && res.json.id,
    body: commentBody
  };
}

async function postAgentKickoffComment(number) {
  var last = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    last = await postIssueComment(number, AGENT_KICKOFF_COMMENT);
    if (last && last.ok) return last;
  }
  return last;
}

async function getIssue(number) {
  var cfg = getGithubConfig();
  if (!isConfigured(cfg)) {
    return { ok: false, error: "github_not_configured", userMessage: "GitHub接続設定が必要です" };
  }
  var n = Number(number);
  if (!isFinite(n) || n < 1) {
    return { ok: false, error: "invalid_issue_number", userMessage: "Issue番号が不正です" };
  }
  var path = "/repos/" + encodeURIComponent(cfg.owner) + "/" + encodeURIComponent(cfg.repo) +
    "/issues/" + encodeURIComponent(String(n));
  var res = await githubFetch(cfg, path, "GET");
  if (!res.ok || !res.json) {
    return {
      ok: false,
      error: "github_api_failed",
      userMessage: "Issueを取得できませんでした",
      httpStatus: res.status
    };
  }
  return { ok: true, issue: res.json };
}

async function findRelatedPullRequest(issueNumber) {
  var cfg = getGithubConfig();
  if (!isConfigured(cfg)) return { ok: false, pr: null };
  var n = Number(issueNumber);
  var q = "repo:" + cfg.owner + "/" + cfg.repo + " is:pr " + n;
  var path = "/search/issues?q=" + encodeURIComponent(q) + "&per_page=5";
  var res = await githubFetch(cfg, path, "GET");
  if (!res.ok || !res.json || !Array.isArray(res.json.items)) {
    return { ok: true, pr: null };
  }
  var hit = res.json.items.find(function (it) {
    return it && it.pull_request && Number(it.number) !== n;
  }) || res.json.items[0];
  if (!hit || !hit.number) return { ok: true, pr: null };
  return {
    ok: true,
    pr: {
      number: hit.number,
      url: hit.html_url || hit.url,
      title: hit.title || "",
      state: hit.state || ""
    }
  };
}

async function updateIssueAgentStatus(number, agentStatus) {
  var cfg = getGithubConfig();
  if (!isConfigured(cfg)) {
    return { ok: false, error: "github_not_configured", userMessage: "GitHub接続設定が必要です" };
  }
  var st = String(agentStatus || "").trim().toUpperCase();
  if (!ALLOWED_AGENT_STATUS[st]) {
    return { ok: false, error: "invalid_agent_status", userMessage: "Agent Statusが不正です" };
  }
  var got = await getIssue(number);
  if (!got.ok) return got;
  var body = ensureAgentStatus(got.issue.body || "", st);
  var path = "/repos/" + encodeURIComponent(cfg.owner) + "/" + encodeURIComponent(cfg.repo) +
    "/issues/" + encodeURIComponent(String(number));
  var res = await githubFetch(cfg, path, "PATCH", { body: body });
  if (!res.ok) {
    return {
      ok: false,
      error: "github_api_failed",
      userMessage: "Agent Statusを更新できませんでした",
      httpStatus: res.status
    };
  }
  return {
    ok: true,
    number: Number(number),
    agentStatus: st,
    jobStatus: mapAgentStatusToJobStatus(st)
  };
}

/**
 * Read Issue (+ optional related PR) and map to developmentJobs fields.
 */
async function syncIssueState(number) {
  var got = await getIssue(number);
  if (!got.ok) return got;
  var issue = got.issue;
  var body = issue.body || "";
  var agentStatus = parseAgentStatus(body) || "READY_FOR_AGENT";
  var jobId = parseJobId(body);
  var branchName = parseBranchName(body);
  var prFromBody = parsePrFromBody(body);
  var prInfo = null;
  if (prFromBody) {
    prInfo = {
      number: prFromBody,
      url: "https://github.com/" + getGithubConfig().owner + "/" + getGithubConfig().repo +
        "/pull/" + prFromBody
    };
  } else {
    var related = await findRelatedPullRequest(number);
    if (related && related.pr) prInfo = related.pr;
  }
  if (prInfo && agentStatus === "READY_FOR_AGENT") {
    // PR exists → treat as ready for review unless agent already advanced
    agentStatus = "READY_FOR_REVIEW";
  }
  var jobStatus = mapAgentStatusToJobStatus(agentStatus, {
    githubPrNumber: prInfo && prInfo.number
  }) || "waiting_for_agent";

  return {
    ok: true,
    sync: {
      githubIssueNumber: issue.number,
      githubIssueUrl: issue.html_url || issue.url,
      agentStatus: agentStatus,
      status: jobStatus,
      jobId: jobId,
      branchName: branchName,
      githubPrNumber: prInfo ? prInfo.number : null,
      githubPrUrl: prInfo ? prInfo.url : null,
      issueState: issue.state || "open",
      issueTitle: issue.title || ""
    }
  };
}

module.exports = {
  getGithubConfig: getGithubConfig,
  isConfigured: isConfigured,
  assertRepoAllowed: assertRepoAllowed,
  sanitizeTitle: sanitizeTitle,
  sanitizeBody: sanitizeBody,
  sanitizeLabels: sanitizeLabels,
  parseAgentStatus: parseAgentStatus,
  isAgentKickoffComment: isAgentKickoffComment,
  shouldStartAgent: shouldStartAgent,
  parseJobId: parseJobId,
  parseBranchName: parseBranchName,
  parsePrFromBody: parsePrFromBody,
  ensureAgentStatus: ensureAgentStatus,
  mapAgentStatusToJobStatus: mapAgentStatusToJobStatus,
  createIssue: createIssue,
  postIssueComment: postIssueComment,
  postAgentKickoffComment: postAgentKickoffComment,
  getIssue: getIssue,
  findRelatedPullRequest: findRelatedPullRequest,
  updateIssueAgentStatus: updateIssueAgentStatus,
  syncIssueState: syncIssueState,
  ALLOWED_AGENT_STATUS: ALLOWED_AGENT_STATUS,
  AGENT_STATUS_TO_JOB: AGENT_STATUS_TO_JOB,
  AGENT_KICKOFF_COMMENT: AGENT_KICKOFF_COMMENT,
  BUSY_AGENT_STATUS: BUSY_AGENT_STATUS
};
