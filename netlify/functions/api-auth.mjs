import api from "./shared/auth-api-handler.js";
import authKv from "./shared/auth/auth-kv.js";
import http from "./shared/http.js";
import { getStore } from "@netlify/blobs";
import { createRequire } from "node:module";

// The shared WebAuthn service uses CJS. Trace its require export explicitly:
// NFT cannot discover the transformed __require inside the bundled service.
const require = createRequire(import.meta.url);
require("@simplewebauthn/server");

// Static import keeps the SDK in Netlify's native function bundle. Do not call
// connectLambda: it replaces the native context and drops strong-read routing.
export function createNativeHandler(deps = {}) {
  const handler = deps.handler || api.handler;
  const makeStore = deps.getStore || getStore;
  return async request => {
    const url = new URL(request.url);
    const event = { httpMethod: request.method, path: url.pathname,
      headers: Object.fromEntries(request.headers),
      queryStringParameters: Object.fromEntries(url.searchParams),
      body: "", isBase64Encoded: false };
    let result;
    try {
      event.body = await request.text();
      const store = makeStore({ name: authKv.storeNameForEnv(), consistency: "strong" });
      result = await authKv.withRequestStore(store, () => handler(event));
    } catch {
      // Fixed response only. Never expose SDK exception text or request context.
      result = http.json(503, { ok: false, error: "unavailable" }, event);
    }
    const headers = new Headers(result.headers || {});
    for (const [name, values] of Object.entries(result.multiValueHeaders || {})) {
      for (const value of values) headers.append(name, value);
    }
    return new Response(request.method === "HEAD" || [204, 304].includes(result.statusCode) ? null : result.body,
      { status: result.statusCode, headers });
  };
}

export default createNativeHandler();
