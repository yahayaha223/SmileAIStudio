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
  var text = String(body || "");
  var section = text.match(/##\s*Pull Request\s*\r?\n\s*([^\n\r]+)/i);
  if (section) {
    var line = String(section[1] || "").trim();
    if (!/none yet/i.test(line)) {
      var numbered = line.match(/^#?(\d+)\s*$/);
      if (numbered) {
        var fromSection = Number(numbered[1]);
        if (isFinite(fromSection) && fromSection > 0) return fromSection;
      }
      var sectionUrl = line.match(/\/pull\/(\d+)/i);
      if (sectionUrl) {
        var fromSectionUrl = Number(sectionUrl[1]);
        if (isFinite(fromSectionUrl) && fromSectionUrl > 0) return fromSectionUrl;
      }
    }
  }
  var m = text.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/i);
  if (!m) return null;
  var n = Number(m[1]);
  return isFinite(n) && n > 0 ? n : null;
}

function issueHtmlUrl(cfg, issueNumber) {
  return "https://github.com/" + cfg.owner + "/" + cfg.repo + "/issues/" + Number(issueNumber);
}

function prBodyReferencesIssue(text, issueNumber, cfg) {
  cfg = cfg || getGithubConfig();
  var n = Number(issueNumber);
  if (!isFinite(n) || n < 1) return false;
  var raw = String(text || "");
  if (!raw.trim()) return false;
  var url = issueHtmlUrl(cfg, n).toLowerCase();
  if (raw.toLowerCase().indexOf(url) >= 0) return true;
  if (new RegExp("(?:^|[\\s'\"(])Related:\\s*\\S*issues/" + n + "\\b", "i").test(raw)) return true;
  if (new RegExp("(?:^|[\\s'\"(/])issues/" + n + "\\b", "i").test(raw)) return true;
  if (new RegExp("(^|[^A-Za-z0-9_])#" + n + "\\b").test(raw)) return true;
  return false;
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
  var methodName = method || "GET";

  async function once(withAuth) {
    var headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "SmileAIStudio-DevJobs",
      "Content-Type": "application/json"
    };
    if (withAuth && cfg.token) headers.Authorization = "Bearer " + cfg.token;
    var res = await fetch(url, {
      method: methodName,
      headers: headers,
      body: payload == null ? undefined : JSON.stringify(payload)
    });
    var text = await res.text();
    var json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    return { ok: res.ok, status: res.status, json: json, text: text };
  }

  var first = await once(true);
  if (first.ok) return first;
  /* Restricted tokens can 403/404 public PRs that unauthenticated GET can read. */
  if (methodName === "GET" && (first.status === 401 || first.status === 403 || first.status === 404)) {
    var second = await once(false);
    if (second.ok) return second;
  }
  return first;
}

/**
 * Fetch GitHub bytes without stringifying. res.text() would UTF-8-decode Shift_JIS.
 */
async function githubFetchBytes(cfg, path, accept) {
  var url = cfg.apiBase + path;

  async function once(withAuth) {
    var headers = {
      Accept: accept || "application/vnd.github.raw",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "SmileAIStudio-DevJobs"
    };
    if (withAuth && cfg.token) headers.Authorization = "Bearer " + cfg.token;
    var res = await fetch(url, { method: "GET", headers: headers });
    if (!res.ok || typeof res.arrayBuffer !== "function") {
      return { ok: false, status: res.status, buffer: null };
    }
    var ab = await res.arrayBuffer();
    if (!ab) return { ok: false, status: res.status, buffer: null };
    return { ok: true, status: res.status, buffer: Buffer.from(ab) };
  }

  var first = await once(true);
  if (first.ok) return first;
  if (first.status === 401 || first.status === 403 || first.status === 404) {
    var second = await once(false);
    if (second.ok) return second;
  }
  return first;
}

