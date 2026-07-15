"use strict";

var https = require("https");

function postJson(url, token, payload) {
  return new Promise(function (resolve, reject) {
    var body = JSON.stringify(payload);
    var u = new URL(url);
    var req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
          "Content-Length": Buffer.byteLength(body)
        }
      },
      function (res) {
        var chunks = [];
        res.on("data", function (c) { chunks.push(c); });
        res.on("end", function () {
          var text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, status: res.statusCode, body: text });
          } else {
            resolve({ ok: false, status: res.statusCode, body: text.slice(0, 200) });
          }
        });
      }
    );
    req.on("error", function (err) {
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

async function replyMessage(accessToken, replyToken, text) {
  if (!accessToken || !replyToken) {
    return { ok: false, reason: "missing_token" };
  }
  return postJson(
    "https://api.line.me/v2/bot/message/reply",
    accessToken,
    {
      replyToken: replyToken,
      messages: [{ type: "text", text: String(text || "").slice(0, 4900) }]
    }
  );
}

async function pushMessage(accessToken, userId, text) {
  if (!accessToken || !userId) {
    return { ok: false, reason: "missing_token" };
  }
  return postJson(
    "https://api.line.me/v2/bot/message/push",
    accessToken,
    {
      to: userId,
      messages: [{ type: "text", text: String(text || "").slice(0, 4900) }]
    }
  );
}

module.exports = {
  replyMessage: replyMessage,
  pushMessage: pushMessage
};
