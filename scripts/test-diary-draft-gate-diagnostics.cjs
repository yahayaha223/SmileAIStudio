const test = require('node:test');
const assert = require('node:assert/strict');
const {createHandler} = require('../netlify/functions/shared/diary-draft-handler');
const deadline = Date.UTC(2027,0,14);
function fixture(env, now = Date.UTC(2026,9,14)) {
  const logs = [];
  const deps = {env, now:()=>now, build:{production:true},
    config:{authEnvironment:'production',rpId:'studio.egaonokiroku.co.jp'},
    logDiagnostic:line=>logs.push(JSON.parse(line)),
    countTokens:()=>1,
    getStores:()=>{throw Error('storage access forbidden');},
    send:()=>{throw Error('AI access forbidden');}};
  const event = {httpMethod:'POST',headers:{host:'studio.egaonokiroku.co.jp',origin:'https://studio.egaonokiroku.co.jp'},
    body:JSON.stringify({notes:'PRIVATE_NOTE',requestId:'11111111-1111-4111-8111-111111111111'})};
  return {deps,event,logs,handler:createHandler(deps)};
}
for (const [name,env,now,reasons] of [
  ['flag absent',{OPENAI_API_KEY:'PRIVATE_KEY'},undefined,['FLAG_DISABLED']],
  ['flag whitespace',{DIARY_AI_ENABLED:'1 ',OPENAI_API_KEY:'PRIVATE_KEY'},undefined,['FLAG_DISABLED']],
  ['key absent',{DIARY_AI_ENABLED:'1'},undefined,['KEY_UNAVAILABLE']],
  ['key empty',{DIARY_AI_ENABLED:'1',OPENAI_API_KEY:''},undefined,['KEY_UNAVAILABLE']],
  ['deadline',{DIARY_AI_ENABLED:'1',OPENAI_API_KEY:'PRIVATE_KEY'},deadline,['MODEL_EXPIRED']],
  ['all reasons',{DIARY_AI_ENABLED:'PRIVATE_FLAG'},deadline,['FLAG_DISABLED','KEY_UNAVAILABLE','MODEL_EXPIRED']]
]) test(name+' logs only fixed reasons; public response unchanged',async()=>{
  const f=fixture(env,now), r=await f.handler(f.event);
  assert.equal(r.statusCode,503);assert.equal(r.body,'{"error":"not_enabled"}');
  assert.deepEqual(f.logs,[{event:'diary_ai_gate_denied',reasons}]);
  assert(!JSON.stringify(f.logs).includes('PRIVATE'));assert.equal(Object.keys(r.headers).length,2);
});
test('2026-10-14 and millisecond before deadline pass gate, then reject missing login',async()=>{
  assert.equal(new Date(deadline).toISOString(),'2027-01-14T00:00:00.000Z');
  for(const now of [Date.UTC(2026,9,14,13,49),deadline-1]){
    const f=fixture({DIARY_AI_ENABLED:'1',OPENAI_API_KEY:'PRIVATE_KEY'},now);
    assert.equal((await f.handler(f.event)).statusCode,401);assert.deepEqual(f.logs,[]);
  }
});
test('gate reads environment on each request, including a changed environment object',async()=>{
  const env={DIARY_AI_ENABLED:'0',OPENAI_API_KEY:'PRIVATE_KEY'},f=fixture(env);
  assert.equal((await f.handler(f.event)).statusCode,503);
  env.DIARY_AI_ENABLED='1';assert.equal((await f.handler(f.event)).statusCode,401);
  f.deps.env={DIARY_AI_ENABLED:'0',OPENAI_API_KEY:'PRIVATE_KEY'};
  assert.equal((await f.handler(f.event)).statusCode,503);
  assert.equal(f.logs.length,2);
});
test('logging failure does not bypass denial or expose its error',async()=>{
  const f=fixture({});f.deps.logDiagnostic=()=>{throw Error('PRIVATE_LOG_FAILURE');};
  const r=await f.handler(f.event);assert.equal(r.statusCode,503);assert.equal(r.body,'{"error":"not_enabled"}');
});
test('GET remains 405 with no diagnostic, no storage and no AI call',async()=>{
  const f=fixture({});f.event.httpMethod='GET';assert.equal((await f.handler(f.event)).statusCode,405);assert.deepEqual(f.logs,[]);
});
