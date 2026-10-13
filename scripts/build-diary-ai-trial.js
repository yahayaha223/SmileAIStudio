"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { getEncoding } = require("js-tiktoken");
const trial = require("../netlify/functions/shared/diary-ai-trial");
const encoder = getEncoding("o200k_base");
const localTextTokens = encoder.encode(trial.INSTRUCTIONS).length + encoder.encode(trial.MEMO).length;
const stamp = { production: process.env.CONTEXT === "production", model: trial.MODEL,
  payloadSha256: trial.digest(), localTextTokens, conservativeInputTokens: localTextTokens + 1024,
  framingAllowance: 1024, maxOutputTokens: 512, maximumModelCostUSD: 0.0016192, priceCheckedOn: "2026-10-13" };
if (!trial.preflight(stamp)) throw new Error("trial_input_budget_failed");
fs.writeFileSync(path.join(__dirname, "../netlify/functions/shared/diary-ai-trial-context.json"), JSON.stringify(stamp, null, 2) + "\n");
console.log(JSON.stringify({ trialBuild: stamp.production ? "production-disabled-until-gate" : "blocked-outside-production",
  localTextTokens, conservativeInputTokens: stamp.conservativeInputTokens, maxOutputTokens: 512 }));
