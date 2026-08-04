"use strict";

/**
 * Date / priority / task-intent parsing for LINE task secretary (JST).
 */

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toYmd(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

/** Current instant as JST calendar parts */
function jstNow(baseDate) {
  var d = baseDate ? new Date(baseDate) : new Date();
  var utc = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utc + 9 * 60 * 60000);
}

function startOfJstDay(baseDate) {
  var j = jstNow(baseDate);
  return new Date(j.getFullYear(), j.getMonth(), j.getDate());
}

function addDays(ymdBase, days) {
  var parts = String(ymdBase).split("-").map(Number);
  var d = new Date(parts[0], parts[1] - 1, parts[2] + days);
  return toYmd(d);
}

function thisWeekFriday(todayYmd, preferNextIfPast) {
  var parts = String(todayYmd).split("-").map(Number);
  var d = new Date(parts[0], parts[1] - 1, parts[2]);
  var day = d.getDay(); // 0 Sun .. 5 Fri
  var diff = (5 - day + 7) % 7;
  if (diff === 0 && preferNextIfPast) diff = 7;
  d.setDate(d.getDate() + diff);
  return toYmd(d);
}

function nextWeekday(todayYmd, weekday /* 0-6 */) {
  var parts = String(todayYmd).split("-").map(Number);
  var d = new Date(parts[0], parts[1] - 1, parts[2]);
  var day = d.getDay();
  var diff = (weekday - day + 7) % 7;
  if (diff === 0) diff = 7; // "金曜日" when today is Friday → next week? Spec: ask if ambiguous
  d.setDate(d.getDate() + diff);
  return toYmd(d);
}

function parseTimeOfDay(text) {
  var t = String(text || "");
  var hm = t.match(/(?:(\d{1,2})\s*時(?:\s*(\d{1,2})\s*分)?)/);
  if (hm) {
    var h = Math.min(23, Number(hm[1]));
    var m = hm[2] != null ? Math.min(59, Number(hm[2])) : 0;
    return pad2(h) + ":" + pad2(m);
  }
  if (/朝一|朝一番/.test(t)) return "09:00";
  if (/午前中/.test(t)) return "10:00";
  if (/明朝|翌朝/.test(t)) return "09:00";
  // 「朝」alone as time — not 朝倉 / 朝礼 etc. when followed by kanji name chars without separator
  if (/(^|[\s　、,])朝([\s　、,]|$)/.test(t) || /の朝に|朝に/.test(t)) return "09:00";
  if (/昼|正午/.test(t)) return "12:00";
  if (/午後/.test(t)) return "15:00";
  if (/夕方/.test(t)) return "17:00";
  if (/夜|今晚|今夜/.test(t)) return "20:00";
  return "";
}

/**
 * @returns {{ dueDate: string, dueTime: string, label: string, ambiguous: string, confidence: string }}
 */
