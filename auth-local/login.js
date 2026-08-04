/**
 * Smile AI Studio — login client (local / Deploy Preview).
 * Passkeys: browser WebAuthn only. No biometric data sent as images.
 */
(function () {
  "use strict";

  var GENERIC_FAIL = "ログインできませんでした。入力内容をご確認のうえ、再度お試しください。";
  var AUTH_BASE = "/api/auth";

  var el = {
    passkeyBtn: document.getElementById("btn-passkey-login"),
    emailBtn: document.getElementById("btn-email-login"),
    registerBtn: document.getElementById("btn-register-passkey"),
    recoverLink: document.getElementById("link-recover"),
    recoverSection: document.getElementById("recover"),
    recoverSubmit: document.getElementById("btn-recover-submit"),
    recoverEmail: document.getElementById("recover-email"),
    capability: document.getElementById("passkey-capability"),
    status: document.getElementById("login-status")
  };

  var busy = false;
  var csrfToken = "";

  function setBusy(on) {
    busy = !!on;
    [el.passkeyBtn, el.emailBtn, el.registerBtn, el.recoverSubmit].forEach(function (b) {
      if (b) b.disabled = !!on;
    });
  }

  function setStatus(message, kind) {
    el.status.textContent = message || "";
    el.status.classList.remove("is-error", "is-info");
    if (kind) el.status.classList.add(kind);
  }

  function setCapability(text, kind) {
    el.capability.textContent = text;
    el.capability.classList.remove("is-ok", "is-warn");
    if (kind) el.capability.classList.add(kind);
  }

  function authUrl(path) {
    return AUTH_BASE + "/" + path.replace(/^\//, "");
  }

  function api(path, options) {
    options = options || {};
    var headers = Object.assign({ Accept: "application/json", "Content-Type": "application/json" }, options.headers || {});
    if (csrfToken && options.method && options.method !== "GET") {
      headers["X-CSRF-Token"] = csrfToken;
    }
    return fetch(authUrl(path), {
      method: options.method || "GET",
      headers: headers,
      body: options.body != null ? JSON.stringify(options.body) : undefined,
      credentials: "include",
      cache: "no-store"
    }).then(function (res) {
      return res.json().catch(function () {
        return { ok: false, error: "invalid_json", _httpStatus: res.status };
      }).then(function (data) {
        data = data || {};
        data._httpStatus = res.status;
        return data;
      });
    });
  }

  function clearTokenFromUrl() {
    if (location.hash && location.hash.indexOf("auth_token=") !== -1) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  function tokenFromHash() {
    var h = String(location.hash || "").replace(/^#/, "");
    var parts = h.split("&");
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split("=");
      if (kv[0] === "auth_token") return decodeURIComponent(kv[1] || "");
    }
    return "";
  }

  function probeWebAuthn() {
    var result = {
      publicKeyCredential: typeof window.PublicKeyCredential === "function",
      platformAuthenticator: false,
      conditionalMediation: false,
      secureContext: window.isSecureContext === true,
      protocol: location.protocol,
      host: location.hostname
    };
    var chain = Promise.resolve();
    if (result.publicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
      chain = chain.then(function () {
        return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      }).then(function (ok) { result.platformAuthenticator = !!ok; }).catch(function () {});
    }
    if (result.publicKeyCredential && PublicKeyCredential.isConditionalMediationAvailable) {
      chain = chain.then(function () {
        return PublicKeyCredential.isConditionalMediationAvailable();
      }).then(function (ok) { result.conditionalMediation = !!ok; }).catch(function () {});
    }
    return chain.then(function () { return result; });
  }

  function bufferToBase64url(buf) {
    var bytes = new Uint8Array(buf);
    var str = "";
    for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64urlToBuffer(b64) {
    var pad = "=".repeat((4 - (b64.length % 4)) % 4);
    var base64 = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out.buffer;
  }

  function publicKeyOptionsToBrowser(options) {
    var o = JSON.parse(JSON.stringify(options));
    if (o.challenge) o.challenge = base64urlToBuffer(o.challenge);
    if (o.user && o.user.id) o.user.id = base64urlToBuffer(o.user.id);
    if (Array.isArray(o.excludeCredentials)) {
      o.excludeCredentials = o.excludeCredentials.map(function (c) {
        return Object.assign({}, c, { id: base64urlToBuffer(c.id) });
      });
    }
    if (Array.isArray(o.allowCredentials)) {
      o.allowCredentials = o.allowCredentials.map(function (c) {
        return Object.assign({}, c, { id: base64urlToBuffer(c.id) });
      });
    }
    return o;
  }

  function credentialToJson(cred) {
    var r = cred.response;
    var out = {
      id: cred.id,
      rawId: bufferToBase64url(cred.rawId),
      type: cred.type,
      authenticatorAttachment: cred.authenticatorAttachment || undefined,
      clientExtensionResults: cred.clientExtensionResults || {},
      response: {}
    };
    if (r.clientDataJSON) out.response.clientDataJSON = bufferToBase64url(r.clientDataJSON);
    if (r.attestationObject) out.response.attestationObject = bufferToBase64url(r.attestationObject);
    if (r.authenticatorData) out.response.authenticatorData = bufferToBase64url(r.authenticatorData);
    if (r.signature) out.response.signature = bufferToBase64url(r.signature);
    if (r.userHandle) out.response.userHandle = bufferToBase64url(r.userHandle);
    if (r.getTransports) out.response.transports = r.getTransports();
    return out;
  }

  async function refreshSession() {
    var data = await api("session", { method: "GET" });
    if (data && data.csrfToken) csrfToken = data.csrfToken;
    return data;
  }

  async function passkeyLogin() {
    if (busy) return;
    setBusy(true);
    setStatus("パスキーを確認しています…", "is-info");
    try {
      var opt = await api("passkey/login/options", { method: "POST", body: {} });
      if (!opt.ok || !opt.options) throw new Error("options");
      var assertion = await navigator.credentials.get({
        publicKey: publicKeyOptionsToBrowser(opt.options)
      });
      if (!assertion) throw new Error("cancelled");
      var verified = await api("passkey/login/verify", {
        method: "POST",
        body: { credential: credentialToJson(assertion), deviceName: navigator.platform || "Passkey" }
      });
      if (!verified.ok) {
        setStatus(GENERIC_FAIL, "is-error");
        return;
      }
      await refreshSession();
      setStatus("ログインしました。Studio へ移動できます。", "is-info");
      setTimeout(function () { location.href = "/index.html"; }, 600);
    } catch (e) {
      setStatus(GENERIC_FAIL, "is-error");
    } finally {
      setBusy(false);
    }
  }

  async function emailStart(email) {
    if (busy) return;
    setBusy(true);
    setStatus("送信処理中…", "is-info");
    try {
      var data = await api("email/start", {
        method: "POST",
        body: { email: email, appUrl: location.origin }
      });
      setStatus(data.message || "リクエストを受け付けました。登録がある場合のみ案内が届きます。", "is-info");
      if (data.debugToken) {
        // Local test only when AUTH_TEST_EXPOSE_EMAIL_TOKEN=1
        setStatus("（開発）トークンを検証します…", "is-info");
        await emailVerify(data.debugToken);
      }
    } catch (e) {
      setStatus("リクエストを受け付けました。登録がある場合のみ案内が届きます。", "is-info");
    } finally {
      setBusy(false);
    }
  }

  async function emailVerify(token) {
    var data = await api("email/verify", {
      method: "POST",
      body: { token: token, deviceName: navigator.platform || "Device" }
    });
    clearTokenFromUrl();
    if (!data.ok) {
      setStatus(GENERIC_FAIL, "is-error");
      return false;
    }
    await refreshSession();
    setStatus("メールを確認しました。初回パスキー登録へ進んでください。", "is-info");
    return true;
  }

  async function registerPasskey() {
    if (busy) return;
    setBusy(true);
    setStatus("パスキー登録を準備しています…", "is-info");
    try {
      await refreshSession();
      var opt = await api("passkey/register/options", { method: "POST", body: {} });
      if (!opt.ok || !opt.options) {
        setStatus("先にメールログイン（初回登録）を完了してください。", "is-error");
        return;
      }
      var cred = await navigator.credentials.create({
        publicKey: publicKeyOptionsToBrowser(opt.options)
      });
      if (!cred) throw new Error("cancelled");
      var verified = await api("passkey/register/verify", {
        method: "POST",
        body: { credential: credentialToJson(cred), deviceName: navigator.platform || "Passkey" }
      });
      if (!verified.ok) {
        setStatus(GENERIC_FAIL, "is-error");
        return;
      }
      await refreshSession();
      setStatus("パスキーを登録しました。", "is-info");
    } catch (e) {
      setStatus(GENERIC_FAIL, "is-error");
    } finally {
      setBusy(false);
    }
  }

  el.passkeyBtn.addEventListener("click", passkeyLogin);
  el.emailBtn.addEventListener("click", function () {
    el.recoverSection.hidden = false;
    if (el.recoverEmail) el.recoverEmail.focus();
    setStatus("メールアドレスを入力し、送信してください。", "is-info");
  });
  el.registerBtn.addEventListener("click", registerPasskey);
  el.recoverLink.addEventListener("click", function (e) {
    e.preventDefault();
    el.recoverSection.hidden = !el.recoverSection.hidden;
  });
  el.recoverSubmit.addEventListener("click", function () {
    var email = (el.recoverEmail && el.recoverEmail.value) || "";
    emailStart(email);
  });

  probeWebAuthn().then(function (info) {
    window.__SMILE_WEBAUTHN_PROBE__ = info;
    if (!info.publicKeyCredential) {
      setCapability("このブラウザはパスキー未対応です。メール代替をご利用ください。", "is-warn");
      el.passkeyBtn.disabled = true;
      return;
    }
    if (info.platformAuthenticator) {
      setCapability("この端末は顔認証・指紋・Windows Hello 等のパスキーに対応しています。", "is-ok");
    } else {
      setCapability("プラットフォーム認証は未検出です。外部キーまたはメール代替が使えます。", "is-warn");
    }
  });

  // Hash token from email link
  var t = tokenFromHash();
  if (t) {
    emailVerify(t).then(function () { /* status set inside */ });
  } else {
    refreshSession().catch(function () { /* ignore */ });
  }
})();
