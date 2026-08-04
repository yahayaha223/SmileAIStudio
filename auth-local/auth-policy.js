/**
 * Auth policy module for Smile AI Studio (design prototype / unit-tested).
 * No network. No secrets. Node + browser friendly (CommonJS + global).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SmileAuthPolicy = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var ROLES = ["owner", "admin", "staff"];

  var PERMISSIONS = {
    viewDashboard: ["owner", "admin", "staff"],
    createInstruction: ["owner", "admin", "staff"],
    saveDraft: ["owner", "admin", "staff"],
    manageProjects: ["owner", "admin"],
    allowedPublish: ["owner", "admin"],
    productionPublish: ["owner"],
    ftpUpload: ["owner"],
    fileDelete: ["owner"],
    backupRestore: ["owner"],
    manageUsers: ["owner"],
    changeRoles: ["owner"],
    viewSecrets: ["owner"],
    changeConnectionSettings: ["owner"],
    changeApiKeys: ["owner"],
    changeSecuritySettings: ["owner"]
  };

  var STEP_UP_ACTIONS = [
    "productionPublish",
    "ftpUpload",
    "fileDelete",
    "backupRestore",
    "manageUsers",
    "changeRoles",
    "changeConnectionSettings",
    "changeApiKeys",
    "changeSecuritySettings"
  ];

  var IDLE_TIMEOUT_MS = {
    owner: 30 * 60 * 1000,
    admin: 60 * 60 * 1000,
    staff: 60 * 60 * 1000
  };

  function hasPermission(role, action) {
    var allowed = PERMISSIONS[action];
    if (!allowed) return false;
    return allowed.indexOf(role) !== -1;
  }

  function requiresStepUp(action) {
    return STEP_UP_ACTIONS.indexOf(action) !== -1;
  }

  function canPerform(session, action, now) {
    now = typeof now === "number" ? now : Date.now();
    if (!session || session.revoked) {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    if (session.expiresAt && now > session.expiresAt) {
      return { ok: false, code: "SESSION_EXPIRED" };
    }
    var idleMs = IDLE_TIMEOUT_MS[session.role] || IDLE_TIMEOUT_MS.staff;
    if (session.lastSeenAt && now - session.lastSeenAt > idleMs) {
      return { ok: false, code: "IDLE_TIMEOUT" };
    }
    if (!hasPermission(session.role, action)) {
      return { ok: false, code: "FORBIDDEN" };
    }
    if (requiresStepUp(action)) {
      if (!session.stepUpUntil || now > session.stepUpUntil) {
        return { ok: false, code: "STEP_UP_REQUIRED" };
      }
    }
    return { ok: true, code: "OK" };
  }

  function cookieFlags(isProduction) {
    return {
      httpOnly: true,
      secure: !!isProduction,
      sameSite: "Lax",
      path: "/",
      name: "smile_session"
    };
  }

  function genericLoginError() {
    return "ログインできませんでした。入力内容をご確認のうえ、再度お試しください。";
  }

  function auditEvent(partial) {
    var forbiddenKeys = ["password", "token", "secret", "ftpPassword", "apiKey", "credentialPrivate"];
    var out = {
      type: partial.type || "unknown",
      actorUserId: partial.actorUserId || null,
      target: partial.target || null,
      success: !!partial.success,
      at: partial.at || new Date().toISOString(),
      ipHash: partial.ipHash || null
    };
    forbiddenKeys.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(partial, k)) {
        throw new Error("audit must not include " + k);
      }
    });
    return out;
  }

  function createSessionId(randomBytesFn) {
    var bytes = randomBytesFn(32);
    return Array.prototype.map
      .call(bytes, function (b) {
        return ("0" + b.toString(16)).slice(-2);
      })
      .join("");
  }

  function rotateSession(oldSession, randomBytesFn, now) {
    now = typeof now === "number" ? now : Date.now();
    return {
      id: createSessionId(randomBytesFn),
      userId: oldSession.userId,
      role: oldSession.role,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
      stepUpUntil: null,
      revoked: false,
      replacedFrom: oldSession.id || null
    };
  }

  return {
    ROLES: ROLES,
    PERMISSIONS: PERMISSIONS,
    STEP_UP_ACTIONS: STEP_UP_ACTIONS,
    IDLE_TIMEOUT_MS: IDLE_TIMEOUT_MS,
    hasPermission: hasPermission,
    requiresStepUp: requiresStepUp,
    canPerform: canPerform,
    cookieFlags: cookieFlags,
    genericLoginError: genericLoginError,
    auditEvent: auditEvent,
    createSessionId: createSessionId,
    rotateSession: rotateSession
  };
});
