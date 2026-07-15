"use strict";

/**
 * OpenAI model / cost settings (not secrets).
 * Change here without touching call sites.
 */
module.exports = {
  // Cost-conscious default for LINE short replies
  model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  // Keep replies short for LINE + cost
  maxOutputTokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 280),
  // LINE reply token time budget
  timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 8000),
  // Conversation memory window
  memoryLimit: Number(process.env.OPENAI_MEMORY_LIMIT || 16),
  apiBaseUrl: "https://api.openai.com/v1"
};
