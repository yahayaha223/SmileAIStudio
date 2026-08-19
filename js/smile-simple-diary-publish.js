/**
 * One-button diary publish orchestration.
 * Reuses existing local apply / package / dry-run / unlock-arm / production publish gates.
 * Technical FTP unlock/arm/dry-run steps stay in code; UI only sees progress labels.
 */
(function (root) {
  "use strict";

  var DIARY_URL = "https://www.egaonokiroku.co.jp/diary/index.htm";
  var UNLOCK_PHRASE = "本番公開を有効にする";
  var EXECUTE_PHRASE = "公開";

  function isLocalHost() {
    var Probe = root.SmileFtpProbe;
    if (Probe && typeof Probe.isLocalFtpRuntime === "function") {
      return !!Probe.isLocalFtpRuntime();
    }
    try {
      var h = String((root.location && root.location.hostname) || "").toLowerCase();
      return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
    } catch (e) {
      return false;
    }
  }

  function progress(onProgress, stage, message) {
    if (typeof onProgress === "function") {
      try { onProgress({ stage: stage, message: message }); } catch (e) { /* ignore */ }
    }
  }

  function fail(code, message, extra) {
    var out = {
      ok: false,
      code: code || "failed",
      message: message || "公開できませんでした",
      productionUntouched: true,
      pageUrl: DIARY_URL,
      log: []
    };
    if (extra && typeof extra === "object") {
      Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    }
    return out;
  }

  /**
   * @param {object} opts
   * @param {object} opts.entry - diary entry (saved)
   * @param {array} opts.memoryItems - image items
   * @param {object} opts.indexSource - loaded CorporateSite index
   * @param {function} [opts.loadIndex] - () => Promise<source>
   * @param {function} [opts.onProgress]
   * @param {boolean} opts.userConfirmed - UI confirm for production
   */
  function runOneButtonPublish(opts) {
    opts = opts || {};
    var onProgress = opts.onProgress;
    var entry = opts.entry;
    var memoryItems = opts.memoryItems || [];
    var log = [];

    function note(msg) {
      log.push({ at: new Date().toISOString(), message: msg });
    }

    if (!entry || !entry.id) {
      return Promise.resolve(fail("invalid_entry", "日記データがありません", { log: log }));
    }
    if (!opts.userConfirmed) {
      return Promise.resolve(fail("confirm_required", "公開確認が必要です", {
        needsConfirm: true,
        log: log
      }));
    }

    var Local = root.SmileDiaryLocalPublish;
    var Pack = root.SmileDiaryPublishPackage;
    var Probe = root.SmileFtpProbe;
    var DryRun = root.SmileFtpDryRun;
    var Prod = root.SmileFtpProductionPublish;

    if (!Local || !Pack) {
      return Promise.resolve(fail("modules_missing", "公開モジュールを読み込めませんでした", { log: log }));
    }

    progress(onProgress, "html", "ホームページ用の文章を作っています…");
    note("start_pipeline");

    var indexPromise = opts.indexSource
      ? Promise.resolve(opts.indexSource)
      : (typeof opts.loadIndex === "function"
        ? opts.loadIndex()
        : Promise.reject(new Error("index.htm が読み込まれていません")));

    return indexPromise.then(function (source) {
      if (!source || !source.text) {
        throw Object.assign(new Error("index.htm が読み込まれていません"), { code: "index_missing" });
      }
      progress(onProgress, "images", "写真を整えています…");
      return Local.prepareLocalPublish({
        entry: entry,
        memoryItems: memoryItems,
        source: source,
        otherEntries: opts.otherEntries || []
      }).then(function (preview) {
        if (!preview || !preview.ok) {
          var blockers = (preview && preview.blockers) || [];
          throw Object.assign(
            new Error((preview && preview.error) || blockers.join(" / ") || "反映準備に失敗しました"),
            { code: "prepare_failed", productionUntouched: true }
          );
        }
        if (preview.prepared && preview.prepared.alreadyReflected) {
          note("already_reflected_local");
        }
        progress(onProgress, "local_apply", "安全な控えを取りながら反映しています…");
        return Local.publishLocal(preview, { backupName: preview.backupName }).then(function (localResult) {
          note("local_apply_ok");
          if (typeof Pack.recordLocalPublishSession === "function") {
            Pack.recordLocalPublishSession({
              result: localResult,
              entry: entry,
              preview: preview
            });
          }
          progress(onProgress, "package", "公開準備をしています…");
          return Pack.preparePublishPackage().then(function (pkgPreview) {
            if (!pkgPreview || !pkgPreview.canCreateZip) {
              var pb = (pkgPreview && pkgPreview.checks && pkgPreview.checks.blockers) || [];
              throw Object.assign(
                new Error(pb.join(" / ") || "公開パッケージ検査に失敗しました"),
                { code: "package_failed", productionUntouched: true }
              );
            }
            return Pack.createPublishZip(pkgPreview).then(function (zipResult) {
              note("package_ok:" + ((zipResult && zipResult.manifest && zipResult.manifest.publishId) || ""));
              if (!isLocalHost()) {
                return fail("not_local", "この端末では本番ホームページへ自動公開できません。日記は保存済みです。", {
                  diarySaved: true,
                  localApplied: true,
                  packageReady: true,
                  productionUntouched: true,
                  log: log
                });
              }
              if (!Probe || !DryRun || !Prod) {
                return fail("ftp_modules_missing", "公開点検モジュールがありません", {
                  diarySaved: true,
                  localApplied: true,
                  productionUntouched: true,
                  log: log
                });
              }

              progress(onProgress, "probe", "公開前の点検をしています…");
              return Probe.loadConfig().then(function (cfgBody) {
                if (!cfgBody || !cfgBody.ok || !cfgBody.config) {
                  throw Object.assign(
                    new Error((cfgBody && cfgBody.userMessage) || "接続設定を読み込めませんでした"),
                    { code: "ftp_config", productionUntouched: true }
                  );
                }
                var ftpConfig = cfgBody.config;
                return Probe.runProbe().then(function (probeResult) {
                  note("probe:" + !!(probeResult && probeResult.ok));
                  progress(onProgress, "dry_run", "公開前の点検をしています…");
                  return DryRun.runDryRun({
                    ftpConfig: ftpConfig,
                    probeResult: probeResult
                  }).then(function (dry) {
                    note("dry_run:" + ((dry && dry.verdict) || "none"));
                    if (!dry || dry.verdict !== "READY_FOR_PRODUCTION") {
                      throw Object.assign(
                        new Error((dry && dry.userMessage) || "公開前点検を通過できませんでした"),
                        {
                          code: "dry_run_blocked",
                          productionUntouched: true,
                          dryRun: dry
                        }
                      );
                    }
                    progress(onProgress, "safety", "最終チェックをしています…");
                    var bundle = Pack.loadLastPublishManifest && Pack.loadLastPublishManifest();
                    var eligibility = Prod.evaluateEligibility({
                      dryRunResult: dry,
                      bundle: bundle,
                      diaryStatus: "package-ready",
                      ftpConfig: ftpConfig
                    });
                    if (!eligibility || !eligibility.ok) {
                      throw Object.assign(
                        new Error(((eligibility && eligibility.blockers) || []).join(" / ") || "最終チェック未通過"),
                        { code: "eligibility_blocked", productionUntouched: true }
                      );
                    }
                    progress(onProgress, "arm", "公開の準備を整えています…");
                    return Prod.enableRealPublishModeWithServerArm({
                      eligibility: eligibility,
                      dryRunResult: dry,
                      bundle: bundle,
                      ftpConfig: ftpConfig,
                      confirmPhrase: UNLOCK_PHRASE,
                      confirmChecks: { write: true, diaryOnly: true, rollback: true }
                    }).then(function (arm) {
                      if (!arm || !arm.ok || !arm.armed) {
                        throw Object.assign(
                          new Error((arm && arm.userMessage) || ((arm && arm.blockers) || []).join(" / ") || "公開準備に失敗しました"),
                          { code: "arm_failed", productionUntouched: true }
                        );
                      }
                      progress(onProgress, "publish", "公開しています…");
                      return Prod.runProductionPublish({
                        eligibility: eligibility,
                        explicitConfirm: true,
                        confirmPhrase: EXECUTE_PHRASE,
                        confirmChecks: { homepage: true, content: true, rollback: true },
                        diaryId: entry.id,
                        ftpConfig: ftpConfig,
                        uiSafeMode: false,
                        allowRealPublish: true,
                        armStatus: arm.status,
                        productionDiaryUrl: DIARY_URL
                      }).then(function (pub) {
                        note("publish:" + ((pub && pub.result) || "none"));
                        progress(onProgress, "verify", "公開結果を確認しています…");
                        if (!pub || !pub.ok || pub.safeMode || !pub.realPublishStarted) {
                          throw Object.assign(
                            new Error((pub && pub.userMessage) || "本番への公開が完了しませんでした"),
                            {
                              code: "publish_incomplete",
                              productionUntouched: !(pub && pub.realPublishStarted && !pub.safeMode),
                              publishResult: pub
                            }
                          );
                        }
                        progress(onProgress, "history", "記録を残しています…");
                        note("success");
                        return {
                          ok: true,
                          code: "published",
                          message: "日記を公開しました",
                          pageUrl: DIARY_URL,
                          productionUntouched: false,
                          publishResult: pub,
                          diaryId: entry.id,
                          log: log
                        };
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    }).catch(function (err) {
      note("error:" + ((err && err.message) || "unknown"));
      return fail(
        (err && err.code) || "pipeline_error",
        (err && err.message) || "公開できませんでした",
        {
          productionUntouched: err && typeof err.productionUntouched === "boolean"
            ? err.productionUntouched
            : true,
          diarySaved: true,
          log: log,
          error: err
        }
      );
    });
  }

  root.SmileSimpleDiaryPublish = {
    runOneButtonPublish: runOneButtonPublish,
    isLocalHost: isLocalHost,
    DIARY_URL: DIARY_URL,
    UNLOCK_PHRASE: UNLOCK_PHRASE,
    EXECUTE_PHRASE: EXECUTE_PHRASE
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
