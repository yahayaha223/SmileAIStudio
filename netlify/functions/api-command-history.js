"use strict";

var http = require("./shared/http");
var historyStore = require("./shared/command-history-store");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return http.options();
  if (event.httpMethod !== "GET") {
    return http.json(405, { ok: false, error: "method_not_allowed" });
  }
  try {
    var history = await historyStore.listCommandHistory(20);
    return http.json(200, { ok: true, history: history });
  } catch (e) {
    return http.json(500, { ok: false, error: "unavailable" });
  }
};
