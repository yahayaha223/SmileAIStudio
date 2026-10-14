import core from './shared/diary-draft-handler.js';
import trial from './shared/diary-ai-trial.js';
import {getStore} from 'netlify-blobs-trial';
import {getEncoding} from 'js-tiktoken';
let encoding;
export function createNativeHandler(deps = {}) {
  const handler = core.createHandler({...deps,
    countTokens: deps.countTokens || (text => { encoding ||= getEncoding('o200k_base'); return encoding.encode(text).length; }),
    getStores: deps.getStores || (() => ({
      auth: getStore({name:'smile-studio-auth',consistency:'strong',fetch:trial.storageFetch()}),
      usage: getStore({name:'smile-diary-ai-usage',consistency:'strong',fetch:trial.storageFetch()})
    }))
  });
  return async request => {
    const url = new URL(request.url), headers = Object.fromEntries(request.headers);
    if (!headers.host || url.host !== 'studio.egaonokiroku.co.jp') headers.host = url.host;
    let body = '', length = 0;
    if (request.body) {
      const reader = request.body.getReader(), chunks = [];
      try {
        for (;;) { const {value,done} = await reader.read(); if (done) break;
          length += value.byteLength; if (length > 16000) { await reader.cancel(); throw Error(); } chunks.push(Buffer.from(value)); }
        body = Buffer.concat(chunks).toString('utf8');
      } catch { body = '!'; } finally {reader.releaseLock();}
    }
    const result = await handler({httpMethod:request.method,headers,body,queryStringParameters:url.search?{present:1}:{}});
    return new Response(result.body,{status:result.statusCode,headers:result.headers});
  };
}
export default createNativeHandler();
