"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const ui = require("../js/smile-diary-draft");

function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
function fixture(fetch) {
  const elements = {};
  function el(id) { return elements[id] || (elements[id] = { value: "", textContent: "", hidden: false, disabled: false,
    handlers: {}, addEventListener(k, fn) { this.handlers[k] = fn; }, setAttribute() {}, focus() {} }); }
  const data = {};
  let accepts = true, timer, publishing = false;
  const options = { document: { getElementById: el }, storage: { getItem: k => data[k], setItem: (k,v) => data[k] = v },
    fetch, AbortController, getCsrfToken: () => "mock-csrf", confirm: () => accepts, onBodyChange() {},
    isPublishing: () => publishing, setTimeout: fn => { timer = fn; return 1; }, clearTimeout() {} };
  const editor = ui.attach(options);
  return { editor, el, data, options, reject: () => accepts = false, timeout: () => timer(), publish: () => publishing = true };
}
const ok = text => ({ ok: true, status: 200, json: async () => ({ ok: true, text }) });

test("UI: edit-and-revert, body-only edits and context switches discard responses", async () => {
  for (const kind of ["revision", "body", "context"]) {
    const d = deferred(), f = fixture(() => d.promise); let context = 'a';
    f.options.getContext = () => context;
    f.el('simple-diary-notes').value = 'memo'; const p = f.editor.generate();
    if (kind === 'revision') f.el('simple-diary-notes').handlers.input();
    if (kind === 'body') f.el('simple-diary-body').value = 'edited';
    if (kind === 'context') context = 'b';
    d.resolve(ok('late')); await p;
    assert.equal(f.el('simple-diary-ai-candidate').value, '');
  }
});
test("UI: restored storage never overwrites prefilled text", () => {
  const f = fixture(async () => ok('draft'));
  f.data.smileAIStudio_diaryComposer_v1 = JSON.stringify({notes:'old',body:'old',candidate:'old'});
  f.el('simple-diary-body').value='current'; ui.attach(f.options);
  assert.equal(f.el('simple-diary-body').value,'current');
});

test("UI: notes preserved, no publication, editable candidate and explicit apply", async () => {
  let sent; const f = fixture(async (url, options) => { sent = {url, options}; return ok("自然な文章です。"); });
  f.el("simple-diary-notes").value = "・出来事";
  await f.editor.generate();
  assert.equal(f.el("simple-diary-notes").value, "・出来事");
  assert.equal(f.el("simple-diary-body").value, "");
  assert.equal(sent.url, "/.netlify/functions/api-diary-draft");
  assert.deepEqual({notes:JSON.parse(sent.options.body).notes}, {notes: "・出来事"});
  assert.equal(sent.options.headers["X-CSRF-Token"], "mock-csrf");
  f.el("simple-diary-ai-candidate").value = "自分で修正しました。";
  f.editor.apply(); assert.equal(f.el("simple-diary-body").value, "自分で修正しました。");
  ui.attach(f.options); assert.equal(f.el("simple-diary-body").value, "自分で修正しました。");
});
test("UI: double-click, cancellation, late response and new request are isolated", async () => {
  const a = deferred(), b = deferred(); let calls = 0;
  const f = fixture(() => (++calls === 1 ? a.promise : b.promise));
  f.el("simple-diary-notes").value = "メモ";
  const first = f.editor.generate(); await f.editor.generate(); assert.equal(calls, 1);
  f.editor.cancel(); const second = f.editor.generate();
  a.resolve(ok("古い結果")); await first; assert.equal(f.editor.isBusy(), true);
  b.resolve(ok("新しい結果")); await second;
  assert.equal(f.el("simple-diary-ai-candidate").value, "新しい結果");
});
test("UI: edits during response are retained; rejected regeneration/apply never overwrite", async () => {
  const d = deferred(); const f = fixture(() => d.promise);
  f.el("simple-diary-notes").value = "初期";
  const p = f.editor.generate(); f.el("simple-diary-notes").value = "変更済み";
  f.el("simple-diary-body").value = "編集中"; d.resolve(ok("古い結果")); await p;
  assert.equal(f.el("simple-diary-body").value, "編集中"); assert.equal(f.el("simple-diary-ai-candidate").value, "");
  f.el("simple-diary-ai-candidate").value = "編集した候補"; f.reject();
  await f.editor.generate(); f.editor.apply(); assert.equal(f.el("simple-diary-body").value, "編集中");
  assert.equal(f.el("simple-diary-ai-candidate").value, "編集した候補");
});
test("UI: timeout/error/oversize and storage failure preserve text", async () => {
  const d = deferred(), f = fixture(() => d.promise); f.el("simple-diary-notes").value = "残す";
  const p = f.editor.generate(); f.timeout(); d.resolve(ok("遅延")); await p;
  assert.equal(f.el("simple-diary-notes").value, "残す"); assert.equal(f.el("simple-diary-ai-candidate").value, "");
  f.options.storage.setItem = () => { throw Error("quota"); }; ui.attach(f.options);
  f.el("simple-diary-notes").value = "x".repeat(2001); await f.editor.generate();
  assert.equal(f.el("simple-diary-notes").value.length, 2001);
  const e = fixture(async () => { throw Error("offline"); }); e.el("simple-diary-notes").value = "残す";
  e.el("simple-diary-body").value = "本文"; await e.editor.generate(); assert.equal(e.el("simple-diary-body").value, "本文");
});
test("UI: candidate edits during generation and publish lock are respected", async () => {
  let calls = 0; const d = deferred(); const f = fixture(() => { calls++; return d.promise; });
  f.el("simple-diary-notes").value = "メモ"; const p = f.editor.generate();
  f.el("simple-diary-ai-candidate").value = "人が編集"; d.resolve(ok("AI")); await p;
  assert.equal(f.el("simple-diary-ai-candidate").value, "人が編集");
  f.publish(); await f.editor.generate(); f.editor.apply(); assert.equal(calls, 1); assert.equal(f.el("simple-diary-body").value, "");
});
