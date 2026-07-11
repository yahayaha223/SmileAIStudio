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

  var modal = document.getElementById("request-modal");
  var form = document.getElementById("request-form");
  var toast = document.getElementById("toast");
  var toastTimer = null;

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
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  function saveRequests(requests) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
  }

  function formatDate(iso) {
    var d = new Date(iso);
    var m = d.getMonth() + 1;
    var day = d.getDate();
    var h = String(d.getHours()).padStart(2, "0");
    var min = String(d.getMinutes()).padStart(2, "0");
    return m + "/" + day + " " + h + ":" + min;
  }

  function priorityBadgeClass(priority) {
    if (priority === "高") return "badge--priority-high";
    if (priority === "低") return "badge--priority-normal";
    return "badge--progress";
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
      card.innerHTML =
        '<div class="request-card__top">' +
          '<h3 class="request-card__title">' + escapeHtml(req.title) + "</h3>" +
          '<time class="request-card__date">' + formatDate(req.createdAt) + "</time>" +
        "</div>" +
        '<p class="request-card__info">' +
          escapeHtml(req.project) + " ／ " + escapeHtml(req.staff) +
          ' <span class="badge ' + priorityBadgeClass(req.priority) + '">' + escapeHtml(req.priority) + "</span>" +
        "</p>" +
        '<p class="request-card__content">' + escapeHtml(req.content) + "</p>";

      container.appendChild(card);
    });
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function openModal(preset) {
    preset = preset || {};
    form.reset();

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
      var firstEmpty = form.querySelector("input:not([value]), textarea, select");
      if (firstEmpty) firstEmpty.focus();
    }, 300);
  }

  function closeModal() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function handleSubmit(e) {
    e.preventDefault();

    var request = {
      id: Date.now().toString(),
      project: document.getElementById("req-project").value,
      staff: document.getElementById("req-staff").value,
      title: document.getElementById("req-title").value.trim(),
      content: document.getElementById("req-content").value.trim(),
      priority: document.getElementById("req-priority").value,
      createdAt: new Date().toISOString()
    };

    var requests = getRequests();
    requests.unshift(request);
    saveRequests(requests);

    closeModal();
    renderRecentRequests();
    showToast("依頼を保存しました");
  }

  document.getElementById("btn-new-request").addEventListener("click", function () {
    openModal();
  });

  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);

  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeModal();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modal.classList.contains("is-open")) {
      closeModal();
    }
  });

  form.addEventListener("submit", handleSubmit);

  renderPriorityTasks();
  renderProjects();
  renderStaff();
  renderRecentRequests();
})();
