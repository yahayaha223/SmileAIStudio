"use strict";

/**
 * Server-side GitHub Issues helper.
 * Token never leaves the server. Repo is allowlisted.
 */

var ALLOWED_AGENT_STATUS = {
  READY_FOR_AGENT: true,
  AGENT_WORKING: true,
  READY_FOR_REVIEW: true,
  FAILED: true,
  COMPLETED: true
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

  return {
    ok: true,
    number: res.json.number,
    url: res.json.html_url || res.json.url,
    title: res.json.title,
    agentStatus: "READY_FOR_AGENT"
  };
}

module.exports = {
  getGithubConfig: getGithubConfig,
  isConfigured: isConfigured,
  assertRepoAllowed: assertRepoAllowed,
  sanitizeTitle: sanitizeTitle,
  sanitizeBody: sanitizeBody,
  sanitizeLabels: sanitizeLabels,
  ensureAgentStatus: ensureAgentStatus,
  createIssue: createIssue,
  ALLOWED_AGENT_STATUS: ALLOWED_AGENT_STATUS
};
