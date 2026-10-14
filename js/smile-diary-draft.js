(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SmileDiaryDraft = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";
  function attach(options) {
    var doc = options.document;
    function el(id) { return doc.getElementById(id); }
    var notes = el("simple-diary-notes"), body = el("simple-diary-body");
    var candidate = el("simple-diary-ai-candidate"), box = el("simple-diary-ai-result");
    var generate = el("btn-simple-diary-generate"), cancel = el("btn-simple-diary-ai-cancel");
    var apply = el("btn-simple-diary-ai-apply"), status = el("simple-diary-ai-status");
    var busy = false, serial = 0, controller = null, storageFailed = false, revision = 0;
    var candidateContext;
    var storageKey = "smileAIStudio_diaryComposer_v1";
    function say(message) {
      status.textContent = message + (storageFailed ? " このタブへの一時保存ができません。閉じる前にコピーしてください。" : "");
    }
    function save() {
      try {
        options.storage.setItem(storageKey, JSON.stringify({ notes: notes.value, body: body.value, candidate: candidate.value }));
      } catch (e) { storageFailed = true; }
      el("simple-diary-notes-count").textContent = notes.value.length + " / 2000文字";
    }
    try {
      var saved = JSON.parse(options.storage.getItem(storageKey) || "null");
      if (saved && typeof saved.notes === "string" && typeof saved.body === "string" && typeof saved.candidate === "string") {
        if (!notes.value && !body.value && !candidate.value) { notes.value = saved.notes; body.value = saved.body; candidate.value = saved.candidate; }
      }
    } catch (e) { storageFailed = true; }
    box.hidden = !candidate.value;
    save();
    if (storageFailed) say("");
    function setBusy(value) {
      busy = value; generate.disabled = value; cancel.hidden = !value;
      apply.disabled = value;
      notes.setAttribute("aria-busy", String(value));
    }
    function stop() {
      if (!busy) return;
      serial++;
      if (controller) controller.abort();
      controller = null; setBusy(false); save();
      say("生成を取り消しました。入力は残っています。送信済みの処理には料金がかかる場合があります。");
    }
    async function run() {
      if (busy || options.isPublishing()) return;
      if (!notes.value.trim() || notes.value.length > 2000) {
        say("メモを1〜2000文字で入力してください。入力は切り捨てません。"); return;
      }
      if (candidate.value && !options.confirm("現在のAI候補を作り直しますか？編集した候補は置き換わります。本文とメモは残ります。")) return;
      options.onBodyChange();
      var token = ++serial, source = notes.value, oldCandidate = candidate.value, oldBody = body.value, startedRevision = revision, context = options.getContext ? options.getContext() : null;
      controller = new options.AbortController();
      var signal = controller.signal;
      setBusy(true); save(); say("入力メモだけから文章を作っています…");
      var timer = options.setTimeout(function () { if (token === serial) { stop(); say("時間がかかっているため停止しました。入力は残っています。再試行は新たな送信として扱われます。"); } }, 25000);
      try {
        var csrf = options.getCsrfToken();
        if (!csrf) throw new Error("auth");
        var res = await options.fetch("/.netlify/functions/api-diary-draft", {
          method: "POST", credentials: "same-origin", cache: "no-store", signal: signal,
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify({ notes: source, requestId: (options.randomUUID || function () { return globalThis.crypto.randomUUID(); })() })
        });
        if (token !== serial) return;
        var data = await res.json();
        if (token !== serial) return;
        if (!res.ok || !data.ok) {
          say(res.status === 429 ? "回数制限です（10分に6回・24時間に30回）。時間を置いてください。入力は残っています。" :
            res.status === 401 || res.status === 403 ? "ログイン状態を確認してください。入力は残っています。" :
            data.error === "not_enabled" ? "AI文章化はまだ利用開始前です。メモと本文はそのまま編集できます。" :
            "文章化できませんでした。入力は残っています。自動再送はしません。"); return;
        }
        if (typeof data.text !== "string" || !data.text.trim() || data.text.length > 3000) throw new Error("invalid_result");
        if (revision !== startedRevision || body.value !== oldBody || (options.getContext && options.getContext() !== context) || notes.value !== source || candidate.value !== oldCandidate) {
          say("生成中に入力が変わったため、結果を反映しませんでした。現在の入力は残っています。"); return;
        }
        candidateContext = context;
        candidate.value = data.text; box.hidden = false; save();
        say("AI候補を作りました。事実を確認して直接修正し、「本文に使う」を押してください。まだ公開されません。");
      } catch (e) {
        if (token === serial) say("文章化できませんでした。入力は残っています。通信・ログイン状態を確認してください。");
      } finally {
        options.clearTimeout(timer);
        if (token === serial) { controller = null; setBusy(false); }
      }
    }
    function useCandidate() {
      if (busy || options.isPublishing() || !candidate.value.trim()) return;
      if (candidateContext !== undefined && options.getContext && options.getContext() !== candidateContext) {
        say("対象の記事が変わりました。メモを確認してから生成し直してください。"); return;
      }
      if (body.value && body.value !== candidate.value && !options.confirm("現在の本文をAI候補で置き換えますか？必要な文章は先にコピーしてください。")) return;
      body.value = candidate.value; options.onBodyChange(); save();
      say("本文に反映しました。本文欄でそのまま修正できます。公開は別の操作です。");
      body.focus();
    }
    notes.addEventListener("input", function () { revision++; save(); if (storageFailed) say("メモを編集中です。"); });
    body.addEventListener("input", function () { revision++; options.onBodyChange(); save(); if (storageFailed) say(""); });
    candidate.addEventListener("input", function () { revision++; save(); if (storageFailed) say(""); });
    generate.addEventListener("click", run); cancel.addEventListener("click", stop); apply.addEventListener("click", useCandidate);
    return { cancel: stop, hasWork: function () { return !!(notes.value || body.value || candidate.value); },
      isBusy: function () { return busy; }, generate: run, apply: useCandidate };
  }
  return { attach: attach };
});
