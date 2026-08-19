"use strict";

/**
 * POST /.netlify/functions/api-github-issues
 * Create a GitHub Issue for a developmentJob (owner + CSRF).
 * Token stays server-side only.
 */
var http = require("./shared/http");
var protectApi = require("./shared/auth/protect-api");
var rateLimit = require("./shared/auth/rate-limit");
var audit = require("./shared/auth/audit");
var githubIssues = require("./shared/github-issues");

function parseBody(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch (e) {
    return null;
  }
}

async function handler(event, guard) {
  if (event.httpMethod !== "POST") {
    return http.json(405, { ok: false, error: "method_not_allowed" }, event);
  }

  var body = parseBody(event);
  if (!body) return http.json(400, { ok: false, error: "invalid_json" }, event);

  var action = String(body.action || "create").trim();
  if (action !== "create") {
    return http.json(400, { ok: false, error: "unknown_action" }, event);
  }

  if (!githubIssues.isConfigured()) {
    return http.json(503, {
      ok: false,
      error: "github_not_configured",
      userMessage: "GitHub接続設定が必要です"
    }, event);
  }

  var userId = (guard && guard.session && guard.session.userId) || "anon";
  var ipHash = audit.ipHashForEvent(event);
  var rlUser = await rateLimit.rateLimit("github-issue-create:user:" + userId, 8, 10 * 60 * 1000);
  if (!rlUser.ok) {
    return http.json(429, { ok: false, error: "rate_limited", userMessage: "しばらく待ってから再試行してください" }, event);
  }
  var rlIp = await rateLimit.rateLimit("github-issue-create:ip:" + ipHash, 20, 10 * 60 * 1000);
  if (!rlIp.ok) {
    return http.json(429, { ok: false, error: "rate_limited", userMessage: "しばらく待ってから再試行してください" }, event);
  }

  var result = await githubIssues.createIssue({
    title: body.title,
    body: body.body,
    labels: body.labels,
    agentStatus: body.agentStatus || "READY_FOR_AGENT",
    owner: body.owner,
    repo: body.repo
  });

  await audit.recordAudit({
    event: "github_issue_create",
    success: !!result.ok,
    reasonCode: result.ok ? "ok" : (result.error || "failed"),
    actorUserId: userId,
    role: guard && guard.session ? guard.session.roleSnapshot : null,
    target: "api-github-issues",
    ipHash: ipHash,
    meta: {
      issueNumber: result.number || null,
      jobId: body.jobId || null
    }
  });

  if (!result.ok) {
    var status = result.error === "github_not_configured" || result.error === "repo_not_allowed"
      ? 503
      : (result.error === "title_too_short" || result.error === "body_too_short" ? 400 : 502);
    return http.json(status, {
      ok: false,
      error: result.error,
      userMessage: result.userMessage || "GitHubへの送信に失敗しました",
      detail: result.detail || null
    }, event);
  }

  return http.json(200, {
    ok: true,
    issue: {
      number: result.number,
      url: result.url,
      title: result.title,
      agentStatus: result.agentStatus
    }
  }, event);
}

exports.handler = protectApi.wrapApi(handler, "api-github-issues:POST:create");
