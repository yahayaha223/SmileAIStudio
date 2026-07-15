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

function extractApiErrorMessage(parsed, raw) {
  if (parsed && parsed.error) {
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error.message) return String(parsed.error.message);
    try {
      return JSON.stringify(parsed.error).slice(0, 1000);
    } catch (e) {
      return "openai_error_object";
    }
  }
  if (parsed && parsed.status && !extractOutputText(parsed)) {
    return "no_output_text status=" + parsed.status;
  }
  if (raw) return String(raw).slice(0, 1000);
  return "unknown_openai_error";
}

function logOpenAiFailure(details) {
  details = details || {};
  // Never log API keys. Include status / message / stack for Netlify function logs.
  console.log("[openai-error] status=", details.status);
  console.log("[openai-error] message=", details.message);
  console.log("[openai-error] stack=", details.stack || "");
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    stage: details.stage || "openai-responses",
    ok: false,
    status: details.status == null ? "" : details.status,
    message: String(details.message || "").slice(0, 1000),
    stack: String(details.stack || "").slice(0, 2000),
    error: details.error || "",
    model: details.model || "",
    latencyMs: details.latencyMs || 0
  }));
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
          var message = ok ? "" : extractApiErrorMessage(parsed, raw);
          resolve({
            ok: ok,
            status: res.statusCode,
            text: text,
            latencyMs: Date.now() - started,
            error: ok ? "" : "openai_http_error",
            message: message,
            stack: "",
            rawBodyPreview: ok ? "" : String(raw || "").slice(0, 1000),
            usage: parsed && parsed.usage ? {
              input_tokens: parsed.usage.input_tokens,
              output_tokens: parsed.usage.output_tokens
            } : null
          });
        });
      }
    );

    req.setTimeout(timeoutMs || config.timeoutMs, function () {
      var err = new Error("OpenAI Responses API timeout after " + (timeoutMs || config.timeoutMs) + "ms");
      resolve({
        ok: false,
        status: 0,
        text: "",
        latencyMs: Date.now() - started,
        error: "timeout",
        message: err.message,
        stack: err.stack || "",
        usage: null
      });
    });

    req.on("error", function (err) {
      resolve({
        ok: false,
        status: 0,
        text: "",
        latencyMs: Date.now() - started,
        error: "network_error",
        message: err && err.message ? err.message : "network_error",
        stack: err && err.stack ? err.stack : "",
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
    var missing = {
      ok: false,
      error: "missing_api_key",
      text: "",
      status: 0,
      message: "OPENAI_API_KEY is missing",
      stack: "",
      latencyMs: 0
    };
    logOpenAiFailure({
      stage: "openai-responses",
      status: missing.status,
      message: missing.message,
      stack: missing.stack,
      error: missing.error
    });
    return missing;
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

  var result;
  try {
    result = await postResponses(apiKey, body, options.timeoutMs || config.timeoutMs);
  } catch (err) {
    result = {
      ok: false,
      status: 0,
      text: "",
      latencyMs: 0,
      error: "exception",
      message: err && err.message ? err.message : "exception",
      stack: err && err.stack ? err.stack : "",
      usage: null
    };
  }

  if (!result.ok) {
    logOpenAiFailure({
      stage: "openai-responses",
      status: result.status,
      message: result.message || result.error || "openai_failed",
      stack: result.stack || "",
      error: result.error || "",
      model: body.model,
      latencyMs: result.latencyMs
    });
    if (result.rawBodyPreview) {
      console.log("[openai-error] rawBodyPreview=", result.rawBodyPreview);
    }
  } else {
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      stage: "openai-responses",
      ok: true,
      model: body.model,
      latencyMs: result.latencyMs,
      inputItems: body.input.length,
      usage: result.usage || null
    }));
  }

  return result;
}

module.exports = {
  createResponse: createResponse,
  extractOutputText: extractOutputText,
  logOpenAiFailure: logOpenAiFailure
};
