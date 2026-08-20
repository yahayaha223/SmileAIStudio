"use strict";

/**
 * developmentJobs — local store for AI development tasks.
 * GitHub Issue creation / sync goes through Netlify Function (token never in browser).
 */
(function (global) {
  var KEY = "smileAIStudio_developmentJobs";

  /** Technical status → everyday Japanese (never show raw status in UI). */
  var STATUS_JA = {
    draft: "下書き",
    planning: "整理中",
    ready_for_issue: "送信準備中",
    issue_created: "GitHubへ送信しました",
    waiting_for_agent: "AIが作業待ち",
    agent_working: "AIが作業中",
    testing: "動作確認中",
    fixing: "修正中",
    pr_ready: "確認してください",
    waiting_for_review: "確認してください",
    ready_for_publish: "本番へ反映できます",
    approved: "承認済み",
    deploying: "公開準備中",
    published: "公開済み",
    publish_failed: "公開失敗",
    completed: "完了",
    failed: "失敗",
    cancelled: "キャンセル"
  };

  var AGENT_STATUS = {
    READY_FOR_AGENT: "READY_FOR_AGENT",
    AGENT_WORKING: "AGENT_WORKING",
    TESTING: "TESTING",
    FIXING: "FIXING",
    READY_FOR_REVIEW: "READY_FOR_REVIEW",
    FAILED: "FAILED",
    COMPLETED: "COMPLETED"
  };

  var AGENT_TO_JOB = {
    READY_FOR_AGENT: "waiting_for_agent",
    AGENT_WORKING: "agent_working",
    TESTING: "testing",
    FIXING: "fixing",
    READY_FOR_REVIEW: "waiting_for_review",
    FAILED: "failed",
    COMPLETED: "completed"
  };

  var memoryStoreData = {};
  function storage() {
    try {
      if (typeof localStorage !== "undefined" && localStorage) return localStorage;
    } catch (e) { /* Node / private mode */ }
    return {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(memoryStoreData, k) ? memoryStoreData[k] : null;
      },
      setItem: function (k, v) {
        memoryStoreData[k] = String(v);
      }
    };
  }

  function load() {
    try {
      var raw = storage().getItem(KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function save(list) {
    storage().setItem(KEY, JSON.stringify(list || []));
  }

  function newId() {
    return "job_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function buildTaskFromRequest(opts) {
    opts = opts || {};
    var req = String(opts.userRequest || "").trim();
    var projectId = String(opts.projectId || "smile-ai-studio");
    var title = req.slice(0, 48) || "開発依頼";
    return {
      id: newId(),
      projectId: projectId,
      title: title,
      userRequest: req,
      status: "draft",
      githubIssueNumber: null,
      githubIssueUrl: null,
      githubPrNumber: null,
      githubPrUrl: null,
      branchName: null,
      previewUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      riskLevel: "medium",
      approvalRequired: true,
      lastAgentAction: null,
      testSummary: null,
      failureReason: null,
      lastGithubError: null,
      lastSyncedAt: null,
      goal: req,
      background: "ユーザーからの自然文依頼",
      acceptanceCriteria: [
        "依頼内容が満たされている",
        "既存の本番安全機構を壊していない",
        "Passkey認証・日記公開の安全経路を維持"
      ],
      affectedAreas: ["要調査"],
      risks: ["本番影響の有無を切替前に確認"],
      testPlan: ["関連ユニットテスト", "主要画面の手動確認"],
      rollbackPlan: ["直前Deployへ戻す / 変更branchを破棄"],
      safetyRules: [
        "main直push禁止",
        "Production Deployは承認制",
        "FTP本番は承認制",
        "secretsをcommitしない",
        "Tokenをブラウザへ送らない"
      ],
      agentStatus: AGENT_STATUS.READY_FOR_AGENT
    };
  }

  function buildHomepageEditTask(userRequest) {
    var req = String(userRequest || "").trim();
    var job = buildTaskFromRequest({
      projectId: "corporate-site",
      userRequest: req
    });
    job.kind = "homepage-edit";
    job.title = ("HP編集: " + req).replace(/\s+/g, " ").trim().slice(0, 48) || "HP編集依頼";
    job.status = "ready_for_issue";
    job.riskLevel = "high";
    job.approvalRequired = true;
    job.goal = "公式ホームページの変更案をPRにする。本番反映はしない。";
    job.background = "ホームページを編集（自然文依頼）";
    job.affectedAreas = ["公式ホームページ / CorporateSite", "関連する文言・画像・CSS（必要な場合のみ）"];
    job.acceptanceCriteria = [
      "依頼内容の変更案がPull Requestになっている",
      "依頼していない箇所を不用意に変えていない",
      "本番FTP公開・Production Deploy・main mergeをしていない"
    ];
    job.testPlan = [
      "変更箇所の表示確認",
      "関係ないページが壊れていないこと"
    ];
    job.rollbackPlan = ["PRをマージしない / 変更branchを破棄"];
    job.safetyRules = [
      "main直push禁止",
      "mainへmergeしない",
      "Production Deployしない",
      "本番FTP公開しない",
      "DNS変更しない",
      "Netlify本番環境変数を変更しない",
      "secretsをcommitしない",
      "本番反映は人間の承認後のみ"
    ];
    job.agentStatus = AGENT_STATUS.READY_FOR_AGENT;
    return job;
  }

  function homepageEditJobs() {
    return load().filter(function (j) {
      return j && j.kind === "homepage-edit";
    }).slice(0, 8);
  }

  function studioProgressMessage(job) {
    if (!job) return "";
    var st = String(job.status || "");
    if (st === "failed") {
      return job.failureReason || job.lastGithubError || "変更案の作成に失敗しました";
    }
    if (st === "cancelled") return "キャンセルしました";
    if (st === "ready_for_issue" && job.lastGithubError) {
      return "依頼は保存しましたが、GitHubへ送れませんでした。再送信できます。";
    }
    if (st === "published") return "公開済み";
    if (st === "publish_failed") return "公開失敗";
    if (st === "ready_for_publish" || (job.prMerged && st !== "published")) {
      return "変更案は承認済みです。本番へ反映できます";
    }
    if (
      st === "waiting_for_review" ||
      st === "pr_ready" ||
      st === "approved"
    ) {
      return "確認してください";
    }
    if (job.githubPrNumber && !job.prMerged && st !== "waiting_for_agent" && st !== "agent_working" &&
      st !== "testing" && st !== "fixing" && st !== "ready_for_issue" && st !== "issue_created") {
      return "確認してください";
    }
    return "変更案を作成中です";
  }

  function canPublishToProduction(job) {
    if (!job || job.kind !== "homepage-edit") return false;
    if (job.status === "published") return false;
    if (!job.prMerged || !job.githubPrNumber) return false;
    return job.status === "ready_for_publish" || job.status === "publish_failed";
  }

  function upsert(job) {
    var list = load();
    var i = list.findIndex(function (j) { return j.id === job.id; });
    job.updatedAt = new Date().toISOString();
    if (i >= 0) list[i] = job;
    else list.unshift(job);
    save(list);
    return job;
  }

  function getById(id) {
    return load().find(function (j) { return j.id === id; }) || null;
  }

  function statusLabel(status) {
    return STATUS_JA[status] || "進行中";
  }

  function jobsNeedingSync() {
    return load().filter(function (j) {
      if (!j || !j.githubIssueNumber) return false;
      if (j.status === "completed" || j.status === "cancelled" || j.status === "published") return false;
      return true;
    }).slice(0, 12);
  }

  function applyGithubIssueResult(job, issue) {
    if (!job) return null;
    job.githubIssueNumber = issue && issue.number != null ? issue.number : job.githubIssueNumber;
    job.githubIssueUrl = (issue && issue.url) || job.githubIssueUrl;
    job.agentStatus = (issue && issue.agentStatus) || AGENT_STATUS.READY_FOR_AGENT;
    job.status = (issue && issue.jobStatus) || "waiting_for_agent";
    job.lastGithubError = null;
    return upsert(job);
  }

  function markGithubFailure(job, err) {
    if (!job) return null;
    job.lastGithubError = (err && (err.userMessage || err.message || err.error)) || "送信失敗";
    if (job.status === "issue_created" || job.status === "waiting_for_agent") {
      /* leave status */
    } else {
      job.status = "ready_for_issue";
    }
    return upsert(job);
  }

  /**
   * Map GitHub Issue / PR / Agent signals into developmentJob status.
   */
  function applyExternalUpdate(job, update) {
    if (!job || !update) return job;
    update = update || {};
    if (update.agentStatus && AGENT_STATUS[update.agentStatus]) {
      job.agentStatus = update.agentStatus;
    }
    if (update.githubIssueNumber != null) job.githubIssueNumber = update.githubIssueNumber;
    if (update.githubIssueUrl) job.githubIssueUrl = update.githubIssueUrl;
    if (update.githubPrNumber != null) job.githubPrNumber = update.githubPrNumber;
    if (update.githubPrUrl) job.githubPrUrl = update.githubPrUrl;
    if (typeof update.prMerged === "boolean") job.prMerged = update.prMerged;
    if (update.prBaseRef) job.prBaseRef = update.prBaseRef;
    if (update.mergeCommitSha) job.mergeCommitSha = update.mergeCommitSha;
    if (Array.isArray(update.changedFiles)) job.changedFiles = update.changedFiles.slice(0, 40);
    if (update.branchName) job.branchName = update.branchName;
    if (update.previewUrl) job.previewUrl = update.previewUrl;
    if (update.testSummary) job.testSummary = update.testSummary;
    if (update.failureReason) job.failureReason = update.failureReason;
    job.lastSyncedAt = new Date().toISOString();

    if (job.status === "published") {
      return upsert(job);
    }

    if (update.prMerged) {
      job.status = "ready_for_publish";
    } else if (update.status && STATUS_JA[update.status] != null) {
      job.status = update.status;
    } else if (update.agentStatus && AGENT_TO_JOB[update.agentStatus]) {
      job.status = AGENT_TO_JOB[update.agentStatus];
      if (update.agentStatus === AGENT_STATUS.READY_FOR_REVIEW && update.githubPrNumber) {
        job.status = "waiting_for_review";
      }
    } else if (update.githubPrNumber && !update.status) {
      job.status = "waiting_for_review";
      job.agentStatus = AGENT_STATUS.READY_FOR_REVIEW;
    }
    return upsert(job);
  }

  function applySyncPayload(sync) {
    if (!sync || !sync.githubIssueNumber) return null;
    var list = load();
    var job = list.find(function (j) {
      return Number(j.githubIssueNumber) === Number(sync.githubIssueNumber) ||
        (sync.jobId && j.id === sync.jobId);
    });
    if (!job) return null;
    return applyExternalUpdate(job, sync);
  }

  function toIssueMarkdown(job) {
    job = job || {};
    return [
      "# AI DEVELOPMENT TASK",
      "",
      "## User Request",
      job.userRequest || "",
      "",
      "## Goal",
      job.goal || "",
      "",
      "## Acceptance Criteria",
      (job.acceptanceCriteria || []).map(function (x) { return "- " + x; }).join("\n"),
      "",
      "## Affected Areas",
      (job.affectedAreas || []).map(function (x) { return "- " + x; }).join("\n"),
      "",
      "## Test Plan",
      (job.testPlan || []).map(function (x) { return "- " + x; }).join("\n"),
      "",
      "## Rollback Plan",
      (job.rollbackPlan || []).map(function (x) { return "- " + x; }).join("\n"),
      "",
      "## Safety Rules",
      (job.safetyRules || []).map(function (x) { return "- " + x; }).join("\n"),
      "",
      "## Job Kind",
      job.kind || "general",
      "",
      "## Job Id",
      job.id || "",
      "",
      "## Branch",
      job.branchName || "(agent will set)",
      "",
      "## Pull Request",
      job.githubPrNumber ? ("#" + job.githubPrNumber) : "(none yet)",
      "",
      "## Agent Status",
      job.agentStatus || AGENT_STATUS.READY_FOR_AGENT,
      "",
      "## Agent Instructions",
      "1. On start: set Agent Status to AGENT_WORKING",
      "2. While verifying: TESTING",
      "3. While fixing failures: FIXING",
      "4. When PR is ready: READY_FOR_REVIEW and fill Pull Request + Branch",
      "5. Never merge to main / never Production Deploy / never real FTP publish",
      job.kind === "homepage-edit"
        ? "6. Homepage-edit job: create a PR with the proposed site change. Do not publish to production."
        : "",
      ""
    ].join("\n");
  }

  function renderProgressHtml(job, escapeHtmlFn) {
    var esc = typeof escapeHtmlFn === "function" ? escapeHtmlFn : function (s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    };
    var lines = [];
    var label = statusLabel(job.status);
    lines.push("<div class=\"ai-job-card\" data-job-id=\"" + esc(job.id) + "\">");
    lines.push("<strong>" + esc(job.title) + "</strong>");

    if (job.status === "ready_for_issue" && job.lastGithubError) {
      lines.push("<p>依頼票は保存済みです</p>");
      lines.push("<p>" + esc(job.lastGithubError) + "</p>");
      lines.push("<p><button type=\"button\" class=\"btn btn--secondary btn--touch btn-ai-job-retry\" data-job-id=\"" +
        esc(job.id) + "\">再送信</button></p>");
    } else if (job.kind === "homepage-edit") {
      lines.push("<p>" + esc(studioProgressMessage(job)) + "</p>");
      if (job.githubIssueNumber) {
        lines.push("<p>GitHub Issue #" + esc(String(job.githubIssueNumber)) + "</p>");
      }
      if (canPublishToProduction(job)) {
        lines.push("<p><button type=\"button\" class=\"btn btn--primary btn--touch btn-hp-site-publish\" data-job-id=\"" +
          esc(job.id) + "\" data-pr-number=\"" + esc(String(job.githubPrNumber)) +
          "\">本番へ反映する</button></p>");
      }
    } else if (job.githubIssueNumber &&
      (job.status === "issue_created" || job.status === "waiting_for_agent")) {
      lines.push("<p>✅ 開発依頼を作成しました</p>");
      lines.push("<p>✅ GitHubへ送信しました</p>");
      lines.push("<p>⏳ AIプログラマー待機中</p>");
      lines.push("<p>GitHub Issue #" + esc(String(job.githubIssueNumber)) + "</p>");
    } else if (job.status === "waiting_for_review" || job.status === "pr_ready") {
      lines.push("<p class=\"ai-job-card__attention\">確認してください</p>");
      lines.push("<p>" + esc(label) + "</p>");
      if (job.githubPrNumber) {
        lines.push("<p>Pull Request #" + esc(String(job.githubPrNumber)) + "</p>");
      }
    } else {
      lines.push("<p>" + esc(label) + "</p>");
      if (job.githubIssueNumber) {
        lines.push("<p>GitHub Issue #" + esc(String(job.githubIssueNumber)) + "</p>");
      }
    }

    if (job.githubIssueUrl) {
      lines.push(
        "<p><a class=\"btn btn--secondary btn--touch\" href=\"" +
        esc(job.githubIssueUrl) +
        "\" target=\"_blank\" rel=\"noopener\">Issueを見る</a></p>"
      );
    }
    if (job.githubPrUrl) {
      lines.push(
        "<p><a class=\"btn btn--primary btn--touch\" href=\"" +
        esc(job.githubPrUrl) +
        "\" target=\"_blank\" rel=\"noopener\">PRを確認</a></p>"
      );
    }
    lines.push("</div>");
    return lines.join("");
  }

  var api = {
    KEY: KEY,
    load: load,
    save: save,
    upsert: upsert,
    getById: getById,
    jobsNeedingSync: jobsNeedingSync,
    buildTaskFromRequest: buildTaskFromRequest,
    buildHomepageEditTask: buildHomepageEditTask,
    homepageEditJobs: homepageEditJobs,
    studioProgressMessage: studioProgressMessage,
    canPublishToProduction: canPublishToProduction,
    statusLabel: statusLabel,
    toIssueMarkdown: toIssueMarkdown,
    applyGithubIssueResult: applyGithubIssueResult,
    markGithubFailure: markGithubFailure,
    applyExternalUpdate: applyExternalUpdate,
    applySyncPayload: applySyncPayload,
    renderProgressHtml: renderProgressHtml,
    STATUS_JA: STATUS_JA,
    AGENT_STATUS: AGENT_STATUS,
    AGENT_TO_JOB: AGENT_TO_JOB
  };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  global.SmileDevJobs = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
