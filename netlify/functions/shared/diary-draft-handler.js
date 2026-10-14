"use strict";
const { authorize } = require('./diary-draft-auth');
const budget = require('./diary-draft-budget');
const transport = require('./diary-draft-transport');
const config = require('./auth/config');
const build = require('./diary-ai-trial-context.json');
const ORIGIN = 'https://studio.egaonokiroku.co.jp';
function createHandler(deps) {
  return async event => {
    const reply = (statusCode, data) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(data) });
    const env = deps.env || process.env, now = (deps.now || Date.now)();
    const cfg = deps.config || config.getAuthConfig();
    if (event.httpMethod !== 'POST') return reply(405, {error:'method_not_allowed'});
    if (env.DIARY_AI_ENABLED !== '1' || !env.OPENAI_API_KEY || now >= Date.UTC(2027,0,14)) return reply(503,{error:'not_enabled'});
    // CONTEXT is a build variable; use the existing build stamp in the runtime.
    if (!(deps.build || build).production || cfg.authEnvironment !== 'production' || cfg.rpId !== 'studio.egaonokiroku.co.jp' || event.headers.host !== 'studio.egaonokiroku.co.jp' || event.headers.origin !== ORIGIN) return reply(403,{error:'origin_denied'});
    let body;
    try {
      if (Buffer.byteLength(event.body || '') > 16000 || event.queryStringParameters && Object.keys(event.queryStringParameters).length) throw Error();
      body = JSON.parse(event.body);
      if (!body || Object.keys(body).some(k => !['notes','requestId'].includes(k)) || typeof body.notes !== 'string' || !body.notes.trim() || body.notes.length > 2000 || typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) throw Error();
      body.requestId = body.requestId.toLowerCase();
      if (deps.countTokens(transport.INSTRUCTIONS + '\n' + body.notes) + 1024 > 6000) throw Error();
    } catch { return reply(400,{error:'invalid_request'}); }
    try {
      const stores = await authorize(event, deps);
      await budget.reserve(stores.usage, body.requestId, now);
      let result;
      try { result = await (deps.send || transport.send)(env.OPENAI_API_KEY, body.notes); }
      catch { await budget.record(stores.usage, body.requestId, now, null); return reply(502,{error:'generation_failed'}); }
      await budget.record(stores.usage, body.requestId, now, result);
      return reply(200, {ok:true,...result});
    } catch (e) { return reply(e.status || 503,{error:e.status ? e.message : 'usage_unavailable'}); }
  };
}
module.exports = {createHandler};
