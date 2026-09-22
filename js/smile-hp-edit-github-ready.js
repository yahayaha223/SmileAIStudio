/**
 * Homepage-edit approved-change card (GitHub ready publishes).
 * Independent of localStorage Job cards. Never shows secrets.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SmileHpEditGithubReady = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function parseReadyItems(data) {
    if (!data || typeof data !== "object") return [];
    if (data.ok === false) return [];
    var src = Array.isArray(data.items) ? data.items : [];
    return src.filter(function (it) {
      if (!it || typeof it !== "object") return false;
      var pr = Number(it.prNumber);
      return isFinite(pr) && pr >= 1;
    });
  }

  function defaultEscape(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cardHtml(it, escapeHtmlFn) {
    var esc = typeof escapeHtmlFn === "function" ? escapeHtmlFn : defaultEscape;
    var issueNo = Number(it.issueNumber);
    var prNo = Number(it.prNumber);
    var issueLabel = "GitHub Issue #" + issueNo;
    var prLabel = "PR #" + prNo;
    var issueHtml = it.issueUrl
      ? "<a href=\"" + esc(it.issueUrl) + "\" target=\"_blank\" rel=\"noopener noreferrer\">" +
        esc(issueLabel) + "</a>"
      : esc(issueLabel);
    var prHtml = it.prUrl
      ? "<a href=\"" + esc(it.prUrl) + "\" target=\"_blank\" rel=\"noopener noreferrer\">" +
        esc(prLabel) + "</a>"
      : esc(prLabel);
    return "<div class=\"ai-job-card hp-edit-github-ready-card\">" +
      "<p class=\"ai-job-card__attention\">承認済みの変更があります</p>" +
      "<p>" + issueHtml + "</p>" +
      "<p>" + prHtml + "</p>" +
      "<p><button type=\"button\" class=\"btn btn--primary btn--block btn--touch btn-hp-github-ready-publish\" data-pr-number=\"" +
      esc(String(prNo)) + "\" data-issue-number=\"" + esc(String(issueNo)) +
      "\">本番へ反映する</button></p>" +
      "</div>";
  }

  function ensureBox(doc) {
    doc = doc || (typeof document !== "undefined" ? document : null);
    if (!doc || !doc.getElementById) return null;
    var box = doc.getElementById("hp-edit-github-ready");
    if (box) return box;
    var modal = doc.getElementById("hp-edit-modal");
    var body = modal && modal.querySelector ? modal.querySelector(".modal__body") : null;
    if (!body || !doc.createElement) return null;
    box = doc.createElement("div");
    box.id = "hp-edit-github-ready";
    box.className = "ai-jobs-list hp-edit-github-ready";
    box.setAttribute("aria-live", "polite");
    if (body.firstChild) body.insertBefore(box, body.firstChild);
    else body.appendChild(box);
    return box;
  }

  function render(box, items, escapeHtmlFn) {
    if (!box) return { shown: false, count: 0 };
    var list = Array.isArray(items) ? items : [];
    if (!list.length) {
      box.innerHTML = "";
      box.hidden = true;
      box.setAttribute("hidden", "hidden");
      box.classList.remove("is-visible");
      return { shown: false, count: 0 };
    }
    box.hidden = false;
    box.removeAttribute("hidden");
    box.classList.add("is-visible");
    box.innerHTML = list.map(function (it) { return cardHtml(it, escapeHtmlFn); }).join("");
    return { shown: true, count: list.length };
  }

  return {
    parseReadyItems: parseReadyItems,
    ensureBox: ensureBox,
    render: render,
    cardHtml: cardHtml
  };
});
