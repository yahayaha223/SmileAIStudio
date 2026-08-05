"use strict";

var authKv = require("./auth-kv");
var cryptoUtil = require("./crypto-util");

function credKey(credentialId) {
  return "credentials/" + credentialId;
}

async function getCredential(credentialId) {
  if (!credentialId) return null;
  return authKv.authGet(credKey(credentialId));
}

async function saveCredential(cred) {
  var existing = await getCredential(cred.credentialId);
  if (existing && !existing.revokedAt) {
    return { ok: false, reasonCode: "credential_duplicate" };
  }
  await authKv.authSet(credKey(cred.credentialId), cred);
  var uidx = (await authKv.authGet("credentialsByUser/" + cred.userId)) || { ids: [] };
  if (uidx.ids.indexOf(cred.credentialId) === -1) {
    uidx.ids.push(cred.credentialId);
    await authKv.authSet("credentialsByUser/" + cred.userId, uidx);
  }
  return { ok: true, credential: cred };
}

async function listUserCredentials(userId) {
  var uidx = (await authKv.authGet("credentialsByUser/" + userId)) || { ids: [] };
  var out = [];
  for (var i = 0; i < (uidx.ids || []).length; i++) {
    var c = await getCredential(uidx.ids[i]);
    if (c && !c.revokedAt) out.push(c);
  }
  return out;
}

async function updateCounter(credentialId, counter) {
  var c = await getCredential(credentialId);
  if (!c) return false;
  c.counter = counter;
  c.lastUsedAt = new Date().toISOString();
  await authKv.authSet(credKey(credentialId), c);
  return true;
}

async function revokeCredential(credentialId) {
  var c = await getCredential(credentialId);
  if (!c) return false;
  c.revokedAt = new Date().toISOString();
  await authKv.authSet(credKey(credentialId), c);
  return true;
}

function newCredentialRecord(opts) {
  return {
    credentialId: opts.credentialId,
    userId: opts.userId,
    publicKey: opts.publicKey,
    counter: opts.counter || 0,
    transports: opts.transports || [],
    deviceName: opts.deviceName || "Passkey",
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
    backedUp: !!opts.backedUp,
    deviceType: opts.deviceType || null
  };
}

module.exports = {
  getCredential: getCredential,
  saveCredential: saveCredential,
  listUserCredentials: listUserCredentials,
  updateCounter: updateCounter,
  revokeCredential: revokeCredential,
  newCredentialRecord: newCredentialRecord,
  newId: cryptoUtil.newId
};
