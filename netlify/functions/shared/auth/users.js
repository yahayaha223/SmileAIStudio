"use strict";

var authKv = require("./auth-kv");
var config = require("./config");
var cryptoUtil = require("./crypto-util");

async function getUser(userId) {
  if (!userId) return null;
  return authKv.authGet("users/" + userId);
}

async function getUserByEmail(email) {
  var emailNormalized = config.normalizeEmail(email);
  if (!emailNormalized) return null;
  var idx = await authKv.authGet("usersByEmail/" + cryptoUtil.sha256Hex(emailNormalized));
  if (!idx || !idx.userId) return null;
  return getUser(idx.userId);
}

async function listOwners() {
  var index = (await authKv.authGet("users/index")) || { ids: [] };
  var owners = [];
  for (var i = 0; i < (index.ids || []).length; i++) {
    var u = await getUser(index.ids[i]);
    // invited or active — never auto-create a second owner
    if (u && u.role === "owner" && u.status !== "disabled") owners.push(u);
  }
  return owners;
}

async function saveUser(user) {
  var now = new Date().toISOString();
  user.updatedAt = now;
  if (!user.createdAt) user.createdAt = now;
  await authKv.authSet("users/" + user.id, user);
  await authKv.authSet(
    "usersByEmail/" + cryptoUtil.sha256Hex(user.emailNormalized),
    { userId: user.id, emailNormalized: user.emailNormalized }
  );
  var index = (await authKv.authGet("users/index")) || { ids: [] };
  if (index.ids.indexOf(user.id) === -1) {
    index.ids.push(user.id);
    await authKv.authSet("users/index", index);
  }
  return user;
}

async function createUser(opts) {
  var emailNormalized = config.normalizeEmail(opts.email);
  var existing = await getUserByEmail(emailNormalized);
  if (existing) return { ok: false, reasonCode: "user_exists", user: existing };
  var user = {
    id: cryptoUtil.newId("usr"),
    emailNormalized: emailNormalized,
    role: opts.role || "staff",
    status: opts.status || "invited",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    invitedBy: opts.invitedBy || null,
    displayName: opts.displayName || emailNormalized.split("@")[0],
    adminPublishAllowlist: opts.adminPublishAllowlist || []
  };
  await saveUser(user);
  return { ok: true, user: user };
}

async function ensureBootstrapOwner() {
  var cfg = config.getAuthConfig();
  var owners = await listOwners();
  if (owners.length > 0) return { ok: false, reasonCode: "owner_exists" };
  if (!cfg.bootstrapEnabled || !cfg.bootstrapOwnerEmail) {
    return { ok: false, reasonCode: "bootstrap_disabled" };
  }
  var created = await createUser({
    email: cfg.bootstrapOwnerEmail,
    role: "owner",
    status: "invited",
    invitedBy: "bootstrap"
  });
  return created;
}

async function isEmailAllowedForRegistration(email) {
  var emailNormalized = config.normalizeEmail(email);
  if (!emailNormalized) return false;
  var user = await getUserByEmail(emailNormalized);
  if (user && (user.status === "invited" || user.status === "active")) return true;
  var cfg = config.getAuthConfig();
  if (cfg.bootstrapEnabled && cfg.bootstrapOwnerEmail === emailNormalized) {
    var owners = await listOwners();
    if (owners.length === 0) return true;
  }
  return false;
}

module.exports = {
  getUser: getUser,
  getUserByEmail: getUserByEmail,
  listOwners: listOwners,
  saveUser: saveUser,
  createUser: createUser,
  ensureBootstrapOwner: ensureBootstrapOwner,
  isEmailAllowedForRegistration: isEmailAllowedForRegistration
};
