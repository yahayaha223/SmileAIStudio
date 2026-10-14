const assert = require('node:assert/strict');
const trial = require('../netlify/functions/shared/diary-ai-trial');
const crypto = require('../netlify/functions/shared/auth/crypto-util');
const stamp = require('../netlify/functions/shared/diary-ai-trial-context.json');
const origin = 'https://studio.egaonokiroku.co.jp';
let passed = 0, reads = 0, writes = 0, sends = 0;
const now = 1791878400000;
const session = { sessionHash: crypto.hashToken('fake'), userId: 'fake-owner', purpose:'full', roleSnapshot:'owner',
  csrfToken:'fake-csrf', expiresAt:now+60000, absoluteExpiresAt:now+120000 };
const user = { id:'fake-owner', role:'owner', status:'active' };
const context = { siteID:'synthetic-site', token:'synthetic-not-a-secret', edgeURL:'https://cached.example.invalid',
  uncachedEdgeURL:'https://strong.example.invalid' };
function setContext(value) { globalThis.netlifyBlobsContext = Buffer.from(JSON.stringify(value)).toString('base64'); }
function request(method='GET', body, extra={}) {
  return new Request(origin+'/.netlify/functions/api-diary-ai-trial'+(extra.query||''), {
    method, headers:{ cookie:'smile_studio_session=fake; smile_studio_csrf=fake-csrf',
      'x-csrf-token':'fake-csrf', ...(method==='POST'?{origin}:{}), ...extra.headers },
    ...(body===undefined?{}:{body}) });
}
(async()=>{
  const {createNativeHandler} = await import('../netlify/functions/api-diary-ai-trial.mjs');
  // Every fetch is synthetic; reject any cached/API host or storage write.
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).hostname, 'strong.example.invalid');
    if ((options.method||'GET').toUpperCase()!=='GET') { writes++; throw Error('No writes in this test'); }
    reads++;
    const pathname = decodeURIComponent(new URL(url).pathname);
    const data = pathname.includes('/sessions/') ? session : pathname.includes('/users/') ? user : null;
    return new Response(data === null ? '' : JSON.stringify(data), {status:data===null?404:200});
  };
  setContext(context);
  const deps={env:{}, build:{...stamp,production:true}, config:{authEnvironment:'production',rpId:'studio.egaonokiroku.co.jp'},
    now:()=>now, send:async()=>{sends++;throw Error('No AI');}};
  const handler = createNativeHandler(deps);
  async function check(name, req, status, code) {
    const res=await handler(req); assert.equal(res.status,status,name);
    assert.equal(res.headers.get('cache-control'),'no-store');
    assert.equal(res.headers.get('set-cookie'),null);
    const data=await res.json(); if(code)assert.equal(data.error,code,name);
    passed++; return data;
  }
  const ready=await check('native owner status',request(),200);
  assert.equal(ready.enabled,false);assert.equal(ready.consumed,false);assert.equal(reads,3);
  const before=reads;
  await check('missing cookie',request('GET',undefined,{headers:{cookie:''}}),401,'owner_login_required');
  await check('foreign origin',request('GET',undefined,{headers:{origin:'https://other.invalid'}}),403,'origin_denied');
  await check('conflicting host',request('GET',undefined,{headers:{host:'other.invalid'}}),403,'origin_denied');
  await check('foreign URL with spoofed host',new Request('https://other.invalid/', {headers:{host:'studio.egaonokiroku.co.jp'}}),403,'origin_denied');
  await check('query',request('GET',undefined,{query:'?x=1'}),400,'invalid_request');
  await check('unsupported method',request('DELETE'),405,'method_not_allowed');
  await check('oversized body',request('POST','x'.repeat(1000)),400,'fixed_memo_only');
  await check('arbitrary input',request('POST','{"text":"x"}'),400,'fixed_memo_only');
  await check('bad JSON',request('POST','{'),400,'fixed_memo_only');
  await check('missing POST origin',request('POST','{}',{headers:{origin:''}}),403,'origin_denied');
  assert.equal(reads,before);
  await check('CSRF mismatch',request('GET',undefined,{headers:{'x-csrf-token':'bad'}}),403,'csrf_denied');
  user.status='disabled';await check('disabled user',request(),403,'owner_required');user.status='active';
  session.revokedAt=now;await check('revoked session',request(),401,'owner_login_required');delete session.revokedAt;
  await check('OFF blocks native POST',request('POST','{}'),503,'trial_disabled');
  const unchanged=globalThis.netlifyBlobsContext;
  trial.getStores();assert.equal(globalThis.netlifyBlobsContext,unchanged);passed++;
  const beforeFailure=reads;
  const {uncachedEdgeURL,...legacy}=context;setContext(legacy);
  await check('missing strong context fails closed',request(),503,'trial_unavailable_do_not_retry');
  assert.equal(reads,beforeFailure);
  setContext(context);
  globalThis.fetch=async()=>{reads++;throw Error('synthetic private detail');};
  const failure=await check('network failure fails closed',request(),503,'trial_unavailable_do_not_retry');
  assert(!JSON.stringify(failure).includes('private'));
  assert.equal(writes,0);assert.equal(sends,0);
  console.log(JSON.stringify({nativeChecksPassed:passed,liveNetworkCalls:0,storageWrites:writes,paidCalls:sends}));
})().catch(e=>{console.error(e);process.exitCode=1;});
