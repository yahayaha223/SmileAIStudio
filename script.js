(function () {
  "use strict";

  var STORAGE_KEY = "smileAIStudio_requests";
  var PROJECTS_KEY = "smileAIStudio_projects";
  var RUNTIME_ERRORS_KEY = "smileAIStudio_runtimeErrors";
  var MANUAL_CHECKLIST_KEY = "smileAIStudio_manualChecklist";
  var RELEASE_NOTES_KEY = "smileAIStudio_releaseNotes";
  var RELEASE_HISTORY_KEY = "smileAIStudio_releaseHistory";
  var RELEASE_STATE_KEY = "smileAIStudio_releaseState";
  var TODAY_TODOS_KEY = "smileAIStudio_todayTodos";
  var IPHONE_SETTINGS_KEY = "smileAIStudio_iphoneSettings";
  var CURRENT_FOCUS_KEY = "smileAIStudio_currentFocus";
  var DIARY_ENTRIES_KEY = "smileAIStudio_diaryEntries";
  var CURSOR_HANDOFFS_KEY = "smileAIStudio_cursorHandoffs";
  var FAMILY_PHOTO_KEY = "smileAIStudio_familyPhoto";
  var TOP_PRIORITY_KEY = "smileAIStudio_topPriority";
  var MEETING_LOGS_KEY = "smileAIStudio_meetingLogs";
  var CURSOR_AGENT_URL = "https://cursor.com/agents";

  var APP_INFO = {
    name: "Smile AI Studio",
    version: "1.5.0",
    build: 35,
    updatedAt: "2026-07-15"
  };

  var DEV_ROADMAP = {
    progress: 92,
    completed: [
      "AIルーター",
      "指示書生成",
      "プロジェクト管理",
      "システムチェック",
      "リリースセンター",
      "スマホファーストUI",
      "Web管理センター",
      "AI秘書",
      "Cursorへ送る連携",
      "AI秘書ファーストUI",
      "Mission / Vision表示",
      "家族写真エリア",
      "朝ダッシュボード",
      "AI会議ログ",
      "Cursor完了報告 → AI会議ログ取り込み",
      "LINE双方向司令塔 MVP",
      "LINE判断 → 会議ログ自動保存"
    ],
    upcoming: [
      { label: "GitHub自動Push", status: "準備中" },
      { label: "Netlify公開", status: "準備中" },
      { label: "Cursor自動実行（要確認）", status: "準備中" },
      { label: "通知", status: "準備中" },
      { label: "音声入力", status: "準備中" },
      { label: "AI検索（会議ログ）", status: "準備中" }
    ]
  };

  /* VISION.md / README.md に基づく表示文（折りたたみ用） */
  var COMPANY_MISSION = {
    quote: "笑顔をつくる仕事に、人の時間を返す。",
    paragraphs: [
      "株式会社えがおのきろくは、イベント・ギフト・体験づくりを通じて「笑顔の記録」を届けています。",
      "AIは人を置き換える道具ではなく、人がもっと人らしい仕事に集中できる環境をつくる道具です。繰り返し作業はAIに任せ、企画・対話・判断には人が向き合う——そのために会社を動かしています。"
    ]
  };

  var COMPANY_VISION = {
    quote: "同じ笑顔の品質で、届け続けられる基盤をつくる。",
    paragraphs: [
      "すべてのプロジェクトを一つの開発文化のもとに置き、依頼→実装→テスト→デプロイ→通知までを再現可能なフローにします。",
      "目的は、ただ速くすることではありません。信頼できる形で速くすること。えがおのきろくの開発文化を、個人の経験に頼らず組織の資産として残すことが Smile AI Studio の存在意義です。"
    ]
  };

  var CURRENT_GOALS = [
    { id: "smile-ai-studio", label: "Smile AI Studio", progress: 82 },
    { id: "corporate-site", label: "CorporateSite", progress: 60 },
    { id: "event-lp", label: "イベント相談LP", progress: 40 }
  ];

  var DAILY_WORDS = [
    "今日の一歩が、\n未来の笑顔につながる。",
    "昨日より少しだけ前へ。",
    "小さく始めて、確かに届ける。",
    "安心できる速さを、今日も。",
    "笑顔をつくる仕事に、時間を返す。"
  ];

  var DUMMY_SCHEDULE = [
    { time: "09:00", title: "ミーティング" },
    { time: "14:00", title: "ホームページ更新" },
    { time: "16:30", title: "システムチェック" }
  ];

  var DEFAULT_TOP_PRIORITY = "Smile AI Studio 朝ダッシュボードを整える";

  var FUTURE_FEATURES = [
    "GitHub自動Push",
    "Netlify公開",
    "Cursor連携",
    "通知",
    "音声入力",
    "AI検索（会議ログ）"
  ];

  var MEETING_CATEGORIES = ["開発", "経営", "ホームページ", "イベント", "AI", "その他"];

  var DEFAULT_TODAY_TODOS = [
    { id: "todo-giftcanvas", text: "GiftCanvas修正", done: false },
    { id: "todo-ningyoyaki", text: "人形焼き追加", done: false },
    { id: "todo-system-check", text: "システムチェック", done: false }
  ];

  var DEFAULT_IPHONE_SETTINGS = {
    cursorMobile: false,
    githubMobile: false,
    netlifyCheck: false
  };

  var DEFAULT_CURRENT_FOCUS = {
    projectId: "gift-canvas",
    progress: 45
  };

  var MANUAL_CHECK_ITEMS = [
    { id: "open-request-modal", label: "新しい依頼モーダルを開ける" },
    { id: "select-project", label: "プロジェクトを選択できる" },
    { id: "run-router", label: "AIルーターが判定する" },
    { id: "copy-prompt", label: "指示書をコピーできる" },
    { id: "save-request", label: "依頼を保存できる" },
    { id: "reopen-request", label: "保存後に再表示できる" },
    { id: "add-project", label: "プロジェクトを追加できる" },
    { id: "edit-project", label: "プロジェクトを編集できる" },
    { id: "toggle-project", label: "無効化・再有効化できる" },
    { id: "delete-confirm", label: "削除確認が表示される" },
    { id: "mobile-layout", label: "スマホ表示が崩れていない" },
    { id: "console-clean", label: "ブラウザConsoleにエラーがない" },
    { id: "review-diff", label: "GitHubへpush前の差分を確認した" },
    { id: "netlify-mobile", label: "Netlify公開後にスマホで確認した" }
  ];

  window.smileAIStudioStatus = {
    initialized: false,
    initializedAt: "",
    runtimeErrors: [],
    sessionErrors: [],
    registeredActions: {}
  };

  function loadPersistedRuntimeErrors() {
    try {
      var raw = localStorage.getItem(RUNTIME_ERRORS_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
    } catch (e) {
      return [];
    }
  }

  function persistRuntimeErrors(list) {
    try {
      localStorage.setItem(RUNTIME_ERRORS_KEY, JSON.stringify((list || []).slice(0, 20)));
    } catch (e) { /* ignore */ }
  }

  function sanitizeErrorText(value) {
    var text = String(value == null ? "" : value);
    text = text.replace(/(api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");
    return text.slice(0, 500);
  }

  function recordRuntimeError(entry) {
    var item = {
      message: sanitizeErrorText(entry.message || "Unknown error"),
      source: sanitizeErrorText(entry.source || ""),
      line: entry.line || 0,
      column: entry.column || 0,
      type: entry.type || "error",
      at: entry.at || new Date().toISOString(),
      session: true
    };
    window.smileAIStudioStatus.sessionErrors.unshift(item);
    if (window.smileAIStudioStatus.sessionErrors.length > 20) {
      window.smileAIStudioStatus.sessionErrors.length = 20;
    }
    var persisted = loadPersistedRuntimeErrors();
    persisted.unshift({
      message: item.message,
      source: item.source,
      line: item.line,
      column: item.column,
      type: item.type,
      at: item.at,
      session: false
    });
    persistRuntimeErrors(persisted);
    window.smileAIStudioStatus.runtimeErrors = persisted;
  }

  window.smileAIStudioStatus.runtimeErrors = loadPersistedRuntimeErrors();

  window.addEventListener("error", function (event) {
    recordRuntimeError({
      message: event && event.message ? event.message : "Script error",
      source: event && event.filename ? event.filename : "",
      line: event && event.lineno ? event.lineno : 0,
      column: event && event.colno ? event.colno : 0,
      type: "error"
    });
  });

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && event.reason;
    var message = "";
    if (reason && reason.message) message = reason.message;
    else if (typeof reason === "string") message = reason;
    else {
      try { message = JSON.stringify(reason); } catch (e) { message = String(reason); }
    }
    recordRuntimeError({
      message: message || "Unhandled promise rejection",
      source: "",
      line: 0,
      column: 0,
      type: "unhandledrejection"
    });
  });

  var priorityTasks = [
    { title: "Fuwafuwa Panic Managerの実用化", progress: 45, status: "進行中" },
    { title: "イベント相談LPの改善", progress: 30, status: "進行中" },
    { title: "Smile AI Studioの司令塔構築", progress: 60, status: "進行中" }
  ];

  var staffList = [
    { id: "programmer", name: "プログラマーAI", icon: "💻", role: "設計、コーディング、GitHub更新" },
    { id: "designer", name: "デザイナーAI", icon: "🎨", role: "画面デザイン、画像、使いやすさ改善" },
    { id: "writer", name: "ライターAI", icon: "✍️", role: "文章、LP、説明文、SEO" },
    { id: "tester", name: "テスターAI", icon: "🔍", role: "バグ確認、動作確認、改善提案" }
  ];

  var AI_NAMES = ["プログラマーAI", "デザイナーAI", "ライターAI", "テスターAI"];

  var AI_KEYWORDS = {
    "プログラマーAI": [
      "コード", "実装", "機能", "追加", "修正", "開発", "javascript", "html", "css",
      "api", "データ", "localstorage", "保存", "バグ修正", "エラー", "リファクタ",
      "github", "commit", "push", "ロジック", "処理", "フォーム", "入力"
    ],
    "デザイナーAI": [
      "デザイン", "見た目", "ui", "ux", "画面", "余白", "色", "配色", "ボタン",
      "レイアウト", "スマホ", "見やすく", "押しやすく", "フォント", "使いやす",
      "分かりやすく", "ビジュアル", "アイコン"
    ],
    "ライターAI": [
      "文章", "文言", "コピー", "lp", "説明", "seo", "見出し", "キャッチ",
      "テキスト", "書き", "伝わり", "説明文", "文章作成", "言い回し", "表現"
    ],
    "テスターAI": [
      "テスト", "バグ", "不具合", "確認", "再現", "動作確認", "検証", "チェック",
      "異常", "境界", "重大度", "調査", "原因", "デバッグ"
    ]
  };

  var STAFF_WORK_EXTRA = {
    "プログラマーAI": [
      "コード構成を確認する",
      "HTML、CSS、JavaScriptの役割を分ける",
      "構文エラーを確認する",
      "既存データとの互換性を確認する"
    ],
    "デザイナーAI": [
      "スマホ優先で画面を確認する",
      "文字サイズ、余白、色、押しやすさを確認する",
      "既存ブランドや配色を壊さない",
      "変更前後の違いを説明する"
    ],
    "ライターAI": [
      "対象読者を明確にする",
      "分かりやすい日本語にする",
      "誇張表現や不自然な表現を避ける",
      "SEO対象の場合は検索意図を考慮する"
    ],
    "テスターAI": [
      "正常系、異常系、境界値を確認する",
      "スマホとパソコンの両方で確認する",
      "再現手順を整理する",
      "重大度と優先度を分けて報告する"
    ]
  };

  var BASE_WORK_ITEMS = [
    "現在のプロジェクト構成を確認する",
    "関連する既存コードを確認する",
    "原因や改善方法を整理する",
    "既存機能を壊さないように実装する",
    "スマホ表示を優先して確認する",
    "動作確認を行う",
    "変更内容を日本語で報告する"
  ];

  var DEFAULT_CONSTRAINTS = [
    "・既存機能を壊さない",
    "・既存ファイルを勝手に削除しない",
    "・現在のコードを確認してから変更する",
    "・大規模な構成変更を勝手に行わない",
    "・強制pushを使用しない",
    "・認証情報や秘密情報をコードに直接書かない",
    "・変更後に動作確認を行う",
    "・スマホ表示を優先する"
  ].join("\n");

  var DEFAULT_REFERENCES = "現在のプロジェクト構成と既存コードを確認してください";

  var DESIRED_BY_STAFF = {
    "プログラマーAI": "既存機能を維持したまま、依頼内容が正常に動作する状態",
    "デザイナーAI": "スマホで見やすく、押しやすく、迷わず使える状態",
    "ライターAI": "対象者に伝わりやすく、自然で分かりやすい文章になっている状態",
    "テスターAI": "不具合の再現条件、原因候補、重大度、改善案が整理された状態"
  };

  var CHECK_ITEMS = [
    "依頼内容が意図どおり動作するか確認する",
    "既存機能が壊れていないか確認する",
    "スマホ表示を優先して確認する",
    "エラーや表示崩れがないか確認する"
  ];

  /* ========== DOM ========== */
  var modal = document.getElementById("request-modal");
  var promptViewModal = document.getElementById("prompt-view-modal");
  var projectModal = document.getElementById("project-modal");
  var projectDetailModal = document.getElementById("project-detail-modal");
  var projectDetailBody = document.getElementById("project-detail-body");
  var projectDetailTitle = document.getElementById("project-detail-title");
  var webCenterModal = document.getElementById("web-center-modal");
  var webCenterMenuView = document.getElementById("web-center-menu-view");
  var webCenterFormView = document.getElementById("web-center-form-view");
  var webCenterDraftsView = document.getElementById("web-center-drafts-view");
  var webCenterPublishedView = document.getElementById("web-center-published-view");
  var webCenterInstructionView = document.getElementById("web-center-instruction-view");
  var meetingLogsModal = document.getElementById("meeting-logs-modal");
  var meetingListView = document.getElementById("meeting-list-view");
  var meetingFormView = document.getElementById("meeting-form-view");
  var meetingDetailView = document.getElementById("meeting-detail-view");
  var meetingImportView = document.getElementById("meeting-import-view");
  var meetingImportPreviewView = document.getElementById("meeting-import-preview-view");
  var currentCursorImportDraft = null;
  var lineCommandModal = document.getElementById("line-command-modal");
  var lineStatusCache = null;
  var lineHistoryCache = null;
  var lineApiConnected = false;
  var lineTestSending = false;
  var LINE_API = {
    status: "/.netlify/functions/api-line-status",
    history: "/.netlify/functions/api-command-history",
    projects: "/.netlify/functions/api-project-status",
    meetingLogs: "/.netlify/functions/api-meeting-logs",
    sendTest: "/.netlify/functions/line-send-test"
  };
  var secretaryModal = document.getElementById("secretary-modal");
  var secretaryInputView = document.getElementById("secretary-input-view");
  var secretaryResultView = document.getElementById("secretary-result-view");
  var cursorHandoffModal = document.getElementById("cursor-handoff-modal");
  var form = document.getElementById("request-form");
  var toast = document.getElementById("toast");
  var formError = document.getElementById("form-error");
  var promptResult = document.getElementById("prompt-result");
  var promptResultText = document.getElementById("prompt-result-text");
  var promptViewText = document.getElementById("prompt-view-text");
  var detailsPanel = document.getElementById("details-panel");
  var btnToggleDetails = document.getElementById("btn-toggle-details");
  var routerInputView = document.getElementById("router-input-view");
  var routerResultView = document.getElementById("router-result-view");
  var routeSummary = document.getElementById("route-summary");
  var projectListView = document.getElementById("project-list-view");
  var projectFormView = document.getElementById("project-form-view");
  var projectFormError = document.getElementById("project-form-error");
  var systemCheckModal = document.getElementById("system-check-modal");
  var releaseCenterModal = document.getElementById("release-center-modal");
  var toastTimer = null;
  var currentGeneratedPrompt = "";
  var viewedPrompt = "";
  var detailsOpen = false;
  var currentRoute = null;
  var editingProjectId = null;
  var editingDiaryId = null;
  var currentDiaryInstruction = "";
  var secretaryPhotoUrl = "";
  var secretaryPhotoName = "";
  var currentSecretaryResults = null;
  var currentCursorInstruction = "";
  var currentCursorHandoff = null;

  /* ========== Utils ========== */
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove("is-visible");
    }, 2800);
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function truncateText(text, maxLen) {
    var t = (text || "").trim();
    if (t.length <= maxLen) return t;
    return t.slice(0, maxLen) + "…";
  }

  function formatDate(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      var m = d.getMonth() + 1;
      var day = d.getDate();
      var h = String(d.getHours()).padStart(2, "0");
      var min = String(d.getMinutes()).padStart(2, "0");
      return m + "/" + day + " " + h + ":" + min;
    } catch (e) {
      return "";
    }
  }

  function isValidHttpUrl(value) {
    if (!value) return true;
    return /^https?:\/\/.+/i.test(value);
  }

  function anyModalOpen() {
    return (
      (modal && modal.classList.contains("is-open")) ||
      (promptViewModal && promptViewModal.classList.contains("is-open")) ||
      (projectModal && projectModal.classList.contains("is-open")) ||
      (projectDetailModal && projectDetailModal.classList.contains("is-open")) ||
      (webCenterModal && webCenterModal.classList.contains("is-open")) ||
      (meetingLogsModal && meetingLogsModal.classList.contains("is-open")) ||
      (lineCommandModal && lineCommandModal.classList.contains("is-open")) ||
      (secretaryModal && secretaryModal.classList.contains("is-open")) ||
      (cursorHandoffModal && cursorHandoffModal.classList.contains("is-open")) ||
      (systemCheckModal && systemCheckModal.classList.contains("is-open")) ||
      (releaseCenterModal && releaseCenterModal.classList.contains("is-open"))
    );
  }

  function registerAction(name) {
    if (!window.smileAIStudioStatus.registeredActions) {
      window.smileAIStudioStatus.registeredActions = {};
    }
    window.smileAIStudioStatus.registeredActions[name] = true;
  }

  function onClick(id, handler, actionName) {
    var el = document.getElementById(id);
    if (!el) return null;
    el.addEventListener("click", handler);
    if (actionName) registerAction(actionName);
    return el;
  }

  function syncBodyScroll() {
    document.body.style.overflow = anyModalOpen() ? "hidden" : "";
  }

  function priorityBadgeClass(priority) {
    if (priority === "最優先") return "badge--priority-top";
    if (priority === "高") return "badge--priority-high";
    if (priority === "低" || priority === "通常") return "badge--priority-normal";
    return "badge--progress";
  }

  function statusBadgeClass(status) {
    if (status === "開発中") return "badge--dev";
    if (status === "改善中") return "badge--improve";
    if (status === "運用中") return "badge--progress";
    if (status === "一時停止" || status === "完了") return "badge--priority-normal";
    return "badge--progress";
  }

  function confidenceBadgeClass(level) {
    if (level === "高") return "badge--priority-high";
    if (level === "低") return "badge--priority-normal";
    return "badge--progress";
  }

  /* ========== Project storage ========== */
  function getDefaultProjects() {
    var now = new Date().toISOString();
    return [
      {
        id: "fuwafuwa-panic-manager",
        name: "Fuwafuwa Panic Manager",
        icon: "🎪",
        description: "イベント現場の積み込み・返却・在庫・スタッフ管理",
        status: "開発中",
        priority: "最優先",
        githubUrl: "",
        publicUrl: "",
        localFolderName: "FuwafuwaPanicManager",
        memo: "",
        enabled: true,
        isDefault: true,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now
      },
      {
        id: "gift-canvas",
        name: "GiftCanvas",
        icon: "🎈",
        description: "バルーンギフトのデザイン・注文システム",
        status: "開発中",
        priority: "通常",
        githubUrl: "",
        publicUrl: "",
        localFolderName: "GiftCanvas",
        memo: "",
        enabled: true,
        isDefault: true,
        sortOrder: 1,
        createdAt: now,
        updatedAt: now
      },
      {
        id: "event-consultation-lp",
        name: "イベント相談LP",
        icon: "🌐",
        description: "イベント相談とAI見積もりの集客サイト",
        status: "改善中",
        priority: "高",
        githubUrl: "",
        publicUrl: "",
        localFolderName: "event-soudan",
        memo: "",
        enabled: true,
        isDefault: true,
        sortOrder: 2,
        createdAt: now,
        updatedAt: now
      },
      {
        id: "smile-ai-studio",
        name: "Smile AI Studio",
        icon: "🤖",
        description: "株式会社えがおのきろく専用のAI司令塔",
        status: "開発中",
        priority: "最優先",
        githubUrl: "https://github.com/yahayaha223/SmileAIStudio",
        publicUrl: "https://smileaistudio.netlify.app",
        localFolderName: "SmileAIStudio",
        memo: "",
        enabled: true,
        isDefault: true,
        sortOrder: 3,
        createdAt: now,
        updatedAt: now
      }
    ];
  }

  function normalizeProject(raw, index) {
    if (!raw || typeof raw !== "object") return null;
    var now = new Date().toISOString();
    var id = String(raw.id || "").trim();
    if (!id) id = "project-" + Date.now() + "-" + (index || 0);

    return {
      id: id,
      name: String(raw.name || "").trim() || "名称未設定",
      icon: String(raw.icon || "").trim() || "📁",
      description: String(raw.description || raw.desc || "").trim(),
      status: String(raw.status || "構想中").trim() || "構想中",
      priority: String(raw.priority || "通常").trim() || "通常",
      githubUrl: String(raw.githubUrl || (raw.links && raw.links.github) || "").trim(),
      publicUrl: String(raw.publicUrl || (raw.links && raw.links.open) || "").trim(),
      localFolderName: String(raw.localFolderName || "").trim(),
      memo: String(raw.memo || "").trim(),
      enabled: raw.enabled !== false,
      isDefault: !!raw.isDefault,
      sortOrder: typeof raw.sortOrder === "number" ? raw.sortOrder : (typeof index === "number" ? index : 0),
      createdAt: raw.createdAt || now,
      updatedAt: raw.updatedAt || now
    };
  }

  function sortProjects(list) {
    return list.slice().sort(function (a, b) {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return String(a.name).localeCompare(String(b.name), "ja");
    });
  }

  function loadProjects() {
    try {
      var data = localStorage.getItem(PROJECTS_KEY);
      if (!data) {
        var defaults = getDefaultProjects();
        saveProjects(defaults);
        return defaults;
      }
      var parsed = JSON.parse(data);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        var fallback = getDefaultProjects();
        saveProjects(fallback);
        return fallback;
      }
      return sortProjects(parsed.map(normalizeProject).filter(Boolean));
    } catch (e) {
      var recovery = getDefaultProjects();
      try { saveProjects(recovery); } catch (err) { /* ignore */ }
      return recovery;
    }
  }

  function saveProjects(projects) {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(sortProjects(projects)));
  }

  function getEnabledProjects() {
    return loadProjects().filter(function (p) { return p.enabled; });
  }

  function getProjectById(id) {
    if (!id) return null;
    return loadProjects().find(function (p) { return p.id === id; }) || null;
  }

  function getProjectByName(name) {
    if (!name) return null;
    return loadProjects().find(function (p) { return p.name === name; }) || null;
  }

  function sanitizeCustomId(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-_\u3040-\u30ff\u3400-\u9fff]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function generateProjectId(name) {
    var base = sanitizeCustomId(name);
    if (!base) base = "project";
    var id = base + "-" + Date.now().toString(36);
    var n = 0;
    while (getProjectById(id)) {
      n += 1;
      id = base + "-" + Date.now().toString(36) + "-" + n;
    }
    return id;
  }

  function createProject(input) {
    var projects = loadProjects();
    var maxOrder = projects.reduce(function (max, p) {
      return Math.max(max, typeof p.sortOrder === "number" ? p.sortOrder : 0);
    }, -1);

    var now = new Date().toISOString();
    var customId = sanitizeCustomId(input.id);
    var id = customId || generateProjectId(input.name);
    if (getProjectById(id)) {
      throw new Error("同じIDのプロジェクトが既に存在します");
    }

    var project = normalizeProject({
      id: id,
      name: input.name,
      icon: input.icon,
      description: input.description,
      status: input.status,
      priority: input.priority,
      githubUrl: input.githubUrl,
      publicUrl: input.publicUrl,
      localFolderName: input.localFolderName,
      memo: input.memo,
      enabled: input.enabled !== false,
      isDefault: false,
      sortOrder: maxOrder + 1,
      createdAt: now,
      updatedAt: now
    });

    projects.push(project);
    saveProjects(projects);
    return project;
  }

  function updateProject(id, input) {
    var projects = loadProjects();
    var index = projects.findIndex(function (p) { return p.id === id; });
    if (index < 0) throw new Error("プロジェクトが見つかりません");

    var current = projects[index];
    projects[index] = normalizeProject({
      id: current.id,
      name: input.name,
      icon: input.icon,
      description: input.description,
      status: input.status,
      priority: input.priority,
      githubUrl: input.githubUrl,
      publicUrl: input.publicUrl,
      localFolderName: input.localFolderName,
      memo: input.memo,
      enabled: input.enabled !== false,
      isDefault: current.isDefault,
      sortOrder: current.sortOrder,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString()
    }, index);

    saveProjects(projects);
    return projects[index];
  }

  function deleteProject(id) {
    var projects = loadProjects().filter(function (p) { return p.id !== id; });
    saveProjects(projects);
  }

  function toggleProjectEnabled(id) {
    var projects = loadProjects();
    var target = projects.find(function (p) { return p.id === id; });
    if (!target) return null;
    target.enabled = !target.enabled;
    target.updatedAt = new Date().toISOString();
    saveProjects(projects);
    return target;
  }

  function moveProject(id, direction) {
    var projects = sortProjects(loadProjects());
    var index = projects.findIndex(function (p) { return p.id === id; });
    if (index < 0) return;
    var swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= projects.length) return;

    var tmpOrder = projects[index].sortOrder;
    projects[index].sortOrder = projects[swapIndex].sortOrder;
    projects[swapIndex].sortOrder = tmpOrder;

    var tmp = projects[index];
    projects[index] = projects[swapIndex];
    projects[swapIndex] = tmp;

    projects.forEach(function (p, i) {
      p.sortOrder = i;
      p.updatedAt = new Date().toISOString();
    });
    saveProjects(projects);
  }

  function refreshProjectDependentUI(selectedId) {
    renderProjectCards();
    populateProjectSelect(selectedId || "");
    renderProjectManagementList();
    renderCurrentFocus();
  }

  /* ========== Project UI ========== */
  function populateProjectSelect(selectedId) {
    var select = document.getElementById("req-project");
    if (!select) return;
    var current = selectedId || select.value;
    var enabled = getEnabledProjects();

    select.innerHTML = '<option value="">選択してください</option>';
    enabled.forEach(function (p) {
      var opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = (p.icon ? p.icon + " " : "") + p.name;
      select.appendChild(opt);
    });

    if (current && enabled.some(function (p) { return p.id === current; })) {
      select.value = current;
    }
  }

  function renderProjectCards() {
    var container = document.getElementById("project-list");
    if (!container) return;
    var enabled = getEnabledProjects();
    var focus = loadCurrentFocus();
    var focusId = focus && focus.projectId ? focus.projectId : "";

    if (enabled.length === 0) {
      container.innerHTML = '<p class="empty-message">表示できるプロジェクトがありません。管理画面から追加または有効化してください。</p>';
      return;
    }

    container.innerHTML = enabled.map(function (p) {
      var isFocus = p.id === focusId;
      var cardClass = "card project-card project-card--simple" +
        (isFocus ? " project-card--focus" : " project-card--compact");
      return (
        '<article class="' + cardClass + '" data-project-id="' + escapeHtml(p.id) + '" tabindex="0" role="button" aria-label="' + escapeHtml(p.name) + 'の詳細">' +
          '<div class="card__header">' +
            '<h3 class="card__title">' +
              '<span class="project-card__icon" aria-hidden="true">' + escapeHtml(p.icon) + "</span>" +
              escapeHtml(p.name) +
              (isFocus ? '<span class="project-card__focus-tag">現在開発中</span>' : "") +
            "</h3>" +
          "</div>" +
          '<div class="card__meta">' +
            '<span class="badge ' + statusBadgeClass(p.status) + '">' + escapeHtml(p.status) + "</span>" +
            (isFocus
              ? '<span class="badge ' + priorityBadgeClass(p.priority) + '">優先度：' + escapeHtml(p.priority) + "</span>"
              : "") +
          "</div>" +
          (isFocus
            ? '<div class="card__actions">' +
                '<button type="button" class="btn btn--primary btn-develop" data-project-id="' + escapeHtml(p.id) + '">開発</button>' +
              "</div>"
            : '<div class="card__actions card__actions--compact">' +
                '<button type="button" class="btn btn--ghost btn-develop" data-project-id="' + escapeHtml(p.id) + '">開発</button>' +
              "</div>") +
        "</article>"
      );
    }).join("");

    container.querySelectorAll(".project-card--simple").forEach(function (card) {
      card.addEventListener("click", function (e) {
        if (e.target.closest(".btn-develop")) return;
        openProjectDetail(card.getAttribute("data-project-id"));
      });
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openProjectDetail(card.getAttribute("data-project-id"));
        }
      });
    });

    container.querySelectorAll(".btn-develop").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        openModal({ projectId: btn.getAttribute("data-project-id") });
      });
    });
  }

  function renderProjectManagementList() {
    var container = document.getElementById("project-mgmt-list");
    if (!container) return;
    var projects = loadProjects();

    if (projects.length === 0) {
      container.innerHTML = '<p class="empty-message">プロジェクトがありません。</p>';
      return;
    }

    container.innerHTML = projects.map(function (p, index) {
      var githubLabel = p.githubUrl ? "GitHubあり" : "GitHubなし";
      var publicLabel = p.publicUrl ? "公開URLあり" : "公開URLなし";
      var enabledLabel = p.enabled ? "有効" : "無効";

      return (
        '<article class="card mgmt-card' + (p.enabled ? "" : " mgmt-card--disabled") + '" data-project-id="' + escapeHtml(p.id) + '">' +
          '<div class="mgmt-card__top">' +
            '<div class="mgmt-card__title-wrap">' +
              '<span class="mgmt-card__icon" aria-hidden="true">' + escapeHtml(p.icon) + "</span>" +
              '<div>' +
                '<h4 class="mgmt-card__name">' + escapeHtml(p.name) + "</h4>" +
                '<p class="mgmt-card__id">ID: ' + escapeHtml(p.id) + "</p>" +
              "</div>" +
            "</div>" +
            '<span class="badge ' + (p.enabled ? "badge--dev" : "badge--priority-normal") + '">' + enabledLabel + "</span>" +
          "</div>" +
          '<p class="card__desc">' + escapeHtml(p.description) + "</p>" +
          '<div class="card__meta">' +
            '<span class="badge ' + statusBadgeClass(p.status) + '">' + escapeHtml(p.status) + "</span>" +
            '<span class="badge ' + priorityBadgeClass(p.priority) + '">' + escapeHtml(p.priority) + "</span>" +
            '<span class="badge badge--progress">' + githubLabel + "</span>" +
            '<span class="badge badge--progress">' + publicLabel + "</span>" +
          "</div>" +
          '<div class="mgmt-card__actions">' +
            '<button type="button" class="btn btn--secondary btn--compact btn-move-up"' + (index === 0 ? " disabled" : "") + ">上へ</button>" +
            '<button type="button" class="btn btn--secondary btn--compact btn-move-down"' + (index === projects.length - 1 ? " disabled" : "") + ">下へ</button>" +
            '<button type="button" class="btn btn--secondary btn--compact btn-toggle-enabled">' + (p.enabled ? "無効化" : "有効化") + "</button>" +
            '<button type="button" class="btn btn--primary btn--compact btn-edit-project">編集</button>' +
            '<button type="button" class="btn btn--danger btn--compact btn-delete-project">削除</button>' +
          "</div>" +
        "</article>"
      );
    }).join("");
  }

  function showProjectListView() {
    projectListView.hidden = false;
    projectFormView.hidden = true;
    document.getElementById("project-modal-title").textContent = "プロジェクト管理";
    editingProjectId = null;
    clearProjectFormError();
    renderProjectManagementList();
  }

  function openProjectForm(project) {
    clearProjectFormError();
    projectListView.hidden = true;
    projectFormView.hidden = false;
    editingProjectId = project ? project.id : null;

    document.getElementById("project-modal-title").textContent = project ? "プロジェクトを編集" : "新しいプロジェクト";
    document.getElementById("proj-edit-id").value = project ? project.id : "";
    document.getElementById("proj-name").value = project ? project.name : "";
    document.getElementById("proj-description").value = project ? project.description : "";
    document.getElementById("proj-icon").value = project ? (project.icon === "📁" ? "" : project.icon) : "";
    document.getElementById("proj-id").value = project ? project.id : "";
    document.getElementById("proj-id").disabled = !!project;
    document.getElementById("proj-id-hint").textContent = project
      ? "作成後のIDは変更できません。"
      : "未入力なら自動生成します。作成後は変更できません。";
    document.getElementById("proj-status").value = project ? project.status : "構想中";
    document.getElementById("proj-priority").value = project ? project.priority : "通常";
    document.getElementById("proj-github").value = project ? project.githubUrl : "";
    document.getElementById("proj-public").value = project ? project.publicUrl : "";
    document.getElementById("proj-folder").value = project ? project.localFolderName : "";
    document.getElementById("proj-memo").value = project ? project.memo : "";
    document.getElementById("proj-enabled").checked = project ? project.enabled !== false : true;

    setTimeout(function () {
      document.getElementById("proj-name").focus();
    }, 200);
  }

  function clearProjectFormError() {
    if (!projectFormError) return;
    projectFormError.hidden = true;
    projectFormError.textContent = "";
    projectFormView.querySelectorAll(".form-group.is-invalid").forEach(function (el) {
      el.classList.remove("is-invalid");
    });
  }

  function showProjectFormError(message, fieldIds) {
    clearProjectFormError();
    projectFormError.textContent = message;
    projectFormError.hidden = false;
    (fieldIds || []).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentElement) el.parentElement.classList.add("is-invalid");
    });
    projectFormError.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function getProjectFormValues() {
    return {
      name: document.getElementById("proj-name").value.trim(),
      description: document.getElementById("proj-description").value.trim(),
      icon: document.getElementById("proj-icon").value.trim(),
      id: document.getElementById("proj-id").value.trim(),
      status: document.getElementById("proj-status").value,
      priority: document.getElementById("proj-priority").value,
      githubUrl: document.getElementById("proj-github").value.trim(),
      publicUrl: document.getElementById("proj-public").value.trim(),
      localFolderName: document.getElementById("proj-folder").value.trim(),
      memo: document.getElementById("proj-memo").value.trim(),
      enabled: document.getElementById("proj-enabled").checked
    };
  }

  function validateProjectForm(values, isEdit) {
    if (!values.name) {
      showProjectFormError("プロジェクト名を入力してください", ["proj-name"]);
      return false;
    }
    if (!values.description) {
      showProjectFormError("説明を入力してください", ["proj-description"]);
      return false;
    }
    if (!isEdit && values.id) {
      var sanitized = sanitizeCustomId(values.id);
      if (!sanitized) {
        showProjectFormError("IDに使える文字がありません", ["proj-id"]);
        return false;
      }
      if (getProjectById(sanitized)) {
        showProjectFormError("同じIDのプロジェクトが既に存在します", ["proj-id"]);
        return false;
      }
    }
    if (!isValidHttpUrl(values.githubUrl)) {
      showProjectFormError("GitHub URLは http:// または https:// で始めてください", ["proj-github"]);
      return false;
    }
    if (!isValidHttpUrl(values.publicUrl)) {
      showProjectFormError("公開サイトURLは http:// または https:// で始めてください", ["proj-public"]);
      return false;
    }
    clearProjectFormError();
    return true;
  }

  function openProjectModal(options) {
    options = options || {};
    projectModal.classList.add("is-open");
    projectModal.setAttribute("aria-hidden", "false");
    syncBodyScroll();

    if (options.mode === "create") {
      openProjectForm(null);
    } else if (options.mode === "edit" && options.projectId) {
      var p = getProjectById(options.projectId);
      if (p) openProjectForm(p);
      else showProjectListView();
    } else {
      showProjectListView();
    }
  }

  function closeProjectModal() {
    projectModal.classList.remove("is-open");
    projectModal.setAttribute("aria-hidden", "true");
    editingProjectId = null;
    clearProjectFormError();
    showProjectListView();
    syncBodyScroll();
  }

  function handleProjectFormSubmit(e) {
    e.preventDefault();
    var values = getProjectFormValues();
    var isEdit = !!editingProjectId;
    if (!validateProjectForm(values, isEdit)) return;

    try {
      if (isEdit) {
        updateProject(editingProjectId, values);
        showToast("プロジェクトを更新しました");
      } else {
        createProject(values);
        showToast("プロジェクトを追加しました");
      }
      refreshProjectDependentUI();
      showProjectListView();
    } catch (err) {
      showProjectFormError(err.message || "保存に失敗しました");
    }
  }

  function handleProjectMgmtClick(e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    var card = btn.closest(".mgmt-card");
    if (!card) return;
    var id = card.getAttribute("data-project-id");
    var project = getProjectById(id);
    if (!project) {
      showToast("プロジェクトが見つかりません");
      renderProjectManagementList();
      return;
    }

    if (btn.classList.contains("btn-edit-project")) {
      openProjectForm(project);
      return;
    }

    if (btn.classList.contains("btn-toggle-enabled")) {
      var updated = toggleProjectEnabled(id);
      refreshProjectDependentUI();
      showToast(updated && updated.enabled ? "プロジェクトを有効化しました" : "プロジェクトを無効化しました");
      return;
    }

    if (btn.classList.contains("btn-move-up")) {
      moveProject(id, "up");
      refreshProjectDependentUI();
      return;
    }

    if (btn.classList.contains("btn-move-down")) {
      moveProject(id, "down");
      refreshProjectDependentUI();
      return;
    }

    if (btn.classList.contains("btn-delete-project")) {
      var msg =
        "このプロジェクトを削除しますか？\n" +
        "過去の依頼履歴は削除されません。\n\n" +
        "可能であれば削除ではなく「無効化」を推奨します。";
      if (project.isDefault) {
        msg =
          "標準プロジェクト「" + project.name + "」を削除しますか？\n" +
          "過去の依頼履歴は削除されません。\n\n" +
          "誤操作防止のため、削除より「無効化」を強く推奨します。";
      }
      if (!window.confirm(msg)) return;
      deleteProject(id);
      refreshProjectDependentUI();
      showToast("プロジェクトを削除しました");
    }
  }

  /* ========== Requests ========== */
  function getRequests() {
    try {
      var data = localStorage.getItem(STORAGE_KEY);
      if (!data) return [];
      var parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed.map(normalizeRequest).filter(Boolean) : [];
    } catch (e) {
      return [];
    }
  }

  function normalizeRequest(req) {
    if (!req || typeof req !== "object") return null;

    var projectName = req.projectName || req.selectedProject || req.project || "";
    var staff = req.detectedMainAI || req.aiStaff || req.staff || "";
    var content = req.request || req.content || "";
    var support = req.detectedSupportAI || req.supportAI || "";
    var purpose = req.detectedPurpose || req.purpose || "";
    var desired = req.detectedDesiredResult || req.desiredResult || "";
    var priority = req.detectedPriority || req.priority || "通常";

    return {
      id: req.id || String(Date.now()),
      project: projectName,
      selectedProject: projectName,
      projectId: req.projectId || "",
      projectName: projectName,
      projectIcon: req.projectIcon || "",
      projectLocalFolderName: req.projectLocalFolderName || "",
      projectGithubUrl: req.projectGithubUrl || "",
      projectPublicUrl: req.projectPublicUrl || "",
      staff: staff,
      aiStaff: staff,
      detectedMainAI: staff,
      supportAI: support,
      detectedSupportAI: support,
      title: req.title || "",
      content: content,
      request: content,
      purpose: purpose,
      detectedPurpose: purpose,
      desiredResult: desired,
      detectedDesiredResult: desired,
      changeScope: req.changeScope || "",
      constraints: req.constraints || "",
      references: req.references || "",
      priority: priority,
      detectedPriority: priority,
      routingConfidence: req.routingConfidence || "",
      generatedPrompt: req.generatedPrompt || "",
      createdAt: req.createdAt || new Date().toISOString()
    };
  }

  function saveRequests(requests) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
  }

  /* ========== AI Router ========== */
  function buildTitleFromWant(want) {
    var normalized = String(want || "")
      .replace(/\r\n|\r|\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) return "";
    if (normalized.length <= 30) return normalized;
    return normalized.slice(0, 30) + "…";
  }

  function inferPurpose(want) {
    var t = String(want || "").replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
    if (!t) return "現場スタッフが迷わず操作できるようにする";
    if (/入力ミス|誤入力|ミスを減ら/.test(t)) return "現場スタッフの入力ミスを減らす";
    if (/分かりやすく|見やすく|使いやすく|迷わず|操作しやすく/.test(t)) {
      return "現場スタッフが迷わず操作できるようにする";
    }
    if (/速く|早く|効率|時短|手間/.test(t)) return "作業時間を短縮し、現場の負担を減らす";
    if (/文章|文言|コピー|LP|説明文|SEO/.test(t)) return "対象者に伝わりやすい文章にする";
    if (/バグ|不具合|エラー|テスト|確認/.test(t)) return "不具合を洗い出し、安心して使える状態にする";
    var base = t.replace(/[。．.！!？?\s]+$/g, "").replace(/(したい|してほしい|して欲しい)$/g, "");
    if (!base) base = t;
    return base + "ことで、現場の負担を減らす";
  }

  function inferDesiredResult(staff) {
    return DESIRED_BY_STAFF[staff] || "依頼内容が満たされ、既存機能も問題なく使える状態";
  }

  function inferPriority(want, override) {
    if (override) return override;
    var t = String(want || "");
    if (/今日|明日|至急|急ぎ|すぐ|緊急/.test(t)) return "高";
    if (/急がない|いつでも|余裕|低優先/.test(t)) return "低";
    if (/今週/.test(t)) return "中";
    return "通常";
  }

  function countKeywordMatches(want, keywords) {
    var text = String(want || "").toLowerCase();
    var count = 0;
    var matched = {};
    keywords.forEach(function (kw) {
      var key = String(kw).toLowerCase();
      if (!key || matched[key]) return;
      if (text.indexOf(key) !== -1) {
        matched[key] = true;
        count += 1;
      }
    });
    return count;
  }

  function confidenceFromMatchCount(count) {
    if (count >= 2) return "高";
    if (count === 1) return "中";
    return "低";
  }

  function detectAIStaff(want, mainOverride, supportOverride) {
    var scores = AI_NAMES.map(function (name) {
      return {
        name: name,
        score: countKeywordMatches(want, AI_KEYWORDS[name] || [])
      };
    }).sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return AI_NAMES.indexOf(a.name) - AI_NAMES.indexOf(b.name);
    });

    var mainAI = mainOverride || scores[0].name;
    var mainScore = 0;
    scores.forEach(function (s) {
      if (s.name === mainAI) mainScore = s.score;
    });

    var supportAI = "";
    if (supportOverride === "なし") {
      supportAI = "なし";
    } else if (supportOverride) {
      supportAI = supportOverride === mainAI ? "なし" : supportOverride;
    } else {
      var second = scores.find(function (s) {
        return s.name !== mainAI && s.score > 0;
      });
      supportAI = second ? second.name : "なし";
    }

    return {
      mainAI: mainAI,
      supportAI: supportAI,
      mainScore: mainScore,
      confidence: confidenceFromMatchCount(mainScore)
    };
  }

  function getRawFormValues() {
    return {
      projectId: document.getElementById("req-project").value,
      content: document.getElementById("req-content").value.trim(),
      mainAI: document.getElementById("req-main-ai").value,
      supportAI: document.getElementById("req-support-ai").value,
      changeScope: document.getElementById("req-scope").value,
      constraints: document.getElementById("req-constraints").value.trim(),
      references: document.getElementById("req-references").value.trim(),
      priority: document.getElementById("req-priority").value
    };
  }

  function runRouter(raw) {
    var content = (raw.content || "").trim();
    var project = getProjectById(raw.projectId);
    if (!project) {
      throw new Error("作業するプロジェクトを選択してください");
    }

    var detection = detectAIStaff(content, raw.mainAI || "", raw.supportAI || "");
    var mainAI = detection.mainAI;
    var priority = inferPriority(content, (raw.priority || "").trim());

    return {
      projectId: project.id,
      selectedProject: project.name,
      project: project.name,
      projectName: project.name,
      projectIcon: project.icon,
      projectLocalFolderName: project.localFolderName || "",
      projectGithubUrl: project.githubUrl || "",
      projectPublicUrl: project.publicUrl || "",
      content: content,
      title: buildTitleFromWant(content),
      detectedMainAI: mainAI,
      staff: mainAI,
      aiStaff: mainAI,
      detectedSupportAI: detection.supportAI,
      supportAI: detection.supportAI,
      detectedPurpose: inferPurpose(content),
      purpose: inferPurpose(content),
      detectedDesiredResult: inferDesiredResult(mainAI),
      desiredResult: inferDesiredResult(mainAI),
      detectedPriority: priority,
      priority: priority,
      routingConfidence: detection.confidence,
      changeScope: (raw.changeScope || "").trim() || "関連ファイルのみ",
      constraints: (raw.constraints || "").trim() || DEFAULT_CONSTRAINTS,
      references: (raw.references || "").trim() || DEFAULT_REFERENCES,
      mainScore: detection.mainScore
    };
  }

  function setDetailsOpen(open) {
    detailsOpen = !!open;
    if (!detailsPanel || !btnToggleDetails) return;
    detailsPanel.hidden = !detailsOpen;
    btnToggleDetails.setAttribute("aria-expanded", detailsOpen ? "true" : "false");
    btnToggleDetails.textContent = detailsOpen ? "詳細設定を閉じる" : "詳細設定を開く";
  }

  function clearValidation() {
    formError.hidden = true;
    formError.textContent = "";
    form.querySelectorAll(".form-group.is-invalid").forEach(function (el) {
      el.classList.remove("is-invalid");
    });
  }

  function showFormError(message, fieldIds) {
    clearValidation();
    formError.textContent = message;
    formError.hidden = false;
    (fieldIds || []).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentElement) el.parentElement.classList.add("is-invalid");
    });
    formError.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function validateRouterInput() {
    var projectId = document.getElementById("req-project").value;
    var content = document.getElementById("req-content").value.trim();

    if (!projectId) {
      showFormError("作業するプロジェクトを選択してください", ["req-project"]);
      return false;
    }
    if (!getProjectById(projectId)) {
      showFormError("作業するプロジェクトを選択してください", ["req-project"]);
      populateProjectSelect();
      return false;
    }
    if (!content) {
      showFormError("やりたいことを入力してください", ["req-content"]);
      return false;
    }
    clearValidation();
    return true;
  }

  function buildWorkItems(staffName) {
    var items = BASE_WORK_ITEMS.slice();
    var extras = STAFF_WORK_EXTRA[staffName] || [];
    extras.forEach(function (item) {
      if (items.indexOf(item) === -1) {
        items.splice(items.length - 1, 0, item);
      }
    });
    return items;
  }

  function generatePrompt(route) {
    var workItems = buildWorkItems(route.detectedMainAI || route.staff);
    var workLines = workItems.map(function (item, i) {
      return (i + 1) + ". " + item;
    }).join("\n");

    var checkLines = CHECK_ITEMS.map(function (item) {
      return "・" + item;
    }).join("\n");

    var supportLine = route.detectedSupportAI && route.detectedSupportAI !== "なし"
      ? route.detectedSupportAI
      : "なし";

    var folderName = route.projectLocalFolderName || "";
    var folderBlock = folderName
      ? folderName
      : "ローカルフォルダ名が未登録のため、作業前に対象フォルダを確認してください";

    var githubBlock = route.projectGithubUrl || "（未登録）";
    var publicBlock = route.projectPublicUrl || "（未登録）";

    var scopeRules = folderName
      ? [
          "・現在Cursorで開いているフォルダ名と、想定ローカルフォルダ名を確認する",
          "・一致しない場合は作業を開始せず報告する",
          "・対象プロジェクト以外のファイルを変更しない",
          "・別リポジトリへcommitやpushを行わない"
        ]
      : [
          "・ローカルフォルダ名が未登録のため、作業前に対象フォルダを確認してください",
          "・対象プロジェクト以外のファイルを変更しない",
          "・別リポジトリへcommitやpushを行わない"
        ];

    return [
      "【作業対象プロジェクト】",
      route.selectedProject || route.projectName || route.project,
      "",
      "【想定ローカルフォルダ】",
      folderBlock,
      "",
      "【GitHubリポジトリ】",
      githubBlock,
      "",
      "【公開サイト】",
      publicBlock,
      "",
      "【作業範囲の厳守】",
      scopeRules.join("\n"),
      "",
      "【プロジェクト名】",
      route.selectedProject || route.projectName || route.project,
      "",
      "【担当AI】",
      route.detectedMainAI || route.staff,
      "",
      "【補助AI】",
      supportLine,
      "",
      "【依頼タイトル】",
      route.title,
      "",
      "【目的】",
      route.detectedPurpose || route.purpose,
      "",
      "【現在の課題】",
      route.content,
      "",
      "【希望する完成状態】",
      route.detectedDesiredResult || route.desiredResult,
      "",
      "【変更してよい範囲】",
      route.changeScope,
      "",
      "【守ってほしい条件】",
      route.constraints,
      "",
      "【参考情報】",
      route.references,
      "",
      "【作業内容】",
      workLines,
      "",
      "【動作確認】",
      checkLines,
      "",
      "【重要】",
      "・既存ファイルを勝手に削除しない",
      "・既存機能を壊さない",
      "・不明点があっても、まず現在のコードを確認する",
      "・危険な変更や大規模変更は勝手に行わない",
      "・強制pushは使用しない",
      "・認証情報や秘密情報をコードに直接書かない",
      "・変更後はエラーの有無を確認する",
      "",
      "【完了報告】",
      "作業完了後、以下を日本語で報告する。",
      "",
      "・実施した内容",
      "・変更したファイル",
      "・確認した動作",
      "・残っている課題",
      "・次に推奨する作業"
    ].join("\n");
  }

  function showView(mode) {
    if (routerInputView) routerInputView.hidden = mode !== "input";
    if (routerResultView) routerResultView.hidden = mode !== "result";
    if (promptResult) promptResult.hidden = mode !== "prompt";
  }

  function renderRouteSummary(route) {
    document.getElementById("route-project-name").textContent = route.selectedProject || route.project;
    routeSummary.innerHTML =
      '<div class="route-summary__row">' +
        "<span>主担当AI</span><strong>" + escapeHtml(route.detectedMainAI) + "</strong>" +
      "</div>" +
      '<div class="route-summary__row">' +
        "<span>補助AI</span><strong>" + escapeHtml(route.detectedSupportAI || "なし") + "</strong>" +
      "</div>" +
      '<div class="route-summary__row">' +
        "<span>依頼タイトル</span><strong>" + escapeHtml(route.title) + "</strong>" +
      "</div>" +
      '<div class="route-summary__row">' +
        "<span>目的</span><strong>" + escapeHtml(route.detectedPurpose) + "</strong>" +
      "</div>" +
      '<div class="route-summary__row">' +
        "<span>希望する完成状態</span><strong>" + escapeHtml(route.detectedDesiredResult) + "</strong>" +
      "</div>" +
      '<div class="route-summary__row">' +
        "<span>優先度</span><strong>" + escapeHtml(route.detectedPriority) + "</strong>" +
      "</div>" +
      '<div class="route-summary__row">' +
        "<span>確信度</span>" +
        '<strong><span class="badge ' + confidenceBadgeClass(route.routingConfidence) + '">' +
          escapeHtml(route.routingConfidence) +
        "</span></strong>" +
      "</div>" +
      '<p class="route-summary__note">確信度は担当AI判定のみです。プロジェクトは手動選択のため判定対象外です。</p>';
  }

  function showGeneratedPrompt(route, text) {
    currentGeneratedPrompt = text;
    currentRoute = route;
    document.getElementById("prompt-project-name").textContent = route.selectedProject || route.project;
    promptResultText.textContent = text;
    showView("prompt");
    promptResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function copyText(text) {
    if (!text) return Promise.reject(new Error("empty"));
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text).catch(function () {
        return fallbackCopy(text);
      });
    }
    return fallbackCopy(text);
  }

  function fallbackCopy(text) {
    return new Promise(function (resolve, reject) {
      var textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.top = "0";
      textarea.style.left = "0";
      textarea.style.width = "1px";
      textarea.style.height = "1px";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(textarea);
      if (ok) resolve();
      else reject(new Error("copy failed"));
    });
  }

  function buildRequestObject(route, generatedPrompt) {
    var projectName = route.selectedProject || route.projectName || route.project;
    var mainAI = route.detectedMainAI || route.staff;
    var content = route.content;

    return {
      id: Date.now().toString(),
      project: projectName,
      selectedProject: projectName,
      projectId: route.projectId || "",
      projectName: projectName,
      projectIcon: route.projectIcon || "",
      projectLocalFolderName: route.projectLocalFolderName || "",
      projectGithubUrl: route.projectGithubUrl || "",
      projectPublicUrl: route.projectPublicUrl || "",
      staff: mainAI,
      aiStaff: mainAI,
      detectedMainAI: mainAI,
      supportAI: route.detectedSupportAI || "なし",
      detectedSupportAI: route.detectedSupportAI || "なし",
      title: route.title,
      content: content,
      request: content,
      purpose: route.detectedPurpose || route.purpose,
      detectedPurpose: route.detectedPurpose || route.purpose,
      desiredResult: route.detectedDesiredResult || route.desiredResult,
      detectedDesiredResult: route.detectedDesiredResult || route.desiredResult,
      changeScope: route.changeScope,
      constraints: route.constraints,
      references: route.references,
      priority: route.detectedPriority || route.priority,
      detectedPriority: route.detectedPriority || route.priority,
      routingConfidence: route.routingConfidence || "",
      generatedPrompt: generatedPrompt || "",
      createdAt: new Date().toISOString()
    };
  }

  function saveCurrentRequest() {
    if (!currentRoute) {
      showFormError("先にAIルーターを実行してください");
      showView("input");
      return false;
    }
    if (!(currentRoute.selectedProject || currentRoute.project)) {
      showFormError("作業するプロジェクトを選択してください", ["req-project"]);
      showView("input");
      return false;
    }

    var prompt = currentGeneratedPrompt || generatePrompt(currentRoute);
    currentGeneratedPrompt = prompt;
    var request = buildRequestObject(currentRoute, prompt);
    var requests = getRequests();
    requests.unshift(request);
    saveRequests(requests);
    closeModal();
    renderRecentRequests();
    showToast("依頼を保存しました");
    return true;
  }

  function renderPriorityTasks() {
    var container = document.getElementById("priority-tasks");
    container.innerHTML = priorityTasks.map(function (task) {
      return (
        '<article class="card">' +
          '<div class="card__header">' +
            '<h3 class="card__title">' + escapeHtml(task.title) + "</h3>" +
            '<span class="badge badge--progress">' + escapeHtml(task.status) + "</span>" +
          "</div>" +
          '<div class="progress">' +
            '<div class="progress__label"><span>進捗</span><span>' + task.progress + "%</span></div>" +
            '<div class="progress__bar" role="progressbar" aria-valuenow="' + task.progress + '" aria-valuemin="0" aria-valuemax="100">' +
              '<div class="progress__fill" style="width:' + task.progress + '%"></div>' +
            "</div>" +
          "</div>" +
        "</article>"
      );
    }).join("");
  }

  function renderStaff() {
    var container = document.getElementById("staff-list");
    if (!container) return;
    container.innerHTML = staffList.map(function (s) {
      return (
        '<article class="card staff-card">' +
          '<div class="staff-card__avatar" aria-hidden="true">' + s.icon + "</div>" +
          '<h3 class="staff-card__name">' + escapeHtml(s.name) + "</h3>" +
          '<p class="staff-card__role">' + escapeHtml(s.role) + "</p>" +
          '<button type="button" class="btn btn--primary btn--staff btn-request-staff" data-staff="' + escapeHtml(s.name) + '">依頼する</button>' +
        "</article>"
      );
    }).join("");

    container.querySelectorAll(".btn-request-staff").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openModal({ staff: btn.getAttribute("data-staff") });
      });
    });
  }

  function renderRecentRequests() {
    var container = document.getElementById("recent-requests");
    var emptyMsg = document.getElementById("empty-requests");
    var requests = getRequests();

    container.querySelectorAll(".request-card").forEach(function (el) {
      el.remove();
    });

    if (requests.length === 0) {
      if (emptyMsg) emptyMsg.style.display = "";
      return;
    }
    if (emptyMsg) emptyMsg.style.display = "none";

    requests.slice(0, 10).forEach(function (req) {
      var card = document.createElement("article");
      card.className = "card request-card";
      card.setAttribute("data-id", req.id);

      var hasPrompt = !!(req.generatedPrompt && req.generatedPrompt.trim());
      var preview = truncateText(req.content || req.request || "", 80);
      var mainAI = req.detectedMainAI || req.staff || req.aiStaff || "—";
      var projectName = req.projectName || req.selectedProject || req.project || "—";
      var icon = req.projectIcon ? req.projectIcon + " " : "";
      var confidence = req.routingConfidence
        ? ' <span class="badge ' + confidenceBadgeClass(req.routingConfidence) + '">確信度：' +
          escapeHtml(req.routingConfidence) + "</span>"
        : "";

      card.innerHTML =
        '<div class="request-card__top">' +
          '<h3 class="request-card__title">' + escapeHtml(req.title || "無題の依頼") + "</h3>" +
          '<time class="request-card__date">' + escapeHtml(formatDate(req.createdAt)) + "</time>" +
        "</div>" +
        '<p class="request-card__info">' +
          escapeHtml(icon + projectName) + " ／ " + escapeHtml(mainAI) +
          ' <span class="badge ' + priorityBadgeClass(req.priority) + '">' +
            escapeHtml(req.detectedPriority || req.priority || "通常") +
          "</span>" + confidence +
        "</p>" +
        '<p class="request-card__content">' + escapeHtml(preview || "（内容なし）") + "</p>" +
        '<div class="request-card__actions">' +
          '<button type="button" class="btn btn--secondary btn-show-prompt"' + (hasPrompt ? "" : " disabled") + ">指示書を表示</button>" +
          '<button type="button" class="btn btn--primary btn-copy-saved"' + (hasPrompt ? "" : " disabled") + ">コピー</button>" +
          '<button type="button" class="btn btn--danger btn-delete-request">削除</button>' +
        "</div>";

      container.appendChild(card);
    });
  }

  function findRequestById(id) {
    return getRequests().find(function (r) { return r.id === id; }) || null;
  }

  function openPromptView(promptText, title) {
    viewedPrompt = promptText || "";
    promptViewText.textContent = viewedPrompt;
    document.getElementById("prompt-view-title").textContent = title || "保存済み指示書";
    promptViewModal.classList.add("is-open");
    promptViewModal.setAttribute("aria-hidden", "false");
    syncBodyScroll();
  }

  function closePromptView() {
    promptViewModal.classList.remove("is-open");
    promptViewModal.setAttribute("aria-hidden", "true");
    viewedPrompt = "";
    syncBodyScroll();
  }

  function resetFormFields() {
    document.getElementById("req-scope").value = "";
    document.getElementById("req-priority").value = "";
    document.getElementById("req-constraints").value = "";
    document.getElementById("req-references").value = "";
    document.getElementById("req-main-ai").value = "";
    document.getElementById("req-support-ai").value = "";
  }

  function openModal(preset) {
    preset = preset || {};
    form.reset();
    clearValidation();
    currentGeneratedPrompt = "";
    currentRoute = null;
    setDetailsOpen(false);
    resetFormFields();
    showView("input");
    populateProjectSelect();

    var projectId = preset.projectId || "";
    if (!projectId && preset.project) {
      var byName = getProjectByName(preset.project);
      if (byName) projectId = byName.id;
    }
    if (projectId) {
      document.getElementById("req-project").value = projectId;
    }
    if (preset.staff) {
      document.getElementById("req-main-ai").value = preset.staff;
      setDetailsOpen(true);
    }
    if (preset.content) {
      document.getElementById("req-content").value = preset.content;
    }

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    syncBodyScroll();

    setTimeout(function () {
      var focusEl = document.getElementById("req-project");
      if (projectId) focusEl = document.getElementById("req-content");
      else if (preset.staff) focusEl = document.getElementById("req-project");
      if (focusEl) focusEl.focus();
    }, 300);
  }

  function closeModal() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    currentGeneratedPrompt = "";
    currentRoute = null;
    clearValidation();
    setDetailsOpen(false);
    showView("input");
    syncBodyScroll();
  }

  function handleRoute() {
    if (!validateRouterInput()) return;
    try {
      var raw = getRawFormValues();
      currentRoute = runRouter(raw);
      currentGeneratedPrompt = "";
      renderRouteSummary(currentRoute);
      showView("result");
      routerResultView.scrollIntoView({ behavior: "smooth", block: "nearest" });
      showToast("AI判定が完了しました");
    } catch (err) {
      showFormError(err.message || "判定に失敗しました", ["req-project"]);
    }
  }

  function handleBuildPrompt() {
    if (!currentRoute) {
      showFormError("先にAIルーターを実行してください");
      showView("input");
      return;
    }
    if (!(currentRoute.selectedProject || currentRoute.project)) {
      showFormError("作業するプロジェクトを選択してください", ["req-project"]);
      showView("input");
      return;
    }
    var prompt = generatePrompt(currentRoute);
    showGeneratedPrompt(currentRoute, prompt);
    showToast("指示書を生成しました");
  }

  function handleSubmit(e) {
    e.preventDefault();
    saveCurrentRequest();
  }

  function handleRecentClick(e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    var card = btn.closest(".request-card");
    if (!card) return;
    var id = card.getAttribute("data-id");
    var req = findRequestById(id);
    if (!req) {
      showToast("依頼が見つかりません");
      renderRecentRequests();
      return;
    }

    if (btn.classList.contains("btn-show-prompt")) {
      if (!req.generatedPrompt) {
        showToast("保存済みの指示書がありません");
        return;
      }
      openPromptView(req.generatedPrompt, req.title || "保存済み指示書");
      return;
    }

    if (btn.classList.contains("btn-copy-saved")) {
      if (!req.generatedPrompt) {
        showToast("保存済みの指示書がありません");
        return;
      }
      copyText(req.generatedPrompt).then(function () {
        showToast("指示書をコピーしました");
      }).catch(function () {
        showToast("コピーに失敗しました");
      });
      return;
    }

    if (btn.classList.contains("btn-delete-request")) {
      if (!window.confirm("この依頼を削除しますか？")) return;
      var requests = getRequests().filter(function (r) { return r.id !== id; });
      saveRequests(requests);
      renderRecentRequests();
      showToast("依頼を削除しました");
    }
  }

  /* ========== System Check ========== */
  var latestSystemCheckResults = [];
  var latestSystemCheckOverall = null;
  var latestSystemCheckAt = "";

  function openSystemCheck() {
    if (!systemCheckModal) return;
    systemCheckModal.classList.add("is-open");
    systemCheckModal.setAttribute("aria-hidden", "false");
    syncBodyScroll();
    renderVersionMeta();
    renderRuntimeErrorPanel();
    renderManualChecklist();
  }

  function closeSystemCheck() {
    if (!systemCheckModal) return;
    systemCheckModal.classList.remove("is-open");
    systemCheckModal.setAttribute("aria-hidden", "true");
    syncBodyScroll();
  }

  function makeCheckResult(id, title, status, message, details) {
    return {
      id: id,
      title: title,
      status: status || "unknown",
      message: message || "",
      details: details || ""
    };
  }

  function runCheckSafely(id, title, fn) {
    try {
      var result = fn();
      if (!result || typeof result !== "object") {
        return makeCheckResult(id, title, "fail", "チェック結果が不正です");
      }
      result.id = id;
      result.title = title;
      if (!result.status) result.status = "unknown";
      if (!result.message) result.message = "";
      if (!result.details) result.details = "";
      return result;
    } catch (e) {
      return makeCheckResult(
        id,
        title,
        "fail",
        "チェック実行中に例外が発生しました",
        sanitizeErrorText(e && e.message ? e.message : e)
      );
    }
  }

  function checkInitialization() {
    var status = window.smileAIStudioStatus || {};
    if (status.initialized) {
      return makeCheckResult(
        "init",
        "JavaScript初期化",
        "ok",
        "初期化が完了しています",
        "initializedAt: " + (status.initializedAt || "不明")
      );
    }
    return makeCheckResult(
      "init",
      "JavaScript初期化",
      "fail",
      "初期化が完了していません。JavaScriptエラーの可能性があります。"
    );
  }

  function checkRuntimeErrors() {
    var session = (window.smileAIStudioStatus && window.smileAIStudioStatus.sessionErrors) || [];
    var persisted = loadPersistedRuntimeErrors();
    var details = [];
    details.push("現在のページ読み込み後のエラー: " + session.length + "件");
    details.push("保存済みの過去エラー: " + persisted.length + "件");
    if (session.length) {
      details.push("--- 今回のセッション ---");
      session.slice(0, 5).forEach(function (err, i) {
        details.push((i + 1) + ". [" + err.type + "] " + err.message +
          (err.source ? " (" + err.source + ":" + err.line + ")" : ""));
      });
    }
    if (session.length > 0) {
      return makeCheckResult("runtime-errors", "直近の実行時エラー", "fail",
        "現在のページ読み込み後に " + session.length + "件のエラーがあります", details.join("\n"));
    }
    if (persisted.length > 0) {
      return makeCheckResult("runtime-errors", "直近の実行時エラー", "warn",
        "保存済みの過去エラーが " + persisted.length + "件あります（今回の読み込み後は0件）", details.join("\n"));
    }
    return makeCheckResult("runtime-errors", "直近の実行時エラー", "ok", "エラーは0件です", details.join("\n"));
  }

  function checkRequiredDom() {
    var required = [
      { id: "view-home", label: "ホーム画面" },
      { id: "view-projects", label: "プロジェクト画面" },
      { id: "view-more", label: "その他画面" },
      { id: "home-family-photo", label: "家族写真" },
      { id: "home-mission", label: "Mission折りたたみ" },
      { id: "home-daily-word", label: "今日のひとこと" },
      { id: "home-vision", label: "Vision折りたたみ" },
      { id: "home-schedule-list", label: "今日の予定" },
      { id: "home-top-priority", label: "今日の最優先" },
      { id: "home-goals-list", label: "現在の目標" },
      { id: "home-secretary-input", label: "ホーム秘書入力欄" },
      { id: "btn-home-ai-run", label: "ホームAIに任せる" },
      { id: "today-todos", label: "今日やること描画先" },
      { id: "priority-tasks", label: "今日の優先タスク描画先" },
      { id: "current-focus-panel", label: "現在開発中描画先" },
      { id: "release-home-panel", label: "リリース状況描画先" },
      { id: "btn-ai-request-hero", label: "AIへ依頼入口" },
      { id: "btn-ai-secretary", label: "AI秘書入口" },
      { id: "secretary-modal", label: "AI秘書モーダル" },
      { id: "cursor-handoff-modal", label: "Cursor連携モーダル" },
      { id: "btn-web-center", label: "Web管理センター入口" },
      { id: "web-center-modal", label: "Web管理センターモーダル" },
      { id: "btn-meeting-logs", label: "AI会議ログ入口" },
      { id: "meeting-logs-modal", label: "AI会議ログモーダル" },
      { id: "meeting-logs-list", label: "AI会議ログ一覧" },
      { id: "btn-line-command", label: "LINE司令塔入口" },
      { id: "line-command-modal", label: "LINE司令塔モーダル" },
      { id: "line-status-panel", label: "LINE接続状況パネル" },
      { id: "btn-line-send-test", label: "LINEテスト送信ボタン" },
      { id: "btn-cursor-report-import", label: "Cursor報告取り込みボタン" },
      { id: "meeting-import-view", label: "取り込みモーダル（貼り付け）" },
      { id: "cursor-report-input", label: "Cursor報告貼り付け欄" },
      { id: "btn-cursor-report-parse", label: "ログに変換ボタン" },
      { id: "meeting-import-preview-view", label: "取り込み確認画面" },
      { id: "btn-import-save", label: "会議ログへ保存ボタン" },
      { id: "project-list", label: "プロジェクト一覧描画先" },
      { id: "staff-list", label: "AIスタッフ一覧描画先" },
      { id: "recent-requests", label: "最近の依頼描画先" },
      { id: "iphone-settings", label: "iPhone運用設定描画先" },
      { id: "upcoming-panel", label: "今後追加予定描画先" },
      { id: "btn-new-request", label: "AI依頼ボタン" },
      { id: "btn-nav-home", label: "ホームナビ" },
      { id: "btn-nav-projects", label: "プロジェクトナビ" },
      { id: "btn-nav-more", label: "その他ナビ" },
      { id: "btn-manage-projects", label: "プロジェクト管理ボタン" },
      { id: "btn-add-project", label: "プロジェクト追加ボタン" },
      { id: "btn-system-check", label: "システムチェックボタン" },
      { id: "btn-release-center", label: "リリースセンターボタン" },
      { id: "request-modal", label: "依頼モーダル" },
      { id: "project-modal", label: "プロジェクト管理モーダル" },
      { id: "project-detail-modal", label: "プロジェクト詳細モーダル" },
      { id: "project-form-view", label: "プロジェクト登録フォーム" },
      { id: "system-check-modal", label: "システムチェックモーダル" },
      { id: "release-center-modal", label: "リリースセンターモーダル" },
      { id: "toast", label: "トースト" },
      { id: "req-project", label: "プロジェクト選択欄" },
      { id: "req-content", label: "やりたいこと入力欄" }
    ];
    var missing = [];
    required.forEach(function (item) {
      if (!document.getElementById(item.id)) missing.push(item.label + " (#" + item.id + ")");
    });
    var footer = document.querySelector("footer.footer.footer--quick");
    if (!footer) missing.push("クイックアクションフッター (footer.footer--quick)");

    if (missing.length) {
      return makeCheckResult("dom", "必須DOM", "fail",
        missing.length + "件の必須要素が見つかりません", missing.join("\n"));
    }
    return makeCheckResult("dom", "必須DOM", "ok", "必須DOM要素はすべて存在します",
      "確認数: " + (required.length + 1) + "件");
  }

  function checkLocalStorage() {
    var key = "smileAIStudio_healthCheck";
    var token = "health-" + Date.now();
    try {
      localStorage.setItem(key, token);
      var read = localStorage.getItem(key);
      localStorage.removeItem(key);
      var remains = localStorage.getItem(key);
      if (read !== token) {
        return makeCheckResult("localstorage", "localStorage読み書き", "fail", "書き込みと読み込みの値が一致しません");
      }
      if (remains !== null) {
        return makeCheckResult("localstorage", "localStorage読み書き", "fail", "テストキーの削除に失敗しました");
      }
      return makeCheckResult("localstorage", "localStorage読み書き", "ok", "保存・読み込み・削除が正常です");
    } catch (e) {
      try { localStorage.removeItem(key); } catch (err) { /* ignore */ }
      return makeCheckResult("localstorage", "localStorage読み書き", "fail",
        "localStorage操作で例外が発生しました", sanitizeErrorText(e.message || e));
    }
  }

  function checkProjects() {
    var projects = loadProjects();
    if (!Array.isArray(projects)) {
      return makeCheckResult("projects", "プロジェクトデータ", "fail", "プロジェクトデータが配列ではありません");
    }
    if (projects.length === 0) {
      return makeCheckResult("projects", "プロジェクトデータ", "fail", "プロジェクトが0件です");
    }

    var enabled = projects.filter(function (p) { return p.enabled; });
    var ids = {};
    var dup = [];
    var noId = 0;
    var noName = 0;
    var badGithub = 0;
    var badPublic = 0;
    var noFolder = 0;
    var sortIssues = 0;
    var normalizeFails = 0;

    projects.forEach(function (p) {
      try {
        normalizeProject(p);
      } catch (e) {
        normalizeFails += 1;
      }
      if (!p.id) noId += 1;
      if (!p.name) noName += 1;
      if (p.id) {
        if (ids[p.id]) dup.push(p.id);
        else ids[p.id] = true;
      }
      if (typeof p.sortOrder !== "number" || isNaN(p.sortOrder)) sortIssues += 1;
      if (typeof p.enabled !== "boolean") sortIssues += 1;
      if (p.githubUrl && !isValidHttpUrl(p.githubUrl)) badGithub += 1;
      if (p.publicUrl && !isValidHttpUrl(p.publicUrl)) badPublic += 1;
      if (!p.localFolderName) noFolder += 1;
    });

    var details = [
      "総数: " + projects.length + "件",
      "有効: " + enabled.length + "件",
      "ローカルフォルダ未登録: " + noFolder + "件"
    ];

    if (normalizeFails || noId || noName || dup.length || badGithub || badPublic) {
      var issues = [];
      if (normalizeFails) issues.push("normalizeProject失敗: " + normalizeFails);
      if (noId) issues.push("id欠損: " + noId);
      if (noName) issues.push("name欠損: " + noName);
      if (dup.length) issues.push("ID重複: " + dup.join(", "));
      if (badGithub) issues.push("GitHub URL形式不正: " + badGithub);
      if (badPublic) issues.push("公開URL形式不正: " + badPublic);
      return makeCheckResult("projects", "プロジェクトデータ", "fail",
        "プロジェクトデータに異常があります", details.concat(issues).join("\n"));
    }

    if (enabled.length === 0) {
      return makeCheckResult("projects", "プロジェクトデータ", "fail",
        "有効なプロジェクトがありません", details.join("\n"));
    }

    if (noFolder > 0 || sortIssues > 0) {
      return makeCheckResult("projects", "プロジェクトデータ", "warn",
        "プロジェクト" + projects.length + "件、有効" + enabled.length + "件（注意あり）",
        details.concat(sortIssues ? ["sortOrder/enabled型の注意: " + sortIssues] : []).join("\n"));
    }

    return makeCheckResult("projects", "プロジェクトデータ", "ok",
      "プロジェクト" + projects.length + "件、有効" + enabled.length + "件", details.join("\n"));
  }

  function checkAIStaff() {
    var names = staffList.map(function (s) { return s.name; });
    var expected = ["プログラマーAI", "デザイナーAI", "ライターAI", "テスターAI"];
    var missing = expected.filter(function (n) { return names.indexOf(n) === -1; });
    var empty = staffList.filter(function (s) { return !s.name; });
    var uniq = {};
    var dup = [];
    names.forEach(function (n) {
      if (uniq[n]) dup.push(n);
      else uniq[n] = true;
    });

    var routerNamesOk = expected.every(function (n) {
      return AI_NAMES.indexOf(n) !== -1;
    });

    var details = [
      "定義数: " + staffList.length + "名",
      "AIルーター側AI名: " + AI_NAMES.join(", ")
    ];

    if (staffList.length !== 4 || missing.length || empty.length || dup.length || !routerNamesOk) {
      return makeCheckResult("ai-staff", "AIスタッフ", "fail",
        "AIスタッフ定義に問題があります",
        details.concat([
          missing.length ? "不足: " + missing.join(", ") : "",
          empty.length ? "空名: " + empty.length : "",
          dup.length ? "重複: " + dup.join(", ") : "",
          !routerNamesOk ? "AIルーターの担当AI名と不一致" : ""
        ]).filter(Boolean).join("\n"));
    }

    return makeCheckResult("ai-staff", "AIスタッフ", "ok", "4名が利用可能です", details.join("\n"));
  }

  function checkRequests() {
    var requests = getRequests();
    if (!Array.isArray(requests)) {
      return makeCheckResult("requests", "最近の依頼データ", "fail", "依頼データが配列ではありません");
    }

    var legacy = 0;
    var normalizeFails = 0;
    requests.forEach(function (req) {
      try {
        var n = normalizeRequest(req);
        if (!n) normalizeFails += 1;
        else if (!req.projectId || !req.generatedPrompt) legacy += 1;
      } catch (e) {
        normalizeFails += 1;
      }
    });

    if (normalizeFails) {
      return makeCheckResult("requests", "最近の依頼データ", "fail",
        "正規化に失敗した依頼が " + normalizeFails + "件あります",
        "総数: " + requests.length);
    }

    var msg = "依頼データ" + requests.length + "件";
    if (legacy) msg += "、旧形式" + legacy + "件を互換表示";
    return makeCheckResult("requests", "最近の依頼データ", "ok", msg);
  }

  function checkRequiredButtons() {
    var buttons = [
      { id: "btn-new-request", label: "新しい依頼を作る", action: "openRequestModal" },
      { id: "btn-manage-projects", label: "プロジェクト管理", action: "openProjectManager" },
      { id: "btn-add-project", label: "プロジェクト追加", action: "openProjectCreate" },
      { id: "btn-system-check", label: "システムチェック", action: "openSystemCheck" },
      { id: "btn-release-center", label: "リリースセンター", action: "openReleaseCenter" },
      { id: "btn-route", label: "AIルーターを実行", action: "runRouter" },
      { id: "btn-build-prompt", label: "指示書を作る", action: "buildPrompt" },
      { id: "btn-copy-prompt", label: "コピーする", action: "copyPrompt" },
      { id: "btn-save-from-result", label: "保存する", action: "saveRequest" },
      { id: "modal-cancel", label: "閉じる", action: "closeRequestModal" }
    ];

    var missing = [];
    var disabled = [];
    var unregistered = [];
    var actions = (window.smileAIStudioStatus && window.smileAIStudioStatus.registeredActions) || {};

    buttons.forEach(function (b) {
      var el = document.getElementById(b.id);
      if (!el) {
        missing.push(b.label + " (#" + b.id + ")");
        return;
      }
      if (el.disabled) disabled.push(b.label);
      if (b.action && !actions[b.action]) unregistered.push(b.label + " (" + b.action + ")");
    });

    if (missing.length) {
      return makeCheckResult("buttons", "必須ボタン", "fail",
        "不足ボタンがあります", missing.join("\n"));
    }
    if (disabled.length) {
      return makeCheckResult("buttons", "必須ボタン", "warn",
        "disabled状態のボタンがあります", disabled.join("\n"));
    }
    if (unregistered.length) {
      return makeCheckResult("buttons", "必須ボタン", "warn",
        "イベント登録が確認できないボタンがあります", unregistered.join("\n"));
    }
    return makeCheckResult("buttons", "必須ボタン", "ok", "主要ボタンは存在し、イベント登録も確認できました");
  }

  function checkModals() {
    var fails = [];
    var warns = [];
    var notes = [];

    function hasCloseControl(modalEl, preferredIds) {
      if (!modalEl) return false;
      var i;
      for (i = 0; i < preferredIds.length; i += 1) {
        if (document.getElementById(preferredIds[i])) return true;
      }
      if (modalEl.querySelector(".modal__close, [data-modal-close], [aria-label='閉じる']")) {
        return true;
      }
      return false;
    }

    function checkOne(spec) {
      var el = document.getElementById(spec.id);
      if (!el) {
        fails.push(spec.label + "が見つかりません（#" + spec.id + "）");
        return;
      }

      var isOpen = el.classList.contains("is-open");
      var ariaHidden = el.getAttribute("aria-hidden");

      // システムチェック実行中は、このモーダル自身が開いていて正常
      if (isOpen && !spec.allowOpenDuringCheck) {
        fails.push(spec.label + "が初期状態で開いています（#" + spec.id + "）");
      } else if (isOpen && spec.allowOpenDuringCheck) {
        notes.push(spec.label + "はチェック実行中のため開いています（正常）");
      }

      if (ariaHidden == null || ariaHidden === "") {
        warns.push(spec.label + "にaria-hiddenがありません（開閉動作への影響は軽微）");
      } else if (ariaHidden !== "true" && ariaHidden !== "false") {
        warns.push(spec.label + "のaria-hidden値が不正です（" + ariaHidden + "）");
      } else if (ariaHidden === "false" && !isOpen && !spec.allowOpenDuringCheck) {
        warns.push(spec.label + "のaria-hiddenがfalseなのに非表示です（不整合の可能性）");
      } else if (ariaHidden === "true" && isOpen && !spec.allowOpenDuringCheck) {
        warns.push(spec.label + "のaria-hiddenがtrueなのに表示中です（不整合の可能性）");
      }

      if (!hasCloseControl(el, spec.closeIds || [])) {
        fails.push(spec.label + "に閉じる操作がありません");
      }

      var openOk = false;
      if (typeof spec.openCheck === "function") {
        openOk = !!spec.openCheck();
      } else if (spec.openAction) {
        openOk = !!(window.smileAIStudioStatus &&
          window.smileAIStudioStatus.registeredActions &&
          window.smileAIStudioStatus.registeredActions[spec.openAction]);
      }
      if (!openOk) {
        fails.push(spec.label + "の開く処理（関数または登録済みアクション）が見つかりません");
      }

      if (spec.closeCheck && typeof spec.closeCheck === "function" && !spec.closeCheck()) {
        fails.push(spec.label + "の閉じる関数が見つかりません");
      }

      if (spec.formId && !document.getElementById(spec.formId)) {
        fails.push(spec.label + "内の必要フォームが見つかりません（#" + spec.formId + "）");
      }

      notes.push(spec.label + "：DOM確認OK");
    }

    checkOne({
      id: "request-modal",
      label: "依頼モーダル",
      closeIds: ["modal-close", "modal-cancel", "modal-cancel-result"],
      openAction: "openRequestModal",
      openCheck: function () {
        return typeof openModal === "function" ||
          !!(window.smileAIStudioStatus.registeredActions || {}).openRequestModal;
      },
      closeCheck: function () { return typeof closeModal === "function"; },
      formId: "request-form",
      allowOpenDuringCheck: false
    });

    checkOne({
      id: "project-modal",
      label: "プロジェクト管理モーダル",
      closeIds: ["project-modal-close", "btn-cancel-project-form"],
      openAction: "openProjectManager",
      openCheck: function () {
        return typeof openProjectModal === "function" ||
          !!(window.smileAIStudioStatus.registeredActions || {}).openProjectManager;
      },
      closeCheck: function () { return typeof closeProjectModal === "function"; },
      formId: "project-form-view",
      allowOpenDuringCheck: false
    });

    checkOne({
      id: "prompt-view-modal",
      label: "指示書表示モーダル",
      closeIds: ["prompt-view-close", "prompt-view-cancel"],
      openCheck: function () { return typeof openPromptView === "function"; },
      closeCheck: function () { return typeof closePromptView === "function"; },
      allowOpenDuringCheck: false
    });

    checkOne({
      id: "system-check-modal",
      label: "システムチェックモーダル",
      closeIds: ["system-check-close", "btn-close-system-check"],
      openAction: "openSystemCheck",
      openCheck: function () {
        return typeof openSystemCheck === "function" ||
          !!(window.smileAIStudioStatus.registeredActions || {}).openSystemCheck;
      },
      closeCheck: function () { return typeof closeSystemCheck === "function"; },
      allowOpenDuringCheck: true
    });

    checkOne({
      id: "release-center-modal",
      label: "リリースセンターモーダル",
      closeIds: ["release-center-close", "btn-release-close"],
      openAction: "openReleaseCenter",
      openCheck: function () {
        return typeof openReleaseCenter === "function" ||
          !!(window.smileAIStudioStatus.registeredActions || {}).openReleaseCenter;
      },
      closeCheck: function () { return typeof closeReleaseCenter === "function"; },
      allowOpenDuringCheck: true
    });

    checkOne({
      id: "project-detail-modal",
      label: "プロジェクト詳細モーダル",
      closeIds: ["project-detail-close", "btn-detail-close"],
      openCheck: function () { return typeof openProjectDetail === "function"; },
      closeCheck: function () { return typeof closeProjectDetail === "function"; },
      allowOpenDuringCheck: false
    });

    checkOne({
      id: "web-center-modal",
      label: "Web管理センターモーダル",
      closeIds: ["web-center-close", "btn-web-center-close-menu"],
      openAction: "openWebCenter",
      openCheck: function () {
        return typeof openWebCenter === "function" ||
          !!(window.smileAIStudioStatus.registeredActions || {}).openWebCenter;
      },
      closeCheck: function () { return typeof closeWebCenter === "function"; },
      allowOpenDuringCheck: false
    });

    checkOne({
      id: "meeting-logs-modal",
      label: "AI会議ログモーダル",
      closeIds: ["meeting-logs-close", "btn-meeting-back-list", "btn-meeting-detail-back"],
      openAction: "openMeetingLogs",
      openCheck: function () {
        return typeof openMeetingLogs === "function" ||
          !!(window.smileAIStudioStatus.registeredActions || {}).openMeetingLogs;
      },
      closeCheck: function () { return typeof closeMeetingLogs === "function"; },
      allowOpenDuringCheck: false
    });

    checkOne({
      id: "line-command-modal",
      label: "LINE司令塔モーダル",
      closeIds: ["line-command-close", "btn-line-command-close"],
      openAction: "openLineCommand",
      openCheck: function () {
        return typeof openLineCommand === "function" ||
          !!(window.smileAIStudioStatus.registeredActions || {}).openLineCommand;
      },
      closeCheck: function () { return typeof closeLineCommand === "function"; },
      allowOpenDuringCheck: false
    });

    checkOne({
      id: "secretary-modal",
      label: "AI秘書モーダル",
      closeIds: ["secretary-close", "btn-secretary-close-result"],
      openAction: "openAiSecretary",
      openCheck: function () {
        return typeof openAiSecretary === "function" ||
          !!(window.smileAIStudioStatus.registeredActions || {}).openAiSecretary;
      },
      closeCheck: function () { return typeof closeAiSecretary === "function"; },
      allowOpenDuringCheck: false
    });

    checkOne({
      id: "cursor-handoff-modal",
      label: "Cursor連携モーダル",
      closeIds: ["cursor-handoff-close", "btn-cursor-handoff-close"],
      openCheck: function () {
        return typeof openCursorHandoffModal === "function" ||
          !!(window.smileAIStudioStatus.registeredActions || {}).openCursorHandoff;
      },
      closeCheck: function () { return typeof closeCursorHandoffModal === "function"; },
      allowOpenDuringCheck: false
    });

    var details = [];
    if (fails.length) details.push("【異常】\n・" + fails.join("\n・"));
    if (warns.length) details.push("【注意】\n・" + warns.join("\n・"));
    if (notes.length) details.push("【確認メモ】\n・" + notes.join("\n・"));

    if (fails.length) {
      return makeCheckResult(
        "modals",
        "モーダル",
        "fail",
        fails[0] + (fails.length > 1 ? " ほか" + (fails.length - 1) + "件" : ""),
        details.join("\n\n")
      );
    }

    if (warns.length) {
      return makeCheckResult(
        "modals",
        "モーダル",
        "warn",
        "開閉動作に影響しない軽微な不足があります（" + warns.length + "件）",
        details.join("\n\n")
      );
    }

    return makeCheckResult(
      "modals",
      "モーダル",
      "ok",
      "主要モーダルの存在・閉じる操作・開閉処理を確認しました",
      details.join("\n\n")
    );
  }

  function checkProjectSelect() {
    var select = document.getElementById("req-project");
    if (!select) {
      return makeCheckResult("project-select", "プロジェクト選択欄", "fail", "選択欄がありません");
    }
    populateProjectSelect(select.value || "");
    var options = Array.prototype.slice.call(select.options || []);
    var values = options.map(function (o) { return o.value; }).filter(Boolean);
    var enabled = getEnabledProjects();
    var details = [
      "選択肢（空以外）: " + values.length + "件",
      "有効プロジェクト: " + enabled.length + "件"
    ];

    if (values.length === 0) {
      return makeCheckResult("project-select", "プロジェクト選択欄", "fail",
        "有効な選択肢がありません", details.join("\n"));
    }

    var dup = {};
    var hasDup = false;
    values.forEach(function (v) {
      if (dup[v]) hasDup = true;
      dup[v] = true;
    });
    if (hasDup) {
      return makeCheckResult("project-select", "プロジェクト選択欄", "fail",
        "選択肢のIDが重複しています", details.join("\n"));
    }

    var enabledIds = enabled.map(function (p) { return p.id; });
    var unexpected = values.filter(function (v) { return enabledIds.indexOf(v) === -1; });
    var missing = enabledIds.filter(function (id) { return values.indexOf(id) === -1; });
    if (unexpected.length || missing.length) {
      return makeCheckResult("project-select", "プロジェクト選択欄", "warn",
        "有効プロジェクトと選択肢に差があります",
        details.concat([
          unexpected.length ? "余分な選択肢: " + unexpected.join(", ") : "",
          missing.length ? "未反映: " + missing.join(", ") : ""
        ]).filter(Boolean).join("\n"));
    }

    if (select.value) {
      return makeCheckResult("project-select", "プロジェクト選択欄", "ok",
        "有効プロジェクトが選択肢に反映されています（現在選択あり）", details.join("\n"));
    }
    return makeCheckResult("project-select", "プロジェクト選択欄", "ok",
      "有効プロジェクトが選択肢に反映され、手動選択必須を維持しています", details.join("\n"));
  }

  function checkProjectUrls() {
    var projects = loadProjects();
    var github = 0;
    var publicUrl = 0;
    var folder = 0;
    var badGithub = 0;
    var badPublic = 0;
    projects.forEach(function (p) {
      if (p.githubUrl) {
        github += 1;
        if (!isValidHttpUrl(p.githubUrl)) badGithub += 1;
      }
      if (p.publicUrl) {
        publicUrl += 1;
        if (!isValidHttpUrl(p.publicUrl)) badPublic += 1;
      }
      if (p.localFolderName) folder += 1;
    });

    var details = [
      "【GitHub URL】登録済み: " + github + "件 / 未登録: " + (projects.length - github) + "件 / 形式不正: " + badGithub + "件",
      "【公開URL】登録済み: " + publicUrl + "件 / 未登録: " + (projects.length - publicUrl) + "件 / 形式不正: " + badPublic + "件",
      "【ローカルフォルダ】登録済み: " + folder + "件 / 未登録: " + (projects.length - folder) + "件",
      "",
      "※ これは登録有無とURL形式の確認です。GitHubやNetlifyへの実接続・デプロイ成功は確認していません。"
    ].join("\n");

    if (badGithub || badPublic) {
      return makeCheckResult("urls", "URL登録チェック", "fail",
        "URL形式が不正な登録があります", details);
    }
    if (github === 0 && publicUrl === 0) {
      return makeCheckResult("urls", "URL登録チェック", "warn",
        "GitHub URL / 公開URLが未登録です（接続確認ではありません）", details);
    }
    if ((projects.length - github) > 0 || (projects.length - publicUrl) > 0) {
      return makeCheckResult("urls", "URL登録チェック", "warn",
        "一部プロジェクトでURL未登録があります（接続確認ではありません）", details);
    }
    return makeCheckResult("urls", "URL登録チェック", "ok",
      "登録URLの形式は問題ありません（接続確認ではありません）", details);
  }

  function checkBasicRendering() {
    var priorityCount = document.querySelectorAll("#priority-tasks .card").length;
    var projectCount = document.querySelectorAll("#project-list .project-card, #project-list .card").length;
    var staffCount = document.querySelectorAll("#staff-list .staff-card").length;
    var recentArea = document.getElementById("recent-requests");
    var enabledProjects = getEnabledProjects().length;
    var details = [
      "優先タスクカード: " + priorityCount,
      "プロジェクトカード: " + projectCount + "（有効プロジェクト: " + enabledProjects + "）",
      "AIスタッフカード: " + staffCount,
      "最近の依頼エリア: " + (recentArea ? "あり" : "なし")
    ];

    var issues = [];
    if (priorityCount !== 3) issues.push("優先タスクは3件表示であるべきです（現在" + priorityCount + "件）");
    if (enabledProjects > 0 && projectCount === 0) issues.push("有効プロジェクトがあるのにカードが0件です");
    if (staffList.length > 0 && staffCount === 0) issues.push("AIスタッフ定義があるのにカードが0件です");
    if (!recentArea) issues.push("最近の依頼エリアがありません");

    if (issues.length) {
      return makeCheckResult("rendering", "基本表示", "fail",
        "画面描画に問題があります", details.concat(issues).join("\n"));
    }
    return makeCheckResult("rendering", "基本表示", "ok",
      "主要セクションの表示件数は妥当です", details.join("\n"));
  }

  function checkDataCompatibility() {
    var sampleRequests = [
      { id: "legacy-1", project: "GiftCanvas", staff: "プログラマーAI", title: "旧依頼", content: "内容", priority: "中", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "legacy-2", project: "イベント相談LP", aiStaff: "ライターAI", request: "LP改善", priority: "高", createdAt: "2026-01-02T00:00:00.000Z" },
      { id: "legacy-3", selectedProject: "Smile AI Studio", detectedMainAI: "テスターAI", content: "テスト", generatedPrompt: "", createdAt: "2026-01-03T00:00:00.000Z" },
      null,
      { id: "broken", project: null, title: "", content: "" }
    ];
    var sampleProjects = [
      { name: "旧形式", desc: "説明のみ" },
      { id: "x", name: "欠損あり", enabled: "yes" },
      { id: "y", name: "URL不正", githubUrl: "ftp://example.com", publicUrl: "notaurl" }
    ];

    var reqFails = 0;
    sampleRequests.forEach(function (sample) {
      try {
        normalizeRequest(sample);
      } catch (e) {
        reqFails += 1;
      }
    });

    var projFails = 0;
    sampleProjects.forEach(function (sample, i) {
      try {
        normalizeProject(sample, i);
      } catch (e) {
        projFails += 1;
      }
    });

    if (reqFails || projFails) {
      return makeCheckResult("compat", "データ互換性", "fail",
        "正規化処理で例外が発生しました",
        "依頼サンプル失敗: " + reqFails + " / プロジェクトサンプル失敗: " + projFails);
    }
    return makeCheckResult("compat", "データ互換性", "ok",
      "旧形式・欠損サンプルでも正規化例外は発生しませんでした",
      "依頼サンプル: " + sampleRequests.length + " / プロジェクトサンプル: " + sampleProjects.length + "（localStorage未保存）");
  }

  function checkLineCommandDom() {
    var ids = [
      "btn-line-command",
      "line-command-modal",
      "line-status-panel",
      "line-morning-preview",
      "line-history-panel",
      "btn-line-send-test",
      "btn-line-refresh"
    ];
    var missing = ids.filter(function (id) { return !document.getElementById(id); });
    if (missing.length) {
      return makeCheckResult("line-dom", "LINE管理画面DOM", "fail",
        "LINE司令塔の必須要素が不足しています", missing.join(", "));
    }
    return makeCheckResult("line-dom", "LINE管理画面DOM", "ok",
      "LINE司令塔の管理画面DOMは揃っています", "確認: " + ids.length + "件");
  }

  function checkLineApiEndpoints() {
    var required = ["status", "history", "projects", "meetingLogs", "sendTest"];
    var missing = required.filter(function (k) {
      return !LINE_API[k] || String(LINE_API[k]).indexOf("/.netlify/functions/") !== 0;
    });
    if (missing.length) {
      return makeCheckResult("line-api-def", "LINE APIエンドポイント定義", "fail",
        "APIパス定義が不正です", missing.join(", "));
    }
    var details = required.map(function (k) {
      return k + ": " + LINE_API[k];
    }).join("\n");
    return makeCheckResult("line-api-def", "LINE APIエンドポイント定義", "ok",
      "Netlify Functions のパス定義を確認しました", details);
  }

  function checkLineEnvStatus() {
    if (!lineStatusCache) {
      return makeCheckResult("line-env", "LINE環境変数設定状況", "unknown",
        "未確認（API未接続のため）",
        "ローカルで file:// 表示中、または Functions 未起動の可能性があります。本体公開禁止にはしません。");
    }
    var secrets = lineStatusCache.secrets || {};
    var lines = Object.keys(secrets).map(function (k) {
      return k + ": " + secrets[k];
    });
    if (lineStatusCache.configured) {
      return makeCheckResult("line-env", "LINE環境変数設定状況", "ok",
        "必須環境変数は設定済みと報告されています", lines.join("\n"));
    }
    return makeCheckResult("line-env", "LINE環境変数設定状況", "warn",
      "LINE連携の環境変数が未設定です（本体は公開可）",
      (lineStatusCache.missing || []).join(", ") || lines.join("\n"));
  }

  function checkLineStorageStatus() {
    if (!lineApiConnected) {
      return makeCheckResult("line-storage", "LINEストレージ接続状況", "unknown",
        "未確認（API未接続）",
        "Netlify Blobs / ローカル .data の接続は Functions 起動後に確認できます。");
    }
    if (lineStatusCache && lineStatusCache.ok) {
      return makeCheckResult("line-storage", "LINEストレージ接続状況", "ok",
        "ステータスAPI経由でストレージ応答を確認しました",
        "todayPriority / conversationStage を取得可能");
    }
    return makeCheckResult("line-storage", "LINEストレージ接続状況", "warn",
      "ストレージ応答を確認できませんでした", "LINE司令塔画面で再読み込みしてください");
  }

  function checkLineWebhookMeta() {
    if (!lineStatusCache) {
      return makeCheckResult("line-webhook", "最終Webhook受信", "unknown",
        "未確認", "API未接続のため最終受信時刻は不明です");
    }
    if (lineStatusCache.lastWebhookAt) {
      return makeCheckResult("line-webhook", "最終Webhook受信", "ok",
        "最終受信: " + lineStatusCache.lastWebhookAt, "");
    }
    return makeCheckResult("line-webhook", "最終Webhook受信", "warn",
      "まだWebhook受信記録がありません", "LINE Webhook設定後に更新されます");
  }

  function checkLineLastSend() {
    if (!lineStatusCache) {
      return makeCheckResult("line-send", "最終メッセージ送信", "unknown",
        "未確認", "API未接続のため最終送信時刻は不明です");
    }
    var last = lineStatusCache.lastTestPushAt || lineStatusCache.lastMorningPushAt || "";
    if (last) {
      return makeCheckResult("line-send", "最終メッセージ送信", "ok",
        "最終送信: " + last,
        "テスト: " + (lineStatusCache.lastTestPushAt || "—") +
        "\n朝送信: " + (lineStatusCache.lastMorningPushAt || "—"));
    }
    return makeCheckResult("line-send", "最終メッセージ送信", "warn",
      "まだ送信記録がありません", "テスト送信または朝メッセージ後に更新されます");
  }

  function checkLineAdminId() {
    if (!lineStatusCache || !lineStatusCache.secrets) {
      return makeCheckResult("line-admin", "管理者ID設定", "unknown",
        "未確認", "API未接続のため管理者IDの登録有無は不明です");
    }
    var admin = lineStatusCache.secrets.LINE_ADMIN_USER_ID;
    if (admin === "設定済み") {
      return makeCheckResult("line-admin", "管理者ID設定", "ok",
        "管理者ユーザーIDは設定済みです", "値そのものは表示しません");
    }
    return makeCheckResult("line-admin", "管理者ID設定", "warn",
      "管理者ユーザーIDが未設定です（本体は公開可）",
      "Netlify環境変数 LINE_ADMIN_USER_ID を設定してください");
  }

  function checkLineScheduleConfig() {
    if (!lineStatusCache) {
      return makeCheckResult("line-schedule", "Scheduled Function設定", "unknown",
        "未確認",
        "netlify.toml では line-send-morning を UTC 23:00（JST 08:00）に設定済み。本番反映はNetlify側で確認。");
    }
    return makeCheckResult("line-schedule", "Scheduled Function設定", "ok",
      "スケジュール定義を確認しました",
      lineStatusCache.schedule || "0 23 * * * (UTC) = 日本時間 08:00");
  }

  function calculateOverallHealth(results) {
    var counts = { ok: 0, warn: 0, fail: 0, unknown: 0 };
    results.forEach(function (r) {
      if (counts[r.status] == null) counts.unknown += 1;
      else counts[r.status] += 1;
    });

    var level = "ok";
    var label = "公開準備OK";
    var advice = "異常はありません。注意がある場合は内容を確認してください。";
    if (counts.fail > 0) {
      level = "fail";
      label = "修正が必要";
      advice = "GitHubへpushする前に異常項目を修正してください。";
    } else if (counts.warn >= 3) {
      level = "warn";
      label = "要確認";
      advice = "異常はありませんが、注意が複数あります。公開前に確認してください。";
    } else if (counts.warn > 0) {
      level = "warn";
      label = "公開準備OK（注意あり）";
      advice = "異常0件です。注意項目のみ確認してください。";
    }

    return {
      level: level,
      label: label,
      advice: advice,
      counts: counts
    };
  }

  function statusLabel(status) {
    if (status === "ok") return "正常";
    if (status === "warn") return "注意";
    if (status === "fail") return "異常";
    return "未確認";
  }

  function statusEmoji(status) {
    if (status === "ok") return "🟢";
    if (status === "warn") return "🟡";
    if (status === "fail") return "🔴";
    return "⚪";
  }

  function renderVersionMeta() {
    var el = document.getElementById("system-check-meta");
    if (!el) return;
    var projects = [];
    var requests = [];
    try { projects = loadProjects(); } catch (e) { projects = []; }
    try { requests = getRequests(); } catch (e) { requests = []; }
    var used = 0;
    try {
      used = JSON.stringify(localStorage).length;
    } catch (e) {
      used = 0;
    }
    el.textContent =
      "アプリ: " + APP_INFO.name + "\n" +
      "バージョン: " + APP_INFO.version + "\n" +
      "ビルド: " + APP_INFO.build + "\n" +
      "最終更新日: " + APP_INFO.updatedAt + "\n" +
      "現在のURL: " + (location.href || "") + "\n" +
      "localStorage概算使用量: " + used + " 文字\n" +
      "登録プロジェクト数: " + projects.length + "\n" +
      "保存依頼数: " + requests.length;
  }

  function renderSystemCheckResults(results, overall) {
    var overallEl = document.getElementById("system-check-overall");
    var listEl = document.getElementById("system-check-results");
    if (!overallEl || !listEl) return;

    overallEl.hidden = false;
    overallEl.className = "system-check__overall is-" + overall.level;
    var failItems = results.filter(function (r) { return r.status === "fail"; });
    overallEl.innerHTML =
      '<div class="system-check__overall-title">' +
        escapeHtml(statusEmoji(overall.level) + " 総合結果：" + overall.label) +
      "</div>" +
      '<div class="system-check__overall-counts">' +
        escapeHtml(
          "異常：" + overall.counts.fail + "件 / 注意：" + overall.counts.warn +
          "件 / 正常：" + overall.counts.ok + "件 / 未確認：" + overall.counts.unknown + "件"
        ) +
      "</div>" +
      '<div class="system-check__overall-issues">' +
        escapeHtml(overall.advice) +
        (failItems.length
          ? "\n異常内容：\n・" + failItems.map(function (f) { return f.message; }).join("\n・")
          : "") +
      "</div>";

    listEl.innerHTML = results.map(function (r, index) {
      var hasDetails = !!(r.details && String(r.details).trim());
      return (
        '<article class="check-card is-' + escapeHtml(r.status) + '">' +
          '<button type="button" class="check-card__summary" data-check-toggle="' + index + '" aria-expanded="false">' +
            '<div>' +
              '<div class="check-card__title">' + escapeHtml(statusEmoji(r.status) + " " + r.title) + "</div>" +
              '<div class="check-card__message">' + escapeHtml(r.message) + "</div>" +
            "</div>" +
            '<span class="check-card__badge is-' + escapeHtml(r.status) + '">' +
              escapeHtml(statusLabel(r.status)) +
            "</span>" +
          "</button>" +
          (hasDetails
            ? '<div class="check-card__details" id="check-details-' + index + '" hidden>' +
                escapeHtml(r.details) +
              "</div>"
            : "") +
        "</article>"
      );
    }).join("");
  }

  function renderRuntimeErrorPanel() {
    var el = document.getElementById("system-check-errors");
    if (!el) return;
    var session = (window.smileAIStudioStatus && window.smileAIStudioStatus.sessionErrors) || [];
    var persisted = loadPersistedRuntimeErrors();
    var html = '<div class="error-list">';
    html += "<p>現在のページ読み込み後: " + escapeHtml(String(session.length)) + "件 / 保存済み過去エラー: " +
      escapeHtml(String(persisted.length)) + "件</p>";

    if (!session.length && !persisted.length) {
      html += "<p>エラー履歴はありません。</p></div>";
      el.innerHTML = html;
      return;
    }

    if (session.length) {
      html += "<p><strong>今回のセッション</strong></p>";
      session.slice(0, 10).forEach(function (err) {
        html += '<div class="error-list__item">' +
          escapeHtml("[" + err.type + "] " + err.message) + "<br>" +
          escapeHtml((err.source || "source不明") + ":" + err.line + ":" + err.column + " / " + (err.at || "")) +
          "</div>";
      });
    }
    if (persisted.length) {
      html += "<p><strong>保存済みの過去エラー</strong></p>";
      persisted.slice(0, 10).forEach(function (err) {
        html += '<div class="error-list__item">' +
          escapeHtml("[" + err.type + "] " + err.message) + "<br>" +
          escapeHtml((err.source || "source不明") + ":" + err.line + ":" + err.column + " / " + (err.at || "")) +
          "</div>";
      });
    }
    html += "</div>";
    el.innerHTML = html;
  }

  function loadManualChecklist() {
    try {
      var raw = localStorage.getItem(MANUAL_CHECKLIST_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveManualChecklist(map) {
    try {
      localStorage.setItem(MANUAL_CHECKLIST_KEY, JSON.stringify(map || {}));
    } catch (e) { /* ignore */ }
  }

  function resetManualChecklist() {
    try {
      localStorage.removeItem(MANUAL_CHECKLIST_KEY);
    } catch (e) { /* ignore */ }
    renderManualChecklist();
    showToast("手動チェックをリセットしました");
  }

  function renderManualChecklist() {
    var el = document.getElementById("manual-checklist");
    if (!el) return;
    var map = loadManualChecklist();
    el.innerHTML = MANUAL_CHECK_ITEMS.map(function (item) {
      var checked = !!map[item.id];
      return (
        '<label class="manual-checklist__item">' +
          '<input type="checkbox" data-manual-check="' + escapeHtml(item.id) + '"' + (checked ? " checked" : "") + ">" +
          "<span>" + escapeHtml(item.label) + "</span>" +
        "</label>"
      );
    }).join("");
  }

  function runAllSystemChecks(options) {
    options = options || {};
    latestSystemCheckAt = new Date().toISOString();
    var checks = [
      ["init", "JavaScript初期化", checkInitialization],
      ["runtime-errors", "直近の実行時エラー", checkRuntimeErrors],
      ["dom", "必須DOM", checkRequiredDom],
      ["localstorage", "localStorage読み書き", checkLocalStorage],
      ["projects", "プロジェクトデータ", checkProjects],
      ["ai-staff", "AIスタッフ", checkAIStaff],
      ["requests", "最近の依頼データ", checkRequests],
      ["buttons", "必須ボタン", checkRequiredButtons],
      ["modals", "モーダル", checkModals],
      ["project-select", "プロジェクト選択欄", checkProjectSelect],
      ["urls", "URL登録チェック", checkProjectUrls],
      ["rendering", "基本表示", checkBasicRendering],
      ["compat", "データ互換性", checkDataCompatibility],
      ["line-dom", "LINE管理画面DOM", checkLineCommandDom],
      ["line-api-def", "LINE APIエンドポイント定義", checkLineApiEndpoints],
      ["line-env", "LINE環境変数設定状況", checkLineEnvStatus],
      ["line-storage", "LINEストレージ接続状況", checkLineStorageStatus],
      ["line-webhook", "最終Webhook受信", checkLineWebhookMeta],
      ["line-send", "最終メッセージ送信", checkLineLastSend],
      ["line-admin", "管理者ID設定", checkLineAdminId],
      ["line-schedule", "Scheduled Function設定", checkLineScheduleConfig]
    ];

    latestSystemCheckResults = checks.map(function (item) {
      return runCheckSafely(item[0], item[1], item[2]);
    });
    latestSystemCheckOverall = calculateOverallHealth(latestSystemCheckResults);
    renderVersionMeta();
    renderSystemCheckResults(latestSystemCheckResults, latestSystemCheckOverall);
    renderRuntimeErrorPanel();
    if (releaseCenterModal && releaseCenterModal.classList.contains("is-open")) {
      renderReleaseCenter();
    }
    if (!options.silentToast) {
      showToast("システムチェックが完了しました");
    }
  }

  function copySystemCheckResults() {
    if (!latestSystemCheckResults.length || !latestSystemCheckOverall) {
      showToast("先にチェックを実行してください");
      return;
    }

    var overall = latestSystemCheckOverall;
    var ok = latestSystemCheckResults.filter(function (r) { return r.status === "ok"; });
    var warn = latestSystemCheckResults.filter(function (r) { return r.status === "warn"; });
    var fail = latestSystemCheckResults.filter(function (r) { return r.status === "fail"; });
    var session = (window.smileAIStudioStatus && window.smileAIStudioStatus.sessionErrors) || [];
    var manual = loadManualChecklist();
    var manualDone = MANUAL_CHECK_ITEMS.filter(function (i) { return !!manual[i.id]; }).length;
    var manualLeft = MANUAL_CHECK_ITEMS.length - manualDone;

    var lines = [
      "【Smile AI Studio システムチェック】",
      "",
      "実行日時：",
      latestSystemCheckAt,
      "",
      "総合結果：",
      overall.label,
      "",
      "【正常】"
    ];
    if (ok.length) ok.forEach(function (r) { lines.push("・" + r.title + "：" + r.message); });
    else lines.push("・なし");

    lines.push("", "【注意】");
    if (warn.length) warn.forEach(function (r) { lines.push("・" + r.title + "：" + r.message); });
    else lines.push("・なし");

    lines.push("", "【異常】");
    if (fail.length) fail.forEach(function (r) { lines.push("・" + r.title + "：" + r.message); });
    else lines.push("・なし");

    lines.push("", "【実行時エラー】");
    if (session.length) session.slice(0, 5).forEach(function (e) { lines.push("・" + e.message); });
    else lines.push("・なし（今回のページ読み込み後）");

    lines.push("", "【手動確認】", "・完了" + manualDone + "件 / 未確認" + manualLeft + "件");
    lines.push("", "※ GitHub/Netlifyの実接続・デプロイ結果は未確認です。");

    copyText(lines.join("\n")).then(function () {
      showToast("システムチェック結果をコピーしました");
    }).catch(function () {
      showToast("コピーに失敗しました");
    });
  }

  function clearRuntimeErrors() {
    try { localStorage.removeItem(RUNTIME_ERRORS_KEY); } catch (e) { /* ignore */ }
    if (window.smileAIStudioStatus) {
      window.smileAIStudioStatus.runtimeErrors = [];
      window.smileAIStudioStatus.sessionErrors = [];
    }
    renderRuntimeErrorPanel();
    showToast("エラー履歴を消去しました");
  }

  /* ========== Release Center ========== */
  var latestPublishDecision = null;

  function loadReleaseNotes() {
    try {
      return localStorage.getItem(RELEASE_NOTES_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function saveReleaseNotes(text) {
    try {
      localStorage.setItem(RELEASE_NOTES_KEY, String(text || ""));
    } catch (e) { /* ignore */ }
  }

  function loadReleaseHistory() {
    try {
      var raw = localStorage.getItem(RELEASE_HISTORY_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveReleaseHistory(list) {
    try {
      localStorage.setItem(RELEASE_HISTORY_KEY, JSON.stringify(list || []));
    } catch (e) { /* ignore */ }
  }

  function loadReleaseState() {
    try {
      var raw = localStorage.getItem(RELEASE_STATE_KEY);
      if (!raw) return { status: "開発中" };
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : { status: "開発中" };
    } catch (e) {
      return { status: "開発中" };
    }
  }

  function saveReleaseState(state) {
    try {
      localStorage.setItem(RELEASE_STATE_KEY, JSON.stringify(state || {}));
    } catch (e) { /* ignore */ }
  }

  function getCheckById(id) {
    return (latestSystemCheckResults || []).find(function (r) {
      return r.id === id;
    }) || null;
  }

  function evaluatePublishDecision() {
    if (!latestSystemCheckResults.length || !latestSystemCheckOverall) {
      return {
        level: "unknown",
        label: "⚪ 未判定",
        detail: "先にシステムチェックを実行してください。",
        canPublish: false,
        canRegisterHistory: false
      };
    }

    var init = getCheckById("init");
    var runtime = getCheckById("runtime-errors");
    var dom = getCheckById("dom");
    var projects = getCheckById("projects");
    var staff = getCheckById("ai-staff");
    var sessionErrors = (window.smileAIStudioStatus && window.smileAIStudioStatus.sessionErrors) || [];
    var failCount = latestSystemCheckOverall.counts.fail || 0;
    var blockReasons = [];

    if (failCount > 0) blockReasons.push("異常が" + failCount + "件あります");
    if (!init || init.status !== "ok") blockReasons.push("JavaScript初期化が正常ではありません");
    if (sessionErrors.length > 0) blockReasons.push("実行時エラーが" + sessionErrors.length + "件あります");
    if (runtime && runtime.status === "fail") blockReasons.push("実行時エラーチェックが異常です");
    if (!dom || dom.status === "fail") blockReasons.push("必須DOMチェックが異常です");
    if (!projects || projects.status === "fail") blockReasons.push("プロジェクトデータチェックが異常です");
    if (!staff || staff.status === "fail") blockReasons.push("AIスタッフチェックが異常です");

    if (blockReasons.length) {
      return {
        level: "fail",
        label: "🔴 公開しないでください",
        detail: blockReasons.join("\n"),
        canPublish: false,
        canRegisterHistory: false
      };
    }

    var warnCount = latestSystemCheckOverall.counts.warn || 0;
    if (warnCount > 0) {
      return {
        level: "warn",
        label: "🟡 要確認",
        detail: "異常はありません。注意が" + warnCount + "件ありますが、公開可能です。必要なら注意内容を確認してください。",
        canPublish: true,
        canRegisterHistory: true
      };
    }

    return {
      level: "ok",
      label: "🟢 公開できます",
      detail: "公開条件を満たしています。GitHubへのpushは手動で行ってください（この画面では実行しません）。",
      canPublish: true,
      canRegisterHistory: true
    };
  }

  function deriveCurrentStatus(decision) {
    var history = loadReleaseHistory();
    var published = history.some(function (h) {
      return h.version === APP_INFO.version && String(h.build) === String(APP_INFO.build);
    });
    if (published) return "公開済み";
    if (decision && decision.canPublish) return "公開準備OK";
    return "開発中";
  }

  function summarizeLatestCheck() {
    if (!latestSystemCheckOverall) {
      return {
        label: "未実行",
        meta: "まだシステムチェックが実行されていません。",
        level: "unknown"
      };
    }
    var c = latestSystemCheckOverall.counts;
    var level = "ok";
    var label = "正常";
    if (c.fail > 0) {
      level = "fail";
      label = "異常";
    } else if (c.warn > 0) {
      level = "warn";
      label = "注意";
    }
    return {
      label: label,
      meta: "正常" + c.ok + " / 注意" + c.warn + " / 異常" + c.fail +
        (latestSystemCheckAt ? "\n実行: " + latestSystemCheckAt : ""),
      level: level
    };
  }

  function renderReleaseCenter() {
    var versionEl = document.getElementById("release-version-info");
    if (versionEl) {
      versionEl.textContent =
        "Version\n" + APP_INFO.version + "\n\n" +
        "Build\n" + APP_INFO.build + "\n\n" +
        "Updated\n" + APP_INFO.updatedAt;
    }

    latestPublishDecision = evaluatePublishDecision();
    var status = deriveCurrentStatus(latestPublishDecision);
    saveReleaseState({
      status: status,
      updatedAt: new Date().toISOString(),
      decision: latestPublishDecision.label
    });

    var statusEl = document.getElementById("release-current-status");
    if (statusEl) statusEl.textContent = status;

    var checkSummary = summarizeLatestCheck();
    var checkEl = document.getElementById("release-latest-check");
    var checkMeta = document.getElementById("release-latest-check-meta");
    var checkCard = document.getElementById("release-check-card");
    if (checkEl) checkEl.textContent = checkSummary.label;
    if (checkMeta) checkMeta.textContent = checkSummary.meta;
    if (checkCard) {
      checkCard.className = "release-card is-" + checkSummary.level;
    }

    var decisionEl = document.getElementById("release-decision");
    var decisionDetail = document.getElementById("release-decision-detail");
    var decisionCard = document.getElementById("release-decision-card");
    if (decisionEl) decisionEl.textContent = latestPublishDecision.label;
    if (decisionDetail) decisionDetail.textContent = latestPublishDecision.detail;
    if (decisionCard) {
      decisionCard.className = "release-card release-card--decision is-" + latestPublishDecision.level;
    }

    var historyBtn = document.getElementById("btn-release-save-history");
    if (historyBtn) {
      historyBtn.hidden = !latestPublishDecision.canRegisterHistory;
    }

    var memoInput = document.getElementById("release-memo-input");
    if (memoInput && !memoInput.value) {
      memoInput.value = loadReleaseNotes();
    }

    renderReleaseHistory();
    if (typeof renderReleaseHome === "function") renderReleaseHome();
  }

  function renderReleaseHistory() {
    var el = document.getElementById("release-history-list");
    if (!el) return;
    var history = loadReleaseHistory();
    if (!history.length) {
      el.innerHTML = '<p class="form-hint">まだリリース履歴はありません。公開判定OKのあと「履歴に追加」できます。</p>';
      return;
    }
    el.innerHTML = history.slice(0, 20).map(function (item) {
      return (
        '<div class="release-history-item">' +
          escapeHtml("v" + (item.version || "") + " / build " + (item.build || "") + "\n") +
          escapeHtml((item.date || "") + "\n") +
          escapeHtml((item.memo || "（メモなし）") + "\n") +
          escapeHtml("判定: " + (item.systemCheckResult || "")) +
        "</div>"
      );
    }).join("");
  }

  function openReleaseCenter() {
    if (!releaseCenterModal) return;
    releaseCenterModal.classList.add("is-open");
    releaseCenterModal.setAttribute("aria-hidden", "false");
    syncBodyScroll();
    var panel = document.getElementById("release-memo-panel");
    if (panel) panel.hidden = true;
    renderReleaseCenter();
  }

  function closeReleaseCenter() {
    if (!releaseCenterModal) return;
    releaseCenterModal.classList.remove("is-open");
    releaseCenterModal.setAttribute("aria-hidden", "true");
    var panel = document.getElementById("release-memo-panel");
    if (panel) panel.hidden = true;
    syncBodyScroll();
  }

  function runPublishCheck() {
    if (!latestSystemCheckResults.length) {
      runAllSystemChecks({ silentToast: true });
    }
    latestPublishDecision = evaluatePublishDecision();
    renderReleaseCenter();
    if (latestPublishDecision.canPublish) {
      showToast("公開チェック完了：公開可能な状態です");
    } else if (latestPublishDecision.level === "unknown") {
      showToast("先にシステムチェックを実行してください");
    } else {
      showToast("公開チェック完了：現時点では公開しないでください");
    }
  }

  function addReleaseHistoryEntry() {
    latestPublishDecision = evaluatePublishDecision();
    if (!latestPublishDecision.canRegisterHistory) {
      showToast("公開判定OKのときだけ履歴に追加できます");
      return;
    }
    var memo = loadReleaseNotes().trim();
    var history = loadReleaseHistory();
    history.unshift({
      version: APP_INFO.version,
      build: APP_INFO.build,
      date: new Date().toISOString(),
      memo: memo || "（メモなし）",
      systemCheckResult: latestPublishDecision.label + " / " +
        (latestSystemCheckOverall ? latestSystemCheckOverall.label : "")
    });
    saveReleaseHistory(history.slice(0, 50));
    saveReleaseState({
      status: "公開済み",
      updatedAt: new Date().toISOString(),
      decision: latestPublishDecision.label
    });
    renderReleaseCenter();
    showToast("リリース履歴に追加しました");
  }

  function renderDevStatusPanel() {
    var el = document.getElementById("dev-status-panel");
    if (!el) return;
    var progress = DEV_ROADMAP.progress;
    var completed = DEV_ROADMAP.completed.map(function (item) {
      return "<li>✅ " + escapeHtml(item) + "</li>";
    }).join("");
    var upcoming = DEV_ROADMAP.upcoming.map(function (item) {
      var mark = item.status === "準備中" ? "◇" : "□";
      return "<li>" + mark + " " + escapeHtml(item.label) +
        (item.status ? "（" + escapeHtml(item.status) + "）" : "") +
        "</li>";
    }).join("");

    el.innerHTML =
      '<article class="dev-status-card">' +
        '<h3 class="dev-status-card__title">' + escapeHtml(APP_INFO.name) + "</h3>" +
        '<div class="dev-progress">' +
          '<div class="dev-progress__label"><span>完成度</span><span>' + progress + "%</span></div>" +
          '<div class="dev-progress__bar" role="progressbar" aria-valuenow="' + progress +
            '" aria-valuemin="0" aria-valuemax="100">' +
            '<div class="dev-progress__fill" style="width:' + progress + '%"></div>' +
          "</div>" +
        "</div>" +
        '<p class="dev-status-list__heading">完成済み</p>' +
        '<ul class="dev-status-list">' + completed + "</ul>" +
        '<p class="dev-status-list__heading">次に作る予定</p>' +
        '<ul class="dev-status-list">' + upcoming + "</ul>" +
      "</article>";
  }

  /* ========== スマホファースト：今日やること / 詳細 / 設定 ========== */

  function loadTodayTodos() {
    try {
      var raw = localStorage.getItem(TODAY_TODOS_KEY);
      if (!raw) return DEFAULT_TODAY_TODOS.map(function (t) {
        return { id: t.id, text: t.text, done: !!t.done };
      });
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return DEFAULT_TODAY_TODOS.map(function (t) {
          return { id: t.id, text: t.text, done: !!t.done };
        });
      }
      return parsed.map(function (t, i) {
        return {
          id: String(t.id || ("todo-" + i)),
          text: String(t.text || "").trim() || "（無題）",
          done: !!t.done
        };
      });
    } catch (e) {
      return DEFAULT_TODAY_TODOS.map(function (t) {
        return { id: t.id, text: t.text, done: !!t.done };
      });
    }
  }

  function saveTodayTodos(list) {
    try {
      localStorage.setItem(TODAY_TODOS_KEY, JSON.stringify(list || []));
    } catch (e) { /* ignore */ }
  }

  function renderTodayTodos() {
    var el = document.getElementById("today-todos");
    if (!el) return;
    var todos = loadTodayTodos();
    var items = todos.map(function (t) {
      return (
        '<label class="today-item' + (t.done ? " is-done" : "") + '">' +
          '<input type="checkbox" data-todo-id="' + escapeHtml(t.id) + '"' + (t.done ? " checked" : "") + ">" +
          '<span class="today-item__text">' + escapeHtml(t.text) + "</span>" +
        "</label>"
      );
    }).join("");

    el.innerHTML =
      items +
      '<div class="today-add">' +
        '<input type="text" id="today-todo-input" placeholder="やること追加" maxlength="80" aria-label="やること追加">' +
        '<button type="button" class="btn btn--primary" id="btn-add-today-todo">追加</button>' +
      "</div>";

    el.querySelectorAll("input[data-todo-id]").forEach(function (input) {
      input.addEventListener("change", function () {
        var list = loadTodayTodos();
        var id = input.getAttribute("data-todo-id");
        list.forEach(function (t) {
          if (t.id === id) t.done = !!input.checked;
        });
        saveTodayTodos(list);
        renderTodayTodos();
      });
    });

    var addBtn = document.getElementById("btn-add-today-todo");
    var addInput = document.getElementById("today-todo-input");
    if (addBtn && addInput) {
      function addTodo() {
        var text = addInput.value.trim();
        if (!text) {
          showToast("内容を入力してください");
          return;
        }
        var list = loadTodayTodos();
        list.push({
          id: "todo-" + Date.now(),
          text: text,
          done: false
        });
        saveTodayTodos(list);
        renderTodayTodos();
        showToast("追加しました");
      }
      addBtn.addEventListener("click", addTodo);
      addInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          addTodo();
        }
      });
    }
  }

  function loadCurrentFocus() {
    try {
      var raw = localStorage.getItem(CURRENT_FOCUS_KEY);
      if (!raw) return {
        projectId: DEFAULT_CURRENT_FOCUS.projectId,
        progress: DEFAULT_CURRENT_FOCUS.progress
      };
      var parsed = JSON.parse(raw);
      return {
        projectId: String(parsed.projectId || DEFAULT_CURRENT_FOCUS.projectId),
        progress: Math.max(0, Math.min(100, Number(parsed.progress) || DEFAULT_CURRENT_FOCUS.progress))
      };
    } catch (e) {
      return {
        projectId: DEFAULT_CURRENT_FOCUS.projectId,
        progress: DEFAULT_CURRENT_FOCUS.progress
      };
    }
  }

  function saveCurrentFocus(focus) {
    try {
      localStorage.setItem(CURRENT_FOCUS_KEY, JSON.stringify(focus));
    } catch (e) { /* ignore */ }
  }

  function renderCurrentFocus() {
    var el = document.getElementById("current-focus-panel");
    if (!el) return;
    var focus = loadCurrentFocus();
    var project = getProjectById(focus.projectId) || getEnabledProjects()[0] || null;
    if (!project) {
      el.innerHTML = '<p class="empty-message">開発中のプロジェクトがありません</p>';
      return;
    }
    if (project.id !== focus.projectId) {
      focus.projectId = project.id;
      saveCurrentFocus(focus);
    }

    el.innerHTML =
      '<button type="button" class="focus-card" id="btn-current-focus" data-project-id="' + escapeHtml(project.id) + '">' +
        '<p class="focus-card__label">現在</p>' +
        '<p class="focus-card__name">' +
          '<span aria-hidden="true">' + escapeHtml(project.icon) + "</span> " +
          escapeHtml(project.name) +
        "</p>" +
        '<div class="progress">' +
          '<div class="progress__bar" role="progressbar" aria-valuenow="' + focus.progress +
            '" aria-valuemin="0" aria-valuemax="100">' +
            '<div class="progress__fill" style="width:' + focus.progress + '%"></div>' +
          "</div>" +
        "</div>" +
        '<p class="focus-card__pct">' + focus.progress + "%</p>" +
      "</button>";

    var btn = document.getElementById("btn-current-focus");
    if (btn) {
      btn.addEventListener("click", function () {
        openProjectDetail(btn.getAttribute("data-project-id"));
      });
    }
  }

  function renderReleaseHome() {
    var el = document.getElementById("release-home-panel");
    if (!el) return;
    var state = { status: "開発中" };
    var decision = { label: "未判定" };
    try {
      state = loadReleaseState() || state;
    } catch (e1) { /* ignore */ }
    try {
      decision = evaluatePublishDecision() || decision;
    } catch (e2) { /* ignore */ }
    var statusText = (state && state.status) ? state.status : "開発中";
    var decisionText = decision && decision.label ? decision.label : "未判定";
    var checkText = "未実行";
    if (latestSystemCheckOverall && latestSystemCheckOverall.label) {
      checkText = latestSystemCheckOverall.label;
    }

    el.innerHTML =
      '<button type="button" class="release-home-card" id="btn-release-home">' +
        '<div class="release-home-card__row">' +
          '<span class="release-home-card__label">公開状態</span>' +
          '<span class="release-home-card__value">' + escapeHtml(statusText) + "</span>" +
        "</div>" +
        '<div class="release-home-card__row">' +
          '<span class="release-home-card__label">公開判定</span>' +
          '<span class="release-home-card__value">' + escapeHtml(decisionText) + "</span>" +
        "</div>" +
        '<div class="release-home-card__row">' +
          '<span class="release-home-card__label">システムチェック</span>' +
          '<span class="release-home-card__value">' + escapeHtml(checkText) + "</span>" +
        "</div>" +
        '<p class="form-hint" style="margin-top:12px;margin-bottom:0">タップでリリースセンターを開く</p>' +
      "</button>";

    var btn = document.getElementById("btn-release-home");
    if (btn) {
      btn.addEventListener("click", function () {
        openReleaseCenter();
      });
    }
  }

  function loadIphoneSettings() {
    try {
      var raw = localStorage.getItem(IPHONE_SETTINGS_KEY);
      if (!raw) {
        return {
          cursorMobile: DEFAULT_IPHONE_SETTINGS.cursorMobile,
          githubMobile: DEFAULT_IPHONE_SETTINGS.githubMobile,
          netlifyCheck: DEFAULT_IPHONE_SETTINGS.netlifyCheck
        };
      }
      var parsed = JSON.parse(raw);
      return {
        cursorMobile: !!parsed.cursorMobile,
        githubMobile: !!parsed.githubMobile,
        netlifyCheck: !!parsed.netlifyCheck
      };
    } catch (e) {
      return {
        cursorMobile: false,
        githubMobile: false,
        netlifyCheck: false
      };
    }
  }

  function saveIphoneSettings(settings) {
    try {
      localStorage.setItem(IPHONE_SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) { /* ignore */ }
  }

  function renderIphoneSettings() {
    var el = document.getElementById("iphone-settings");
    if (!el) return;
    var s = loadIphoneSettings();
    var rows = [
      { key: "cursorMobile", label: "Cursorモバイル運用" },
      { key: "githubMobile", label: "GitHub Mobile運用" },
      { key: "netlifyCheck", label: "Netlify公開確認" }
    ];

    el.innerHTML = rows.map(function (row) {
      return (
        '<div class="settings-row">' +
          '<span class="settings-row__label">' + escapeHtml(row.label) + "</span>" +
          '<label class="settings-toggle">' +
            '<input type="checkbox" data-iphone-setting="' + row.key + '"' + (s[row.key] ? " checked" : "") + ">" +
            '<span class="settings-toggle__track" aria-hidden="true"></span>' +
          "</label>" +
        "</div>"
      );
    }).join("");

    el.querySelectorAll("input[data-iphone-setting]").forEach(function (input) {
      input.addEventListener("change", function () {
        var settings = loadIphoneSettings();
        var key = input.getAttribute("data-iphone-setting");
        settings[key] = !!input.checked;
        saveIphoneSettings(settings);
        showToast(input.checked ? "ONにしました" : "OFFにしました");
      });
    });
  }

  function renderUpcomingPanel() {
    var el = document.getElementById("upcoming-panel");
    if (!el) return;
    el.innerHTML =
      '<ul class="upcoming-list">' +
        FUTURE_FEATURES.map(function (label) {
          return (
            "<li>" +
              "<span>" + escapeHtml(label) + "</span>" +
              '<span class="upcoming-badge">準備中</span>' +
            "</li>"
          );
        }).join("") +
      "</ul>";
  }

  function getProjectReleaseSummary(project) {
    if (!project) return { latest: "未登録", publish: "不明" };
    var history = [];
    try {
      var raw = localStorage.getItem(RELEASE_HISTORY_KEY);
      history = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(history)) history = [];
    } catch (e) {
      history = [];
    }
    var latest = history[0];
    var latestText = latest
      ? ("v" + (latest.version || "?") + " / " + formatDate(latest.date || ""))
      : "未登録";
    var publish = project.publicUrl ? "公開URLあり" : "未公開";
    if (project.id === "smile-ai-studio") {
      var state = loadReleaseState();
      if (state && state.status) publish = state.status;
    }
    return { latest: latestText, publish: publish };
  }

  function getProjectDevHistory(project) {
    var requests = getRequests().filter(function (r) {
      return (r.projectId && r.projectId === project.id) ||
        (r.projectName && r.projectName === project.name) ||
        (r.selectedProject && r.selectedProject === project.name) ||
        (r.project && r.project === project.name);
    }).slice(0, 5);

    if (requests.length === 0) {
      return '<p class="form-hint">まだ開発履歴はありません</p>';
    }
    return (
      '<ul class="dev-status-list">' +
        requests.map(function (r) {
          return "<li>" + escapeHtml(formatDate(r.createdAt)) + " — " +
            escapeHtml(r.title || "無題の依頼") + "</li>";
        }).join("") +
      "</ul>"
    );
  }

  function openProjectDetail(projectId) {
    var project = getProjectById(projectId);
    if (!project || !projectDetailModal || !projectDetailBody) {
      showToast("プロジェクトが見つかりません");
      return;
    }
    var release = getProjectReleaseSummary(project);
    if (projectDetailTitle) {
      projectDetailTitle.textContent = (project.icon ? project.icon + " " : "") + project.name;
    }

    var githubHtml = project.githubUrl
      ? '<a href="' + escapeHtml(project.githubUrl) + '" target="_blank" rel="noopener noreferrer">' +
          escapeHtml(project.githubUrl) + "</a>"
      : "未登録";
    var publicHtml = project.publicUrl
      ? '<a href="' + escapeHtml(project.publicUrl) + '" target="_blank" rel="noopener noreferrer">' +
          escapeHtml(project.publicUrl) + "</a>"
      : "未登録";

    projectDetailBody.innerHTML =
      '<div class="detail-block">' +
        '<p class="detail-block__label">説明</p>' +
        '<p class="detail-block__value">' + escapeHtml(project.description || "—") + "</p>" +
      "</div>" +
      '<div class="detail-block">' +
        '<p class="detail-block__label">GitHub</p>' +
        '<p class="detail-block__value">' + githubHtml + "</p>" +
      "</div>" +
      '<div class="detail-block">' +
        '<p class="detail-block__label">公開サイト</p>' +
        '<p class="detail-block__value">' + publicHtml + "</p>" +
      "</div>" +
      '<div class="detail-block">' +
        '<p class="detail-block__label">ローカルフォルダ</p>' +
        '<p class="detail-block__value">' + escapeHtml(project.localFolderName || "—") + "</p>" +
      "</div>" +
      '<div class="detail-block">' +
        '<p class="detail-block__label">開発履歴</p>' +
        getProjectDevHistory(project) +
      "</div>" +
      '<div class="detail-block">' +
        '<p class="detail-block__label">最新リリース</p>' +
        '<p class="detail-block__value">' + escapeHtml(release.latest) + "</p>" +
      "</div>" +
      '<div class="detail-block">' +
        '<p class="detail-block__label">公開状態</p>' +
        '<p class="detail-block__value">' + escapeHtml(release.publish) + "</p>" +
      "</div>" +
      '<div class="detail-actions">' +
        '<button type="button" class="btn btn--primary" id="btn-detail-develop" data-project-id="' +
          escapeHtml(project.id) + '">開発する</button>' +
        '<button type="button" class="btn btn--secondary" id="btn-detail-edit" data-project-id="' +
          escapeHtml(project.id) + '">編集する</button>' +
        '<button type="button" class="btn btn--ghost" id="btn-detail-close">閉じる</button>' +
      "</div>";

    var developBtn = document.getElementById("btn-detail-develop");
    if (developBtn) {
      developBtn.addEventListener("click", function () {
        closeProjectDetail();
        openModal({ projectId: developBtn.getAttribute("data-project-id") });
      });
    }
    var editBtn = document.getElementById("btn-detail-edit");
    if (editBtn) {
      editBtn.addEventListener("click", function () {
        closeProjectDetail();
        openProjectModal({ mode: "edit", projectId: editBtn.getAttribute("data-project-id") });
      });
    }
    var closeBtn = document.getElementById("btn-detail-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", closeProjectDetail);
    }

    projectDetailModal.classList.add("is-open");
    projectDetailModal.setAttribute("aria-hidden", "false");
    syncBodyScroll();
  }

  function closeProjectDetail() {
    if (!projectDetailModal) return;
    projectDetailModal.classList.remove("is-open");
    projectDetailModal.setAttribute("aria-hidden", "true");
    syncBodyScroll();
  }

  function scrollToProjects() {
    showAppView("projects");
  }

  function updateHomeGreeting() {
    var el = document.getElementById("home-greeting");
    if (!el) return;
    var hour = new Date().getHours();
    var hello = "こんにちは";
    if (hour < 5) hello = "こんばんは";
    else if (hour < 11) hello = "おはよう";
    else if (hour < 18) hello = "こんにちは";
    else hello = "こんばんは";
    el.textContent = hello + "、YAHA😊";
  }

  function renderHomePurpose() {
    var missionBody = document.getElementById("home-mission-body");
    var visionBody = document.getElementById("home-vision-body");
    if (missionBody) {
      missionBody.innerHTML =
        '<p class="home-accordion__quote">' + escapeHtml(COMPANY_MISSION.quote) + "</p>" +
        COMPANY_MISSION.paragraphs.map(function (p) {
          return "<p>" + escapeHtml(p) + "</p>";
        }).join("");
    }
    if (visionBody) {
      visionBody.innerHTML =
        '<p class="home-accordion__quote">' + escapeHtml(COMPANY_VISION.quote) + "</p>" +
        COMPANY_VISION.paragraphs.map(function (p) {
          return "<p>" + escapeHtml(p) + "</p>";
        }).join("");
    }
  }

  function renderHomeGoals() {
    var list = document.getElementById("home-goals-list");
    if (!list) return;
    list.innerHTML = CURRENT_GOALS.map(function (g) {
      var pct = Math.max(0, Math.min(100, Number(g.progress) || 0));
      return (
        '<li class="home-goals__item home-goals__item--progress" data-goal-id="' + escapeHtml(g.id) + '">' +
          '<div class="home-goals__row">' +
            '<span class="home-goals__name">' + escapeHtml(g.label) + "</span>" +
            '<span class="home-goals__pct">' + pct + "%</span>" +
          "</div>" +
          '<div class="home-goals__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-label="' + escapeHtml(g.label) + 'の進捗">' +
            '<span class="home-goals__bar-fill" style="width:' + pct + '%"></span>' +
          "</div>" +
        "</li>"
      );
    }).join("");
  }

  function renderDailyWord() {
    var el = document.getElementById("home-daily-word");
    if (!el || !DAILY_WORDS.length) return;
    var daySeed = new Date();
    var idx = (daySeed.getFullYear() * 372 + (daySeed.getMonth() + 1) * 31 + daySeed.getDate()) % DAILY_WORDS.length;
    el.textContent = DAILY_WORDS[idx];
  }

  function renderHomeSchedule() {
    var list = document.getElementById("home-schedule-list");
    if (!list) return;
    list.innerHTML = DUMMY_SCHEDULE.map(function (item) {
      return (
        '<li class="home-schedule__item">' +
          '<span class="home-schedule__time">' + escapeHtml(item.time) + "</span>" +
          '<span class="home-schedule__title">' + escapeHtml(item.title) + "</span>" +
        "</li>"
      );
    }).join("");
  }

  function loadTopPriority() {
    try {
      var raw = localStorage.getItem(TOP_PRIORITY_KEY);
      if (raw == null || raw === "") return DEFAULT_TOP_PRIORITY;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed.text === "string" && parsed.text.trim()) {
        return parsed.text.trim();
      }
    } catch (e) {
      /* ignore */
    }
    return DEFAULT_TOP_PRIORITY;
  }

  function saveTopPriority(text) {
    var value = String(text || "").trim();
    if (!value) value = DEFAULT_TOP_PRIORITY;
    try {
      localStorage.setItem(TOP_PRIORITY_KEY, JSON.stringify({
        text: value,
        updatedAt: new Date().toISOString()
      }));
    } catch (e) {
      showToast("保存に失敗しました");
      return false;
    }
    return true;
  }

  function setTopPriorityEditMode(editing) {
    var textEl = document.getElementById("home-top-priority-text");
    var input = document.getElementById("home-top-priority-input");
    var editBtn = document.getElementById("btn-top-priority-edit");
    var saveBtn = document.getElementById("btn-top-priority-save");
    if (!textEl || !input) return;
    if (editing) {
      input.value = textEl.textContent || "";
      textEl.hidden = true;
      input.hidden = false;
      if (editBtn) editBtn.hidden = true;
      if (saveBtn) saveBtn.hidden = false;
      setTimeout(function () { input.focus(); }, 30);
    } else {
      textEl.hidden = false;
      input.hidden = true;
      if (editBtn) editBtn.hidden = false;
      if (saveBtn) saveBtn.hidden = true;
    }
  }

  function renderTopPriority() {
    var textEl = document.getElementById("home-top-priority-text");
    if (!textEl) return;
    textEl.textContent = loadTopPriority();
    setTopPriorityEditMode(false);
  }

  function handleTopPrioritySave() {
    var input = document.getElementById("home-top-priority-input");
    var text = input ? String(input.value || "").trim() : "";
    if (!text) {
      showToast("最優先を入力してください");
      if (input) input.focus();
      return;
    }
    if (!saveTopPriority(text)) return;
    renderTopPriority();
    showToast("今日の最優先を保存しました");
  }

  function applyFamilyPhoto(src) {
    var img = document.getElementById("home-family-photo");
    if (!img || !src) return;
    img.src = src;
  }

  function loadFamilyPhoto() {
    try {
      var saved = localStorage.getItem(FAMILY_PHOTO_KEY);
      if (saved && saved.indexOf("data:image") === 0) {
        applyFamilyPhoto(saved);
      }
    } catch (e) {
      /* ignore */
    }
  }

  function handleFamilyPhotoChange() {
    var input = document.getElementById("home-family-photo-input");
    if (!input || !input.files || !input.files[0]) return;
    var file = input.files[0];
    if (!file.type || file.type.indexOf("image/") !== 0) {
      showToast("画像ファイルを選んでください");
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = String(reader.result || "");
      if (!dataUrl) {
        showToast("写真の読み込みに失敗しました");
        return;
      }
      try {
        localStorage.setItem(FAMILY_PHOTO_KEY, dataUrl);
      } catch (e) {
        showToast("保存に失敗しました（容量超過の可能性）");
        applyFamilyPhoto(dataUrl);
        return;
      }
      applyFamilyPhoto(dataUrl);
      showToast("家族写真を更新しました");
    };
    reader.onerror = function () {
      showToast("写真の読み込みに失敗しました");
    };
    reader.readAsDataURL(file);
  }

  function showAppView(name) {
    var views = ["home", "projects", "more"];
    if (views.indexOf(name) === -1) name = "home";

    views.forEach(function (v) {
      var el = document.getElementById("view-" + v);
      if (!el) return;
      var active = v === name;
      el.hidden = !active;
      if (active) el.classList.add("is-active");
      else el.classList.remove("is-active");
    });

    var navMap = {
      home: "btn-nav-home",
      projects: "btn-nav-projects",
      more: "btn-nav-more"
    };
    Object.keys(navMap).forEach(function (key) {
      var btn = document.getElementById(navMap[key]);
      if (!btn) return;
      if (key === name) btn.classList.add("quick-nav__btn--active");
      else btn.classList.remove("quick-nav__btn--active");
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ========== Web管理センター（活動日記） ========== */

  function loadDiaryEntries() {
    try {
      var raw = localStorage.getItem(DIARY_ENTRIES_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeDiaryEntry).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  function saveDiaryEntries(list) {
    try {
      localStorage.setItem(DIARY_ENTRIES_KEY, JSON.stringify(list || []));
    } catch (e) {
      showToast("保存に失敗しました");
    }
  }

  function normalizeDiaryEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    var id = String(raw.id || "").trim();
    if (!id) id = "diary-" + Date.now();
    var status = raw.status === "published" ? "published" : "draft";
    return {
      id: id,
      title: String(raw.title || "").trim(),
      body: String(raw.body || "").trim(),
      publishDate: String(raw.publishDate || "").trim(),
      photoMemo: String(raw.photoMemo || "").trim(),
      status: status,
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString()
    };
  }

  function getDiaryById(id) {
    return loadDiaryEntries().find(function (d) { return d.id === id; }) || null;
  }

  function formatDiaryDisplayDate(isoDate) {
    if (!isoDate) return "";
    var parts = String(isoDate).split("-");
    if (parts.length !== 3) return isoDate;
    return parts[0] + "." + parts[1] + "." + parts[2];
  }

  function todayInputDate() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function showWebCenterView(name) {
    var views = {
      menu: webCenterMenuView,
      form: webCenterFormView,
      drafts: webCenterDraftsView,
      published: webCenterPublishedView,
      instruction: webCenterInstructionView
    };
    Object.keys(views).forEach(function (key) {
      var el = views[key];
      if (!el) return;
      if (key === name) el.hidden = false;
      else el.hidden = true;
    });
  }

  function clearWebDiaryFormError() {
    var el = document.getElementById("web-diary-form-error");
    if (!el) return;
    el.hidden = true;
    el.textContent = "";
  }

  function showWebDiaryFormError(message) {
    var el = document.getElementById("web-diary-form-error");
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
  }

  function resetWebDiaryForm() {
    editingDiaryId = null;
    currentDiaryInstruction = "";
    clearWebDiaryFormError();
    var idEl = document.getElementById("web-diary-edit-id");
    var titleEl = document.getElementById("web-diary-title");
    var bodyEl = document.getElementById("web-diary-body");
    var dateEl = document.getElementById("web-diary-date");
    var memoEl = document.getElementById("web-diary-photo-memo");
    if (idEl) idEl.value = "";
    if (titleEl) titleEl.value = "";
    if (bodyEl) bodyEl.value = "";
    if (dateEl) dateEl.value = todayInputDate();
    if (memoEl) memoEl.value = "";
  }

  function fillWebDiaryForm(entry) {
    editingDiaryId = entry ? entry.id : null;
    currentDiaryInstruction = "";
    clearWebDiaryFormError();
    var idEl = document.getElementById("web-diary-edit-id");
    var titleEl = document.getElementById("web-diary-title");
    var bodyEl = document.getElementById("web-diary-body");
    var dateEl = document.getElementById("web-diary-date");
    var memoEl = document.getElementById("web-diary-photo-memo");
    if (idEl) idEl.value = entry ? entry.id : "";
    if (titleEl) titleEl.value = entry ? entry.title : "";
    if (bodyEl) bodyEl.value = entry ? entry.body : "";
    if (dateEl) dateEl.value = entry && entry.publishDate ? entry.publishDate : todayInputDate();
    if (memoEl) memoEl.value = entry ? entry.photoMemo : "";
  }

  function readWebDiaryFormValues() {
    return {
      title: (document.getElementById("web-diary-title") || {}).value || "",
      body: (document.getElementById("web-diary-body") || {}).value || "",
      publishDate: (document.getElementById("web-diary-date") || {}).value || "",
      photoMemo: (document.getElementById("web-diary-photo-memo") || {}).value || ""
    };
  }

  function validateWebDiaryForm(values) {
    if (!String(values.title || "").trim()) {
      showWebDiaryFormError("タイトルを入力してください");
      return false;
    }
    if (!String(values.body || "").trim()) {
      showWebDiaryFormError("本文を入力してください");
      return false;
    }
    if (!String(values.publishDate || "").trim()) {
      showWebDiaryFormError("公開日を入力してください");
      return false;
    }
    clearWebDiaryFormError();
    return true;
  }

  function openWebCenter() {
    if (!webCenterModal) return;
    showWebCenterView("menu");
    webCenterModal.classList.add("is-open");
    webCenterModal.setAttribute("aria-hidden", "false");
    syncBodyScroll();
  }

  function closeWebCenter() {
    if (!webCenterModal) return;
    webCenterModal.classList.remove("is-open");
    webCenterModal.setAttribute("aria-hidden", "true");
    editingDiaryId = null;
    currentDiaryInstruction = "";
    showWebCenterView("menu");
    syncBodyScroll();
  }

  function openWebDiaryForm(entry) {
    if (entry) fillWebDiaryForm(entry);
    else resetWebDiaryForm();
    showWebCenterView("form");
    setTimeout(function () {
      var titleEl = document.getElementById("web-diary-title");
      if (titleEl) titleEl.focus();
    }, 50);
  }

  /**
   * 将来AI接続用。今回はダミー文章を返すだけ。
   * @param {{ title?: string, body?: string, publishDate?: string, photoMemo?: string }} context
   * @returns {Promise<{ title: string, body: string }>}
   */
  function generateDiaryWithAI(context) {
    context = context || {};
    var dateLabel = formatDiaryDisplayDate(context.publishDate || todayInputDate()) || "本日";
    return Promise.resolve({
      title: context.title && context.title.trim()
        ? context.title.trim()
        : "活動日記（" + dateLabel + "）",
      body: [
        "株式会社えがおのきろくの活動日記です。",
        "",
        "（AI下書き・ダミー）" + dateLabel + "のできごとをここにまとめます。",
        "イベント準備や現場の様子、これから伝えたいことを書き足してください。",
        "",
        "写真がある場合は、写真メモ欄にファイル名や置き場所を書いておくと更新指示書に反映されます。"
      ].join("\n")
    });
  }

  function handleWebAiWrite() {
    var values = readWebDiaryFormValues();
    generateDiaryWithAI(values).then(function (result) {
      var titleEl = document.getElementById("web-diary-title");
      var bodyEl = document.getElementById("web-diary-body");
      if (titleEl && (!titleEl.value || !titleEl.value.trim())) {
        titleEl.value = result.title;
      }
      if (bodyEl) {
        if (bodyEl.value && bodyEl.value.trim()) {
          bodyEl.value = bodyEl.value.replace(/\s+$/, "") + "\n\n" + result.body;
        } else {
          bodyEl.value = result.body;
        }
      }
      showToast("AI下書き（ダミー）を入れました");
    }).catch(function () {
      showToast("AI下書きに失敗しました");
    });
  }

  function saveWebDiary(status) {
    var values = readWebDiaryFormValues();
    if (!validateWebDiaryForm(values)) return null;

    var list = loadDiaryEntries();
    var now = new Date().toISOString();
    var id = editingDiaryId || ("diary-" + Date.now());
    var existing = list.find(function (d) { return d.id === id; });
    var entry = normalizeDiaryEntry({
      id: id,
      title: values.title.trim(),
      body: values.body.trim(),
      publishDate: values.publishDate.trim(),
      photoMemo: values.photoMemo.trim(),
      status: status,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    });

    if (existing) {
      list = list.map(function (d) { return d.id === id ? entry : d; });
    } else {
      list.unshift(entry);
    }
    saveDiaryEntries(list);
    editingDiaryId = entry.id;
    var idEl = document.getElementById("web-diary-edit-id");
    if (idEl) idEl.value = entry.id;
    return entry;
  }

  function handleSaveWebDiaryDraft() {
    var entry = saveWebDiary("draft");
    if (!entry) return;
    showToast("下書きを保存しました");
  }

  function handleSaveWebDiaryPublished() {
    var entry = saveWebDiary("published");
    if (!entry) return;
    showToast("公開済みとして保存しました");
  }

  function buildHomepageUpdateInstruction(entry) {
    entry = entry || null;
    if (!entry) {
      var values = readWebDiaryFormValues();
      if (!validateWebDiaryForm(values)) return "";
      entry = normalizeDiaryEntry({
        id: editingDiaryId || "unsaved",
        title: values.title,
        body: values.body,
        publishDate: values.publishDate,
        photoMemo: values.photoMemo,
        status: "draft"
      });
    }

    var displayDate = formatDiaryDisplayDate(entry.publishDate);
    var lines = [
      "【ホームページ更新指示書】",
      "",
      "対象プロジェクト：CorporateSite（株式会社えがおのきろく 公式ホームページ）",
      "対象ファイル：diary/index.htm",
      "文字コード：Shift_JIS（UTF-8へ変更しない）",
      "",
      "【目的】",
      "活動日記を1件追加する",
      "",
      "【追加する記事】",
      "日付：" + displayDate,
      "タイトル：" + entry.title,
      "",
      "本文：",
      entry.body,
      "",
      "写真メモ：",
      entry.photoMemo ? entry.photoMemo : "（なし・今回は画像タグを追加しない）",
      "",
      "【作業ルール】",
      "・既存の記事・デザイン・CSS・リンク・charsetは変更しない",
      "・新しい記事だけを、既存の最新記事より上に追加する",
      "・作業前に diary/backup/ へバックアップを作成する",
      "・Xserverへのアップロードは指示があるまで行わない",
      "",
      "【確認】",
      "・ローカルで表示確認する",
      "・文字化けがないか確認する"
    ];
    return lines.join("\n");
  }

  function handleBuildWebInstruction() {
    var saved = null;
    if (editingDiaryId) {
      saved = getDiaryById(editingDiaryId);
    }
    var text = buildHomepageUpdateInstruction(saved);
    if (!text) return;
    currentDiaryInstruction = text;
    var pre = document.getElementById("web-instruction-text");
    if (pre) pre.textContent = text;
    showWebCenterView("instruction");
  }

  function handleCopyWebInstruction() {
    var text = currentDiaryInstruction ||
      ((document.getElementById("web-instruction-text") || {}).textContent || "");
    if (!text.trim()) {
      showToast("指示書がありません");
      return;
    }
    copyText(text).then(function () {
      showToast("指示書をコピーしました");
    }).catch(function () {
      showToast("コピーに失敗しました");
    });
  }

  function truncateDiaryPreview(text, maxLen) {
    var t = String(text || "").replace(/\s+/g, " ").trim();
    if (t.length <= maxLen) return t;
    return t.slice(0, maxLen) + "…";
  }

  function renderWebDiaryList(containerId, status) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var list = loadDiaryEntries().filter(function (d) { return d.status === status; });
    if (!list.length) {
      container.innerHTML = '<p class="empty-message">' +
        (status === "draft" ? "下書きはまだありません。" : "公開済みはまだありません。") +
        "</p>";
      return;
    }

    container.innerHTML = list.map(function (d) {
      return (
        '<article class="card web-diary-card" data-diary-id="' + escapeHtml(d.id) + '">' +
          '<h4 class="card__title">' + escapeHtml(d.title || "無題") + "</h4>" +
          '<div class="web-diary-card__meta">' +
            '<span class="badge badge--progress">' + escapeHtml(formatDiaryDisplayDate(d.publishDate) || "日付未設定") + "</span>" +
            '<span class="badge ' + (d.status === "published" ? "badge--dev" : "badge--improve") + '">' +
              (d.status === "published" ? "公開済み" : "下書き") +
            "</span>" +
          "</div>" +
          '<p class="web-diary-card__preview">' + escapeHtml(truncateDiaryPreview(d.body, 100)) + "</p>" +
          '<div class="card__actions">' +
            '<button type="button" class="btn btn--primary btn--touch btn-web-edit" data-diary-id="' + escapeHtml(d.id) + '">編集</button>' +
            '<button type="button" class="btn btn--secondary btn--touch btn-web-instruction" data-diary-id="' + escapeHtml(d.id) + '">指示書</button>' +
            '<button type="button" class="btn btn--danger btn--touch btn-web-delete" data-diary-id="' + escapeHtml(d.id) + '">削除</button>' +
          "</div>" +
        "</article>"
      );
    }).join("");
  }

  function openWebDrafts() {
    renderWebDiaryList("web-drafts-list", "draft");
    showWebCenterView("drafts");
  }

  function openWebPublished() {
    renderWebDiaryList("web-published-list", "published");
    showWebCenterView("published");
  }

  function handleWebListClick(e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    var id = btn.getAttribute("data-diary-id");
    if (!id) return;
    var entry = getDiaryById(id);
    if (!entry) {
      showToast("記事が見つかりません");
      return;
    }

    if (btn.classList.contains("btn-web-edit")) {
      openWebDiaryForm(entry);
      return;
    }
    if (btn.classList.contains("btn-web-instruction")) {
      fillWebDiaryForm(entry);
      currentDiaryInstruction = buildHomepageUpdateInstruction(entry);
      var pre = document.getElementById("web-instruction-text");
      if (pre) pre.textContent = currentDiaryInstruction;
      showWebCenterView("instruction");
      return;
    }
    if (btn.classList.contains("btn-web-delete")) {
      if (!window.confirm("この活動日記を削除しますか？\n「" + entry.title + "」")) return;
      var next = loadDiaryEntries().filter(function (d) { return d.id !== id; });
      saveDiaryEntries(next);
      showToast("削除しました");
      if (entry.status === "published") openWebPublished();
      else openWebDrafts();
    }
  }

  /* ========== AI会議ログ（Company Memory） ========== */

  function createMeetingLogId() {
    return "meeting-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  }

  function formatMeetingDateLabel(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return (
      d.getFullYear() + "/" +
      String(d.getMonth() + 1).padStart(2, "0") + "/" +
      String(d.getDate()).padStart(2, "0") + " " +
      String(d.getHours()).padStart(2, "0") + ":" +
      String(d.getMinutes()).padStart(2, "0")
    );
  }

  function normalizeMeetingLog(raw) {
    if (!raw || typeof raw !== "object") return null;
    var id = String(raw.id || "").trim();
    var title = String(raw.title || "").trim();
    var content = String(raw.content || "").trim();
    if (!id || !title || !content) return null;
    var category = String(raw.category || "その他").trim();
    if (MEETING_CATEGORIES.indexOf(category) === -1) category = "その他";
    var createdAt = String(raw.createdAt || raw.date || new Date().toISOString());
    var date = String(raw.date || createdAt);
    var summary = String(raw.summary || "").trim();
    var changedFiles = Array.isArray(raw.changedFiles)
      ? raw.changedFiles.map(function (f) { return String(f || "").trim(); }).filter(Boolean)
      : [];
    var uniqueFiles = [];
    changedFiles.forEach(function (f) {
      if (uniqueFiles.indexOf(f) === -1) uniqueFiles.push(f);
    });
    return {
      id: id,
      date: date,
      title: title,
      category: category,
      content: content,
      summary: summary,
      createdAt: createdAt,
      sourceType: String(raw.sourceType || "").trim(),
      sourceText: String(raw.sourceText || "").trim(),
      version: String(raw.version || "").trim(),
      build: raw.build == null || raw.build === "" ? "" : String(raw.build).trim(),
      commitId: String(raw.commitId || "").trim(),
      changedFiles: uniqueFiles,
      verification: String(raw.verification || "").trim(),
      remainingIssues: String(raw.remainingIssues || "").trim(),
      recommendations: String(raw.recommendations || "").trim(),
      importedAt: String(raw.importedAt || "").trim()
    };
  }

  /**
   * 将来：AI検索 / 開発履歴 / チャット履歴 / Cursor履歴と統合する入口。
   * 今回は localStorage からの読み込みのみ。
   */
  function loadMeetingLogs() {
    try {
      var raw = localStorage.getItem(MEETING_LOGS_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeMeetingLog).filter(Boolean).sort(function (a, b) {
        return String(b.createdAt).localeCompare(String(a.createdAt));
      });
    } catch (e) {
      return [];
    }
  }

  function persistMeetingLogs(list) {
    localStorage.setItem(MEETING_LOGS_KEY, JSON.stringify(list || []));
  }

  /**
   * 1件追加して保存。将来は同期API差し替え用に分離。
   */
  function saveMeetingLog(entry) {
    var normalized = normalizeMeetingLog(entry);
    if (!normalized) return null;
    var list = loadMeetingLogs();
    list.unshift(normalized);
    list.sort(function (a, b) {
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
    try {
      persistMeetingLogs(list);
    } catch (e) {
      var msg = "保存に失敗しました";
      if (e && (e.name === "QuotaExceededError" || e.code === 22)) {
        msg = "保存容量を超えました。古いログを減らしてから再試行してください";
      }
      showToast(msg);
      return null;
    }
    return normalized;
  }

  /**
   * 今回はダミー要約。将来はAI接続に差し替え。
   */
  function generateMeetingSummary(title, content, category) {
    var t = String(title || "").trim() || "会議";
    var body = String(content || "").trim().replace(/\s+/g, " ");
    var short = body.length > 60 ? body.slice(0, 60) + "…" : body;
    var cat = String(category || "").trim();
    var catLine = cat ? "（カテゴリ：" + cat + "）" : "";
    return (
      "今回の会議では\n" +
      t + "について方針を整理しました" + catLine + "。\n" +
      (short ? short : "詳細は本文を参照してください。") +
      "\n（AI要約・ダミー）"
    );
  }

  function filterMeetingLogs(logs, query, category) {
    var q = String(query || "").trim().toLowerCase();
    var cat = String(category || "").trim();
    return (logs || []).filter(function (log) {
      if (cat && log.category !== cat) return false;
      if (!q) return true;
      var files = (log.changedFiles || []).join(" ");
      var hay = (
        log.title + " " +
        log.content + " " +
        log.summary + " " +
        log.category + " " +
        (log.commitId || "") + " " +
        (log.version || "") + " " +
        (log.build || "") + " " +
        files + " " +
        (log.remainingIssues || "") + " " +
        (log.recommendations || "") + " " +
        (log.verification || "") + " " +
        (log.sourceText || "")
      ).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function getMeetingFilterState() {
    var searchEl = document.getElementById("meeting-search");
    var catEl = document.getElementById("meeting-filter-category");
    return {
      query: searchEl ? searchEl.value : "",
      category: catEl ? catEl.value : ""
    };
  }

  function renderMeetingLogs(logs) {
    var container = document.getElementById("meeting-logs-list");
    if (!container) return;
    var state = getMeetingFilterState();
    var filtered = filterMeetingLogs(logs || loadMeetingLogs(), state.query, state.category);

    if (!filtered.length) {
      container.innerHTML = '<p class="empty-message">会議ログがありません。右下から追加できます。</p>';
      return;
    }

    container.innerHTML = filtered.map(function (log) {
      var overview = log.summary
        ? String(log.summary).replace(/\n/g, " ").slice(0, 72)
        : String(log.content).replace(/\n/g, " ").slice(0, 72);
      if ((log.summary || log.content || "").length > 72) overview += "…";
      var badge = log.sourceType === "cursor-report"
        ? '<span class="meeting-card__source">Cursor</span>'
        : "";
      return (
        '<button type="button" class="meeting-card" data-meeting-id="' + escapeHtml(log.id) + '">' +
          '<div class="meeting-card__top">' +
            '<span class="meeting-card__date">' + escapeHtml(formatMeetingDateLabel(log.date || log.createdAt)) + "</span>" +
            '<span class="meeting-card__cat">' + escapeHtml(log.category) + "</span>" +
          "</div>" +
          '<strong class="meeting-card__title">' + escapeHtml(log.title) + "</strong>" +
          badge +
          '<p class="meeting-card__overview">' + escapeHtml(overview) + "</p>" +
        "</button>"
      );
    }).join("");
  }

  function showMeetingView(name) {
    if (meetingListView) meetingListView.hidden = name !== "list";
    if (meetingFormView) meetingFormView.hidden = name !== "form";
    if (meetingDetailView) meetingDetailView.hidden = name !== "detail";
    if (meetingImportView) meetingImportView.hidden = name !== "import";
    if (meetingImportPreviewView) meetingImportPreviewView.hidden = name !== "import-preview";
  }

  function resetMeetingForm() {
    var title = document.getElementById("meeting-title");
    var content = document.getElementById("meeting-content");
    var category = document.getElementById("meeting-category");
    var err = document.getElementById("meeting-form-error");
    if (title) title.value = "";
    if (content) content.value = "";
    if (category) category.value = "";
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
  }

  function openMeetingLogs() {
    if (!meetingLogsModal) return;
    resetMeetingForm();
    currentCursorImportDraft = null;
    showMeetingView("list");
    renderMeetingLogs();
    meetingLogsModal.classList.add("is-open");
    meetingLogsModal.setAttribute("aria-hidden", "false");
    syncBodyScroll();
  }

  function closeMeetingLogs() {
    if (!meetingLogsModal) return;
    meetingLogsModal.classList.remove("is-open");
    meetingLogsModal.setAttribute("aria-hidden", "true");
    showMeetingView("list");
    resetMeetingForm();
    currentCursorImportDraft = null;
    syncBodyScroll();
  }

  /* ========== LINE司令塔 ========== */

  function lineApiBase() {
    try {
      if (location.protocol === "file:") return "";
      return "";
    } catch (e) {
      return "";
    }
  }

  function fetchLineJson(path, options) {
    options = options || {};
    var url = lineApiBase() + path;
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null;
    if (ctrl) {
      timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { /* ignore */ } }, 8000);
    }
    return fetch(url, {
      method: options.method || "GET",
      headers: options.headers || { Accept: "application/json" },
      body: options.body || undefined,
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.json().catch(function () {
        return { ok: false, error: "invalid_json", status: res.status };
      }).then(function (data) {
        data = data || {};
        data._httpStatus = res.status;
        data._okHttp = res.ok;
        return data;
      });
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  function formatLineDate(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return d.toLocaleString("ja-JP");
    } catch (e) {
      return String(iso);
    }
  }

  function lineValueClass(text) {
    var t = String(text || "");
    if (t === "設定済み" || t.indexOf("正常") === 0) return "is-ok";
    if (t === "未設定" || t === "未確認") return "is-unknown";
    if (t.indexOf("注意") === 0 || t.indexOf("未") === 0) return "is-warn";
    return "";
  }

  function renderLineStatusPanel(status, connected) {
    var panel = document.getElementById("line-status-panel");
    var hint = document.getElementById("line-command-hint");
    var preview = document.getElementById("line-morning-preview");
    if (!panel) return;

    if (!connected || !status) {
      if (hint) hint.textContent = "LINE司令塔へ接続できません。既存機能には影響しません。";
      panel.innerHTML =
        '<div class="line-banner line-banner--warn">LINE司令塔へ接続できません</div>' +
        '<div class="line-status__row">' +
          '<span class="line-status__label">接続</span>' +
          '<span class="line-status__value is-warn">未接続</span>' +
        "</div>" +
        '<div class="line-status__row">' +
          '<span class="line-status__label">備考</span>' +
          '<span class="line-status__value is-unknown">Netlify Functions 起動後に再読み込み</span>' +
        "</div>";
      if (preview) {
        preview.hidden = true;
        preview.textContent = "";
      }
      return;
    }

    if (hint) {
      hint.textContent = status.configured
        ? "サーバー連携は応答しています。秘密情報は表示しません。"
        : "接続は可能ですが、環境変数が未設定です。";
    }

    var secrets = status.secrets || {};
    var rows = [
      ["接続", status.ok ? "正常" : "注意", status.ok ? "is-ok" : "is-warn"],
      ["設定完了", status.configured ? "設定済み" : "未設定", status.configured ? "is-ok" : "is-warn"],
      ["LINE_CHANNEL_SECRET", secrets.LINE_CHANNEL_SECRET || "未設定", lineValueClass(secrets.LINE_CHANNEL_SECRET)],
      ["LINE_CHANNEL_ACCESS_TOKEN", secrets.LINE_CHANNEL_ACCESS_TOKEN || "未設定", lineValueClass(secrets.LINE_CHANNEL_ACCESS_TOKEN)],
      ["LINE_ADMIN_USER_ID", secrets.LINE_ADMIN_USER_ID || "未設定", lineValueClass(secrets.LINE_ADMIN_USER_ID)],
      ["APP_BASE_URL", secrets.APP_BASE_URL || "未設定", lineValueClass(secrets.APP_BASE_URL)],
      ["最終Webhook", formatLineDate(status.lastWebhookAt), ""],
      ["最終朝送信", formatLineDate(status.lastMorningPushAt), ""],
      ["最終テスト送信", formatLineDate(status.lastTestPushAt), ""],
      ["会話ステージ", status.conversationStage || "なし", ""],
      ["今日の最優先", (status.todayPriority && status.todayPriority.projectName) || "未設定", ""],
      ["朝スケジュール", status.schedule || "—", ""]
    ];

    panel.innerHTML = (status.configured
      ? '<div class="line-banner line-banner--ok">LINE司令塔に接続できました</div>'
      : '<div class="line-banner line-banner--warn">環境変数が未設定です（秘密情報は表示しません）</div>') +
      rows.map(function (r) {
        return (
          '<div class="line-status__row">' +
            '<span class="line-status__label">' + escapeHtml(r[0]) + "</span>" +
            '<span class="line-status__value ' + escapeHtml(r[2] || "") + '">' + escapeHtml(r[1]) + "</span>" +
          "</div>"
        );
      }).join("");

    if (preview) {
      if (status.morningPreview) {
        preview.hidden = false;
        preview.textContent = "【朝メッセージ プレビュー】\n\n" + status.morningPreview;
      } else {
        preview.hidden = true;
        preview.textContent = "";
      }
    }
  }

  function renderLineHistoryPanel(history) {
    var el = document.getElementById("line-history-panel");
    if (!el) return;
    if (!history || !history.length) {
      el.innerHTML =
        '<p class="line-history__title">直近のLINE操作履歴</p>' +
        '<p class="empty-message">まだ履歴がありません</p>';
      return;
    }
    el.innerHTML =
      '<p class="line-history__title">直近のLINE操作履歴</p>' +
      history.slice(0, 8).map(function (h) {
        return (
          '<div class="line-history__item">' +
            escapeHtml(h.summary || h.type || "操作") +
            '<span class="line-history__meta">' +
              escapeHtml(formatLineDate(h.createdAt || h.at)) +
            "</span>" +
          "</div>"
        );
      }).join("");
  }

  function refreshLineCommandData() {
    var panel = document.getElementById("line-status-panel");
    if (panel) panel.innerHTML = '<p class="empty-message">読み込み中…</p>';

    return Promise.all([
      fetchLineJson(LINE_API.status).catch(function () { return null; }),
      fetchLineJson(LINE_API.history).catch(function () { return null; })
    ]).then(function (pair) {
      var status = pair[0];
      var historyRes = pair[1];
      lineApiConnected = !!(status && status.ok);
      lineStatusCache = lineApiConnected ? status : null;
      lineHistoryCache = (historyRes && historyRes.ok && Array.isArray(historyRes.history))
        ? historyRes.history
        : [];
      renderLineStatusPanel(status, lineApiConnected);
      renderLineHistoryPanel(lineHistoryCache);
    }).catch(function () {
      lineApiConnected = false;
      lineStatusCache = null;
      lineHistoryCache = [];
      renderLineStatusPanel(null, false);
      renderLineHistoryPanel([]);
    });
  }

  function openLineCommand() {
    if (!lineCommandModal) return;
    lineCommandModal.classList.add("is-open");
    lineCommandModal.setAttribute("aria-hidden", "false");
    syncBodyScroll();
    refreshLineCommandData();
  }

  function closeLineCommand() {
    if (!lineCommandModal) return;
    lineCommandModal.classList.remove("is-open");
    lineCommandModal.setAttribute("aria-hidden", "true");
    syncBodyScroll();
  }

  function handleLineSendTest() {
    if (lineTestSending) return;
    if (!window.confirm("管理者へテストメッセージを送信しますか？")) return;
    var btn = document.getElementById("btn-line-send-test");
    lineTestSending = true;
    if (btn) btn.disabled = true;
    fetchLineJson(LINE_API.sendTest, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: "{}"
    }).then(function (data) {
      if (data && data.ok) {
        showToast("テストメッセージを送信しました");
        return refreshLineCommandData();
      }
      showToast("送信できませんでした。設定を確認してください");
    }).catch(function () {
      showToast("送信できませんでした。設定を確認してください");
    }).finally(function () {
      lineTestSending = false;
      if (btn) btn.disabled = false;
    });
  }

  function openMeetingForm() {
    resetMeetingForm();
    showMeetingView("form");
    setTimeout(function () {
      var title = document.getElementById("meeting-title");
      if (title) title.focus();
    }, 40);
  }

  function renderMeetingDetailExtra(log) {
    var extra = document.getElementById("meeting-detail-extra");
    if (!extra) return;
    if (!log || log.sourceType !== "cursor-report") {
      extra.hidden = true;
      extra.innerHTML = "";
      return;
    }
    var files = (log.changedFiles || []).length
      ? (log.changedFiles || []).map(function (f) { return escapeHtml(f); }).join("<br>")
      : "—";
    var versionLine = log.version
      ? escapeHtml(log.version) + (log.build ? " / build " + escapeHtml(log.build) : "")
      : (log.build ? "build " + escapeHtml(log.build) : "—");
    extra.hidden = false;
    extra.innerHTML =
      '<section class="meeting-detail__block">' +
        '<h5 class="meeting-detail__label">取込情報</h5>' +
        '<p class="meeting-detail__content">取込元：Cursor完了報告</p>' +
        '<p class="meeting-detail__content"><strong>バージョン：</strong>' + versionLine + "</p>" +
        '<p class="meeting-detail__content"><strong>コミットID：</strong>' + escapeHtml(log.commitId || "—") + "</p>" +
        '<p class="meeting-detail__content"><strong>変更ファイル：</strong><br>' + files + "</p>" +
        (log.verification
          ? '<p class="meeting-detail__content"><strong>動作確認：</strong><br>' + escapeHtml(log.verification) + "</p>"
          : "") +
        (log.remainingIssues
          ? '<p class="meeting-detail__content"><strong>残っている課題：</strong><br>' + escapeHtml(log.remainingIssues) + "</p>"
          : "") +
        (log.recommendations
          ? '<p class="meeting-detail__content"><strong>次におすすめ：</strong><br>' + escapeHtml(log.recommendations) + "</p>"
          : "") +
      "</section>" +
      (log.sourceText
        ? '<details class="meeting-source-fold">' +
            "<summary>元の報告全文を見る</summary>" +
            '<pre class="meeting-source-fold__body"></pre>' +
          "</details>"
        : "");
    if (log.sourceText) {
      var pre = extra.querySelector(".meeting-source-fold__body");
      if (pre) pre.textContent = log.sourceText;
    }
  }

  function openMeetingDetail(id) {
    var log = loadMeetingLogs().find(function (item) { return item.id === id; });
    if (!log) {
      showToast("会議ログが見つかりません");
      return;
    }
    var meta = document.getElementById("meeting-detail-meta");
    var title = document.getElementById("meeting-detail-title");
    var category = document.getElementById("meeting-detail-category");
    var summary = document.getElementById("meeting-detail-summary");
    var content = document.getElementById("meeting-detail-content");
    if (meta) meta.textContent = formatMeetingDateLabel(log.date || log.createdAt);
    if (title) title.textContent = log.title;
    if (category) category.textContent = log.category;
    if (summary) summary.textContent = log.summary || "（要約なし）";
    if (content) content.textContent = log.content;
    renderMeetingDetailExtra(log);
    showMeetingView("detail");
  }

  function handleMeetingSave() {
    var titleEl = document.getElementById("meeting-title");
    var contentEl = document.getElementById("meeting-content");
    var categoryEl = document.getElementById("meeting-category");
    var err = document.getElementById("meeting-form-error");
    var title = titleEl ? String(titleEl.value || "").trim() : "";
    var content = contentEl ? String(contentEl.value || "").trim() : "";
    var category = categoryEl ? String(categoryEl.value || "").trim() : "";

    function showErr(msg) {
      if (err) {
        err.hidden = false;
        err.textContent = msg;
      }
      showToast(msg);
    }

    if (!title) {
      showErr("タイトルを入力してください");
      if (titleEl) titleEl.focus();
      return;
    }
    if (!content) {
      showErr("今日決めたことを入力してください");
      if (contentEl) contentEl.focus();
      return;
    }
    if (!category || MEETING_CATEGORIES.indexOf(category) === -1) {
      showErr("カテゴリを選択してください");
      if (categoryEl) categoryEl.focus();
      return;
    }
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }

    var now = new Date().toISOString();
    var summary = generateMeetingSummary(title, content, category);
    var saved = saveMeetingLog({
      id: createMeetingLogId(),
      date: now,
      title: title,
      category: category,
      content: content,
      summary: summary,
      createdAt: now
    });
    if (!saved) return;
    showToast("会議ログを保存しました");
    resetMeetingForm();
    showMeetingView("list");
    renderMeetingLogs();
  }

  function handleMeetingListClick(e) {
    var card = e.target.closest(".meeting-card");
    if (!card) return;
    openMeetingDetail(card.getAttribute("data-meeting-id"));
  }

  /* ========== Cursor完了報告 → AI会議ログ取り込み ========== */

  function truncateText(str, max) {
    var s = String(str || "").trim().replace(/\s+/g, " ");
    if (s.length <= max) return s;
    return s.slice(0, max) + "…";
  }

  function extractSection(text, headings) {
    var src = String(text || "").replace(/\r\n/g, "\n");
    var i;
    for (i = 0; i < headings.length; i++) {
      var heading = String(headings[i] || "").trim();
      if (!heading) continue;
      var markerRe = new RegExp(
        "(?:^|\\n)\\s*【?\\s*" + heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*】?\\s*[:：]?\\s*(?:\\n|$)",
        "i"
      );
      var match = markerRe.exec(src);
      if (!match) continue;
      var start = match.index + match[0].length;
      var rest = src.slice(start);
      var endMatch = rest.search(/\n\s*【[^】\n]+】|\n\s*(?:コミットID|Commit(?:\s*ID)?|commit(?:\s*id)?|Version|バージョン|Build|ビルド)\s*[:：]/i);
      var body = endMatch >= 0 ? rest.slice(0, endMatch) : rest;
      body = String(body || "").trim();
      if (body) return body;
    }
    return "";
  }

  function extractTitle(text) {
    var src = String(text || "").replace(/\r\n/g, "\n");
    var m = src.match(/【\s*開発完了\s*】\s*([^\n]+)/);
    if (m && m[1]) return truncateText(m[1], 40);
    var done = extractSection(src, ["今回やったこと", "今回"]);
    if (done) {
      var firstLine = done.split(/\n/).map(function (l) {
        return l.replace(/^[\s・\-\*●○]+/, "").trim();
      }).filter(Boolean)[0];
      if (firstLine) return truncateText(firstLine, 40);
    }
    var commitMsg = src.match(/(?:コミットメッセージ|commit\s*message)\s*[:：]\s*([^\n]+)/i);
    if (commitMsg && commitMsg[1]) return truncateText(commitMsg[1], 40);
    return truncateText(src.replace(/\n+/g, " "), 40) || "Cursor完了報告";
  }

  function detectMeetingCategory(text) {
    var src = String(text || "");
    var rules = [
      {
        name: "開発",
        words: ["実装", "修正", "コード", "ファイル", "バージョン", "コミット", "push", "GitHub", "Netlify", "Cursor", "バグ", "UI", "機能"]
      },
      {
        name: "経営",
        words: ["売上", "利益", "採用", "経営", "資金", "組織", "目標", "会社"]
      },
      {
        name: "ホームページ",
        words: ["ホームページ", "Web", "CorporateSite", "日記", "SEO", "LP", "記事", "公開"]
      },
      {
        name: "イベント",
        words: ["イベント", "出演", "会場", "パフォーマー", "ステージ", "縁日", "ふわふわ"]
      },
      {
        name: "AI",
        words: ["AI", "AI秘書", "AIルーター", "AI会議", "自動化", "ChatGPT", "Cursor Agent"]
      }
    ];
    var scores = {};
    rules.forEach(function (rule) {
      scores[rule.name] = 0;
      rule.words.forEach(function (w) {
        var re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        var matches = src.match(re);
        if (matches) scores[rule.name] += matches.length;
      });
    });
    var best = "その他";
    var bestScore = 0;
    Object.keys(scores).forEach(function (name) {
      if (scores[name] > bestScore) {
        bestScore = scores[name];
        best = name;
      }
    });
    if (bestScore === 0) return "その他";
    if (scores["開発"] === scores["AI"] && scores["開発"] === bestScore && scores["開発"] > 0) {
      var codeHints = /index\.html|script\.js|style\.css|変更したファイル|コミット|build|バージョン/i.test(src);
      return codeHints ? "開発" : "AI";
    }
    return best;
  }

  function extractVersionInfo(text) {
    var src = String(text || "");
    var version = "";
    var build = "";
    var vMatch = src.match(/(?:バージョン|Version)\s*[:：]?\s*v?(\d+\.\d+\.\d+)/i) ||
      src.match(/\bv(\d+\.\d+\.\d+)\b/i) ||
      src.match(/\b(\d+\.\d+\.\d+)\b/);
    if (vMatch) version = vMatch[1];
    var bMatch = src.match(/(?:ビルド|Build)\s*[:：]?\s*(\d+)/i) ||
      src.match(/\bbuild\s*[:：]?\s*(\d+)/i);
    if (bMatch) build = bMatch[1];
    return { version: version, build: build };
  }

  function extractCommitId(text) {
    var src = String(text || "");
    var near = src.match(/(?:コミットID|commit(?:\s*id)?)\s*[:：]?\s*([a-f0-9]{7,40})\b/i);
    if (near) return near[1];
    var all = src.match(/\b([a-f0-9]{7,40})\b/gi) || [];
    var filtered = all.filter(function (id) {
      return !/^\d+$/.test(id) && id.length >= 7;
    });
    if (!filtered.length) return "";
    filtered.sort(function (a, b) { return b.length - a.length; });
    return filtered[0];
  }

  function extractChangedFiles(text) {
    var section = extractSection(text, ["変更したファイル", "変更ファイル"]);
    var src = section || String(text || "");
    var found = src.match(/(?:^|[\s・\-\*])((?:[\w.\-\/]+\/)*[\w.\-]+\.(?:html?|css|js|ts|tsx|jsx|md|json|svg|txt))/gim) || [];
    var files = [];
    found.forEach(function (raw) {
      var name = String(raw).replace(/^[\s・\-\*]+/, "").trim();
      if (name && files.indexOf(name) === -1) files.push(name);
    });
    return files;
  }

  function linesToBullets(sectionText, maxLines) {
    var lines = String(sectionText || "").split(/\n/).map(function (l) {
      return l.replace(/^[\s・\-\*●○]+/, "").trim();
    }).filter(Boolean);
    var unique = [];
    lines.forEach(function (l) {
      var key = l.toLowerCase();
      var dup = unique.some(function (u) { return u.toLowerCase() === key || u.indexOf(l) !== -1 || l.indexOf(u) !== -1; });
      if (!dup) unique.push(l);
    });
    return unique.slice(0, maxLines || 6).map(function (l) { return "・" + l; }).join("\n");
  }

  function buildMeetingContent(parsedSections) {
    var parts = [];
    if (parsedSections.did) parts.push(linesToBullets(parsedSections.did, 4));
    if (parsedSections.reason) parts.push(linesToBullets(parsedSections.reason, 2));
    if (parsedSections.value) parts.push(linesToBullets(parsedSections.value, 2));
    var joined = parts.filter(Boolean).join("\n");
    if (joined) return joined;
    return linesToBullets(parsedSections.fallback || "", 4) || "・Cursor完了報告を取り込みました";
  }

  function buildMeetingSummary(draft) {
    var title = draft.title || "今回の開発";
    var content = String(draft.content || "").replace(/^・/gm, "").replace(/\n/g, "、");
    var short = truncateText(content, 80);
    return (
      "今回の開発では、" + title + "を進め、" +
      (short || "必要な変更を反映しました") + "。" +
      (draft.category ? "カテゴリは「" + draft.category + "」です。" : "")
    );
  }

  function parseCursorReport(rawText) {
    var text = String(rawText || "").replace(/\r\n/g, "\n").trim();
    var shortWarning = text.length > 0 && text.length < 40;
    var did = extractSection(text, ["今回やったこと", "今回追加された価値", "今回", "変更内容"]);
    var reason = extractSection(text, ["変更理由"]);
    var value = extractSection(text, ["今回追加された価値"]);
    var verification = extractSection(text, ["動作確認", "確認した内容"]);
    var remainingIssues = extractSection(text, ["残っている課題"]);
    var recommendations = extractSection(text, ["次におすすめする作業", "次におすすめ", "改善提案"]);
    var versionInfo = extractVersionInfo(text);
    var commitId = extractCommitId(text);
    var changedFiles = extractChangedFiles(text);
    var title = extractTitle(text);
    var category = detectMeetingCategory(text);
    var content = buildMeetingContent({
      did: did || extractSection(text, ["変更内容"]),
      reason: reason,
      value: value,
      fallback: text.slice(0, 400)
    });
    var draft = {
      title: title,
      category: category,
      content: content,
      summary: "",
      version: versionInfo.version,
      build: versionInfo.build,
      commitId: commitId,
      changedFiles: changedFiles,
      verification: linesToBullets(verification, 4) || truncateText(verification, 200),
      remainingIssues: linesToBullets(remainingIssues, 4) || truncateText(remainingIssues, 200),
      recommendations: linesToBullets(recommendations, 4) || truncateText(recommendations, 200),
      sourceType: "cursor-report",
      sourceText: text,
      shortWarning: shortWarning
    };
    draft.summary = buildMeetingSummary(draft);
    return draft;
  }

  function openCursorReportImport() {
    currentCursorImportDraft = null;
    var input = document.getElementById("cursor-report-input");
    var err = document.getElementById("meeting-import-error");
    var hint = document.getElementById("meeting-import-hint");
    if (input) input.value = "";
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    if (hint) {
      hint.hidden = true;
      hint.textContent = "";
    }
    showMeetingView("import");
    setTimeout(function () {
      if (input) input.focus();
    }, 40);
  }

  function closeCursorReportImport() {
    currentCursorImportDraft = null;
    showMeetingView("list");
    renderMeetingLogs();
  }

  function renderImportPreview(draft) {
    currentCursorImportDraft = draft;
    var title = document.getElementById("import-preview-title");
    var category = document.getElementById("import-preview-category");
    var content = document.getElementById("import-preview-content");
    var summary = document.getElementById("import-preview-summary");
    var meta = document.getElementById("import-preview-meta");
    var note = document.getElementById("meeting-import-preview-note");
    var err = document.getElementById("meeting-import-preview-error");
    var fold = document.getElementById("import-source-fold");
    var sourceText = document.getElementById("import-source-text");
    if (title) title.value = draft.title || "";
    if (category) category.value = draft.category || "その他";
    if (content) content.value = draft.content || "";
    if (summary) summary.value = draft.summary || "";
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    if (note) {
      if (draft.shortWarning) {
        note.hidden = false;
        note.textContent = "内容が短いため、一部を手動で確認してください";
      } else {
        note.hidden = true;
        note.textContent = "";
      }
    }
    if (meta) {
      meta.innerHTML =
        '<p><strong>バージョン：</strong>' + escapeHtml(draft.version || "—") +
          (draft.build ? " / build " + escapeHtml(draft.build) : "") + "</p>" +
        '<p><strong>コミットID：</strong>' + escapeHtml(draft.commitId || "—") + "</p>" +
        '<p><strong>変更ファイル：</strong>' +
          escapeHtml((draft.changedFiles || []).length ? draft.changedFiles.join(", ") : "—") + "</p>" +
        '<p><strong>残っている課題：</strong><br>' + escapeHtml(draft.remainingIssues || "—") + "</p>" +
        '<p><strong>次におすすめ：</strong><br>' + escapeHtml(draft.recommendations || "—") + "</p>";
    }
    if (fold) fold.hidden = true;
    if (sourceText) sourceText.textContent = draft.sourceText || "";
    showMeetingView("import-preview");
  }

  function handleCursorReportParse() {
    var input = document.getElementById("cursor-report-input");
    var err = document.getElementById("meeting-import-error");
    var text = input ? String(input.value || "").trim() : "";
    if (!text) {
      if (err) {
        err.hidden = false;
        err.textContent = "Cursorの完了報告を貼り付けてください";
      }
      showToast("Cursorの完了報告を貼り付けてください");
      if (input) input.focus();
      return;
    }
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    var draft = parseCursorReport(text);
    renderImportPreview(draft);
  }

  function readImportPreviewDraft() {
    var title = document.getElementById("import-preview-title");
    var category = document.getElementById("import-preview-category");
    var content = document.getElementById("import-preview-content");
    var summary = document.getElementById("import-preview-summary");
    var base = currentCursorImportDraft || {};
    return {
      title: title ? String(title.value || "").trim() : "",
      category: category ? String(category.value || "").trim() : "その他",
      content: content ? String(content.value || "").trim() : "",
      summary: summary ? String(summary.value || "").trim() : "",
      version: base.version || "",
      build: base.build || "",
      commitId: base.commitId || "",
      changedFiles: base.changedFiles || [],
      verification: base.verification || "",
      remainingIssues: base.remainingIssues || "",
      recommendations: base.recommendations || "",
      sourceType: "cursor-report",
      sourceText: base.sourceText || ""
    };
  }

  function saveImportedMeetingLog() {
    var draft = readImportPreviewDraft();
    var err = document.getElementById("meeting-import-preview-error");
    if (!draft.title || !draft.content) {
      if (err) {
        err.hidden = false;
        err.textContent = "タイトルと今日決めたことを入力してください";
      }
      showToast("タイトルと今日決めたことを入力してください");
      return;
    }
    if (MEETING_CATEGORIES.indexOf(draft.category) === -1) draft.category = "その他";
    if (!draft.summary) draft.summary = buildMeetingSummary(draft);
    var now = new Date().toISOString();
    var saved = saveMeetingLog({
      id: createMeetingLogId(),
      date: now,
      title: draft.title,
      category: draft.category,
      content: draft.content,
      summary: draft.summary,
      createdAt: now,
      sourceType: "cursor-report",
      sourceText: draft.sourceText,
      version: draft.version,
      build: draft.build,
      commitId: draft.commitId,
      changedFiles: draft.changedFiles,
      verification: draft.verification,
      remainingIssues: draft.remainingIssues,
      recommendations: draft.recommendations,
      importedAt: now
    });
    if (!saved) return;
    currentCursorImportDraft = null;
    showToast("AI会議ログへ保存しました");
    showMeetingView("list");
    renderMeetingLogs();
  }

  /* ========== AI秘書（今日何した？） ========== */

  function clearSecretaryPhoto() {
    if (secretaryPhotoUrl) {
      try { URL.revokeObjectURL(secretaryPhotoUrl); } catch (e) { /* ignore */ }
    }
    secretaryPhotoUrl = "";
    secretaryPhotoName = "";

    ["secretary-photo", "home-secretary-photo"].forEach(function (id) {
      var input = document.getElementById(id);
      if (input) input.value = "";
    });

    var modalPreview = document.getElementById("secretary-photo-preview");
    var modalImg = document.getElementById("secretary-photo-img");
    if (modalImg) modalImg.removeAttribute("src");
    if (modalPreview) modalPreview.hidden = true;

    var homePreview = document.getElementById("home-photo-preview");
    var homeImg = document.getElementById("home-photo-img");
    if (homeImg) homeImg.removeAttribute("src");
    if (homePreview) homePreview.hidden = true;
  }

  function resetSecretaryInput() {
    var input = document.getElementById("secretary-input");
    if (input) input.value = "";
    var homeInput = document.getElementById("home-secretary-input");
    if (homeInput) homeInput.value = "";
    clearSecretaryPhoto();
    currentSecretaryResults = null;
  }

  function showSecretaryView(name) {
    if (secretaryInputView) secretaryInputView.hidden = name !== "input";
    if (secretaryResultView) secretaryResultView.hidden = name !== "result";
  }

  function openSecretaryResultModal() {
    if (!secretaryModal) return;
    showSecretaryView("result");
    secretaryModal.classList.add("is-open");
    secretaryModal.setAttribute("aria-hidden", "false");
    syncBodyScroll();
  }

  function openAiSecretary() {
    if (!secretaryModal) return;
    showSecretaryView("input");
    secretaryModal.classList.add("is-open");
    secretaryModal.setAttribute("aria-hidden", "false");
    syncBodyScroll();
    setTimeout(function () {
      var input = document.getElementById("secretary-input");
      if (input) {
        var homeInput = document.getElementById("home-secretary-input");
        if (homeInput && homeInput.value && !input.value) {
          input.value = homeInput.value;
        }
        input.focus();
      }
    }, 50);
  }

  function closeAiSecretary() {
    if (cursorHandoffModal && cursorHandoffModal.classList.contains("is-open")) {
      closeCursorHandoffModal();
    }
    if (!secretaryModal) return;
    secretaryModal.classList.remove("is-open");
    secretaryModal.setAttribute("aria-hidden", "true");
    currentSecretaryResults = null;
    currentCursorInstruction = "";
    currentCursorHandoff = null;
    showSecretaryView("input");
    syncBodyScroll();
  }

  function applySecretaryPhotoFile(file, previewId, imgId) {
    if (!file) {
      clearSecretaryPhoto();
      return;
    }
    if (secretaryPhotoUrl) {
      try { URL.revokeObjectURL(secretaryPhotoUrl); } catch (e) { /* ignore */ }
    }
    secretaryPhotoUrl = URL.createObjectURL(file);
    secretaryPhotoName = file.name || "photo.jpg";
    var preview = document.getElementById(previewId);
    var img = document.getElementById(imgId);
    if (img) img.src = secretaryPhotoUrl;
    if (preview) preview.hidden = false;
  }

  function handleSecretaryPhotoChange() {
    var input = document.getElementById("secretary-photo");
    if (!input || !input.files || !input.files[0]) {
      clearSecretaryPhoto();
      return;
    }
    applySecretaryPhotoFile(input.files[0], "secretary-photo-preview", "secretary-photo-img");
  }

  function handleHomePhotoChange() {
    var input = document.getElementById("home-secretary-photo");
    if (!input || !input.files || !input.files[0]) {
      clearSecretaryPhoto();
      return;
    }
    applySecretaryPhotoFile(input.files[0], "home-photo-preview", "home-photo-img");
  }

  /**
   * 将来AI接続用。今回はダミー生成のみ。
   * @param {{ text: string, photoName?: string }} context
   */
  function generateSecretaryOutputs(context) {
    context = context || {};
    var text = String(context.text || "").trim() || "今日の活動";
    var photoName = String(context.photoName || "").trim();
    var photoLine = photoName ? "写真メモ：" + photoName : "写真：なし";
    var short = text.length > 80 ? text.slice(0, 80) + "…" : text;
    var today = new Date();
    var publishDate =
      today.getFullYear() + "." +
      String(today.getMonth() + 1).padStart(2, "0") + "." +
      String(today.getDate()).padStart(2, "0");
    var articleTitle = "今日のえがお — " + short;
    var articleBody =
      text + "\n\n" +
      "株式会社えがおのきろくでは、現場のできごとを活動日記として公開しています。\n" +
      photoLine;

    return Promise.resolve({
      sourceText: text,
      photoName: photoName,
      publishDate: publishDate,
      articleTitle: articleTitle,
      articleBody: articleBody,
      diary:
        "【活動日記 " + publishDate + "】\n" +
        text + "\n\n" +
        photoLine + "\n" +
        "（AI下書き・ダミー）今後この内容を diary/index.htm へ反映できます。",
      homepage:
        "【ホームページ記事】\n" +
        "タイトル：" + articleTitle + "\n\n" +
        articleBody,
      instagram:
        "📱 Instagram投稿（ダミー）\n\n" +
        text + "\n\n" +
        "#えがおのきろく #大道芸 #イベント #縁日\n" +
        photoLine,
      facebook:
        "📘 Facebook投稿（ダミー）\n\n" +
        "本日の活動をご報告します。\n\n" +
        text + "\n\n" +
        "詳しくはホームページの活動日記もご覧ください。\n" +
        photoLine,
      x:
        "𝕏 投稿（ダミー）\n\n" +
        short + "\n" +
        "#えがおのきろく",
      devLog:
        "【Smile AI Studio 開発ログ】\n" +
        "日時：" + today.toISOString() + "\n" +
        "入力：" + text + "\n" +
        photoLine + "\n" +
        "生成物：活動日記 / HP記事 / Instagram / Facebook / X / 開発ログ\n" +
        "状態：ダミー生成（AI未接続）"
    });
  }

  function renderSecretaryResults(results) {
    var container = document.getElementById("secretary-results");
    if (!container || !results) return;

    var homepageText = results.diary
      ? results.diary + "\n\n----------\n\n" + results.homepage
      : results.homepage;

    var cards = [
      {
        key: "homepage",
        label: "ホームページ",
        icon: "🌐",
        text: homepageText,
        primaryAction: true
      },
      { key: "instagram", label: "Instagram", icon: "📸", text: results.instagram },
      { key: "facebook", label: "Facebook", icon: "📘", text: results.facebook },
      { key: "x", label: "X", icon: "𝕏", text: results.x },
      { key: "devLog", label: "開発ログ", icon: "🛠️", text: results.devLog }
    ];

    container.innerHTML = cards.map(function (card) {
      var actionHtml = card.primaryAction
        ? '<button type="button" class="btn btn--primary btn--touch btn-cursor-send" id="btn-cursor-send">' +
            "Cursorへ送る</button>" +
          '<p class="form-hint secretary-card__hint">CorporateSite更新用の完全な指示書をコピーします</p>'
        : '<button type="button" class="btn btn--secondary btn--touch btn-secretary-copy" data-copy-key="' +
            escapeHtml(card.key) + '">コピー</button>';

      return (
        '<article class="secretary-card' + (card.primaryAction ? " secretary-card--primary" : "") +
          '" data-secretary-key="' + escapeHtml(card.key) + '">' +
          '<div class="secretary-card__head">' +
            '<h4 class="secretary-card__title">' +
              escapeHtml(card.icon + " " + card.label) +
            "</h4>" +
          "</div>" +
          '<div class="secretary-card__body">' + escapeHtml(card.text) + "</div>" +
          '<div class="secretary-card__actions">' + actionHtml + "</div>" +
        "</article>"
      );
    }).join("");
  }

  function runSecretaryGeneration(text, btn) {
    if (!text) {
      showToast("今日やったことを入力してください");
      return;
    }
    if (btn) btn.disabled = true;

    generateSecretaryOutputs({
      text: text,
      photoName: secretaryPhotoName || ""
    }).then(function (results) {
      currentSecretaryResults = results;
      currentCursorInstruction = "";
      currentCursorHandoff = null;
      renderSecretaryResults(results);
      openSecretaryResultModal();
      showToast("下書きを作成しました");
    }).catch(function () {
      showToast("生成に失敗しました");
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function handleHomeAiRun() {
    var input = document.getElementById("home-secretary-input");
    var text = input ? String(input.value || "").trim() : "";
    if (!text) {
      showToast("今日やったことを入力してください");
      if (input) input.focus();
      return;
    }
    var modalInput = document.getElementById("secretary-input");
    if (modalInput) modalInput.value = text;
    runSecretaryGeneration(text, document.getElementById("btn-home-ai-run"));
  }

  function handleSecretaryRun() {
    var input = document.getElementById("secretary-input");
    var text = input ? String(input.value || "").trim() : "";
    if (!text) {
      showToast("今日やったことを入力してください");
      if (input) input.focus();
      return;
    }
    var homeInput = document.getElementById("home-secretary-input");
    if (homeInput) homeInput.value = text;
    runSecretaryGeneration(text, document.getElementById("btn-secretary-run"));
  }

  function handleSecretaryResultsClick(e) {
    var sendBtn = e.target.closest(".btn-cursor-send");
    if (sendBtn) {
      try {
        var prepared = prepareCorporateSiteHandoff();
        openCursorHandoffModal();
        copyText(prepared.instruction).then(function () {
          showToast("Cursor用の指示をコピーしました");
        }).catch(function () {
          showToast("自動コピーに失敗しました。「もう一度コピー」を押してください");
        });
      } catch (err) {
        showToast("指示書の作成に失敗しました");
      }
      return;
    }

    var btn = e.target.closest(".btn-secretary-copy");
    if (!btn || !currentSecretaryResults) return;
    var key = btn.getAttribute("data-copy-key");
    var map = {
      instagram: currentSecretaryResults.instagram,
      facebook: currentSecretaryResults.facebook,
      x: currentSecretaryResults.x,
      devLog: currentSecretaryResults.devLog
    };
    var text = map[key] || "";
    if (!text) {
      showToast("コピーする内容がありません");
      return;
    }
    copyText(text).then(function () {
      showToast("コピーしました");
    }).catch(function () {
      showToast("コピーに失敗しました");
    });
  }

  /* ========== Cursorへ送る（CorporateSite連携） ========== */

  function loadCursorHandoffs() {
    try {
      var raw = localStorage.getItem(CURSOR_HANDOFFS_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveCursorHandoffs(list) {
    try {
      localStorage.setItem(CURSOR_HANDOFFS_KEY, JSON.stringify((list || []).slice(0, 30)));
    } catch (e) { /* ignore */ }
  }

  function buildCorporateSiteInstruction(payload) {
    payload = payload || currentSecretaryResults || {};
    var publishDate = payload.publishDate || "";
    var title = payload.articleTitle || "";
    var body = payload.articleBody || "";
    var photoName = payload.photoName || "";
    var photoSection = photoName
      ? ("写真名または写真メモ：\n" + photoName + "\n\n" +
        "写真ファイルそのものはSmile AI Studioから送信されていません。\n" +
        "写真がCorporateSite内に存在しない場合は、勝手に存在するものとしてHTMLへ追加しないこと。\n" +
        "必要な保存先とファイル名を報告すること。")
      : "写真：なし（写真なしの記事として追加する）";

    return [
      "【作業対象】",
      "株式会社えがおのきろく公式ホームページ",
      "CorporateSite",
      "",
      "【最初に確認すること】",
      "・現在開いているプロジェクトがCorporateSiteであること",
      "・SmileAIStudioではないこと",
      "・対象ファイルが diary/index.htm であること",
      "・既存ページの文字コードを確認すること",
      "・既存の日記記事のHTML構造を確認すること",
      "",
      "【重要】",
      "・Smile AI Studioのindex.html、style.css、script.jsは変更しない",
      "・CorporateSite以外のファイルを変更しない",
      "・既存の記事を削除しない",
      "・既存デザインを壊さない",
      "・文字コードを勝手に変更しない",
      "・新しい記事は既存ルールに従った位置へ追加する",
      "・GitHubへpushしない",
      "・FTPアップロードしない",
      "・本番公開しない",
      "・ローカル確認まで行う",
      "",
      "【追加する活動日記】",
      "公開日：",
      publishDate,
      "タイトル：",
      title,
      "本文：",
      body,
      "写真：",
      photoName || "なし",
      "",
      "【作業内容】",
      "1. CorporateSiteの構成を確認する",
      "2. diary/index.htmを確認する",
      "3. 既存の日記記事の形式を確認する",
      "4. 新しい記事を既存形式に合わせて追加する",
      "5. 写真の配置先と参照方法を確認する",
      "6. 文字化けやHTML崩れがないか確認する",
      "7. ローカル表示で記事を確認する",
      "",
      "【写真について】",
      photoSection,
      "",
      "【完了報告】",
      "・変更したファイル",
      "・追加した記事",
      "・写真の状態",
      "・ローカル確認結果",
      "・本番公開前に必要な作業",
      "・残っている問題"
    ].join("\n");
  }

  function prepareCorporateSiteHandoff(payload) {
    if (!payload && !currentSecretaryResults) {
      throw new Error("no results");
    }
    var source = payload || currentSecretaryResults;
    var instruction = buildCorporateSiteInstruction(source);
    currentCursorInstruction = instruction;

    var handoff = {
      id: "handoff-" + Date.now(),
      createdAt: new Date().toISOString(),
      sourceText: source.sourceText || "",
      articleTitle: source.articleTitle || "",
      articleBody: source.articleBody || "",
      publishDate: source.publishDate || "",
      photoName: source.photoName || "",
      instruction: instruction,
      status: "copied"
    };
    currentCursorHandoff = handoff;

    var list = loadCursorHandoffs();
    list.unshift(handoff);
    saveCursorHandoffs(list);
    return handoff;
  }

  function copyCorporateSiteInstruction(payload) {
    var handoff = prepareCorporateSiteHandoff(payload);
    return copyText(handoff.instruction).then(function () {
      return { handoff: handoff, copied: true };
    }).catch(function () {
      return { handoff: handoff, copied: false };
    });
  }

  function renderCursorInstructionPreview(handoff) {
    var preview = document.getElementById("cursor-handoff-preview");
    var full = document.getElementById("cursor-handoff-full");
    var data = handoff || currentCursorHandoff || {};
    if (preview) {
      preview.innerHTML =
        '<div class="cursor-handoff__summary">' +
          "<p><strong>作業対象：</strong>CorporateSite</p>" +
          "<p><strong>対象ファイル：</strong>diary/index.htm</p>" +
          "<p><strong>記事タイトル：</strong>" + escapeHtml(data.articleTitle || "—") + "</p>" +
          "<p><strong>公開日：</strong>" + escapeHtml(data.publishDate || "—") + "</p>" +
        "</div>";
    }
    if (full) {
      full.textContent = data.instruction || currentCursorInstruction || "";
      full.hidden = true;
    }
    var showBtn = document.getElementById("btn-cursor-show-instruction");
    if (showBtn) showBtn.textContent = "指示内容を見る";
  }

  function openCursorHandoffModal() {
    if (!cursorHandoffModal) return;
    registerAction("openCursorHandoff");

    var photoNote = document.getElementById("cursor-handoff-photo-note");
    var hasPhoto = !!(currentCursorHandoff && currentCursorHandoff.photoName);
    if (photoNote) {
      photoNote.textContent = hasPhoto
        ? "写真をCorporateSiteの指定フォルダへ追加する作業が別途必要です"
        : "写真なしの記事として指示書を作成しました";
    }

    renderCursorInstructionPreview(currentCursorHandoff);
    cursorHandoffModal.classList.add("is-open");
    cursorHandoffModal.setAttribute("aria-hidden", "false");
    syncBodyScroll();
  }

  function closeCursorHandoffModal() {
    if (!cursorHandoffModal) return;
    cursorHandoffModal.classList.remove("is-open");
    cursorHandoffModal.setAttribute("aria-hidden", "true");
    var full = document.getElementById("cursor-handoff-full");
    if (full) full.hidden = true;
    syncBodyScroll();
  }

  function openCursorAgent() {
    try {
      window.open(CURSOR_AGENT_URL, "_blank", "noopener,noreferrer");
      showToast("Cursorを開きました。コピー済みの指示を貼り付けて送信してください");
    } catch (e) {
      showToast("Cursorを開けませんでした。手動で開いて貼り付けてください");
    }
  }

  function handleCursorCopyAgain() {
    var text = currentCursorInstruction ||
      (currentCursorHandoff && currentCursorHandoff.instruction) || "";
    if (!text) {
      showToast("指示書がありません");
      return;
    }
    copyText(text).then(function () {
      showToast("もう一度コピーしました");
    }).catch(function () {
      showToast("コピーに失敗しました");
    });
  }

  function handleToggleCursorInstruction() {
    var full = document.getElementById("cursor-handoff-full");
    var btn = document.getElementById("btn-cursor-show-instruction");
    if (!full) return;
    var open = full.hidden;
    full.hidden = !open;
    if (btn) btn.textContent = open ? "指示内容を閉じる" : "指示内容を見る";
  }

  /* ========== Events ========== */
  onClick("btn-new-request", function () {
    openModal();
  }, "openRequestModal");

  onClick("btn-ai-request-hero", function () {
    openModal();
  }, "openRequestModalHero");

  onClick("btn-ai-secretary", function () {
    openAiSecretary();
  }, "openAiSecretary");
  onClick("secretary-close", closeAiSecretary, "closeAiSecretary");
  onClick("btn-secretary-close-result", closeAiSecretary);
  onClick("btn-secretary-run", handleSecretaryRun);
  onClick("btn-home-ai-run", handleHomeAiRun, "runHomeSecretary");
  onClick("btn-secretary-again", function () {
    closeAiSecretary();
    showAppView("home");
    setTimeout(function () {
      var input = document.getElementById("home-secretary-input");
      if (input) input.focus();
    }, 50);
  });
  onClick("btn-secretary-photo-clear", clearSecretaryPhoto);
  onClick("btn-home-photo-clear", clearSecretaryPhoto);
  var secretaryPhotoInput = document.getElementById("secretary-photo");
  if (secretaryPhotoInput) {
    secretaryPhotoInput.addEventListener("change", handleSecretaryPhotoChange);
  }
  var homePhotoInput = document.getElementById("home-secretary-photo");
  if (homePhotoInput) {
    homePhotoInput.addEventListener("change", handleHomePhotoChange);
  }
  var secretaryResultsEl = document.getElementById("secretary-results");
  if (secretaryResultsEl) {
    secretaryResultsEl.addEventListener("click", handleSecretaryResultsClick);
  }
  if (secretaryModal) {
    secretaryModal.addEventListener("click", function (e) {
      if (e.target === secretaryModal) closeAiSecretary();
    });
  }

  onClick("cursor-handoff-close", closeCursorHandoffModal, "closeCursorHandoff");
  onClick("btn-cursor-handoff-close", closeCursorHandoffModal);
  onClick("btn-cursor-open", openCursorAgent, "openCursorAgent");
  onClick("btn-cursor-copy-again", handleCursorCopyAgain);
  onClick("btn-cursor-show-instruction", handleToggleCursorInstruction);
  if (cursorHandoffModal) {
    cursorHandoffModal.addEventListener("click", function (e) {
      if (e.target === cursorHandoffModal) closeCursorHandoffModal();
    });
  }

  onClick("btn-nav-home", function () {
    showAppView("home");
  }, "showHomeView");
  onClick("btn-nav-projects", function () {
    showAppView("projects");
  }, "scrollToProjects");
  onClick("btn-nav-more", function () {
    showAppView("more");
  }, "showMoreView");
  onClick("btn-back-home-from-projects", function () {
    showAppView("home");
  });
  onClick("btn-back-home-from-more", function () {
    showAppView("home");
  });
  var familyPhotoInput = document.getElementById("home-family-photo-input");
  if (familyPhotoInput) {
    familyPhotoInput.addEventListener("change", handleFamilyPhotoChange);
  }
  onClick("btn-top-priority-edit", function () {
    setTopPriorityEditMode(true);
  });
  onClick("btn-top-priority-save", handleTopPrioritySave);
  var topPriorityInput = document.getElementById("home-top-priority-input");
  if (topPriorityInput) {
    topPriorityInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        handleTopPrioritySave();
      }
    });
  }

  onClick("btn-manage-projects", function () {
    openProjectModal({ mode: "list" });
  }, "openProjectManager");

  onClick("btn-add-project", function () {
    openProjectModal({ mode: "create" });
  }, "openProjectCreate");

  onClick("btn-system-check", function () {
    openSystemCheck();
  }, "openSystemCheck");

  onClick("btn-release-center", function () {
    openReleaseCenter();
  }, "openReleaseCenter");

  onClick("project-detail-close", closeProjectDetail, "closeProjectDetail");
  if (projectDetailModal) {
    projectDetailModal.addEventListener("click", function (e) {
      if (e.target === projectDetailModal) closeProjectDetail();
    });
  }

  onClick("btn-web-center", function () {
    openWebCenter();
  }, "openWebCenter");
  onClick("web-center-close", closeWebCenter, "closeWebCenter");
  onClick("btn-web-center-close-menu", closeWebCenter);
  onClick("btn-meeting-logs", function () {
    openMeetingLogs();
  }, "openMeetingLogs");
  onClick("meeting-logs-close", closeMeetingLogs, "closeMeetingLogs");
  onClick("btn-line-command", function () {
    openLineCommand();
  }, "openLineCommand");
  onClick("line-command-close", closeLineCommand, "closeLineCommand");
  onClick("btn-line-command-close", closeLineCommand);
  onClick("btn-line-refresh", function () {
    refreshLineCommandData();
  });
  onClick("btn-line-send-test", handleLineSendTest);
  if (lineCommandModal) {
    lineCommandModal.addEventListener("click", function (e) {
      if (e.target === lineCommandModal) closeLineCommand();
    });
  }
  onClick("btn-meeting-new", openMeetingForm);
  onClick("btn-meeting-save", handleMeetingSave);
  onClick("btn-meeting-back-list", function () {
    resetMeetingForm();
    showMeetingView("list");
    renderMeetingLogs();
  });
  onClick("btn-meeting-detail-back", function () {
    showMeetingView("list");
    renderMeetingLogs();
  });
  onClick("btn-cursor-report-import", openCursorReportImport, "openCursorReportImport");
  onClick("btn-cursor-report-parse", handleCursorReportParse);
  onClick("btn-cursor-report-close", closeCursorReportImport, "closeCursorReportImport");
  onClick("btn-import-save", saveImportedMeetingLog);
  onClick("btn-import-show-source", function () {
    var fold = document.getElementById("import-source-fold");
    if (!fold) return;
    fold.hidden = false;
    fold.open = true;
  });
  onClick("btn-import-retry", openCursorReportImport);
  onClick("btn-import-cancel", closeCursorReportImport);
  var meetingSearch = document.getElementById("meeting-search");
  if (meetingSearch) {
    meetingSearch.addEventListener("input", function () {
      renderMeetingLogs();
    });
  }
  var meetingFilterCategory = document.getElementById("meeting-filter-category");
  if (meetingFilterCategory) {
    meetingFilterCategory.addEventListener("change", function () {
      renderMeetingLogs();
    });
  }
  var meetingLogsList = document.getElementById("meeting-logs-list");
  if (meetingLogsList) {
    meetingLogsList.addEventListener("click", handleMeetingListClick);
  }
  if (meetingLogsModal) {
    meetingLogsModal.addEventListener("click", function (e) {
      if (e.target === meetingLogsModal) closeMeetingLogs();
    });
  }
  onClick("btn-web-new-diary", function () {
    openWebDiaryForm(null);
  });
  onClick("btn-web-drafts", openWebDrafts);
  onClick("btn-web-published", openWebPublished);
  onClick("btn-web-back-menu", function () {
    showWebCenterView("menu");
  });
  onClick("btn-web-back-from-drafts", function () {
    showWebCenterView("menu");
  });
  onClick("btn-web-back-from-published", function () {
    showWebCenterView("menu");
  });
  onClick("btn-web-ai-write", handleWebAiWrite);
  onClick("btn-web-save-draft", handleSaveWebDiaryDraft);
  onClick("btn-web-save-published", handleSaveWebDiaryPublished);
  onClick("btn-web-build-instruction", handleBuildWebInstruction);
  onClick("btn-web-copy-instruction", handleCopyWebInstruction);
  onClick("btn-web-back-from-instruction", function () {
    showWebCenterView("form");
  });
  onClick("btn-web-instruction-to-menu", function () {
    showWebCenterView("menu");
  });
  if (webCenterModal) {
    webCenterModal.addEventListener("click", function (e) {
      if (e.target === webCenterModal) closeWebCenter();
    });
  }
  if (webCenterFormView) {
    webCenterFormView.addEventListener("submit", function (e) {
      e.preventDefault();
      handleSaveWebDiaryDraft();
    });
  }
  var webDraftsList = document.getElementById("web-drafts-list");
  if (webDraftsList) webDraftsList.addEventListener("click", handleWebListClick);
  var webPublishedList = document.getElementById("web-published-list");
  if (webPublishedList) webPublishedList.addEventListener("click", handleWebListClick);

  onClick("btn-new-project", function () {
    openProjectForm(null);
  }, "openProjectForm");

  onClick("project-modal-close", closeProjectModal, "closeProjectModal");
  onClick("btn-cancel-project-form", function () {
    showProjectListView();
  });

  if (projectFormView) {
    projectFormView.addEventListener("submit", handleProjectFormSubmit);
  }
  var projectMgmtList = document.getElementById("project-mgmt-list");
  if (projectMgmtList) {
    projectMgmtList.addEventListener("click", handleProjectMgmtClick);
  }

  if (projectModal) {
    projectModal.addEventListener("click", function (e) {
      if (e.target === projectModal) closeProjectModal();
    });
  }

  onClick("modal-close", closeModal, "closeRequestModal");
  onClick("modal-cancel", closeModal, "closeRequestModal");
  onClick("modal-cancel-result", closeModal, "closeRequestModal");

  onClick("btn-route", handleRoute, "runRouter");
  onClick("btn-build-prompt", handleBuildPrompt, "buildPrompt");

  onClick("btn-back-to-input", function () {
    currentGeneratedPrompt = "";
    showView("input");
    clearValidation();
  });

  onClick("btn-copy-prompt", function () {
    copyText(currentGeneratedPrompt).then(function () {
      showToast("指示書をコピーしました");
    }).catch(function () {
      showToast("コピーに失敗しました");
    });
  }, "copyPrompt");

  onClick("btn-edit-prompt", function () {
    currentGeneratedPrompt = "";
    clearValidation();
    showView("input");
    var wantEl = document.getElementById("req-content");
    if (wantEl) {
      wantEl.focus();
      wantEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  onClick("btn-save-from-result", function () {
    saveCurrentRequest();
  }, "saveRequest");

  if (btnToggleDetails) {
    btnToggleDetails.addEventListener("click", function () {
      setDetailsOpen(!detailsOpen);
    });
  }

  onClick("prompt-view-close", closePromptView);
  onClick("prompt-view-cancel", closePromptView);

  onClick("btn-copy-viewed-prompt", function () {
    copyText(viewedPrompt).then(function () {
      showToast("指示書をコピーしました");
    }).catch(function () {
      showToast("コピーに失敗しました");
    });
  });

  if (modal) {
    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeModal();
    });
  }

  if (promptViewModal) {
    promptViewModal.addEventListener("click", function (e) {
      if (e.target === promptViewModal) closePromptView();
    });
  }

  if (systemCheckModal) {
    systemCheckModal.addEventListener("click", function (e) {
      if (e.target === systemCheckModal) closeSystemCheck();
    });
  }

  onClick("system-check-close", closeSystemCheck);
  onClick("btn-close-system-check", closeSystemCheck);
  onClick("btn-run-system-check", runAllSystemChecks);
  onClick("btn-rerun-system-check", runAllSystemChecks);
  onClick("btn-copy-system-check", copySystemCheckResults);
  onClick("btn-clear-runtime-errors", clearRuntimeErrors);
  onClick("btn-reset-manual-checklist", resetManualChecklist);

  onClick("release-center-close", closeReleaseCenter);
  onClick("btn-release-close", closeReleaseCenter);
  onClick("btn-release-run-check", function () {
    runAllSystemChecks();
    renderReleaseCenter();
  });
  onClick("btn-release-view-check", function () {
    closeReleaseCenter();
    openSystemCheck();
    if (latestSystemCheckResults.length) {
      renderSystemCheckResults(latestSystemCheckResults, latestSystemCheckOverall);
    }
  });
  onClick("btn-release-judge", runPublishCheck);
  onClick("btn-release-memo", function () {
    var panel = document.getElementById("release-memo-panel");
    var input = document.getElementById("release-memo-input");
    if (!panel) return;
    panel.hidden = false;
    if (input) {
      input.value = loadReleaseNotes();
      input.focus();
    }
  });
  onClick("btn-release-memo-save", function () {
    var input = document.getElementById("release-memo-input");
    saveReleaseNotes(input ? input.value : "");
    showToast("公開メモを保存しました");
  });
  onClick("btn-release-memo-cancel", function () {
    var panel = document.getElementById("release-memo-panel");
    if (panel) panel.hidden = true;
  });
  onClick("btn-release-save-history", addReleaseHistoryEntry);

  if (releaseCenterModal) {
    releaseCenterModal.addEventListener("click", function (e) {
      if (e.target === releaseCenterModal) closeReleaseCenter();
    });
  }

  var systemCheckResultsEl = document.getElementById("system-check-results");
  if (systemCheckResultsEl) {
    systemCheckResultsEl.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-check-toggle]");
      if (!btn) return;
      var index = btn.getAttribute("data-check-toggle");
      var details = document.getElementById("check-details-" + index);
      if (!details) return;
      var open = details.hidden;
      details.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  var manualChecklistEl = document.getElementById("manual-checklist");
  if (manualChecklistEl) {
    manualChecklistEl.addEventListener("change", function (e) {
      var input = e.target;
      if (!input || !input.getAttribute("data-manual-check")) return;
      var map = loadManualChecklist();
      map[input.getAttribute("data-manual-check")] = !!input.checked;
      saveManualChecklist(map);
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (promptViewModal && promptViewModal.classList.contains("is-open")) {
      closePromptView();
      return;
    }
    if (secretaryModal && secretaryModal.classList.contains("is-open")) {
      if (cursorHandoffModal && cursorHandoffModal.classList.contains("is-open")) {
        closeCursorHandoffModal();
        return;
      }
      if (secretaryResultView && !secretaryResultView.hidden) {
        showSecretaryView("input");
        return;
      }
      closeAiSecretary();
      return;
    }
    if (cursorHandoffModal && cursorHandoffModal.classList.contains("is-open")) {
      closeCursorHandoffModal();
      return;
    }
    if (webCenterModal && webCenterModal.classList.contains("is-open")) {
      if (webCenterInstructionView && !webCenterInstructionView.hidden) {
        showWebCenterView("form");
        return;
      }
      if (webCenterFormView && !webCenterFormView.hidden) {
        showWebCenterView("menu");
        return;
      }
      if ((webCenterDraftsView && !webCenterDraftsView.hidden) ||
          (webCenterPublishedView && !webCenterPublishedView.hidden)) {
        showWebCenterView("menu");
        return;
      }
      closeWebCenter();
      return;
    }
    if (meetingLogsModal && meetingLogsModal.classList.contains("is-open")) {
      if (meetingImportPreviewView && !meetingImportPreviewView.hidden) {
        openCursorReportImport();
        return;
      }
      if (meetingImportView && !meetingImportView.hidden) {
        closeCursorReportImport();
        return;
      }
      if (meetingFormView && !meetingFormView.hidden) {
        showMeetingView("list");
        renderMeetingLogs();
        return;
      }
      if (meetingDetailView && !meetingDetailView.hidden) {
        showMeetingView("list");
        renderMeetingLogs();
        return;
      }
      closeMeetingLogs();
      return;
    }
    if (projectDetailModal && projectDetailModal.classList.contains("is-open")) {
      closeProjectDetail();
      return;
    }
    if (releaseCenterModal && releaseCenterModal.classList.contains("is-open")) {
      closeReleaseCenter();
      return;
    }
    if (systemCheckModal && systemCheckModal.classList.contains("is-open")) {
      closeSystemCheck();
      return;
    }
    if (projectModal && projectModal.classList.contains("is-open")) {
      if (projectFormView && !projectFormView.hidden) {
        showProjectListView();
        return;
      }
      closeProjectModal();
      return;
    }
    if (modal && modal.classList.contains("is-open")) {
      closeModal();
    }
  });

  if (form) {
    form.addEventListener("submit", handleSubmit);
  }
  var recentRequestsEl = document.getElementById("recent-requests");
  if (recentRequestsEl) {
    recentRequestsEl.addEventListener("click", handleRecentClick);
  }

  /* ========== Init ========== */
  try {
    updateHomeGreeting();
    renderHomePurpose();
    renderDailyWord();
    renderHomeSchedule();
    renderTopPriority();
    renderHomeGoals();
    loadFamilyPhoto();
    showAppView("home");
    loadProjects();
    renderTodayTodos();
    renderPriorityTasks();
    renderCurrentFocus();
    renderReleaseHome();
    renderDevStatusPanel();
    renderProjectCards();
    populateProjectSelect();
    renderStaff();
    renderRecentRequests();
    renderIphoneSettings();
    renderUpcomingPanel();
    window.smileAIStudioStatus.initialized = true;
    window.smileAIStudioStatus.initializedAt = new Date().toISOString();
  } catch (e) {
    window.smileAIStudioStatus.initialized = false;
    recordRuntimeError({
      message: e && e.message ? e.message : String(e),
      source: "script.js:init",
      line: 0,
      column: 0,
      type: "error"
    });
  }
})();
