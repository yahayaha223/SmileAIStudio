(function () {
  "use strict";

  var STORAGE_KEY = "smileAIStudio_requests";

  var priorityTasks = [
    { title: "Fuwafuwa Panic Managerの実用化", progress: 45, status: "進行中" },
    { title: "イベント相談LPの改善", progress: 30, status: "進行中" },
    { title: "Smile AI Studioの司令塔構築", progress: 60, status: "進行中" }
  ];

  var projects = [
    {
      id: "fuwafuwa",
      name: "Fuwafuwa Panic Manager",
      desc: "イベント現場の積み込み・返却・在庫・スタッフ管理",
      status: "開発中",
      statusClass: "badge--dev",
      priority: "最優先",
      priorityClass: "badge--priority-top",
      links: { open: "", github: "" }
    },
    {
      id: "giftcanvas",
      name: "GiftCanvas",
      desc: "バルーンギフトのデザイン・注文システム",
      status: "開発中",
      statusClass: "badge--dev",
      priority: "通常",
      priorityClass: "badge--priority-normal",
      links: { open: "", github: "" }
    },
    {
      id: "event-lp",
      name: "イベント相談LP",
      desc: "イベント相談とAI見積もりの集客サイト",
      status: "改善中",
      statusClass: "badge--improve",
      priority: "高",
      priorityClass: "badge--priority-high",
      links: { open: "", github: "" }
    }
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
      "分かりやすく", "見た目", "ビジュアル", "アイコン", "余白"
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

  var modal = document.getElementById("request-modal");
  var promptViewModal = document.getElementById("prompt-view-modal");
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
  var toastTimer = null;
  var currentGeneratedPrompt = "";
  var viewedPrompt = "";
  var detailsOpen = false;
  var currentRoute = null;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove("is-visible");
    }, 2800);
  }

  function showPlaceholder() {
    showToast("リンクは今後設定します");
  }

  function openLink(url) {
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      showPlaceholder();
    }
  }

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

    var project = req.selectedProject || req.project || "";
    var staff = req.detectedMainAI || req.aiStaff || req.staff || "";
    var content = req.request || req.content || "";
    var support = req.detectedSupportAI || req.supportAI || "";
    var purpose = req.detectedPurpose || req.purpose || "";
    var desired = req.detectedDesiredResult || req.desiredResult || "";
    var priority = req.detectedPriority || req.priority || "通常";

    return {
      id: req.id || String(Date.now()),
      project: project,
      selectedProject: project,
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

  function priorityBadgeClass(priority) {
    if (priority === "高") return "badge--priority-high";
    if (priority === "低" || priority === "通常") return "badge--priority-normal";
    return "badge--progress";
  }

  function confidenceBadgeClass(level) {
    if (level === "高") return "badge--priority-high";
    if (level === "低") return "badge--priority-normal";
    return "badge--progress";
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

    if (/入力ミス|誤入力|ミスを減ら/.test(t)) {
      return "現場スタッフの入力ミスを減らす";
    }
    if (/分かりやすく|見やすく|使いやすく|迷わず|操作しやすく/.test(t)) {
      return "現場スタッフが迷わず操作できるようにする";
    }
    if (/速く|早く|効率|時短|手間/.test(t)) {
      return "作業時間を短縮し、現場の負担を減らす";
    }
    if (/文章|文言|コピー|LP|説明文|SEO/.test(t)) {
      return "対象者に伝わりやすい文章にする";
    }
    if (/バグ|不具合|エラー|テスト|確認/.test(t)) {
      return "不具合を洗い出し、安心して使える状態にする";
    }

    var base = t
      .replace(/[。．.！!？?\s]+$/g, "")
      .replace(/(したい|してほしい|して欲しい)$/g, "");
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
      confidence: confidenceFromMatchCount(mainScore),
      scores: scores
    };
  }

  function getRawFormValues() {
    return {
      project: document.getElementById("req-project").value,
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
    var project = raw.project || "";
    var detection = detectAIStaff(content, raw.mainAI || "", raw.supportAI || "");
    var mainAI = detection.mainAI;
    var priority = inferPriority(content, (raw.priority || "").trim());

    return {
      selectedProject: project,
      project: project,
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
    var project = document.getElementById("req-project").value;
    var content = document.getElementById("req-content").value.trim();

    if (!project) {
      showFormError("作業するプロジェクトを選択してください", ["req-project"]);
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

    return [
      "【作業対象プロジェクト】",
      route.selectedProject || route.project,
      "",
      "【作業範囲の厳守】",
      "・現在開いているフォルダ名と対象プロジェクト名が一致しているか、作業前に確認する",
      "・対象プロジェクト以外のファイルを変更しない",
      "・フォルダが一致しない場合は作業を開始せず報告する",
      "・別リポジトリへcommitやpushを行わない",
      "",
      "【プロジェクト名】",
      route.selectedProject || route.project,
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
    if (!text) {
      return Promise.reject(new Error("empty"));
    }

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
      textarea.style.padding = "0";
      textarea.style.border = "none";
      textarea.style.outline = "none";
      textarea.style.boxShadow = "none";
      textarea.style.background = "transparent";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);

      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);

      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }

      document.body.removeChild(textarea);

      if (ok) {
        resolve();
      } else {
        reject(new Error("copy failed"));
      }
    });
  }

  function buildRequestObject(route, generatedPrompt) {
    var project = route.selectedProject || route.project;
    var mainAI = route.detectedMainAI || route.staff;
    var content = route.content;

    return {
      id: Date.now().toString(),
      project: project,
      selectedProject: project,
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
            '<div class="progress__label">' +
              "<span>進捗</span><span>" + task.progress + "%</span>" +
            "</div>" +
            '<div class="progress__bar" role="progressbar" aria-valuenow="' + task.progress + '" aria-valuemin="0" aria-valuemax="100">' +
              '<div class="progress__fill" style="width:' + task.progress + '%"></div>' +
            "</div>" +
          "</div>" +
        "</article>"
      );
    }).join("");
  }

  function renderProjects() {
    var container = document.getElementById("project-list");
    container.innerHTML = projects.map(function (p) {
      return (
        '<article class="card" data-project="' + escapeHtml(p.name) + '">' +
          '<div class="card__header">' +
            '<h3 class="card__title">' + escapeHtml(p.name) + "</h3>" +
          "</div>" +
          '<p class="card__desc">' + escapeHtml(p.desc) + "</p>" +
          '<div class="card__meta">' +
            '<span class="badge ' + p.statusClass + '">' + escapeHtml(p.status) + "</span>" +
            '<span class="badge ' + p.priorityClass + '">優先度：' + escapeHtml(p.priority) + "</span>" +
          "</div>" +
          '<div class="card__actions">' +
            '<button type="button" class="btn btn--secondary btn-open" data-url="' + escapeHtml(p.links.open) + '">開く</button>' +
            '<button type="button" class="btn btn--secondary btn-github" data-url="' + escapeHtml(p.links.github) + '">GitHub</button>' +
            '<button type="button" class="btn btn--primary btn-instruct" data-project="' + escapeHtml(p.name) + '">開発指示を作る</button>' +
          "</div>" +
        "</article>"
      );
    }).join("");

    container.querySelectorAll(".btn-open, .btn-github").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openLink(btn.getAttribute("data-url"));
      });
    });

    container.querySelectorAll(".btn-instruct").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openModal({ project: btn.getAttribute("data-project") });
      });
    });
  }

  function renderStaff() {
    var container = document.getElementById("staff-list");
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
      var projectName = req.selectedProject || req.project || "—";
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
          escapeHtml(projectName) + " ／ " + escapeHtml(mainAI) +
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
    return getRequests().find(function (r) {
      return r.id === id;
    }) || null;
  }

  function openPromptView(promptText, title) {
    viewedPrompt = promptText || "";
    promptViewText.textContent = viewedPrompt;
    document.getElementById("prompt-view-title").textContent = title || "保存済み指示書";
    promptViewModal.classList.add("is-open");
    promptViewModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closePromptView() {
    promptViewModal.classList.remove("is-open");
    promptViewModal.setAttribute("aria-hidden", "true");
    viewedPrompt = "";
    if (!modal.classList.contains("is-open")) {
      document.body.style.overflow = "";
    }
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

    if (preset.project) {
      document.getElementById("req-project").value = preset.project;
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
    document.body.style.overflow = "hidden";

    setTimeout(function () {
      var focusEl = document.getElementById("req-project");
      if (preset.project) {
        focusEl = document.getElementById("req-content");
      } else if (preset.staff) {
        focusEl = document.getElementById("req-project");
      }
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
    if (!promptViewModal.classList.contains("is-open")) {
      document.body.style.overflow = "";
    }
  }

  function handleRoute() {
    if (!validateRouterInput()) return;

    var raw = getRawFormValues();
    currentRoute = runRouter(raw);
    currentGeneratedPrompt = "";
    renderRouteSummary(currentRoute);
    showView("result");
    routerResultView.scrollIntoView({ behavior: "smooth", block: "nearest" });
    showToast("AI判定が完了しました");
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
      var requests = getRequests().filter(function (r) {
        return r.id !== id;
      });
      saveRequests(requests);
      renderRecentRequests();
      showToast("依頼を削除しました");
    }
  }

  document.getElementById("btn-new-request").addEventListener("click", function () {
    openModal();
  });

  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("modal-cancel-result").addEventListener("click", closeModal);

  document.getElementById("btn-route").addEventListener("click", handleRoute);
  document.getElementById("btn-build-prompt").addEventListener("click", handleBuildPrompt);

  document.getElementById("btn-back-to-input").addEventListener("click", function () {
    currentGeneratedPrompt = "";
    showView("input");
    clearValidation();
  });

  document.getElementById("btn-copy-prompt").addEventListener("click", function () {
    copyText(currentGeneratedPrompt).then(function () {
      showToast("指示書をコピーしました");
    }).catch(function () {
      showToast("コピーに失敗しました");
    });
  });

  document.getElementById("btn-edit-prompt").addEventListener("click", function () {
    currentGeneratedPrompt = "";
    clearValidation();
    showView("input");
    var wantEl = document.getElementById("req-content");
    if (wantEl) {
      wantEl.focus();
      wantEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  document.getElementById("btn-save-from-result").addEventListener("click", function () {
    saveCurrentRequest();
  });

  if (btnToggleDetails) {
    btnToggleDetails.addEventListener("click", function () {
      setDetailsOpen(!detailsOpen);
    });
  }

  document.getElementById("prompt-view-close").addEventListener("click", closePromptView);
  document.getElementById("prompt-view-cancel").addEventListener("click", closePromptView);

  document.getElementById("btn-copy-viewed-prompt").addEventListener("click", function () {
    copyText(viewedPrompt).then(function () {
      showToast("指示書をコピーしました");
    }).catch(function () {
      showToast("コピーに失敗しました");
    });
  });

  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeModal();
  });

  promptViewModal.addEventListener("click", function (e) {
    if (e.target === promptViewModal) closePromptView();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (promptViewModal.classList.contains("is-open")) {
      closePromptView();
      return;
    }
    if (modal.classList.contains("is-open")) {
      closeModal();
    }
  });

  form.addEventListener("submit", handleSubmit);
  document.getElementById("recent-requests").addEventListener("click", handleRecentClick);

  renderPriorityTasks();
  renderProjects();
  renderStaff();
  renderRecentRequests();
})();
