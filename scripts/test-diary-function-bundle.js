"use strict";

/**
 * Prove diary-publish modules survive a Netlify-like esbuild bundle.
 * Production Lambda __dirname is the bundle dir (/var/task), not
 * netlify/functions/shared, so dynamic path.join(__dirname, "../../../js/...")
 * cannot find included_files.
 */
process.env.AUTH_ENVIRONMENT = process.env.AUTH_ENVIRONMENT || "local";
process.env.AUTH_ENFORCEMENT_MODE = process.env.AUTH_ENFORCEMENT_MODE || "enforce";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var { spawnSync } = require("child_process");

var ROOT = path.join(__dirname, "..");
var SRC = path.join(ROOT, "netlify", "functions", "shared", "diary-publish.js");
var ENTRY = path.join(ROOT, "netlify", "functions", "api-diary-publish.js");
var NODE = process.execPath;

var SAMPLE_INDEX = [
  "<!DOCTYPE html>",
  "<html><head><meta charset=\"UTF-8\"><title>活動日記</title></head>",
  "<body><div id=\"diary-base\">",
  "<div class=\"year-navi-mobile\"><select></select></div>",
  "<div class=\"diary-box\" id=\"diary-240101\">",
  "<div class=\"diary-date\">2024.01.01</div>",
  "<div class=\"diary-main\">旧記事です。えがお</div>",
  "</div></div></body></html>"
].join("\n");

var passed = 0;
var failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(function () { return fn(); })
    .then(function () {
      passed += 1;
      console.log("OK  " + name);
    })
    .catch(function (e) {
      failed += 1;
      console.log("NG  " + name);
      console.log("    " + (e && e.message ? e.message : e));
    });
}

function resolveEsbuildBin() {
  var jsCli = path.join(ROOT, "node_modules", "esbuild", "bin", "esbuild");
  if (fs.existsSync(jsCli)) return { cmd: NODE, argsPrefix: [jsCli] };
  return { cmd: process.platform === "win32" ? "npx.cmd" : "npx", argsPrefix: ["--yes", "esbuild"] };
}

function bundleFile(entry, outfile) {
  var bin = resolveEsbuildBin();
  var args = bin.argsPrefix.concat([
    entry,
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--outfile=" + outfile,
    "--external:basic-ftp",
    "--external:@netlify/blobs",
    "--external:@simplewebauthn/server",
    "--external:@simplewebauthn/browser"
  ]);
  var r = spawnSync(bin.cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true
  });
  if (r.status !== 0) {
    throw new Error(
      "esbuild failed (" + r.status + "): " +
      String(r.stderr || r.stdout || "").slice(0, 800)
    );
  }
  if (!fs.existsSync(outfile) || !fs.statSync(outfile).size) {
    throw new Error("esbuild produced no outfile");
  }
}

async function run() {
  await test("source uses static requires, not path.join(__dirname)", function () {
    var src = fs.readFileSync(SRC, "utf8");
    assert.ok(src.indexOf('require("../../../js/smile-cp932-map.js")') >= 0);
    assert.ok(src.indexOf('require("../../../js/smile-charset.js")') >= 0);
    assert.ok(src.indexOf('require("../../../js/smile-diary-html.js")') >= 0);
    assert.ok(!/^\s*require\(\s*path\.join\(\s*__dirname/m.test(src));
    assert.ok(!/loadCharset\s*\(/.test(src));
    assert.ok(!/loadDiaryHtml\s*\(/.test(src));
  });

  await test("Lambda-like __dirname cannot reach included_files via ../../../js", function () {
    var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smile-lambda-layout-"));
    try {
      fs.mkdirSync(path.join(tmp, "js"));
      fs.copyFileSync(
        path.join(ROOT, "js", "smile-charset.js"),
        path.join(tmp, "js", "smile-charset.js")
      );
      var lambdaDirname = tmp;
      var dynamicResolved = path.join(lambdaDirname, "../../../js/smile-charset.js");
      var includedResolved = path.join(lambdaDirname, "js", "smile-charset.js");
      assert.strictEqual(fs.existsSync(includedResolved), true);
      assert.strictEqual(
        fs.existsSync(dynamicResolved),
        false,
        "dynamic ../../../js from /var/task must miss: " + dynamicResolved
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await test("Production-like esbuild bundle inlines charset/html and publishes via FTP mock", async function () {
    var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "smile-fn-bundle-"));
    var sharedOut = path.join(tmp, "diary-publish.bundle.js");
    var fnOut = path.join(tmp, "api-diary-publish.bundle.js");
    try {
      bundleFile(SRC, sharedOut);
      bundleFile(ENTRY, fnOut);

      var sharedBundle = fs.readFileSync(sharedOut, "utf8");
      var fnBundle = fs.readFileSync(fnOut, "utf8");
      assert.ok(sharedBundle.indexOf("SmileCharset") >= 0 || sharedBundle.indexOf("detectEncoding") >= 0);
      assert.ok(sharedBundle.indexOf("generateDiaryArticleHtml") >= 0);
      assert.ok(fnBundle.indexOf("detectEncoding") >= 0);
      assert.ok(fnBundle.indexOf("generateDiaryArticleHtml") >= 0);
      assert.ok(!/require\([^)]*smile-charset\.js/.test(sharedBundle));
      assert.ok(!/require\([^)]*smile-diary-html\.js/.test(sharedBundle));
      assert.ok(!/require\([^)]*smile-charset\.js/.test(fnBundle));

      var bundled = require(sharedOut);
      var ftpClient = require(path.join(ROOT, "netlify", "functions", "shared", "ftp-client.js"));
      var ftp = ftpClient.createMemoryFtp({
        "index.htm": Buffer.from(SAMPLE_INDEX, "utf8")
      });
      var retrNames = [];
      var origRetr = ftp.retr.bind(ftp);
      ftp.retr = async function (name) {
        retrNames.push(name);
        return origRetr(name);
      };
      var r = await bundled.publishDiaryOnServer({
        userConfirmed: true,
        entry: {
          id: "job_bundle_1",
          title: "公園で遊びました",
          content: "今日は公園で遊びました。",
          publishDate: "2026-08-20"
        },
        images: [],
        ftp: ftp
      });
      assert.ok(retrNames.indexOf("index.htm") >= 0, "FTP mock must RETR index.htm");
      assert.strictEqual(r.ok, true, r.userMessage || r.code);
      var live = ftp.files["index.htm"].toString("utf8");
      assert.ok(live.indexOf("公園で遊びました") >= 0);
      assert.ok(live.indexOf("旧記事です") >= 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  console.log("\nPassed " + passed + " diary-function-bundle tests" + (failed ? (" failed=" + failed) : ""));
  if (failed) process.exit(1);
}

run().catch(function (e) {
  console.error(e);
  process.exit(1);
});
