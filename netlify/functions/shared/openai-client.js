"use strict";

var https = require("https");
var config = require("./openai-config");

function extractOutputText(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  var parts = [];
  var output = Array.isArray(payload.output) ? payload.output : [];
  output.forEach(function (item) {
    if (!item || item.type !== "message") return;
    var content = Array.isArray(item.content) ? item.content : [];
    content.forEach(function (c) {
      if (!c) return;
      if (c.type === "output_text" && c.text) parts.push(String(c.text));
      else if (c.type === "text" && c.text) parts.push(String(c.text));
    });
  });
  return parts.join("\n").trim();
}

function postResponses(apiKey, body, timeoutMs) {
  return new Promise(function (resolve) {
    var started = Date.now();
    var payload = JSON.stringify(body);
    var req = https.request(
      {
        hostname: "api.openai.com",
        path: "/v1/responses",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
          "Content-Length": Buffer.byteLength(payload)
        }
      },
      function (res) {
        var chunks = [];
        res.on("data", function (c) { chunks.push(c); });
        res.on("end", function () {
          var raw = Buffer.concat(chunks).toString("utf8");
          var parsed = null;
          try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
          var text = extractOutputText(parsed);
          var ok = res.statusCode >= 200 && res.statusCode < 300 && !!text;
          resolve({
            ok: ok,
            status: res.statusCode,
            text: text,
            latencyMs: Date.now() - started,
            error: ok ? "" : "openai_http_error",
            usage: parsed && parsed.usage ? {
              input_tokens: parsed.usage.input_tokens,
              output_tokens: parsed.usage.output_tokens
            } : null
          });
        });
      }
    );

    req.setTimeout(timeoutMs || config.timeoutMs, function () {
      req.destroy();
      resolve({
        ok: false,
        status: 0,
        text: "",
        latencyMs: Date.now() - started,
        error: "timeout",
        usage: null
      });
    });

    req.on("error", function () {
      resolve({
        ok: false,
        status: 0,
        text: "",
        latencyMs: Date.now() - started,
        error: "network_error",
        usage: null
      });
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Call OpenAI Responses API.
 * inputMessages: [{ role: 'user'|'assistant', content: string }]
 */
async function createResponse(apiKey, options) {
  options = options || {};
  if (!apiKey) {
    return { ok: false, error: "missing_api_key", text: "", latencyMs: 0 };
  }

  var input = Array.isArray(options.input) ? options.input : [];
  var body = {
    model: options.model || config.model,
    instructions: String(options.instructions || ""),
    input: input.map(function (m) {
      return {
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content || "").slice(0, 2000)
      };
    }),
    max_output_tokens: options.maxOutputTokens || config.maxOutputTokens
  };

  var result = await postResponses(apiKey, body, options.timeoutMs || config.timeoutMs);

  // Safe usage log (no secrets, no full message)
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    stage: "openai-responses",
    ok: !!result.ok,
    model: body.model,
    latencyMs: result.latencyMs,
    inputItems: body.input.length,
    error: result.error || "",
    usage: result.usage || null
  }));

  return result;
}

module.exports = {
  createResponse: createResponse,
  extractOutputText: extractOutputText
};
