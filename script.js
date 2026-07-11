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

  var REQUIRED_FIELDS = [
    { id: "req-project", label: "プロジェクト" },
    { id: "req-staff", label: "依頼するAIスタッフ" },
    { id: "req-title", label: "依頼タイトル" },
    { id: "req-content", label: "依頼内容" },
    { id: "req-purpose", label: "目的" },
    { id: "req-desired", label: "希望する完成状態" },
    { id: "req-scope", label: "変更してよい範囲" },
    { id: "req-priority", label: "優先度" }
  ];

  var modal = document.getElementById("request-modal");
  var promptViewModal = document.getElementById("prompt-view-modal");
  var form = document.getElementById("request-form");
  var toast = document.getElementById("toast");
  var formError = document.getElementById("form-error");
  var promptResult = document.getElementById("prompt-result");
  var promptResultText = document.getElementById("prompt-result-text");
  var promptViewText = document.getElementById("prompt-view-text");
  var toastTimer = null;
  var currentGeneratedPrompt = "";
  var viewedPrompt = "";

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

    var staff = req.aiStaff || req.staff || "";
    var content = req.request || req.content || "";

    return {
      id: req.id || String(Date.now()),
      project: req.project || "",
      staff: staff,
      aiStaff: staff,
      title: req.title || "",
      content: content,
      request: content,
      purpose: req.purpose || "",
      desiredResult: req.desiredResult || "",
      changeScope: req.changeScope || "",
      constraints: req.constraints || "",
      references: req.references || "",
      priority: req.priority || "中",
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
    if (priority === "低") return "badge--priority-normal";
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

  function displayOrEmpty(value) {
    var v = (value || "").trim();
    return v || "（未入力）";
  }

  function getFormValues() {
    return {
      project: document.getElementById("req-project").value,
      staff: document.getElementById("req-staff").value,
      title: document.getElementById("req-title").value.trim(),
      content: document.getElementById("req-content").value.trim(),
      purpose: document.getElementById("req-purpose").value.trim(),
      desiredResult: document.getElementById("req-desired").value.trim(),
      changeScope: document.getElementById("req-scope").value,
      constraints: document.getElementById("req-constraints").value.trim(),
      references: document.getElementById("req-references").value.trim(),
      priority: document.getElementById("req-priority").value
    };
  }

  function clearValidation() {
    formError.hidden = true;
    formError.textContent = "";
    form.querySelectorAll(".form-group.is-invalid").forEach(function (el) {
      el.classList.remove("is-invalid");
    });
  }

  function validateRequired() {
    clearValidation();
    var missing = [];

    REQUIRED_FIELDS.forEach(function (field) {
      var el = document.getElementById(field.id);
      var value = el.value.trim();
      if (!value) {
        missing.push(field.label);
        if (el.parentElement) el.parentElement.classList.add("is-invalid");
      }
    });

    if (missing.length > 0) {
      formError.textContent = "次の項目を入力してください：" + missing.join("、");
      formError.hidden = false;
      formError.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return false;
    }

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

  function generatePrompt(values) {
    var workItems = buildWorkItems(values.staff);
    var workLines = workItems.map(function (item, i) {
      return (i + 1) + ". " + item;
    }).join("\n");

    return [
      "【プロジェクト名】",
      values.project,
      "",
      "【担当AI】",
      values.staff,
      "",
      "【依頼タイトル】",
      values.title,
      "",
      "【目的】",
      values.purpose,
      "",
      "【現在の課題】",
      values.content,
      "",
      "【希望する完成状態】",
      values.desiredResult,
      "",
      "【変更してよい範囲】",
      values.changeScope,
      "",
      "【守ってほしい条件】",
      displayOrEmpty(values.constraints),
      "",
      "【参考情報】",
      displayOrEmpty(values.references),
      "",
      "【作業内容】",
      workLines,
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

  function showGeneratedPrompt(text) {
    currentGeneratedPrompt = text;
    promptResultText.textContent = text;
    promptResult.hidden = false;
    promptResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function hideGeneratedPrompt() {
    promptResult.hidden = true;
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

  function buildRequestObject(values, generatedPrompt) {
    var content = values.content;
    var staff = values.staff;

    return {
      id: Date.now().toString(),
      project: values.project,
      staff: staff,
      aiStaff: staff,
      title: values.title,
      content: content,
      request: content,
      purpose: values.purpose,
      desiredResult: values.desiredResult,
      changeScope: values.changeScope,
      constraints: values.constraints,
      references: values.references,
      priority: values.priority,
      generatedPrompt: generatedPrompt || "",
      createdAt: new Date().toISOString()
    };
  }

  function saveCurrentRequest(options) {
    options = options || {};
    if (!validateRequired()) return false;

    var values = getFormValues();
    var prompt = currentGeneratedPrompt;

    if (!prompt && options.requirePrompt) {
      formError.textContent = "先に「指示書を生成」を押してください。";
      formError.hidden = false;
      return false;
    }

    if (!prompt) {
      prompt = generatePrompt(values);
      currentGeneratedPrompt = prompt;
    }

    var request = buildRequestObject(values, prompt);
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

      card.innerHTML =
        '<div class="request-card__top">' +
          '<h3 class="request-card__title">' + escapeHtml(req.title || "無題の依頼") + "</h3>" +
          '<time class="request-card__date">' + escapeHtml(formatDate(req.createdAt)) + "</time>" +
        "</div>" +
        '<p class="request-card__info">' +
          escapeHtml(req.project || "—") + " ／ " + escapeHtml(req.staff || req.aiStaff || "—") +
          ' <span class="badge ' + priorityBadgeClass(req.priority) + '">' + escapeHtml(req.priority || "中") + "</span>" +
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

  function openModal(preset) {
    preset = preset || {};
    form.reset();
    clearValidation();
    hideGeneratedPrompt();
    currentGeneratedPrompt = "";

    document.getElementById("req-scope").value = "不明";
    document.getElementById("req-priority").value = "中";

    if (preset.project) {
      document.getElementById("req-project").value = preset.project;
    }
    if (preset.staff) {
      document.getElementById("req-staff").value = preset.staff;
    }
    if (preset.title) {
      document.getElementById("req-title").value = preset.title;
    }

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    setTimeout(function () {
      var focusEl = document.getElementById("req-project");
      if (preset.project && !preset.staff) {
        focusEl = document.getElementById("req-staff");
      } else if (preset.staff && !preset.project) {
        focusEl = document.getElementById("req-project");
      } else if (preset.project && preset.staff) {
        focusEl = document.getElementById("req-title");
      }
      if (focusEl) focusEl.focus();
    }, 300);
  }

  function closeModal() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    currentGeneratedPrompt = "";
    hideGeneratedPrompt();
    clearValidation();
    if (!promptViewModal.classList.contains("is-open")) {
      document.body.style.overflow = "";
    }
  }

  function handleGenerate() {
    if (!validateRequired()) return;

    var values = getFormValues();
    var prompt = generatePrompt(values);
    showGeneratedPrompt(prompt);
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

  document.getElementById("btn-generate").addEventListener("click", handleGenerate);

  document.getElementById("btn-copy-prompt").addEventListener("click", function () {
    copyText(currentGeneratedPrompt).then(function () {
      showToast("指示書をコピーしました");
    }).catch(function () {
      showToast("コピーに失敗しました");
    });
  });

  document.getElementById("btn-edit-prompt").addEventListener("click", function () {
    currentGeneratedPrompt = "";
    hideGeneratedPrompt();
    clearValidation();
    var titleEl = document.getElementById("req-title");
    if (titleEl) {
      titleEl.focus();
      titleEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  document.getElementById("btn-save-from-result").addEventListener("click", function () {
    saveCurrentRequest();
  });

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
