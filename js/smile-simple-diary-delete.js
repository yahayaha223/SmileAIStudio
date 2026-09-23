/**
 * Owner-only published diary list + delete.
 * FTP secrets never leave the server. UI only sends diaryId + confirm.
 */
(function (root) {
  "use strict";

  var API_PATH = "/.netlify/functions/api-diary-delete";
  var DIARY_URL = "https://www.egaonokiroku.co.jp/diary/index.htm";

  function fail(code, message, extra) {
    var out = {
      ok: false,
      code: code || "failed",
      message: message || "日記を消せませんでした",
      productionUntouched: true,
      pageUrl: DIARY_URL
    };
    if (extra && typeof extra === "object") {
      Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    }
    return out;
  }

  function postAction(opts) {
    opts = opts || {};
    var fetchImpl = typeof opts.fetch === "function" ? opts.fetch : root.fetch;
    if (typeof fetchImpl !== "function") {
      return Promise.resolve(fail("fetch_missing", "削除APIに接続できません"));
    }
    var csrf = typeof opts.getCsrfToken === "function" ? opts.getCsrfToken() : (opts.csrfToken || "");
    var headers = {
      Accept: "application/json",
      "Content-Type": "application/json"
    };
    if (csrf) headers["X-CSRF-Token"] = csrf;
    var body = { action: opts.action || "list" };
    if (opts.action === "delete") {
      body.userConfirmed = !!opts.userConfirmed;
      body.diaryId = opts.diaryId || "";
    }
    return fetchImpl(API_PATH, {
      method: "POST",
      headers: headers,
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () {
        return { ok: false, error: "invalid_json", userMessage: "返事を読めませんでした" };
      }).then(function (data) {
        data = data || {};
        if (data.ok) {
          return {
            ok: true,
            code: data.code || (opts.action === "delete" ? "deleted" : "listed"),
            message: data.userMessage || (opts.action === "delete" ? "日記を消しました" : "公開中の日記を読みました"),
            pageUrl: data.pageUrl || DIARY_URL,
            articles: data.articles || [],
            count: data.count || 0,
            diaryId: data.diaryId || opts.diaryId || "",
            productionUntouched: data.productionUntouched !== false
          };
        }
        return fail(
          data.error || "pipeline_error",
          data.userMessage || "日記を消せませんでした",
          { productionUntouched: data.productionUntouched !== false }
        );
      });
    }).catch(function (err) {
      return fail(
        (err && err.code) || "pipeline_error",
        (err && err.message) || "日記を消せませんでした",
        { productionUntouched: true }
      );
    });
  }

  function listPublishedDiaries(opts) {
    opts = opts || {};
    return postAction({
      action: "list",
      fetch: opts.fetch,
      getCsrfToken: opts.getCsrfToken,
      csrfToken: opts.csrfToken
    });
  }

  function deletePublishedDiary(opts) {
    opts = opts || {};
    if (!opts.userConfirmed) {
      return Promise.resolve(fail("confirm_required", "削除確認が必要です", { needsConfirm: true }));
    }
    if (!opts.diaryId) {
      return Promise.resolve(fail("invalid_diary_id", "消す日記を選んでください"));
    }
    return postAction({
      action: "delete",
      userConfirmed: true,
      diaryId: opts.diaryId,
      fetch: opts.fetch,
      getCsrfToken: opts.getCsrfToken,
      csrfToken: opts.csrfToken
    });
  }

  function dateKeyFromPublishDate(isoDate) {
    var m = String(isoDate || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return "";
    return "diary-" + m[1].slice(2) + m[2] + m[3];
  }

  root.SmileSimpleDiaryDelete = {
    listPublishedDiaries: listPublishedDiaries,
    deletePublishedDiary: deletePublishedDiary,
    dateKeyFromPublishDate: dateKeyFromPublishDate,
    API_PATH: API_PATH,
    DIARY_URL: DIARY_URL
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