function decodeGitBlobBase64(json) {
  if (!json) return null;
  if (json.encoding && json.encoding !== "base64") return null;
  var b64 = String(json.content || "").replace(/\s+/g, "");
  if (!b64) return null;
  try {
    var buf = Buffer.from(b64, "base64");
    return buf.length ? buf : null;
  } catch (e) {
    return null;
  }
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

function parseJobKind(body) {
  var m = String(body || "").match(/##\s*Job Kind\s*\r?\n\s*([^\n\r]+)/i);
  if (!m) return null;
  return String(m[1] || "").trim().replace(/^[`*_]+|[`*_]+$/g, "") || null;
}

function normalizeJobKind(kind) {
  return String(kind || "").trim().replace(/[`*_]/g, "").toLowerCase();
}

function safeLogFilename(name) {
  var s = String(name || "").replace(/\\/g, "/").trim();
  if (!s) return "";
  if (/credential|secret|password|\.env|token|apikey|api_key/i.test(s)) return "(redacted)";
  return s.slice(0, 120);
}

function hasHomepagePublishFiles(filenames) {
  return filterHomepagePublishFiles(filenames).length > 0;
}

function filterHomepagePublishFiles(filenames) {
  var allow = {
    "CorporateSite/index.htm": true,
    "CorporateSite/css/top-diary-notice.css": true
  };
  var out = [];
  var seen = {};
  (filenames || []).forEach(function (n) {
    var key = String(n || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
    if (!allow[key] || seen[key]) return;
    seen[key] = true;
    out.push(key);
  });
  return out;
}

/** Known homepage-edit Issue numbers still publishable after localStorage is gone. */
var DEFAULT_HOMEPAGE_ISSUE_SEEDS = [6];

function uniquePositiveInts(list, max) {
  var out = [];
  var seen = {};
  (list || []).forEach(function (n) {
    var v = Number(n);
    if (!isFinite(v) || v < 1 || seen[v]) return;
    seen[v] = true;
    out.push(v);
  });
  return out.slice(0, max || 12);
}

function homepageIssueSeeds() {
  var extra = readEnv("SITE_PUBLISH_ISSUE_SEEDS");
  var raw = DEFAULT_HOMEPAGE_ISSUE_SEEDS.slice();
  if (extra) {
    extra.split(",").forEach(function (s) { raw.push(s); });
  }
  return uniquePositiveInts(raw, 12);
}

function isMainBaseRef(ref) {
  var base = String(ref || "").toLowerCase();
  return base === "main" || base === "master";
}

function assertPrMergedToMain(pr) {
  if (!pr || !pr.ok) {
    return {
      ok: false,
      error: (pr && pr.error) || "pr_fetch_failed",
      userMessage: (pr && pr.userMessage) || "PRを確認できませんでした",
      httpStatus: 502
    };
  }
  if (!pr.merged) {
    return {
      ok: false,
      error: "pr_not_merged",
      userMessage: "PRがmainへmergeされるまで本番反映できません",
      httpStatus: 409
    };
  }
  if (!isMainBaseRef(pr.baseRef)) {
    return {
      ok: false,
      error: "pr_base_not_main",
      userMessage: "mainへmergeされたPRのみ公開できます",
      httpStatus: 409
    };
  }
  return { ok: true };
}

function isReadyForSitePublish(sync) {
  return !evaluateHomepagePublishCandidate(sync).excluded;
}

function evaluateHomepagePublishCandidate(sync) {
  var files = filterHomepagePublishFiles(sync && sync.changedFiles);
  var out = {
    issueNumber: sync && sync.githubIssueNumber ? Number(sync.githubIssueNumber) : null,
    prNumber: sync && sync.githubPrNumber ? Number(sync.githubPrNumber) : null,
    merged: !!(sync && sync.prMerged),
    baseRef: (sync && sync.prBaseRef) || "",
    jobKind: (sync && sync.jobKind) || null,
    changedFiles: ((sync && sync.changedFiles) || []).map(safeLogFilename).filter(Boolean).slice(0, 20),
    filteredPublishFiles: files.slice(),
    excluded: false,
    excludeReason: null
  };
  if (!sync) {
    out.excluded = true;
    out.excludeReason = "sync_missing";
    return out;
  }
  if (!sync.githubPrNumber) {
    out.excluded = true;
    out.excludeReason = "pr_not_found";
    return out;
  }
  if (!sync.prMerged) {
    out.excluded = true;
    out.excludeReason = "pr_not_merged";
    return out;
  }
  if (!isMainBaseRef(sync.prBaseRef)) {
    out.excluded = true;
    out.excludeReason = "pr_base_not_main";
    return out;
  }
  if (sync.jobKind && normalizeJobKind(sync.jobKind) !== "homepage-edit") {
    out.excluded = true;
    out.excludeReason = "job_kind_not_homepage_edit";
    return out;
  }
  if (!files.length) {
    out.excluded = true;
    out.excludeReason = "no_allowlist_files";
    return out;
  }
  return out;
}

function logReadySitePublishDebug(payload) {
  var safe = payload && typeof payload === "object" ? payload : {};
  var blob = JSON.stringify({
    stage: "github_ready_site_publish",
    candidateIssueNumbers: safe.candidateIssueNumbers || [],
    itemsCount: safe.itemsCount || 0,
    evaluations: safe.evaluations || []
  });
  if (/ftp_user|ftp_password|github_token|authorization|apikey|api_key/i.test(blob)) return;
  console.log(blob);
}

async function getPullRequest(number) {
  var cfg = getGithubConfig();
  if (!isConfigured(cfg)) {
    return { ok: false, error: "github_not_configured", userMessage: "GitHub接続設定が必要です" };
  }
  var n = Number(number);
  if (!isFinite(n) || n < 1) {
    return { ok: false, error: "invalid_pr", userMessage: "PR番号が不正です" };
  }
  var path = "/repos/" + encodeURIComponent(cfg.owner) + "/" + encodeURIComponent(cfg.repo) +
    "/pulls/" + encodeURIComponent(String(n));
  var res = await githubFetch(cfg, path, "GET");
  if (!res.ok || !res.json) {
    return {
      ok: false,
      error: "github_api_failed",
      userMessage: "PRを取得できませんでした",
      httpStatus: res.status
    };
  }
  var p = res.json;
  var baseRef = p.base && p.base.ref ? String(p.base.ref) : "";
  return {
    ok: true,
    number: p.number || n,
    merged: p.merged === true || !!(p.merged_at),
    mergedAt: p.merged_at || null,
    state: p.state || "",
    htmlUrl: p.html_url || p.url || "",
    baseRef: baseRef,
    mergeCommitSha: p.merge_commit_sha || "",
    headSha: p.head && p.head.sha ? String(p.head.sha) : "",
    body: p.body || ""
  };
}

async function listPullFiles(number) {
  var cfg = getGithubConfig();
  if (!isConfigured(cfg)) {
    return { ok: false, error: "github_not_configured", filenames: [] };
  }
  var n = Number(number);
  if (!isFinite(n) || n < 1) {
    return { ok: false, error: "invalid_pr", filenames: [] };
  }
  var path = "/repos/" + encodeURIComponent(cfg.owner) + "/" + encodeURIComponent(cfg.repo) +
    "/pulls/" + encodeURIComponent(String(n)) + "/files?per_page=100";
  var res = await githubFetch(cfg, path, "GET");
  if (!res.ok || !Array.isArray(res.json)) {
    return {
      ok: false,
      error: "github_api_failed",
      userMessage: "変更ファイルを取得できませんでした",
      filenames: []
    };
  }
  var filenames = res.json.map(function (f) { return f && f.filename; }).filter(Boolean);
  return { ok: true, filenames: filenames };
}

async function getRepoFileContent(repoPath, ref) {
  var cfg = getGithubConfig();
  if (!isConfigured(cfg)) {
    return { ok: false, error: "github_not_configured" };
  }
  var p = String(repoPath || "").replace(/\\/g, "/").replace(/^\//, "");
  if (!p || p.indexOf("..") >= 0) {
    return { ok: false, error: "unsafe_path" };
  }
  var path = "/repos/" + encodeURIComponent(cfg.owner) + "/" + encodeURIComponent(cfg.repo) +
    "/contents/" + p.split("/").map(encodeURIComponent).join("/");
  if (ref) path += "?ref=" + encodeURIComponent(String(ref));
  /* Metadata only. Never decode json.content — Contents API transcodes Shift_JIS to UTF-8. */
  var meta = await githubFetch(cfg, path, "GET");
  if (!meta.ok || !meta.json) {
    return {
      ok: false,
      error: "github_api_failed",
      userMessage: "ファイルを取得できませんでした"
    };
  }
  if (meta.json.type && meta.json.type !== "file") {
    return { ok: false, error: "not_a_file" };
  }
  var sha = meta.json.sha || null;
  var expectedSize = Number(meta.json.size);
  var buf = null;
  var source = null;

  if (sha) {
    var blobPath = "/repos/" + encodeURIComponent(cfg.owner) + "/" + encodeURIComponent(cfg.repo) +
      "/git/blobs/" + encodeURIComponent(String(sha));
    var blobRes = await githubFetch(cfg, blobPath, "GET");
    if (blobRes.ok && blobRes.json) {
      buf = decodeGitBlobBase64(blobRes.json);
      if (buf) source = "git_blob";
    }
  }

  if (!buf) {
    var rawRes = await githubFetchBytes(cfg, path, "application/vnd.github.raw");
    if (rawRes.ok && rawRes.buffer && rawRes.buffer.length) {
      buf = rawRes.buffer;
      source = "github_raw";
    }
  }

  if (!buf || !buf.length) {
    return {
      ok: false,
      error: "github_api_failed",
      userMessage: "ファイルを取得できませんでした"
    };
  }
  if (isFinite(expectedSize) && expectedSize > 0 && buf.length !== expectedSize) {
    return {
      ok: false,
      error: "blob_size_mismatch",
      userMessage: "公開ファイルのバイト数が一致しません"
    };
  }
  return {
    ok: true,
    buffer: Buffer.from(buf),
    path: p,
    sha: sha,
    size: buf.length,
    source: source
  };
}

async function githubSearchIssueItems(query) {
  var cfg = getGithubConfig();
  var path = "/search/issues?q=" + encodeURIComponent(query) + "&per_page=10";
  var res = await githubFetch(cfg, path, "GET");
  if (!res.ok || !res.json || !Array.isArray(res.json.items)) return [];
  return res.json.items;
}

async function listCrossReferencedPullNumbers(issueNumber) {
  var cfg = getGithubConfig();
  var n = Number(issueNumber);
  if (!isFinite(n) || n < 1) return [];
  var path = "/repos/" + encodeURIComponent(cfg.owner) + "/" + encodeURIComponent(cfg.repo) +
    "/issues/" + encodeURIComponent(String(n)) + "/timeline?per_page=50";
  var res = await githubFetch(cfg, path, "GET");
  if (!res.ok || !Array.isArray(res.json)) return [];
  var out = [];
  res.json.forEach(function (ev) {
    if (!ev || ev.event !== "cross-referenced") return;
    var src = ev.source && ev.source.issue;
    if (!src || !src.pull_request || !src.number) return;
    if (Number(src.number) === n) return;
    out.push(src.number);
  });
  return uniquePositiveInts(out, 8);
}

async function searchPullNumbersReferencingIssue(issueNumber) {
  var cfg = getGithubConfig();
  var n = Number(issueNumber);
  if (!isFinite(n) || n < 1) return [];
  var issueUrl = issueHtmlUrl(cfg, n);
  var queries = [
    "repo:" + cfg.owner + "/" + cfg.repo + " is:pr \"" + issueUrl + "\"",
    "repo:" + cfg.owner + "/" + cfg.repo + " is:pr in:body " + issueUrl,
    "repo:" + cfg.owner + "/" + cfg.repo + " is:pr Related issues/" + n
  ];
  var numbers = [];
  for (var i = 0; i < queries.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    var items = await githubSearchIssueItems(queries[i]);
    items.forEach(function (it) {
      if (!it || !it.pull_request) return;
      if (Number(it.number) === n) return;
      numbers.push(it.number);
    });
    if (uniquePositiveInts(numbers, 8).length) break;
  }
  return uniquePositiveInts(numbers, 8);
}

function relatedPrSummary(pull) {
  return {
    number: pull.number,
    url: pull.htmlUrl || "",
    title: pull.title || "",
    state: pull.state || "",
    merged: !!pull.merged,
    baseRef: pull.baseRef || "",
    body: pull.body || ""
  };
}

/**
 * Resolve Issue N → related PR from GitHub data, not Issue "Pull Request" section.
 * Candidates come from timeline cross-references and issue-URL search.
 * A candidate is kept only if its PR body mentions the Issue URL or #N.
 */
async function findRelatedPullRequest(issueNumber) {
  var cfg = getGithubConfig();
  if (!isConfigured(cfg)) return { ok: false, pr: null };
  var n = Number(issueNumber);
  if (!isFinite(n) || n < 1) return { ok: true, pr: null };

  var candidates = uniquePositiveInts(
    (await listCrossReferencedPullNumbers(n)).concat(await searchPullNumbersReferencingIssue(n)),
    8
  );
  var verified = [];
  for (var i = 0; i < candidates.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    var pull = await getPullRequest(candidates[i]);
    if (!pull || !pull.ok) continue;
    if (Number(pull.number) === n) continue;
    if (!prBodyReferencesIssue(pull.body, n, cfg)) continue;
    verified.push(pull);
  }
  if (!verified.length) return { ok: true, pr: null };

  verified.sort(function (a, b) {
    var aReady = a.merged && isMainBaseRef(a.baseRef) ? 1 : 0;
    var bReady = b.merged && isMainBaseRef(b.baseRef) ? 1 : 0;
    if (bReady !== aReady) return bReady - aReady;
    return (Number(b.number) || 0) - (Number(a.number) || 0);
  });
  return { ok: true, pr: relatedPrSummary(verified[0]) };
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

  var prMerged = false;
  var prBaseRef = "";
  var mergeCommitSha = "";
  var changedFiles = [];
  if (prInfo && prInfo.number) {
    var pull = await getPullRequest(prInfo.number);
    if (pull && pull.ok) {
      prMerged = !!pull.merged;
      prBaseRef = pull.baseRef || "";
      mergeCommitSha = pull.mergeCommitSha || pull.headSha || "";
      prInfo.url = pull.htmlUrl || prInfo.url;
      var files = await listPullFiles(prInfo.number);
      if (files && files.ok) changedFiles = files.filenames || [];
    }
  }

  if (prInfo && agentStatus === "READY_FOR_AGENT" && !prMerged) {
    agentStatus = "READY_FOR_REVIEW";
  }
  var jobKind = parseJobKind(body);
  var jobStatus = mapAgentStatusToJobStatus(agentStatus, {
    githubPrNumber: prInfo && prInfo.number
  }) || "waiting_for_agent";
  if (prMerged && isMainBaseRef(prBaseRef) && hasHomepagePublishFiles(changedFiles)) {
    jobStatus = "ready_for_publish";
  }

  return {
    ok: true,
    sync: {
      githubIssueNumber: issue.number,
      githubIssueUrl: issue.html_url || issue.url,
      agentStatus: agentStatus,
      status: jobStatus,
      jobId: jobId,
      jobKind: jobKind,
      branchName: branchName,
      githubPrNumber: prInfo ? prInfo.number : null,
      githubPrUrl: prInfo ? prInfo.url : null,
      prMerged: prMerged,
      prBaseRef: prBaseRef,
      mergeCommitSha: mergeCommitSha,
      changedFiles: changedFiles,
      issueState: issue.state || "open",
      issueTitle: issue.title || ""
    }
  };
}

async function searchHomepageEditIssueNumbers() {
  var cfg = getGithubConfig();
  if (!isConfigured(cfg)) return [];
  var q = "repo:" + cfg.owner + "/" + cfg.repo + " is:issue homepage-edit in:body";
  var path = "/search/issues?q=" + encodeURIComponent(q) + "&per_page=10";
  var res = await githubFetch(cfg, path, "GET");
  if (!res.ok || !res.json || !Array.isArray(res.json.items)) return [];
  return res.json.items.map(function (it) { return it && it.number; }).filter(Boolean);
}

/**
 * Restore approved homepage publishes from GitHub without localStorage Job cards.
 * Merge-to-main is verified with getPullRequest (never trusted from the client).
 */
async function findReadyHomepagePublishes(opts) {
  opts = opts || {};
  if (!isConfigured()) {
    return { ok: false, error: "github_not_configured", userMessage: "GitHub接続設定が必要です", items: [], debug: { candidateIssueNumbers: [], itemsCount: 0, evaluations: [] } };
  }
  var numbers = uniquePositiveInts(
    homepageIssueSeeds().concat(opts.issueNumbers || []).concat(await searchHomepageEditIssueNumbers()),
    12
  );
  var items = [];
  var seenPr = {};
  var evaluations = [];
  for (var i = 0; i < numbers.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    var one = await syncIssueState(numbers[i]);
    if (!one.ok || !one.sync) {
      evaluations.push({
        issueNumber: numbers[i],
        prNumber: null,
        merged: false,
        baseRef: "",
        changedFiles: [],
        filteredPublishFiles: [],
        excluded: true,
        excludeReason: (one && one.error) || "sync_failed"
      });
      continue;
    }
    var evaln = evaluateHomepagePublishCandidate(one.sync);
    if (evaln.excluded) {
      evaluations.push(evaln);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    var pull = await getPullRequest(one.sync.githubPrNumber);
    var mergeGate = assertPrMergedToMain(pull);
    if (!mergeGate.ok) {
      evaln.excluded = true;
      evaln.excludeReason = mergeGate.error || "pr_not_merged";
      evaln.merged = !!(pull && pull.merged);
      evaln.baseRef = (pull && pull.baseRef) || evaln.baseRef;
      evaluations.push(evaln);
      continue;
    }
    var prNumber = Number(pull.number || one.sync.githubPrNumber);
    if (!isFinite(prNumber) || prNumber < 1 || seenPr[prNumber]) {
      evaln.excluded = true;
      evaln.excludeReason = seenPr[prNumber] ? "duplicate_pr" : "invalid_pr";
      evaluations.push(evaln);
      continue;
    }
    seenPr[prNumber] = true;
    var files = filterHomepagePublishFiles(one.sync.changedFiles);
    if (!files.length) {
      evaln.excluded = true;
      evaln.excludeReason = "no_allowlist_files";
      evaluations.push(evaln);
      continue;
    }
    evaln.filteredPublishFiles = files.slice();
    evaluations.push(evaln);
    items.push({
      issueNumber: one.sync.githubIssueNumber,
      issueUrl: one.sync.githubIssueUrl || "",
      issueTitle: one.sync.issueTitle || "",
      prNumber: prNumber,
      prUrl: pull.htmlUrl || one.sync.githubPrUrl || "",
      prMerged: true,
      prBaseRef: pull.baseRef || one.sync.prBaseRef || "",
      mergeCommitSha: pull.mergeCommitSha || one.sync.mergeCommitSha || "",
      files: files,
      status: "ready_for_publish"
    });
  }
  var debug = {
    candidateIssueNumbers: numbers.slice(),
    itemsCount: items.length,
    evaluations: evaluations
  };
  logReadySitePublishDebug(debug);
  return { ok: true, items: items, debug: debug };
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
  parseJobKind: parseJobKind,
  hasHomepagePublishFiles: hasHomepagePublishFiles,
  filterHomepagePublishFiles: filterHomepagePublishFiles,
  assertPrMergedToMain: assertPrMergedToMain,
  isReadyForSitePublish: isReadyForSitePublish,
  evaluateHomepagePublishCandidate: evaluateHomepagePublishCandidate,
  parseBranchName: parseBranchName,
  parsePrFromBody: parsePrFromBody,
  prBodyReferencesIssue: prBodyReferencesIssue,
  ensureAgentStatus: ensureAgentStatus,
  mapAgentStatusToJobStatus: mapAgentStatusToJobStatus,
  createIssue: createIssue,
  postIssueComment: postIssueComment,
  postAgentKickoffComment: postAgentKickoffComment,
  getIssue: getIssue,
  getPullRequest: getPullRequest,
  listPullFiles: listPullFiles,
  getRepoFileContent: getRepoFileContent,
  findRelatedPullRequest: findRelatedPullRequest,
  updateIssueAgentStatus: updateIssueAgentStatus,
  syncIssueState: syncIssueState,
  findReadyHomepagePublishes: findReadyHomepagePublishes,
  DEFAULT_HOMEPAGE_ISSUE_SEEDS: DEFAULT_HOMEPAGE_ISSUE_SEEDS,
  ALLOWED_AGENT_STATUS: ALLOWED_AGENT_STATUS,
  AGENT_STATUS_TO_JOB: AGENT_STATUS_TO_JOB,
  AGENT_KICKOFF_COMMENT: AGENT_KICKOFF_COMMENT,
  BUSY_AGENT_STATUS: BUSY_AGENT_STATUS
};
