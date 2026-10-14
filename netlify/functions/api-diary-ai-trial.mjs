import core from "./shared/diary-ai-trial-handler.js";
import trial from "./shared/diary-ai-trial.js";
import { getStore } from "netlify-blobs-trial";

// Native Functions preserve the platform-provided Blobs context. The existing
// owner/CSRF/origin checks operate on a bounded adapter, not a Lambda connection.
export function createNativeHandler(deps = {}) {
  // Keep the SDK import visible to Netlify's V2 dependency tracer.
  const handler = core.createHandler({ ...deps,
    getStores: deps.getStores || ((event, markStage) => trial.getStores(event, markStage, { getStore })) });
  return async request => {
    const url = new URL(request.url);
    const headers = Object.fromEntries(request.headers);
    // Reject a conflicting explicit Host; only synthesize it when absent.
    if (!headers.host || url.host !== "studio.egaonokiroku.co.jp") headers.host = url.host;
    let body = "";
    let invalidBody = false;
    if (request.body) {
      const reader = request.body.getReader();
      const chunks = [];
      let length = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 64) { invalidBody = true; await reader.cancel(); break; }
          chunks.push(Buffer.from(value));
        }
        if (!invalidBody) body = Buffer.concat(chunks).toString("utf8");
      } catch { invalidBody = true; }
      finally { reader.releaseLock(); }
    }
    // An invalid/oversized stream is rejected by the existing body validation.
    if (invalidBody) body = "x".repeat(65);
    const result = await handler({ httpMethod: request.method, headers, body,
      queryStringParameters: url.search ? { present: "1" } : {}, isBase64Encoded: false });
    return new Response(result.body, { status: result.statusCode, headers: result.headers });
  };
}

export default createNativeHandler();
