"use strict";

/**
 * /.netlify/functions/api-github-issues
 * actions: create | sync | sync-batch | update-agent-status
 * Token stays server-side. Owner + CSRF required.
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

function permissionKey(event) {
  if (String(event.httpMethod || "").toUpperCase() !== "POST") return null;
  var body = parseBody(event) || {};
  var action = String(body.action || "create").trim();
  if (action === "create") return "api-github-issues:POST:create";
  if (action === "sync" || action === "sync-batch") return "api-github-issues:POST:sync";
  if (action === "update-agent-status") return "api-github-issues:POST:update-agent-status";
  return null;
}

async function handleCreate(event, guard, body) {
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
    meta: { issueNumber: result.number || null, jobId: body.jobId || null }
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
      agentStatus: result.agentStatus,
      jobStatus: result.jobStatus || "waiting_for_agent",
      kickoffCommentPosted: result.kickoffCommentPosted === true
    }
  }, event);
}

async function handleSync(event, guard, body) {
  var userId = (guard && guard.session && guard.session.userId) || "anon";
  var ipHash = audit.ipHashForEvent(event);
  var rl = await rateLimit.rateLimit("github-issue-sync:user:" + userId, 60, 10 * 60 * 1000);
  if (!rl.ok) {
    return http.json(429, { ok: false, error: "rate_limited" }, event);
  }

  var numbers = [];
  if (body.action === "sync-batch" && Array.isArray(body.issueNumbers)) {
    numbers = body.issueNumbers.map(Number).filter(function (n) { return isFinite(n) && n > 0; }).slice(0, 12);
  } else if (body.issueNumber != null) {
    numbers = [Number(body.issueNumber)];
  }
  if (!numbers.length) {
    return http.json(400, { ok: false, error: "invalid_issue_number" }, event);
  }

  var results = [];
  for (var i = 0; i < numbers.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    var one = await githubIssues.syncIssueState(numbers[i]);
    if (one.ok) results.push(one.sync);
    else {
      results.push({
        githubIssueNumber: numbers[i],
        ok: false,
        error: one.error,
        userMessage: one.userMessage
      });
    }
  }

  await audit.recordAudit({
    event: "github_issue_sync",
    success: true,
    reasonCode: "ok",
    actorUserId: userId,
    role: guard && guard.session ? guard.session.roleSnapshot : null,
    target: "api-github-issues",
    ipHash: ipHash,
    meta: { count: results.length }
  });

  return http.json(200, {
    ok: true,
    syncs: results,
    sync: results.length === 1 ? results[0] : undefined
  }, event);
}

async function handleUpdateAgentStatus(event, guard, body) {
  var userId = (guard && guard.session && guard.session.userId) || "anon";
  var ipHash = audit.ipHashForEvent(event);
  var rl = await rateLimit.rateLimit("github-issue-status:user:" + userId, 40, 10 * 60 * 1000);
  if (!rl.ok) {
    return http.json(429, { ok: false, error: "rate_limited" }, event);
  }

  var result = await githubIssues.updateIssueAgentStatus(body.issueNumber, body.agentStatus);
  await audit.recordAudit({
    event: "github_issue_agent_status",
    success: !!result.ok,
    reasonCode: result.ok ? "ok" : (result.error || "failed"),
    actorUserId: userId,
    role: guard && guard.session ? guard.session.roleSnapshot : null,
    target: "api-github-issues",
    ipHash: ipHash,
    meta: {
      issueNumber: body.issueNumber || null,
      agentStatus: body.agentStatus || null
    }
  });

  if (!result.ok) {
    var status = result.error === "github_not_configured" ? 503
      : (result.error === "invalid_agent_status" || result.error === "invalid_issue_number" ? 400 : 502);
    return http.json(status, {
      ok: false,
      error: result.error,
      userMessage: result.userMessage || "更新に失敗しました"
    }, event);
  }

  return http.json(200, {
    ok: true,
    issue: {
      number: result.number,
      agentStatus: result.agentStatus,
      jobStatus: result.jobStatus
    }
  }, event);
}

async function handler(event, guard) {
  if (event.httpMethod !== "POST") {
    return http.json(405, { ok: false, error: "method_not_allowed" }, event);
  }

  var body = parseBody(event);
  if (!body) return http.json(400, { ok: false, error: "invalid_json" }, event);

  var action = String(body.action || "create").trim();

  if (!githubIssues.isConfigured()) {
    return http.json(503, {
      ok: false,
      error: "github_not_configured",
      userMessage: "GitHub接続設定が必要です"
    }, event);
  }

  if (action === "create") return handleCreate(event, guard, body);
  if (action === "sync" || action === "sync-batch") return handleSync(event, guard, body);
  if (action === "update-agent-status") return handleUpdateAgentStatus(event, guard, body);
  return http.json(400, { ok: false, error: "unknown_action" }, event);
}

exports.handler = protectApi.wrapApi(handler, permissionKey);
