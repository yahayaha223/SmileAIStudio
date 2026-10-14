"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createHandler}=require('../netlify/functions/shared/diary-ai-trial-handler');
const crypto=require('../netlify/functions/shared/auth/crypto-util');
const stamp=require('../netlify/functions/shared/diary-ai-trial-context.json');
const origin='https://studio.egaonokiroku.co.jp';
const good={sessionHash:crypto.hashToken('SENSITIVE_SESSION'),userId:'SENSITIVE_USER',purpose:'full',roleSnapshot:'owner',csrfToken:'SENSITIVE_CSRF',expiresAt:2000,absoluteExpiresAt:3000};
const event={httpMethod:'GET',headers:{host:'studio.egaonokiroku.co.jp',cookie:'smile_studio_session=SENSITIVE_SESSION; smile_studio_csrf=SENSITIVE_CSRF','x-csrf-token':'SENSITIVE_CSRF'}};
let checks=0;const results=[];
async function test(name,fn){await fn();checks++;results.push(name);}
function server(session=good,user={id:'SENSITIVE_USER',role:'owner',status:'active'},log=()=>{}){
  return createHandler({env:{},build:{...stamp,production:true},config:{authEnvironment:'production',rpId:'studio.egaonokiroku.co.jp'},now:()=>1000,
    logDiagnostic:log,getStores:()=>({auth:{get:async key=>key.includes('/sessions/')?session:user},trial:{get:async()=>null,setJSON:()=>{throw Error('WRITE FORBIDDEN');}}}),send:()=>{throw Error('AI FORBIDDEN');}});
}
function nodes(){const all={};return {all,get:id=>all[id]||(all[id]={textContent:'',hidden:true,disabled:true,handlers:{},classList:{add(){},remove(){}},addEventListener(type,fn){this.handlers[type]=fn;}})};}
async function browserTrial(jar,ref='ABCDEFGHIJKLMNOP'){
  const n=nodes(),requests=[],doc={cookie:jar,getElementById:n.get};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/diary-ai-trial.js'),'utf8'),{
    document:doc,window:{},fetch:async(url,opts)=>{requests.push({url,opts});return {ok:false,json:async()=>({error:'owner_login_required',diagnosticRef:ref,reason:'SENSITIVE_SESSION_ABSENT'})};}
  });
  await new Promise(r=>setImmediate(r));return {n,requests,doc};
}
async function browserLogin(sessionReply,status=200,sourceFile=path.join(__dirname,'../auth-local/login.js')){
  const n=nodes(),timers=[],requests=[],location={protocol:'https:',hostname:'studio.egaonokiroku.co.jp',hash:'',href:'/auth-local/login.html'};
  vm.runInNewContext(fs.readFileSync(sourceFile,'utf8'),{
    document:{getElementById:n.get},window:{isSecureContext:true},location,Uint8Array,btoa,atob,
    navigator:{platform:'synthetic',credentials:{get:async()=>({id:'fake',rawId:new ArrayBuffer(0),response:{},getClientExtensionResults:()=>({})})}},
    setTimeout:fn=>timers.push(fn),fetch:async(url,opts)=>{
      requests.push({url,opts});
      const session=url.endsWith('/session');
      return {status:session?status:200,json:async()=>session?{...sessionReply}:url.endsWith('/options')?{ok:true,options:{}}:{ok:true}};
    }
  });
  await new Promise(r=>setImmediate(r));
  await n.get('btn-passkey-login').handlers.click();
  return {n,timers,requests,location};
}
(async()=>{
  if(process.argv[2]) await test('baseline falsely navigates on anonymous session confirmation',async()=>{
    const b=await browserLogin({ok:true,authenticated:false},200,path.resolve(process.argv[2]));
    assert.equal(b.timers.length,1);b.timers[0]();assert.equal(b.location.href,'/index.html');
  });
  const cases=[
    ['session input missing',{},good,'INPUT_SESSION_MISSING'],
    ['csrf cookie missing',{cookie:'smile_studio_session=SENSITIVE_SESSION','x-csrf-token':'SENSITIVE_CSRF'},good,'INPUT_CSRF_COOKIE_MISSING'],
    ['API URL direct navigation lacks CSRF header',{cookie:event.headers.cookie},good,'INPUT_CSRF_HEADER_MISSING'],
    ['durable session absent',event.headers,null,'SESSION_ABSENT'],
    ['idle expiry',event.headers,{...good,expiresAt:1000},'SESSION_EXPIRED'],
    ['absolute expiry',event.headers,{...good,absoluteExpiresAt:1000},'SESSION_EXPIRED'],
    ['non-owner',event.headers,{...good,roleSnapshot:'staff'},'SESSION_NOT_OWNER_FULL'],
    ['enrollment only',event.headers,{...good,purpose:'passkey_enroll'},'SESSION_NOT_OWNER_FULL'],
    ['revoked',event.headers,{...good,revokedAt:1},'SESSION_REVOKED'],
    ['invalid record',event.headers,{...good,expiresAt:null},'SESSION_INVALID']
  ];let firstShape;
  for(const [name,headers,session,reason] of cases){await test(name+' stays private',async()=>{
    const logs=[];const r=await server(session,undefined,x=>logs.push(JSON.parse(x)))({...event,headers:{host:event.headers.host,...headers}});
    assert.equal(r.statusCode,401);const body=JSON.parse(r.body);assert.equal(body.error,'owner_login_required');assert.match(body.diagnosticRef,/^[A-Za-z0-9_-]{16}$/);
    assert.deepEqual(Object.keys(body).sort(),['diagnosticRef','error']);
    const shape=JSON.stringify({...body,diagnosticRef:'OPAQUE'});if(firstShape)assert.equal(shape,firstShape);else firstShape=shape;
    assert.equal(logs.length,1);assert.equal(logs[0].reason,reason);assert.equal(logs[0].diagnosticRef,body.diagnosticRef);
    assert.deepEqual(Object.keys(logs[0]).sort(),['diagnosticRef','event','reason']);
    assert(!JSON.stringify(logs).includes('SENSITIVE'));assert(!r.body.includes(reason));
  });}
  await test('CSRF and active-owner failures logged only as fixed categories',async()=>{
    for(const [h,u,reason,error] of [[{...event.headers,'x-csrf-token':'wrong'},undefined,'CSRF_MISMATCH','csrf_denied'],[event.headers,{id:'SENSITIVE_USER',role:'staff',status:'active'},'USER_NOT_ACTIVE_OWNER','owner_required']]){
      const logs=[];const r=await server(good,u,x=>logs.push(JSON.parse(x)))({...event,headers:h});
      assert.equal(r.statusCode,403);assert.equal(JSON.parse(r.body).error,error);assert.equal(logs[0].reason,reason);assert(!r.body.includes(reason));
    }
  });
  await test('POST rejection adds no diagnostics or log',async()=>{
    let logs=0;const r=await server(null,undefined,()=>logs++)({...event,httpMethod:'POST',body:'{}',headers:{...event.headers,origin}});
    assert.equal(r.statusCode,401);assert.equal(logs,0);assert.equal(r.body,JSON.stringify({error:'owner_login_required'}));
  });
  await test('logging failure does not alter authentication',async()=>{
    const r=await server(null,undefined,()=>{throw Error('SENSITIVE');})(event);assert.equal(r.statusCode,401);assert(!r.body.includes('SENSITIVE'));
  });
  await test('healthy GET remains read-only and has no diagnostic log',async()=>{
    let logs=0;const r=await server(good,undefined,()=>logs++)(event);assert.equal(r.statusCode,200);assert.equal(logs,0);assert(!JSON.parse(r.body).diagnosticRef);
  });
  await test('page URL sends one GET with CSRF and no secret display',async()=>{
    const b=await browserTrial('smile_studio_csrf=SENSITIVE_CSRF');assert.equal(b.requests.length,1);
    assert.equal(b.requests[0].opts.method,'GET');assert.equal(b.requests[0].opts.headers['X-CSRF-Token'],'SENSITIVE_CSRF');
    const info=b.n.get('check-info').textContent;assert(info.includes('あり'));assert(info.includes('ABCDEFGHIJKLMNOP'));assert(!info.includes('SENSITIVE'));
    assert(b.n.get('controls').hidden);assert(b.n.get('run').disabled);
  });
  await test('existing tab retains old result; reload or fresh tab reads new cookie',async()=>{
    const old=await browserTrial('');const oldInfo=old.n.get('check-info').textContent;assert(oldInfo.includes('なし'));
    old.doc.cookie='smile_studio_csrf=SENSITIVE_CSRF';await new Promise(r=>setImmediate(r));
    assert.equal(old.requests.length,1);assert.equal(old.n.get('check-info').textContent,oldInfo);
    for(const name of ['reload','new tab after login']){const fresh=await browserTrial(old.doc.cookie);assert.equal(fresh.requests.length,1);assert(fresh.n.get('check-info').textContent.includes('あり'),name);}
  });
  await test('untrusted diagnostic reference is not displayed',async()=>{
    const b=await browserTrial('','SENSITIVE_SECRET\n');assert(!b.n.get('check-info').textContent.includes('SENSITIVE'));
  });
  for(const [name,data,status] of [['anonymous',{ok:true,authenticated:false},200],['enrollment',{ok:true,authenticated:false,purpose:'passkey_enroll'},200],['missing purpose',{ok:true,authenticated:true},200],['HTTP failure',{ok:true,authenticated:true,purpose:'full'},503]]){
    await test('login does not announce success for '+name,async()=>{
      const b=await browserLogin(data,status);assert.equal(b.timers.length,0);assert.equal(b.location.href,'/auth-local/login.html');
      assert(b.n.get('login-status').textContent.includes('ログイン状態を確認できませんでした'));
      assert.equal(b.requests.filter(x=>x.url.endsWith('/verify')).length,1);
    });
  }
  await test('confirmed full session permits normal home navigation',async()=>{
    const b=await browserLogin({ok:true,authenticated:true,purpose:'full'});assert.equal(b.timers.length,1);b.timers[0]();assert.equal(b.location.href,'/index.html');
  });
  console.log(JSON.stringify({checks,liveCalls:0,storageWrites:0,aiCalls:0,results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
