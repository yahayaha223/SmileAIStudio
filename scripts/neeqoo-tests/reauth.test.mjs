import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reauthenticate,encode,decode} from '../../neeqoo/reauth.js';
test('step-up uses existing endpoints and confirms persisted session, never approves',async()=>{
 const calls=[];let sessionReads=0;const buf=new Uint8Array([0,127,255]).buffer;
 const fetcher=async(url,opts)=>{calls.push(url);let value={ok:true};if(url.endsWith('/session'))value={...value,authenticated:true,purpose:'full',csrfToken:'synthetic',stepUpRemainingSec:sessionReads++?120:0};else{assert.equal(opts.headers['X-CSRF-Token'],'synthetic');if(url.endsWith('/options'))value.options={challenge:encode(buf),rpId:'studio.egaonokiroku.co.jp',userVerification:'required',allowCredentials:[]};}return Response.json(value);};
 await reauthenticate({fetcher,credentials:{get:async({publicKey})=>{assert.deepEqual(new Uint8Array(publicKey.challenge),new Uint8Array(buf));return {id:'synthetic',rawId:buf,type:'public-key',response:{clientDataJSON:buf,authenticatorData:buf,signature:buf}};}}});
 assert.deepEqual(calls,['/api/auth/session','/api/auth/passkey/step-up/options','/api/auth/passkey/step-up/verify','/api/auth/session']);assert.deepEqual(decode(encode(buf)),buf);
});
test('step-up refuses enrollment or unconfirmed session and cancellation',async()=>{
 await assert.rejects(reauthenticate({fetcher:async()=>Response.json({ok:true,authenticated:true,purpose:'passkey_enroll'}),credentials:{get(){throw Error('must not run');}}}));
 let calls=0;await assert.rejects(reauthenticate({fetcher:async()=>Response.json(++calls===1?{ok:true,authenticated:true,purpose:'full',csrfToken:'synthetic'}:{ok:true,options:{challenge:'AA'}}),credentials:{get:async()=>null}}));assert.equal(calls,2);
});
