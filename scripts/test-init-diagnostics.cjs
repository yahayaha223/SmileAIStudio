const assert=require('node:assert/strict');
const {createHandler}=require('../netlify/functions/shared/diary-ai-trial-handler');
const trial=require('../netlify/functions/shared/diary-ai-trial');
const stamp=require('../netlify/functions/shared/diary-ai-trial-context.json');
const event={httpMethod:'GET',headers:{host:'studio.egaonokiroku.co.jp',cookie:'smile_studio_session=fake; smile_studio_csrf=fake','x-csrf-token':'fake'}};
const deps={env:{},build:{...stamp,production:true},config:{authEnvironment:'production',rpId:'studio.egaonokiroku.co.jp'}};
(async()=>{
let passed=0;
for(const [stage,code,name,expected] of [['D10','MODULE_NOT_FOUND','Error','C07'],['D10','ERR_MODULE_NOT_FOUND','Error','C07'],['D10','ERR_REQUIRE_ESM','Error','C08'],['D10',null,'ReferenceError','C09'],['D11',null,'Error','C00'],['D12',null,'Error','C00']]){
 const handler=createHandler({...deps,getStores:(_,mark)=>{mark(stage);throw Object.assign(Error('PRIVATE_SENTINEL'),{code,name});}});
 const r=await handler(event);assert.equal(r.statusCode,503);assert.equal(JSON.parse(r.body).diagnostic,stage+'_'+expected);assert(!r.body.includes('PRIVATE_SENTINEL'));passed++;
}
const phases=[];globalThis.netlifyBlobsContext=Buffer.from(JSON.stringify({siteID:'fake',token:'fake',edgeURL:'https://cached.invalid',uncachedEdgeURL:'https://strong.invalid'})).toString('base64');
globalThis.fetch=()=>{throw Error('Network forbidden');};
const stores=trial.getStores(event,stage=>phases.push(stage));assert.deepEqual(phases,['D10','D11','D12']);assert(stores.auth&&stores.trial);passed++;
const bad=createHandler({...deps,getStores:(_,mark)=>{mark('PRIVATE_SENTINEL');throw Error('PRIVATE_SENTINEL');}});
assert.equal(JSON.parse((await bad(event)).body).diagnostic,'D02_C00');passed++;
console.log(JSON.stringify({initializationChecks:passed,liveCalls:0,writes:0,paidCalls:0}));
})().catch(e=>{console.error(e);process.exitCode=1;});
