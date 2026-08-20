"use strict";

/**
 * Homepage-edit proposal for Issue #6:
 * add「最新の日記を更新しました！」near the diary / back-number button.
 * Does not publish production / FTP.
 */
var assert = require("assert");
var fs = require("fs");
var path = require("path");
var { TextDecoder } = require("util");

var ROOT = path.join(__dirname, "..");
var INDEX = path.join(ROOT, "CorporateSite", "index.htm");
var CSS = path.join(ROOT, "CorporateSite", "css", "top-diary-notice.css");
var STUDIO_INDEX = path.join(ROOT, "index.html");

var passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log("OK  " + name);
}

function decodeSjis(filePath) {
  var buf = fs.readFileSync(filePath);
  return new TextDecoder("shift_jis").decode(buf);
}

function run() {
  test("proposal files exist", function () {
    assert.ok(fs.existsSync(INDEX), "CorporateSite/index.htm missing");
    assert.ok(fs.existsSync(CSS), "CorporateSite/css/top-diary-notice.css missing");
  });

  test("index.htm stays Shift_JIS and keeps diary CTA", function () {
    var raw = fs.readFileSync(INDEX);
    var html = decodeSjis(INDEX);
    assert.ok(/charset=Shift_JIS/i.test(html));
    assert.ok(html.indexOf("日記・バックナンバー") >= 0);
    assert.ok(html.indexOf('class="nv-box-diary"') >= 0);
    assert.ok(html.indexOf('class="top-nv-diary"') >= 0);
    assert.ok(html.indexOf('href="/diary/"') >= 0);
    assert.ok(html.indexOf("イベントの準備や活動の様子をご紹介します") >= 0);
    assert.ok(html.indexOf("インスタグラムはこちら") >= 0);
    assert.ok(raw.length > 20000);
  });

  test("notice is next to the diary button", function () {
    var html = decodeSjis(INDEX);
    var notice = "最新の日記を更新しました！";
    var btn = 'class="top-nv-diary"';
    var ni = html.indexOf(notice);
    var bi = html.indexOf(btn);
    assert.ok(ni >= 0, "notice text missing");
    assert.ok(html.indexOf(notice) === html.lastIndexOf(notice), "notice should appear once");
    assert.ok(Math.abs(ni - bi) < 400, "notice should sit near the diary button");
    var diaryBlock = html.slice(
      html.indexOf('class="nv-box-diary"'),
      html.indexOf("top-schedule-box-->")
    );
    assert.ok(diaryBlock.indexOf(notice) >= 0);
    assert.ok(diaryBlock.indexOf("top-nv-diary-update") >= 0);
    assert.ok(diaryBlock.indexOf("top-nv-diary-lead") >= 0);
  });

  test("new stylesheet is linked and styles the notice", function () {
    var html = decodeSjis(INDEX);
    assert.ok(html.indexOf('href="css/top-diary-notice.css"') >= 0);
    var css = fs.readFileSync(CSS, "utf8");
    assert.ok(/\.top-nv-diary-update/.test(css));
    assert.ok(/#F8288B/i.test(css));
    assert.ok(/max-width:\s*480px/.test(css));
    assert.ok(css.indexOf("ftp") === -1);
    assert.ok(css.indexOf("password") === -1);
  });

  test("studio app homepage was not rewritten", function () {
    var studio = fs.readFileSync(STUDIO_INDEX, "utf8");
    assert.ok(studio.indexOf("Smile AI Studio") >= 0 || studio.indexOf("hp-edit-modal") >= 0);
    assert.ok(studio.indexOf("最新の日記を更新しました！") === -1);
  });

  test("proposal does not include secrets or publish hooks", function () {
    var html = decodeSjis(INDEX);
    var css = fs.readFileSync(CSS, "utf8");
    var blob = html + "\n" + css;
    assert.ok(!/ftp:\/\//i.test(blob));
    assert.ok(blob.indexOf("GITHUB_TOKEN") === -1);
    assert.ok(blob.indexOf("BEGIN RSA PRIVATE KEY") === -1);
  });

  console.log("\nPassed " + passed + " corporate-site top diary notice tests");
}

run();
