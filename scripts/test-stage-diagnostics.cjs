const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createHandler}=require('../netlify/functions/shared/diary-ai-trial-handler');
const crypto=require('../netlify/functions/shared/auth/crypto-util');
const stamp=require('../netlify/functions/shared/diary-ai-trial-context.json');
const now=1000;
const session={sessionHash:crypto.hashToken('fake'),userId:'synthetic',purpose:'full',roleSnapshot:'owner',csrfToken:'csrf',expiresAt:2000,absoluteExpiresAt:3000};
const event={httpMethod:'GET',headers:{host:'studio.egaonokiroku.co.jp',cookie:'smile_studio_session=fake; smile_studio_csrf=csrf','x-csrf-token':'csrf'}};
const error=name=>Object.assign(new Error('SECRET_SENTINEL'),{name});
let checks=0;
function handler(stage,name){return createHandler({env:{},build:{...stamp,production:true},config:{authEnvironment:'production',rpId:'studio.egaonokiroku.co.jp'},now:()=>now,
getStores:()=>{if(stage==='D02')throw error(name);return {auth:{get:async key=>{if(key.includes('/sessions/')){if(stage==='D03')throw error(name);return session;}if(stage==='D06')throw error(name);return {id:'synthetic',role:'owner',status:'active'};}},trial:{get:async()=>{if(stage==='D09')throw error(name);return null;},setJSON:()=>{throw Error('WRITE FORBIDDEN');}}};},send:()=>{throw Error('AI FORBIDDEN');}});}
(async()=>{
for(const [stage,name,category] of [['D02','MissingBlobsEnvironmentError','C01'],['D03','BlobsConsistencyError','C02'],['D03','BlobsInternalError','C03'],['D03','SyntaxError','C04'],['D06','SyntaxError','C04'],['D09','TypeError','C06'],['D09','SECRET_SENTINEL','C00']]){
 const r=await handler(stage,name)(event);assert.equal(r.statusCode,503);assert.equal(JSON.parse(r.body).diagnostic,stage+'_'+category);assert(!r.body.includes('SECRET_SENTINEL'));checks++;
}
const badCookie=await handler()({...event,headers:{...event.headers,cookie:event.headers.cookie+'; unrelated=%ZZ'}});
assert.equal(JSON.parse(badCookie.body).diagnostic,'D01_C05');checks++;
const good=await handler()(event);assert.equal(good.statusCode,200);assert(!('diagnostic' in JSON.parse(good.body)));checks++;
const post=await handler('D02','MissingBlobsEnvironmentError')({...event,httpMethod:'POST',body:'{}',headers:{...event.headers,origin:'https://studio.egaonokiroku.co.jp'}});
assert(!('diagnostic' in JSON.parse(post.body)));checks++;
for(const diagnostic of ['D03_C02','SECRET_SENTINEL','D03_C02\nSECRET_SENTINEL','D99_C99']){
 const nodes=Object.fromEntries(['status','run','controls','memo','result'].map(id=>[id,{hidden:true,disabled:true,textContent:'',addEventListener(){}}]));let calls=0;
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../js/diary-ai-trial.js'),'utf8'),{document:{cookie:'',getElementById:id=>nodes[id]},fetch:async(_,opts)=>{assert.equal(opts.method,'GET');calls++;return {ok:false,json:async()=>({error:'trial_unavailable_do_not_retry',diagnostic,private:'SECRET_SENTINEL'})};},window:{}});
 await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert(!nodes.status.textContent.includes('SECRET_SENTINEL'));assert.equal(nodes.status.textContent.includes('[D03_C02]'),diagnostic==='D03_C02');assert(nodes.controls.hidden);checks++;
}
console.log(JSON.stringify({stageChecksPassed:checks,liveCalls:0,writes:0,paidCalls:0}));
})().catch(e=>{console.error(e);process.exitCode=1;});
