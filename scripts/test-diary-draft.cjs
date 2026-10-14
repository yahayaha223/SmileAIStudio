const test = require('node:test'), assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const budget = require('../netlify/functions/shared/diary-draft-budget');
const {createHandler} = require('../netlify/functions/shared/diary-draft-handler');
const {hashToken} = require('../netlify/functions/shared/auth/crypto-util');
function store() { let row, version=0; return {
 getWithMetadata:async()=>row?{data:structuredClone(row),etag:String(version)}:null,
 setJSON:async(k,next,c)=>{if(c.onlyIfNew?!!row:c.onlyIfMatch!==String(version))return {modified:false};row=structuredClone(next);return {modified:true,etag:String(++version)};},
 row:()=>row}; }
test('global CAS concurrency, duplicate and rolling limits',async()=>{
 const s=store(), now=1792000000000;
 const results=await Promise.allSettled(Array.from({length:20},()=>budget.reserve(s,randomUUID(),now)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,6);
 await assert.rejects(budget.reserve(s,s.row().rows[0].id,now),/duplicate/);
 for(let d=1;d<5;d++)for(let i=0;i<6;i++)await budget.reserve(s,randomUUID(),now+d*600001);
 await assert.rejects(budget.reserve(s,randomUUID(),now+3000005),/budget/);
 for(let day=1;day<10;day++)for(let p=0;p<5;p++)for(let i=0;i<6;i++)await budget.reserve(s,randomUUID(),now+day*86400001+p*600001);
 await assert.rejects(budget.reserve(s,randomUUID(),now+10*86400001),/budget/);
 await budget.reserve(s,randomUUID(),now+31*86400001);
});
test('uncertain writes and corrupt storage fail closed',async()=>{
 await assert.rejects(budget.reserve({getWithMetadata:async()=>null,setJSON:async()=>({modified:true})},randomUUID(),100),/unavailable/);
 await assert.rejects(budget.reserve({getWithMetadata:async()=>({data:{rows:[]},etag:'x'})},randomUUID(),100),/unavailable/);
});
function fixture(){
 const now=1792000000000,s=store();let calls=0;
 const session={sessionHash:hashToken('test'),userId:'owner',purpose:'full',roleSnapshot:'owner',expiresAt:now+10000,absoluteExpiresAt:now+20000,csrfToken:'csrf'};
 const deps={now:()=>now,build:{production:true},env:{DIARY_AI_ENABLED:'1',OPENAI_API_KEY:'mock'},config:{authEnvironment:'production',rpId:'studio.egaonokiroku.co.jp'},
 countTokens:()=>100,getStores:()=>({usage:s,auth:{get:async k=>k.includes('/sessions/')?session:{id:'owner',role:'owner',status:'active'}}}),
 send:async(key,notes)=>{calls++;assert.equal(notes,'memo');return {text:'draft',model:'mock',usage:{input_tokens:100,output_tokens:20},estimatedModelCostUSD:.000072};}};
 const event={httpMethod:'POST',headers:{host:'studio.egaonokiroku.co.jp',origin:'https://studio.egaonokiroku.co.jp',cookie:'smile_studio_session=test; smile_studio_csrf=csrf','x-csrf-token':'csrf'},body:JSON.stringify({notes:'memo',requestId:randomUUID()})};
 return {deps,event,session,s,calls:()=>calls};
}
test('authorized request records usage without notes; repeat never sends',async()=>{
 const f=fixture(),h=createHandler(f.deps);assert.equal((await h(f.event)).statusCode,200);assert.equal((await h(f.event)).statusCode,409);assert.equal(f.calls(),1);
 assert.equal(f.s.row().rows[0].status,'completed');assert.equal(JSON.stringify(f.s.row()).includes('memo'),false);
});
test('disabled, expired auth, CSRF, origin, oversized notes and token caps never send',async()=>{
 for(const mutate of [f=>f.deps.build.production=false,f=>f.deps.env.DIARY_AI_ENABLED='0',f=>f.session.expiresAt=0,f=>f.event.headers['x-csrf-token']='wrong',f=>f.event.headers.origin='https://other.test',f=>f.event.body=JSON.stringify({notes:'x'.repeat(2001),requestId:randomUUID()}),f=>f.deps.countTokens=()=>6000]){
 const f=fixture();mutate(f);assert.notEqual((await createHandler(f.deps)(f.event)).statusCode,200);assert.equal(f.calls(),0);assert.equal(f.s.row(),undefined);}
});
test('provider failure consumes reservation and blocks duplicate retry',async()=>{
 const f=fixture();f.deps.send=async()=>{throw Error('private');};const h=createHandler(f.deps);
 assert.equal((await h(f.event)).statusCode,502);assert.equal(f.s.row().rows[0].status,'failed_or_unknown');assert.equal((await h(f.event)).statusCode,409);
});
test('completion survives another request arriving at a later time',async()=>{
 const s=store(), a=randomUUID(), b=randomUUID();
 await budget.reserve(s,a,1000);await budget.reserve(s,b,1001);
 await budget.record(s,a,1000,{model:'mock',usage:{input_tokens:1,output_tokens:1},estimatedModelCostUSD:.000002});
 assert.equal(s.row().rows.find(r=>r.id===a).status,'completed');assert.equal(s.row().rows.length,2);
});
test('independent handlers share reservation; abandoned caller does not refund',async()=>{
 const f=fixture();let finish,calls=0;
 f.deps.send=()=>{calls++;return new Promise(r=>finish=r);};
 const first=createHandler({...f.deps})(f.event);
 while(!finish)await new Promise(r=>setImmediate(r));
 const other=createHandler({...f.deps});
 assert.equal((await other(f.event)).statusCode,409);assert.equal(calls,1);
 finish({text:'mock',model:'mock',usage:{input_tokens:1,output_tokens:1},estimatedModelCostUSD:.000002});
 assert.equal((await first).statusCode,200);assert.equal(f.s.row().rows[0].reserved,4320);
 assert.equal((await other(f.event)).statusCode,409);
});
test('installed SDK emits If-Match and rejects conflicted writes',async()=>{
 const {getStore}=require('netlify-blobs-trial'),{storageFetch}=require('../netlify/functions/shared/diary-ai-trial');
 const seen=[],statuses=[200,412];
 const s=getStore({name:'smile-diary-ai-usage',siteID:'mock',token:'mock',apiURL:'https://mock.invalid',fetch:storageFetch(async(url,options)=>{
  if(String(url)!=='https://signed.invalid/object')return new Response(JSON.stringify({url:'https://signed.invalid/object'}),{status:200});
  seen.push(options);return new Response('',{status:statuses.shift(),headers:{etag:'"new-etag"'}});
 })});
 assert.equal((await s.setJSON('global-v1',{version:1,rows:[]},{onlyIfMatch:'"old-etag"'})).modified,true);
 assert.equal((await s.setJSON('global-v1',{version:1,rows:[]},{onlyIfMatch:'"old-etag"'})).modified,false);
 assert.equal(seen.length,2);assert(seen.every(x=>x.headers['if-match']==='"old-etag"'));
});
test('UUID case is normalized and non-string UUID is rejected',async()=>{
 const f=fixture(),h=createHandler(f.deps),body=JSON.parse(f.event.body);
 assert.equal((await h(f.event)).statusCode,200);
 f.event.body=JSON.stringify({...body,requestId:body.requestId.toUpperCase()});assert.equal((await h(f.event)).statusCode,409);
 f.event.body=JSON.stringify({...body,requestId:[body.requestId]});assert.equal((await h(f.event)).statusCode,400);
});
