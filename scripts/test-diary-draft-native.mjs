import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createNativeHandler} from '../netlify/functions/api-diary-draft.mjs';
import transport from '../netlify/functions/shared/diary-draft-transport.js';
test('native endpoint defaults OFF without store access',async()=>{
 const h=createNativeHandler({env:{},getStores(){throw Error('must not access');}});
 const r=await h(new Request('https://studio.egaonokiroku.co.jp/.netlify/functions/api-diary-draft',{method:'POST',body:'{}'}));
 assert.equal(r.status,503);assert.equal((await r.json()).error,'not_enabled');
});
test('transport notes-only payload, usage and bounded output; no retry',async()=>{
 for(const mode of ['ok','http','large','incomplete']){
 let calls=0, payload;
 const request=(opts,cb)=>{calls++;const req=new EventEmitter();req.destroy=()=>{};req.end=bytes=>{
 payload=JSON.parse(bytes);const res=new EventEmitter();res.statusCode=mode==='http'?500:200;cb(res);
 const data={status:mode==='incomplete'?'incomplete':'completed',model:transport.MODEL,usage:{input_tokens:200,output_tokens:30},output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'generated'}]}]};
 res.emit('data',Buffer.from(mode==='large'?'x'.repeat(131073):JSON.stringify(data)));res.emit('end');};return req;};
 const result=transport.send('mock','memo',request);
 if(mode==='ok'){const r=await result;assert.equal(r.text,'generated');assert.equal(r.estimatedModelCostUSD,.000128);}else await assert.rejects(result,/generation_failed/);
 assert.equal(calls,1);assert.deepEqual(payload.input,[{role:'user',content:'memo'}]);assert.equal(payload.store,false);assert.equal(payload.max_output_tokens,1200);assert.equal(payload.tools,undefined);
 }
});