function parseDue(text, now) {
  var t = String(text || "");
  var today = toYmd(startOfJstDay(now));
  var dueTime = parseTimeOfDay(t);
  var dueDate = "";
  var label = "";
  var ambiguous = "";
  var confidence = "none";

  if (/今日中|本日中|今日|本日/.test(t)) {
    dueDate = today;
    label = "今日";
    confidence = "high";
  } else if (/明後日/.test(t)) {
    dueDate = addDays(today, 2);
    label = "明後日";
    confidence = "high";
  } else if (/明日|あした|あす/.test(t)) {
    dueDate = addDays(today, 1);
    label = "明日";
    confidence = "high";
  } else if (/来週中|来週/.test(t)) {
    dueDate = addDays(today, 7);
    label = "来週";
    confidence = "medium";
  } else if (/今週中|今週/.test(t)) {
    // end of this week = Sunday
    var parts = today.split("-").map(Number);
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    var toSun = (7 - d.getDay()) % 7;
    if (toSun === 0) toSun = 0;
    dueDate = addDays(today, toSun || 0);
    if (dueDate < today) dueDate = today;
    label = "今週中";
    confidence = "medium";
  }

  var weekdays = [
    { re: /日曜日|日曜/, n: 0, name: "日曜日" },
    { re: /月曜日|月曜/, n: 1, name: "月曜日" },
    { re: /火曜日|火曜/, n: 2, name: "火曜日" },
    { re: /水曜日|水曜/, n: 3, name: "水曜日" },
    { re: /木曜日|木曜/, n: 4, name: "木曜日" },
    { re: /金曜日|金曜/, n: 5, name: "金曜日" },
    { re: /土曜日|土曜/, n: 6, name: "土曜日" }
  ];
  for (var i = 0; i < weekdays.length; i++) {
    if (weekdays[i].re.test(t)) {
      var parts2 = today.split("-").map(Number);
      var cur = new Date(parts2[0], parts2[1] - 1, parts2[2]);
      var day = cur.getDay();
      var diff = (weekdays[i].n - day + 7) % 7;
      if (diff === 0) {
        ambiguous = "weekday-same";
        confidence = "low";
        dueDate = "";
        label = weekdays[i].name;
      } else {
        dueDate = addDays(today, diff);
        label = (diff <= 6 ? "今週の" : "") + weekdays[i].name;
        confidence = "medium";
      }
      break;
    }
  }

  var ymd = t.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (ymd) {
    dueDate = ymd[1] + "-" + pad2(Number(ymd[2])) + "-" + pad2(Number(ymd[3]));
    label = dueDate;
    confidence = "high";
    ambiguous = "";
  } else {
    var md = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (md) {
      var y = startOfJstDay(now).getFullYear();
      dueDate = y + "-" + pad2(Number(md[1])) + "-" + pad2(Number(md[2]));
      if (dueDate < today) {
        dueDate = (y + 1) + "-" + pad2(Number(md[1])) + "-" + pad2(Number(md[2]));
      }
      label = dueDate;
      confidence = "high";
      ambiguous = "";
    }
  }

  return {
    dueDate: dueDate,
    dueTime: dueTime,
    label: label || (dueDate || "未設定"),
    ambiguous: ambiguous,
    confidence: confidence
  };
}

function parsePriority(text) {
  var t = String(text || "");
  if (/(絶対|最優先|急ぎ|至急|忘れたら困る|今日中|締切|締め切り|朝一|朝一番)/.test(t)) {
    return { priority: "high", label: "高" };
  }
  if (/(時間があれば|余裕があれば|いつか|急がない|できれば)/.test(t)) {
    return { priority: "low", label: "低" };
  }
  return { priority: "normal", label: "通常" };
}

var PROJECT_HINTS = [
  { keys: ["人形焼き", "豊川"], idHint: "人形焼き" },
  { keys: ["風船ダーツ", "縁日"], idHint: "縁日" },
  { keys: ["ホームページ", "HP", "コーポレート"], idHint: "ホーム" },
  { keys: ["GiftCanvas", "ギフトキャンバス"], idHint: "Gift" },
  { keys: ["イベント相談", "朝倉"], idHint: "イベント" }
];

function guessProjectId(text, projects) {
  var t = String(text || "");
  var list = Array.isArray(projects) ? projects : [];
  for (var i = 0; i < PROJECT_HINTS.length; i++) {
    var hint = PROJECT_HINTS[i];
    var hit = hint.keys.some(function (k) { return t.indexOf(k) !== -1; });
    if (!hit) continue;
    var found = list.find(function (p) {
      return hint.keys.some(function (k) { return (p.name || "").indexOf(k) !== -1; }) ||
        (p.name || "").indexOf(hint.idHint) !== -1 ||
        (p.id || "").indexOf(hint.idHint) !== -1;
    });
    if (found) return found.id;
  }
  return "";
}

