"use strict";

var kv = require("./kv-store");
var openaiConfig = require("./openai-config");

var KEY_PREFIX = "chatMemory:";

function memoryKey(userId) {
  return KEY_PREFIX + String(userId || "unknown");
}

function nowIso() {
  return new Date().toISOString();
}

async function getChatMemory(userId) {
  var data = await kv.kvGet(memoryKey(userId));
  if (!data || typeof data !== "object") {
    return { userId: String(userId || ""), messages: [], updatedAt: "" };
  }
  return {
    userId: String(data.userId || userId || ""),
    messages: Array.isArray(data.messages) ? data.messages : [],
    updatedAt: String(data.updatedAt || "")
  };
}

async function appendChatMessages(userId, entries) {
  var current = await getChatMemory(userId);
  var nextMessages = current.messages.slice();
  (entries || []).forEach(function (entry) {
    if (!entry || !entry.content) return;
    nextMessages.push({
      role: entry.role === "assistant" ? "assistant" : "user",
      content: String(entry.content).slice(0, 2000),
      createdAt: entry.createdAt || nowIso()
    });
  });
  var limit = openaiConfig.memoryLimit || 16;
  if (nextMessages.length > limit) {
    nextMessages = nextMessages.slice(nextMessages.length - limit);
  }
  var payload = {
    userId: String(userId),
    messages: nextMessages,
    updatedAt: nowIso()
  };
  var ok = await kv.kvSet(memoryKey(userId), payload);
  return ok ? payload : null;
}

async function clearChatMemory(userId) {
  var payload = {
    userId: String(userId),
    messages: [],
    updatedAt: nowIso()
  };
  var ok = await kv.kvSet(memoryKey(userId), payload);
  return !!ok;
}

async function getChatMemoryCount(userId) {
  var mem = await getChatMemory(userId);
  return mem.messages.length;
}

module.exports = {
  getChatMemory: getChatMemory,
  appendChatMessages: appendChatMessages,
  clearChatMemory: clearChatMemory,
  getChatMemoryCount: getChatMemoryCount
};
