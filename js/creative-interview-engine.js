/**
 * AIヒアリング制作エンジン（ルールベース）
 * 将来 OpenAI API 差し替え用に関数を分離。
 * Browser: window.SmileCreativeInterviewEngine
 * Node: module.exports
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SmileCreativeInterviewEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var STORAGE_KEY = "smileAIStudio_interviews";
  var STATUSES = {
    IN_PROGRESS: "ヒアリング中",
    COMPLETED: "ヒアリング完了",
    CONVERTED: "制作済み",
    /** @deprecated keep for older saved drafts */
    CONVERTED_LEGACY: "制作依頼へ変換済み"
  };

  /** @type {Record<string, Array<{key:string, question:string, examples?:string[], choices?:string[], optional?:boolean}>>} */
  var QUESTION_BANKS = {
    lp: [
      {
        key: "title",
        question: "どんなLPを作りたいですか？",
        examples: ["イベント相談のページ", "無料体験の案内", "商品紹介ページ"]
      },
      {
        key: "purpose",
        question: "このページで一番達成したいことは何ですか？",
        examples: ["問い合わせを増やす", "予約を増やす"],
        choices: [
          "問い合わせを増やす",
          "予約を増やす",
          "商品を販売する",
          "サービスを知ってもらう",
          "その他"
        ]
      },
      {
        key: "target",
        question: "主にどんな人へ見てほしいですか？",
        examples: ["子育て世代", "企業の担当者", "地域の自治体"]
      },
      {
        key: "customerProblem",
        question: "その相手は、いまどんなことで困っていますか？",
        examples: ["何を頼めばいいか分からない", "業者選びが大変"]
      },
      {
        key: "service",
        question: "このページで紹介するサービスや内容は何ですか？",
        examples: ["大道芸・縁日・企画運営", "無料相談"]
      },
      {
        key: "strengths",
        question: "選ばれる理由や強みは何ですか？",
        examples: ["相談から運営まで一括", "地域密着"]
      },
      {
        key: "achievements",
        question: "見せられる実績はありますか？（なければ「なし」でOK）",
        examples: ["年間○件のイベント", "なし"],
        optional: true
      },
      {
        key: "pricing",
        question: "料金は、どのように見せたいですか？",
        examples: ["料金表を載せる", "まずは相談", "載せない"],
        choices: ["料金表を載せる", "まずは無料相談", "価格は載せない", "その他"]
      },
      {
        key: "cta",
        question: "このページを見た人に、最後に何をしてほしいですか？",
        examples: ["電話してほしい", "無料相談を申し込んでほしい", "見積もり依頼をしてほしい"],
        choices: [
          "電話してほしい",
          "無料相談を申し込んでほしい",
          "見積もり依頼をしてほしい",
          "資料請求してほしい",
          "その他"
        ]
      },
      {
        key: "images",
        question: "使える写真や素材はありますか？",
        examples: ["イベント写真あり", "ロゴのみ", "まだない"],
        choices: ["写真あり", "ロゴのみ", "まだない", "その他"]
      },
      {
        key: "designTone",
        question: "希望する雰囲気はどんな感じですか？",
        examples: ["親しみやすく信頼感", "明るく楽しい", "シンプルで清潔"],
        choices: [
          "親しみやすく信頼感",
          "明るく楽しい",
          "シンプルで清潔",
          "高級感",
          "その他"
        ]
      },
      {
        key: "referenceSites",
        question: "参考にしたいサイトはありますか？（なければ「なし」）",
        examples: ["https://…", "なし"],
        optional: true
      },
      {
        key: "prohibitedContent",
        question: "掲載してはいけない内容はありますか？（なければ「なし」）",
        examples: ["価格の比較表", "なし"],
        optional: true
      },
      {
        key: "deadline",
        question: "公開希望の時期はいつ頃ですか？",
        examples: ["今月中", "来月末", "未定"],
        choices: ["できるだけ早く", "今月中", "来月末", "未定", "その他"]
      },
      {
        key: "notes",
        question: "その他に伝えておきたいことはありますか？（なければ「なし」）",
        examples: ["スマホ優先で", "なし"],
        optional: true
      }
    ],
    home: [
      { key: "title", question: "サイト名は何ですか？", examples: ["えがおのきろく公式サイト"] },
      {
        key: "purpose",
        question: "このホームページで一番達成したいことは？",
        choices: ["会社を知ってもらう", "問い合わせを増やす", "採用", "その他"]
      },
      { key: "target", question: "主な訪問者はどんな人ですか？", examples: ["地域の保護者", "企業担当"] },
      { key: "pages", question: "だいたい何ページくらい必要ですか？", examples: ["5ページ", "トップ＋サービス＋会社概要＋お問い合わせ"] },
      {
        key: "designTone",
        question: "希望するデザインの雰囲気は？",
        choices: ["親しみやすい", "信頼感", "シンプル", "その他"]
      },
      { key: "notes", question: "その他に伝えたいことは？（なければ「なし」）", optional: true }
    ],
    blog: [
      { key: "title", question: "記事のタイトル案はありますか？", examples: ["夏のイベントの楽しみ方"] },
      { key: "category", question: "カテゴリは何にしますか？", examples: ["イベント", "お知らせ"] },
      { key: "keywords", question: "入れたいキーワードはありますか？", examples: ["夏,家族,イベント"] },
      { key: "length", question: "だいたい何文字くらいにしますか？", examples: ["1500字", "2000字"] },
      { key: "deadline", question: "公開したい日は決まっていますか？", examples: ["来週金曜", "未定"] },
      { key: "notes", question: "その他に伝えたいことは？（なければ「なし」）", optional: true }
    ],
    notice: [
      { key: "title", question: "お知らせのタイトルは？", examples: ["臨時休業のお知らせ"] },
      { key: "purpose", question: "いちばん伝えたいことは？", examples: ["日程変更", "新サービス開始"] },
      { key: "deadline", question: "公開希望日は？", examples: ["明日", "未定"] },
      { key: "notes", question: "その他に伝えたいことは？（なければ「なし」）", optional: true }
    ],
    banner: [
      { key: "title", question: "バナーの用途は何ですか？", examples: ["夏キャンペーン告知"] },
      { key: "purpose", question: "見た人にどうしてほしいですか？", examples: ["クリックして詳細へ"] },
      {
        key: "designTone",
        question: "雰囲気は？",
        choices: ["明るい", "落ち着いた", "目立つ", "その他"]
      },
      { key: "images", question: "使える写真はありますか？", choices: ["あり", "なし", "その他"] },
      { key: "notes", question: "その他に伝えたいことは？（なければ「なし」）", optional: true }
    ],
    sns: [
      { key: "title", question: "投稿のテーマは何ですか？", examples: ["夏イベントの告知"] },
      {
        key: "media",
        question: "どの媒体に出しますか？",
        choices: ["Instagram", "TikTok", "Facebook", "YouTube", "X", "その他"]
      },
      { key: "postBody", question: "伝えたい内容をざっくり教えてください", examples: ["楽しい夏のイベント開催！"] },
      { key: "images", question: "写真や動画素材はありますか？", choices: ["あり", "なし", "その他"] },
      { key: "cta", question: "最後に促したい行動は？", examples: ["プロフィールのリンクへ", "いいね・保存"] },
      { key: "notes", question: "その他に伝えたいことは？（なければ「なし」）", optional: true }
    ],
    html: [
      { key: "title", question: "どんなHTMLページを作りますか？", examples: ["キャンペーン専用ページ"] },
      { key: "purpose", question: "目的・用途は何ですか？", examples: ["期間限定の案内"] },
      { key: "target", question: "誰向けですか？", examples: ["既存顧客"] },
      { key: "notes", question: "その他に伝えたいことは？（なければ「なし」）", optional: true }
    ],
    app: [
      { key: "title", question: "アプリ名（仮でOK）は？", examples: ["社内TODO"] },
      { key: "purpose", question: "このアプリで達成したいことは？", examples: ["タスク漏れをなくす"] },
      { key: "features", question: "必要な機能を教えてください", examples: ["一覧、完了、通知"] },
      { key: "target", question: "使う人は誰ですか？", examples: ["社内スタッフ"] },
      { key: "notes", question: "その他に伝えたいことは？（なければ「なし」）", optional: true }
    ]
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function createEmptyAnswers() {
    return {
      title: "",
      purpose: "",
      target: "",
      customerProblem: "",
      service: "",
      strengths: "",
      achievements: "",
      pricing: "",
      cta: "",
      images: "",
      designTone: "",
      referenceSites: "",
      prohibitedContent: "",
      deadline: "",
      notes: "",
      pages: "",
      category: "",
      keywords: "",
      length: "",
      media: "",
      postBody: "",
      features: ""
    };
  }

  function getQuestionBank(creativeType) {
    return QUESTION_BANKS[creativeType] || QUESTION_BANKS.lp;
  }

  function isNoneAnswer(value) {
    var v = String(value || "").trim();
    return !v || /^(なし|無い|ない|no|none|未定|特になし)$/i.test(v);
  }

  function answerFilled(answers, key) {
    var v = answers && answers[key];
    return !!(v && String(v).trim());
  }

  /**
   * 既存回答・テキストから埋まっているキーを推定し、重複質問を避ける。
   */
  function inferAnswersFromText(text, answers) {
    var a = Object.assign({}, answers || {});
    var t = String(text || "");
    if (!t) return a;

    if (!answerFilled(a, "purpose")) {
      if (/問い合わせ|問合せ|連絡/.test(t)) a.purpose = "問い合わせを増やす";
      else if (/予約/.test(t)) a.purpose = "予約を増やす";
      else if (/販売|購入|買う/.test(t)) a.purpose = "商品を販売する";
      else if (/知って|認知|紹介/.test(t)) a.purpose = "サービスを知ってもらう";
    }
    if (!answerFilled(a, "cta")) {
      if (/無料相談/.test(t)) a.cta = "無料相談を申し込んでほしい";
      else if (/電話/.test(t)) a.cta = "電話してほしい";
      else if (/見積/.test(t)) a.cta = "見積もり依頼をしてほしい";
      else if (/資料/.test(t)) a.cta = "資料請求してほしい";
    }
    if (!answerFilled(a, "images")) {
      if (/写真(が)?(ある|あり)|素材(が)?(ある|あり)/.test(t)) a.images = "写真あり";
      else if (/写真(が)?ない|素材(が)?ない|まだない/.test(t)) a.images = "まだない";
    }
    if (!answerFilled(a, "referenceSites") && /https?:\/\//i.test(t)) {
      var m = t.match(/https?:\/\/\S+/i);
      if (m) a.referenceSites = m[0];
    }
    return a;
  }

  function skipAnsweredQuestions(interview, questions) {
    var answers = (interview && interview.answers) || {};
    var list = questions || getQuestionBank(interview && interview.creativeType);
    return list.filter(function (q) {
      if (answerFilled(answers, q.key)) return false;
      // 任意項目で「なし」相当が既にある場合もスキップ対象だが、未回答なら出す
      return true;
    });
  }

  function generateFollowUpQuestion(/* interview, lastKey, lastValue */) {
    // 将来 OpenAI 差し替えポイント。現状は追加質問なし。
    return null;
  }

  function getNextInterviewQuestion(interview) {
    if (!interview) return null;
    var bank = getQuestionBank(interview.creativeType);
    var remaining = skipAnsweredQuestions(interview, bank);
    if (!remaining.length) return null;

    var follow = generateFollowUpQuestion(interview);
    if (follow) return follow;

    var idx = typeof interview.currentStep === "number" ? interview.currentStep : 0;
    // currentStep は「回答済み設問数」として扱い、remaining の先頭を次問にする
    var q = remaining[0];
    var total = bank.length;
    var answered = bank.length - remaining.length;
    return {
      question: q,
      progressCurrent: answered + 1,
      progressTotal: total,
      remainingCount: remaining.length
    };
  }

  function saveInterviewAnswer(interview, answerKey, value) {
    if (!interview) return interview;
    var key = answerKey || (interview._pendingKey);
    var text = String(value || "").trim();
    if (text === "その他") text = "";
    interview.answers = interview.answers || createEmptyAnswers();
    if (key) {
      interview.answers[key] = text;
    }
    interview.answers = inferAnswersFromText(text, interview.answers);
    interview.updatedAt = nowIso();
    interview.status = STATUSES.IN_PROGRESS;

    var bank = getQuestionBank(interview.creativeType);
    var remaining = skipAnsweredQuestions(interview, bank);
    interview.currentStep = bank.length - remaining.length;

    if (!remaining.length) {
      interview.status = STATUSES.COMPLETED;
      interview.completedAt = nowIso();
    }
    return interview;
  }

  function buildCreativeBrief(interview) {
    var a = (interview && interview.answers) || {};
    var type = (interview && interview.creativeType) || "lp";
    var typeLabels = {
      lp: "LP",
      home: "ホームページ",
      blog: "ブログ記事",
      notice: "お知らせ",
      banner: "バナー",
      sns: "SNS投稿",
      html: "HTMLページ",
      app: "AIアプリ"
    };
    var label = typeLabels[type] || type;
    var lines = ["【" + label + "制作要件】"];

    function add(name, val) {
      if (!val || isNoneAnswer(val)) return;
      lines.push(name + "：");
      lines.push(String(val));
    }

    add("タイトル", a.title);
    add("目的", a.purpose);
    add("ターゲット", a.target);
    add("悩み", a.customerProblem);
    add("提供サービス", a.service);
    add("強み", a.strengths);
    add("実績", a.achievements);
    add("料金の見せ方", a.pricing);
    add("CTA", a.cta);
    add("写真・素材", a.images);
    add("希望デザイン", a.designTone);
    add("参考サイト", a.referenceSites);
    add("掲載禁止", a.prohibitedContent);
    add("公開希望", a.deadline);
    add("ページ数", a.pages);
    add("カテゴリ", a.category);
    add("キーワード", a.keywords);
    add("文字数", a.length);
    add("媒体", a.media);
    add("投稿内容", a.postBody);
    add("必要機能", a.features);
    add("その他", a.notes);

    return {
      title: a.title || "",
      purpose: a.purpose || "",
      target: a.target || "",
      customerProblem: a.customerProblem || "",
      service: a.service || "",
      strengths: a.strengths || "",
      achievements: a.achievements || "",
      pricing: a.pricing || "",
      cta: a.cta || "",
      images: a.images || "",
      design: a.designTone || "",
      referenceSites: a.referenceSites || "",
      prohibitedContent: a.prohibitedContent || "",
      deadline: a.deadline || "",
      notes: a.notes || "",
      pages: a.pages || "",
      category: a.category || "",
      keywords: a.keywords || "",
      length: a.length || "",
      media: a.media || "",
      postBody: a.postBody || "",
      features: a.features || "",
      text: lines.join("\n")
    };
  }

  function createInterview(creativeType, opts) {
    var now = nowIso();
    return {
      id: "interview-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8),
      draftTitle: (opts && opts.draftTitle) || "",
      creativeType: creativeType || "lp",
      currentStep: 0,
      answers: createEmptyAnswers(),
      startedAt: now,
      updatedAt: now,
      completedAt: "",
      status: STATUSES.IN_PROGRESS,
      creator: (opts && opts.creator) || "YAHA",
      history: []
    };
  }

  function normalizeInterviewStatus(status) {
    if (status === STATUSES.CONVERTED_LEGACY) return STATUSES.CONVERTED;
    return status || STATUSES.IN_PROGRESS;
  }

  function isConvertedStatus(status) {
    var s = normalizeInterviewStatus(status);
    return s === STATUSES.CONVERTED || s === STATUSES.CONVERTED_LEGACY;
  }

  function getInterviewDisplayTitle(interview) {
    if (!interview) return "無題のヒアリング";
    var t = String(interview.draftTitle || "").trim();
    if (t) return t;
    var a = interview.answers && interview.answers.title;
    if (a && String(a).trim()) return String(a).trim();
    return "無題のヒアリング";
  }

  function getInterviewProgress(interview) {
    var bank = getQuestionBank(interview && interview.creativeType);
    var total = bank.length || 1;
    var remaining = skipAnsweredQuestions(interview, bank);
    var answered = Math.max(0, total - remaining.length);
    var current = Math.min(total, answered + (remaining.length ? 1 : 0));
    if (normalizeInterviewStatus(interview && interview.status) === STATUSES.COMPLETED ||
        isConvertedStatus(interview && interview.status)) {
      current = total;
      answered = total;
    }
    return {
      current: current,
      answered: answered,
      total: total,
      label: answered + "/" + total
    };
  }

  function needsDraftTitle(interview) {
    return !(interview && String(interview.draftTitle || "").trim());
  }

  function setDraftTitle(interview, title) {
    if (!interview) return interview;
    interview.draftTitle = String(title || "").trim();
    interview.updatedAt = nowIso();
    return interview;
  }

  function renameInterview(id, newTitle, storage) {
    var list = loadInterviews(storage);
    var found = null;
    list = list.map(function (it) {
      if (it.id !== id) return it;
      found = setDraftTitle(Object.assign({}, it), newTitle);
      return found;
    });
    if (!found) return null;
    saveInterviews(list, storage);
    return found;
  }

  function duplicateInterview(id, storage) {
    var list = loadInterviews(storage);
    var src = list.find(function (it) { return it.id === id; });
    if (!src) return null;
    var now = nowIso();
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = "interview-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8);
    copy.draftTitle = getInterviewDisplayTitle(src) + "（コピー）";
    copy.startedAt = now;
    copy.updatedAt = now;
    copy.completedAt = "";
    copy.status = STATUSES.IN_PROGRESS;
    list.unshift(copy);
    saveInterviews(list, storage);
    return copy;
  }

  function deleteInterview(id, storage) {
    var list = loadInterviews(storage).filter(function (it) { return it.id !== id; });
    saveInterviews(list, storage);
    return true;
  }

  function markInterviewProduced(interview) {
    if (!interview) return interview;
    interview.status = STATUSES.CONVERTED;
    interview.updatedAt = nowIso();
    interview.completedAt = interview.completedAt || interview.updatedAt;
    if (!String(interview.draftTitle || "").trim()) {
      interview.draftTitle = getInterviewDisplayTitle(interview);
    }
    return interview;
  }

  function goBackOneAnswer(interview) {
    if (!interview || !interview.history || !interview.history.length) return interview;
    var last = interview.history.pop();
    if (last && last.key) {
      interview.answers[last.key] = "";
    }
    interview.updatedAt = nowIso();
    interview.status = STATUSES.IN_PROGRESS;
    interview.completedAt = "";
    var bank = getQuestionBank(interview.creativeType);
    var remaining = skipAnsweredQuestions(interview, bank);
    interview.currentStep = bank.length - remaining.length;
    return interview;
  }

  function recordHistory(interview, key, value, questionText) {
    interview.history = interview.history || [];
    interview.history.push({
      key: key,
      value: value,
      question: questionText || "",
      at: nowIso()
    });
    return interview;
  }

  function interviewToCreativeJob(interview, brief, typeMeta) {
    var b = brief || buildCreativeBrief(interview);
    var meta = typeMeta || { id: interview.creativeType, label: interview.creativeType };
    var now = nowIso();
    var memoParts = [];
    if (b.notes && !isNoneAnswer(b.notes)) memoParts.push(b.notes);
    if (b.customerProblem) memoParts.push("悩み: " + b.customerProblem);
    if (b.service) memoParts.push("サービス: " + b.service);
    if (b.strengths) memoParts.push("強み: " + b.strengths);
    if (b.achievements && !isNoneAnswer(b.achievements)) memoParts.push("実績: " + b.achievements);
    if (b.pricing) memoParts.push("料金: " + b.pricing);
    if (b.prohibitedContent && !isNoneAnswer(b.prohibitedContent)) {
      memoParts.push("掲載禁止: " + b.prohibitedContent);
    }
    memoParts.push("--- ヒアリング全文 ---");
    memoParts.push(b.text || "");

    return {
      id: "creative-" + Date.now(),
      type: meta.id || interview.creativeType,
      typeLabel: meta.label || interview.creativeType,
      title: b.title || "無題",
      purpose: b.purpose || "",
      target: b.target || "",
      cta: b.cta || "",
      keywords: b.keywords || "",
      images: b.images || "",
      memo: memoParts.join("\n"),
      pages: b.pages || "",
      design: b.design || "",
      category: b.category || "",
      length: b.length || "",
      publishDate: "",
      deadline: b.deadline || "",
      media: b.media || "",
      postBody: b.postBody || "",
      features: b.features || "",
      referenceUrl: b.referenceSites || "",
      referenceSites: b.referenceSites || "",
      createdAt: now,
      updatedAt: now,
      status: "設計中",
      creator: interview.creator || "YAHA",
      sourceType: "ai-interview",
      interviewId: interview.id,
      interviewAnswers: Object.assign({}, interview.answers),
      brief: b.text || "",
      pipeline: {
        writer: "pending",
        designer: "pending",
        programmer: "pending",
        tester: "pending"
      }
    };
  }

  /** Storage helpers (injectable localStorage-like) */
  function loadInterviews(storage) {
    var store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return [];
    try {
      var raw = store.getItem(STORAGE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveInterviews(list, storage) {
    var store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return;
    store.setItem(STORAGE_KEY, JSON.stringify((list || []).slice(0, 100)));
  }

  function upsertInterview(interview, storage) {
    var list = loadInterviews(storage);
    var found = false;
    if (interview) {
      interview.status = normalizeInterviewStatus(interview.status);
      interview.updatedAt = interview.updatedAt || nowIso();
    }
    list = list.map(function (it) {
      if (it.id !== interview.id) return it;
      found = true;
      return interview;
    });
    if (!found) list.unshift(interview);
    saveInterviews(list, storage);
    return interview;
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    STATUSES: STATUSES,
    QUESTION_BANKS: QUESTION_BANKS,
    createEmptyAnswers: createEmptyAnswers,
    getQuestionBank: getQuestionBank,
    skipAnsweredQuestions: skipAnsweredQuestions,
    getNextInterviewQuestion: getNextInterviewQuestion,
    saveInterviewAnswer: saveInterviewAnswer,
    buildCreativeBrief: buildCreativeBrief,
    generateFollowUpQuestion: generateFollowUpQuestion,
    inferAnswersFromText: inferAnswersFromText,
    createInterview: createInterview,
    goBackOneAnswer: goBackOneAnswer,
    recordHistory: recordHistory,
    interviewToCreativeJob: interviewToCreativeJob,
    loadInterviews: loadInterviews,
    saveInterviews: saveInterviews,
    upsertInterview: upsertInterview,
    isNoneAnswer: isNoneAnswer,
    normalizeInterviewStatus: normalizeInterviewStatus,
    isConvertedStatus: isConvertedStatus,
    getInterviewDisplayTitle: getInterviewDisplayTitle,
    getInterviewProgress: getInterviewProgress,
    needsDraftTitle: needsDraftTitle,
    setDraftTitle: setDraftTitle,
    renameInterview: renameInterview,
    duplicateInterview: duplicateInterview,
    deleteInterview: deleteInterview,
    markInterviewProduced: markInterviewProduced
  };
});
