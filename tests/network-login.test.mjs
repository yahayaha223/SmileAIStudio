import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {requestJson} from '../neeqoo/request.js';
import {allowLoginNavigation,installLoginNavigation} from '../neeqoo/login-navigation.js';
import {installDraftRetention} from '../neeqoo/return-state.js';
import {createPendingStore} from '../neeqoo/pending-instruction.js';
import {saveAndReadBack} from '../neeqoo/save-receipt.js';
const {createCloudStore}=createRequire(import.meta.url)('../netlify/functions/shared/neeqoo/cloud-store.cjs');
const fields={instruction:'Synthetic timeout recovery',intent:'report',reason:'verification',productId:'otter-mug'};
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
for(const phase of ['POST','GET','JSON'])test('deadline releases unresolved '+phase+' and retains pending',async()=>{
 const pending=createPendingStore(storage(),randomUUID),p=pending.begin(fields);let signal;
 const hung=()=>requestJson('/synthetic',{}, {timeoutMs:5,fetcher:async(_,o)=>{signal=o.signal;return phase==='JSON'?{json:()=>new Promise(()=>{})}:new Promise(()=>{});}});
 await assert.rejects(saveAndReadBack(p,phase==='POST'?hung:async()=>({id:randomUUID(),idempotency_key:p.key,...fields,product_id:p.productId}),hung),{code:'request_timeout'});
 assert.equal(signal.aborted,true);assert.deepEqual(pending.read(),p);
});
test('late committed POST after timeout and concurrent same-key retry produce one record',async()=>{
 let row=null,rev=0;const db=createCloudStore({async getWithMetadata(){return row?{data:structuredClone(row),etag:String(rev)}:null;},async setJSON(k,v,o){if(row?o.onlyIfMatch!==String(rev):!o.onlyIfNew)return {modified:false};row=structuredClone(v);return {modified:true,etag:String(++rev)};}});
 const pending=createPendingStore(storage(),randomUUID),p=pending.begin(fields);let release,late;
 const wait=new Promise(r=>release=r);
 await assert.rejects(saveAndReadBack(p,()=>requestJson('/synthetic',{}, {timeoutMs:5,fetcher:()=>{late=(async()=>{await wait;const j=await db.submit(p,'test');return {json:async()=>j};})();return late;}}),()=>db.snapshot()),{code:'request_timeout'});
 assert.deepEqual(pending.read(),p);release();
 const job=await saveAndReadBack(p,v=>db.submit(v,'test'),()=>db.snapshot());await late;
 assert.equal((await db.snapshot()).Jobs.length,1);assert.equal(pending.confirm(job),true);
});
test('late GET resolution cannot turn a timed-out call into success',async()=>{
 let resolve;let confirmed=false;
 const call=requestJson('/synthetic',{}, {timeoutMs:5,fetcher:()=>new Promise(r=>resolve=r)}).then(()=>confirmed=true);
 await assert.rejects(call,{code:'request_timeout'});resolve({json:async()=>({authentication:true})});await new Promise(r=>setImmediate(r));assert.equal(confirmed,false);
});
function fixture(disk=storage()){
 const oldWindow=globalThis.window,oldFormData=globalThis.FormData;
 const handlers={};globalThis.window={addEventListener(k,fn){handlers[k]=fn;}};globalThis.FormData=class{constructor(){return Object.entries(fields);}};
 const form={elements:Object.fromEntries(Object.entries(fields).map(([k,value])=>[k,{value}])),addEventListener(){}},input={value:fields.instruction,addEventListener(){}},checkbox={checked:false,addEventListener(){}},status={};
 const retention=installDraftRetention({form,input,checkbox,status,storage:disk,getPending:()=>null});
 return {retention,checkbox,disk,handlers,cleanup(){globalThis.window=oldWindow;globalThis.FormData=oldFormData;}};
}
test('draft OFF decline stays OFF; leaving requires separate loss confirmation',()=>{
 const f=fixture();try{const prompts=[];assert.equal(allowLoginNavigation({hasInput:true,getPending:()=>null,retention:f.retention,ask:s=>{prompts.push(s);return false;}}),false);assert.equal(prompts.length,2);assert.match(prompts[1],/失われる/);assert.equal(f.checkbox.checked,false);assert.equal(f.disk.getItem('neeqoo.optional-draft.v1'),null);}finally{f.cleanup();}
});
test('explicit opt-in verifies actual write; existing ON verifies again',()=>{
 const f=fixture();try{assert.equal(allowLoginNavigation({hasInput:true,getPending:()=>null,retention:f.retention,ask:()=>true}),true);assert.equal(f.checkbox.checked,true);assert.equal(JSON.parse(f.disk.getItem('neeqoo.optional-draft.v1')).payload.instruction,fields.instruction);assert.equal(allowLoginNavigation({hasInput:true,getPending:()=>null,retention:f.retention,ask:()=>{throw Error('not needed');}}),true);}finally{f.cleanup();}
});
for(const kind of ['throw','silent'])test('draft storage '+kind+' failure warns and cancels navigation for ON and opt-in',()=>{
 for(const enabled of [false,true]){const disk=storage();disk.setItem=()=>{if(kind==='throw')throw Error('quota');};const f=fixture(disk);try{f.checkbox.checked=enabled;const prompts=[];assert.equal(allowLoginNavigation({hasInput:true,getPending:()=>null,retention:f.retention,ask:s=>{prompts.push(s);return s.includes('一時保持しますか');}}),false);assert.match(prompts.at(-1),/書込み成功を確認できません/);}finally{f.cleanup();}}
});
test('pending and empty form navigate without enabling optional storage',()=>{for(const pending of [null,{key:'existing'}])assert.equal(allowLoginNavigation({hasInput:!!pending,getPending:()=>pending,ask:()=>{throw Error('not needed');}}),true);});

test('confirmed login departure avoids duplicate unload warning; return restores warning',()=>{
 const f=fixture();try{
  assert.equal(allowLoginNavigation({hasInput:true,getPending:()=>null,retention:f.retention,ask:()=>true}),true);
  f.retention.confirmDeparture();let warnings=0;const event={preventDefault(){warnings++;}};
  f.handlers.beforeunload(event);assert.equal(warnings,0);
  f.handlers.pageshow();f.handlers.beforeunload(event);assert.equal(warnings,1);
 }finally{f.cleanup();}
});
test('HTML login and common entry links are wired to cancel or confirm departure',async()=>{
 const {readFileSync}=await import('node:fs');const html=readFileSync('neeqoo/index.html','utf8');
 const tags=[...html.matchAll(/<a\b[^>]*>/g)].map(m=>m[0]).filter(s=>s.includes('data-neeqoo-login')||s.includes('href="/index.html"'));
 assert.equal(tags.length,3);
 const links=tags.map(()=>({addEventListener(type,fn){assert.equal(type,'click');this.click=fn;}}));let allowed=false,departures=0,cancelled=0;
 installLoginNavigation({document:{querySelectorAll(selector){assert.equal(selector,'[data-neeqoo-login],a[href="/index.html"]');return links;}},getState:()=>({hasInput:true,getPending:()=>null,retention:{isEnabled:()=>false,retainForLogin:()=>true,confirmDeparture(){departures++;}}}),ask:()=>allowed});
 for(const link of links)link.click({preventDefault(){cancelled++;}});assert.equal(cancelled,3);assert.equal(departures,0);
 allowed=true;for(const link of links)link.click({preventDefault(){cancelled++;}});assert.equal(cancelled,3);assert.equal(departures,3);
 links[0].click({metaKey:true,preventDefault(){throw Error('should navigate');}});assert.equal(departures,3);
});
