"use strict";

/**
 * Optional Cursor cloud launch. Runs only when CURSOR_API_KEY is set.
 * Does not print the key. Does not merge / deploy / FTP.
 */
var fs = require("fs");
var path = require("path");
var dispatch = require(path.join(__dirname, "..", "netlify", "functions", "shared", "ai-dev-job-dispatch.js"));

function logSafe(payload) {
  console.log(JSON.stringify(payload));
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), ".ai-dev-job-state.json"), "utf8"));
  } catch (e) {
    return {};
  }
}

async function launchWithSdk(prompt, branch) {
  var Agent;
  try {
    Agent = require("@cursor/sdk").Agent;
  } catch (e) {
    return { launched: false, reason: "cursor_sdk_missing" };
  }
  if (!Agent || typeof Agent.prompt !== "function") {
    return { launched: false, reason: "cursor_sdk_missing" };
  }
  var repo = process.env.GITHUB_REPOSITORY || "yahayaha223/SmileAIStudio";
  var result = await Agent.prompt(prompt, {
    apiKey: process.env.CURSOR_API_KEY,
    model: { id: "composer-2.5" },
    cloud: {
      repos: [{
        url: "https://github.com/" + repo,
        startingRef: branch || "main"
      }],
      autoCreatePR: true
    }
  });
  return {
    launched: true,
    reason: "cursor_cloud",
    status: result && result.status
  };
}

async function run(opts) {
  opts = opts || {};
  if (!dispatch.shouldLaunchCursor(process.env)) {
    var missing = {
      stage: "ai-dev-job-cursor",
      launched: false,
      reason: "cursor_key_missing",
      mergeToMain: false,
      productionDeploy: false,
      productionFtp: false
    };
    logSafe(missing);
    return missing;
  }
  var state = opts.state || readState();
  if (state && state.started === false) {
    var skipped = {
      stage: "ai-dev-job-cursor",
      launched: false,
      reason: "dispatch_not_started",
      mergeToMain: false,
      productionDeploy: false,
      productionFtp: false
    };
    logSafe(skipped);
    return skipped;
  }
  var prompt = opts.prompt || dispatch.buildCursorAgentPrompt({
    number: state.issueNumber,
    title: "",
    body: ""
  }, state.branch);
  var launched = await launchWithSdk(prompt, state.branch);
  var out = Object.assign({
    stage: "ai-dev-job-cursor",
    mergeToMain: false,
    productionDeploy: false,
    productionFtp: false
  }, launched);
  logSafe(out);
  return out;
}

if (require.main === module) {
  run().catch(function () {
    logSafe({ stage: "ai-dev-job-cursor", launched: false, reason: "pipeline_error" });
    process.exit(1);
  });
}

module.exports = { run: run, launchWithSdk: launchWithSdk };
