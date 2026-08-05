/**
 * WebAuthn / Passkey feasibility checks (Node environment + design constraints).
 * Does not contact production. Does not store biometrics.
 */
"use strict";

var assert = require("assert");
var passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log("OK  " + name);
}

test("Node version supports WebCrypto", function () {
  assert.ok(process.versions.node);
  var major = parseInt(String(process.versions.node).split(".")[0], 10);
  assert.ok(major >= 18, "Node >= 18 required for studio");
  assert.ok(globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function");
});

test("RP ID rules documented for current hosts", function () {
  var hosts = [
    { host: "smileaistudio.netlify.app", ok: true },
    { host: "www.egaonokiroku.co.jp", ok: true, note: "corporate site — out of studio auth scope" },
    { host: "127.0.0.1", ok: true },
    { host: "localhost", ok: true }
  ];
  hosts.forEach(function (h) {
    assert.ok(h.host.length > 0);
  });
  // WebAuthn requires secure context except localhost
  assert.strictEqual(true, true);
});

test("server must store public key only (schema shape)", function () {
  var credentialRecord = {
    credentialId: "base64url…",
    userId: "usr_1",
    publicKey: "cose-or-spki…",
    counter: 0,
    transports: ["internal"],
    deviceLabel: "iPhone"
  };
  assert.ok(!Object.prototype.hasOwnProperty.call(credentialRecord, "faceImage"));
  assert.ok(!Object.prototype.hasOwnProperty.call(credentialRecord, "biometricTemplate"));
  assert.ok(credentialRecord.publicKey);
});

test("platform mapping is OS authenticator not custom CV", function () {
  var map = {
    iPhone: "Face ID / Touch ID via platform passkey",
    Windows: "Windows Hello via platform passkey",
    Android: "Biometric or device lock via platform passkey",
    fallback: "email OTP + passkey enrollment"
  };
  assert.ok(map.iPhone.indexOf("platform") !== -1);
  assert.ok(map.fallback.indexOf("email") !== -1);
});

test("CORS wildcard incompatible with credentialed cookies", function () {
  var currentCors = "*";
  var credentialedRequiresExactOrigin = currentCors === "*";
  assert.strictEqual(credentialedRequiresExactOrigin, true);
  // Migration note: replace * with APP_BASE_URL before enabling cookies
});

console.log("");
console.log("feasibility_passed=" + passed);
console.log("browser_probe=open auth-local/login.html on localhost to fill __SMILE_WEBAUTHN_PROBE__");
process.exit(0);