function cleanTitle(text, due) {
  var t = String(text || "").trim();
  t = t
    .replace(/^(タスク|TODO|やること)[:：\s]*/i, "")
    .replace(/(絶対|最優先|急ぎ|至急|今日中|朝一|朝一番|時間があれば|余裕があれば|いつか|急がない)/g, "")
    .replace(/(今日|本日|明日|あした|あす|明後日|今週中|今週|来週|午前中|午後|夕方|夜|明朝|翌朝)/g, "")
    // bare「朝」as time-of-day only (do not strip 朝倉)
    .replace(/(^|[\s　、,])朝(?=[\s　、,]|$)/g, "$1")
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*日/g, "")
    .replace(/20\d{2}\s*年/g, "")
    .replace(/\d{1,2}\s*時(\s*\d{1,2}\s*分)?/g, "")
    .replace(/[、,]\s*$/g, "")
    .replace(/^(に|を|へ|は|が|で|の)+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) t = String(text || "").trim().slice(0, 40);
  return t.slice(0, 80);
}

/**
 * Detect task-like utterance. Returns null if not a task.
 */
function detectTaskCandidate(text, options) {
  options = options || {};
  var t = String(text || "").trim();
  if (t.length < 4 || t.length > 400) return null;
  if (knowledgeLikeCommand(t)) return null;
  if (/^(おはよう|こんにちは|ありがとう|了解|はい|うん|ヘルプ|メニュー)/.test(t)) return null;
  if (/[?？]$/.test(t) && !/(する|やる|完了|追加)/.test(t)) return null;

  var actionLike =
    /(する|します|して|やる|やり|送る|返信|連絡|電話|メール|確認|決める|塗る|買う|追加|提出|対応|準備|直す|書く|作る|打ち合わせ|打合せ)/.test(t) ||
    /(まで|までに|へ|に).{0,20}(メール|電話|返信|連絡)/.test(t) ||
    /買い物|TODO|やること|タスク/.test(t);

  var due = parseDue(t, options.now);
  var hasDueCue = due.confidence !== "none" || due.ambiguous;
  if (!actionLike && !hasDueCue) return null;
  // Prefer not to steal pure knowledge facts without action
  if (!actionLike && /決定しました|開催予定です/.test(t) && !/する|やる/.test(t)) return null;

  var pr = parsePriority(t);
  var title = cleanTitle(t, due);
  if (title.length < 2) return null;

  return {
    title: title,
    description: t,
    priority: pr.priority,
    priorityLabel: pr.label,
    dueDate: due.dueDate,
    dueTime: due.dueTime,
    dueLabel: due.label,
    ambiguous: due.ambiguous,
    dueConfidence: due.confidence,
    sourceText: t,
    projectId: guessProjectId(t, options.projects || [])
  };
}

function knowledgeLikeCommand(t) {
  return /(保存して|保存しておいて|メモして|知識に入れて)/.test(t);
}

function formatDueLabel(dueDate, dueTime) {
  if (!dueDate) return "未設定";
  var today = toYmd(startOfJstDay());
  var tomorrow = addDays(today, 1);
  var head = dueDate === today ? "今日" : (dueDate === tomorrow ? "明日" : dueDate);
  return dueTime ? head + " " + dueTime : head;
}

function priorityEmoji(priority) {
  if (priority === "high") return "🔴";
  if (priority === "low") return "🟢";
  return "🟡";
}

function priorityLabelJa(priority) {
  if (priority === "high") return "高";
  if (priority === "low") return "低";
  return "通常";
}

module.exports = {
  jstNow: jstNow,
  toYmd: toYmd,
  addDays: addDays,
  startOfJstDay: startOfJstDay,
  thisWeekFriday: thisWeekFriday,
  nextWeekday: nextWeekday,
  parseDue: parseDue,
  parsePriority: parsePriority,
  parseTimeOfDay: parseTimeOfDay,
  guessProjectId: guessProjectId,
  detectTaskCandidate: detectTaskCandidate,
  formatDueLabel: formatDueLabel,
  priorityEmoji: priorityEmoji,
  priorityLabelJa: priorityLabelJa,
  cleanTitle: cleanTitle
};
