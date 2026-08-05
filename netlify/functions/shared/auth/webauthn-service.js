"use strict";

var simple = require("@simplewebauthn/server");
var config = require("./config");
var challenges = require("./challenges");
var credentials = require("./credentials");
var cryptoUtil = require("./crypto-util");

function toUint8(str) {
  return Buffer.from(String(str), "utf8");
}

function expectedOrigins(origin) {
  var cfg = config.getAuthConfig();
  // Prefer request origin if allowlisted; verification uses exact expectedOrigin
  if (origin && cfg.allowedOrigins.indexOf(origin) !== -1) return origin;
  return cfg.allowedOrigins[0];
}

function assertRpEnvironment(origin) {
  var cfg = config.getAuthConfig();
  if (cfg.isStagingEnvironment && cfg.isProductionRp) {
    return { ok: false, reasonCode: "staging_must_not_use_production_rp" };
  }
  if (cfg.isProductionRp && origin !== cfg.productionOrigin) {
    return { ok: false, reasonCode: "rp_origin_mismatch" };
  }
  return { ok: true };
}

async function registrationOptions(user, origin) {
  var cfg = config.getAuthConfig();
  var envOk = assertRpEnvironment(origin);
  if (!envOk.ok) return envOk;
  var existing = await credentials.listUserCredentials(user.id);
  var options = await simple.generateRegistrationOptions({
    rpName: cfg.rpName,
    rpID: cfg.rpId,
    userName: user.emailNormalized,
    userDisplayName: user.displayName || user.emailNormalized,
    userID: toUint8(user.id),
    attestationType: "none",
    excludeCredentials: existing.map(function (c) {
      return { id: c.credentialId, transports: c.transports || undefined };
    }),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required"
      // authenticatorAttachment intentionally omitted (not forced)
    }
  });
  await challenges.saveChallenge({
    challenge: options.challenge,
    purpose: "passkey_register",
    userId: user.id,
    emailNormalized: user.emailNormalized,
    origin: origin
  });
  return { ok: true, options: options };
}

async function verifyRegistration(user, response, origin) {
  var cfg = config.getAuthConfig();
  var envOk = assertRpEnvironment(origin);
  if (!envOk.ok) return envOk;
  var clientChallenge = response && response.response && response.response.clientDataJSON
    ? null
    : null;
  // Extract challenge from clientData for consume
  var challengeFromClient = "";
  try {
    var cd = JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"));
    challengeFromClient = cd.challenge;
  } catch (e) {
    return { ok: false, reasonCode: "client_data_invalid" };
  }
  var consumed = await challenges.consumeChallenge(challengeFromClient, "passkey_register");
  if (!consumed.ok) return { ok: false, reasonCode: consumed.reasonCode };

  var verification;
  try {
    verification = await simple.verifyRegistrationResponse({
      response: response,
      expectedChallenge: challengeFromClient,
      expectedOrigin: origin,
      expectedRPID: cfg.rpId,
      requireUserVerification: true
    });
  } catch (e) {
    return { ok: false, reasonCode: "registration_verify_failed" };
  }
  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, reasonCode: "registration_not_verified" };
  }
  var info = verification.registrationInfo;
  var cred = info.credential || {};
  var credentialId = cred.id || info.credentialID;
  if (Buffer.isBuffer(credentialId)) credentialId = credentialId.toString("base64url");
  var publicKey = cred.publicKey || info.credentialPublicKey;
  if (Buffer.isBuffer(publicKey)) publicKey = publicKey.toString("base64url");
  else if (publicKey && publicKey instanceof Uint8Array) {
    publicKey = Buffer.from(publicKey).toString("base64url");
  }

  var record = credentials.newCredentialRecord({
    credentialId: String(credentialId),
    userId: user.id,
    publicKey: String(publicKey),
    counter: cred.counter != null ? cred.counter : (info.counter || 0),
    transports: response.response.transports || [],
    deviceName: (response && response.authenticatorAttachment) || "Passkey",
    backedUp: !!(info.credentialBackedUp || info.credentialDeviceType === "multiDevice"),
    deviceType: info.credentialDeviceType || null
  });
  var saved = await credentials.saveCredential(record);
  if (!saved.ok) return saved;
  return { ok: true, credential: record };
}

async function authenticationOptions(origin) {
  var cfg = config.getAuthConfig();
  var envOk = assertRpEnvironment(origin);
  if (!envOk.ok) return envOk;
  // Discoverable credentials — do not reveal account existence
  var options = await simple.generateAuthenticationOptions({
    rpID: cfg.rpId,
    userVerification: "required"
  });
  await challenges.saveChallenge({
    challenge: options.challenge,
    purpose: "passkey_login",
    origin: origin
  });
  return { ok: true, options: options };
}

async function stepUpOptions(user, origin) {
  var cfg = config.getAuthConfig();
  var envOk = assertRpEnvironment(origin);
  if (!envOk.ok) return envOk;
  var existing = await credentials.listUserCredentials(user.id);
  var options = await simple.generateAuthenticationOptions({
    rpID: cfg.rpId,
    userVerification: "required",
    allowCredentials: existing.map(function (c) {
      return { id: c.credentialId, transports: c.transports || undefined };
    })
  });
  await challenges.saveChallenge({
    challenge: options.challenge,
    purpose: "passkey_stepup",
    userId: user.id,
    origin: origin
  });
  return { ok: true, options: options };
}

async function verifyAuthentication(response, origin, purpose) {
  var cfg = config.getAuthConfig();
  var envOk = assertRpEnvironment(origin);
  if (!envOk.ok) return envOk;
  var challengeFromClient = "";
  try {
    var cd = JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"));
    challengeFromClient = cd.challenge;
  } catch (e) {
    return { ok: false, reasonCode: "client_data_invalid" };
  }
  var consumed = await challenges.consumeChallenge(challengeFromClient, purpose || "passkey_login");
  if (!consumed.ok) return { ok: false, reasonCode: consumed.reasonCode };

  var credId = response.id || (response.rawId);
  var stored = await credentials.getCredential(String(credId));
  if (!stored || stored.revokedAt) {
    return { ok: false, reasonCode: "credential_unknown" };
  }

  var publicKey = stored.publicKey;
  var pubBuf = Buffer.from(publicKey, "base64url");

  var verification;
  try {
    verification = await simple.verifyAuthenticationResponse({
      response: response,
      expectedChallenge: challengeFromClient,
      expectedOrigin: origin,
      expectedRPID: cfg.rpId,
      credential: {
        id: stored.credentialId,
        publicKey: pubBuf,
        counter: stored.counter || 0,
        transports: stored.transports || []
      },
      requireUserVerification: true
    });
  } catch (e) {
    return { ok: false, reasonCode: "authentication_verify_failed" };
  }
  if (!verification.verified) {
    return { ok: false, reasonCode: "authentication_not_verified" };
  }
  var newCounter = verification.authenticationInfo && verification.authenticationInfo.newCounter;
  if (typeof newCounter === "number") {
    await credentials.updateCounter(stored.credentialId, newCounter);
  }
  return { ok: true, credential: stored, userId: stored.userId };
}

module.exports = {
  registrationOptions: registrationOptions,
  verifyRegistration: verifyRegistration,
  authenticationOptions: authenticationOptions,
  stepUpOptions: stepUpOptions,
  verifyAuthentication: verifyAuthentication,
  expectedOrigins: expectedOrigins,
  cryptoUtil: cryptoUtil
};
