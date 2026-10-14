// Run against the official zip-it-and-ship-it output, without source node_modules.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
assert(process.argv[2], 'Pass the packed api-auth.mjs path');
process.env.AUTH_ENVIRONMENT='production';
process.env.AUTH_RP_ID='studio.egaonokiroku.co.jp';
process.env.AUTH_ENFORCEMENT_MODE='enforce';
process.env.AUTH_IP_HASH_SALT='synthetic';
const origin='https://studio.egaonokiroku.co.jp';
globalThis.netlifyBlobsContext=Buffer.from(JSON.stringify({siteID:'synthetic',token:'synthetic',
  edgeURL:'https://cached.invalid',uncachedEdgeURL:'https://strong.invalid'})).toString('base64');
const session={sessionHash:crypto.createHash('sha256').update('synthetic-session').digest('hex'),
  userId:'synthetic-owner',roleSnapshot:'owner',purpose:'full',csrfToken:'synthetic-csrf',
  expiresAt:Date.now()+60000,absoluteExpiresAt:Date.now()+120000};
const records=new Map();let reads=0,writes=0;
globalThis.fetch=async(url,opts)=>{
  assert.equal(new URL(url).hostname,'strong.invalid');
  const key=decodeURIComponent(new URL(url).pathname);
  if(opts.method.toUpperCase()==='PUT'){writes++;records.set(key,JSON.parse(opts.body));return new Response('',{status:200});}
  assert.equal(opts.method.toUpperCase(),'GET');reads++;
  const value=records.get(key)||(key.includes('/sessions/')?session:
    key.includes('/users/')?{id:'synthetic-owner',role:'owner',status:'active'}:null);
  return new Response(value?JSON.stringify(value):'',{status:value?200:404});
};
const {default:handler}=await import(pathToFileURL(path.resolve(process.argv[2])));
const authenticated=await handler(new Request(origin+'/api/auth/session',{
  headers:{cookie:'smile_studio_session=synthetic-session; smile_studio_csrf=synthetic-csrf'}}));
assert.equal(authenticated.status,200);assert.equal((await authenticated.json()).authenticated,true);
const anonymous=await handler(new Request(origin+'/.netlify/functions/api-auth/session'));
assert.equal(anonymous.status,200);assert.equal((await anonymous.json()).authenticated,false);
// Calls the actual packaged SimpleWebAuthn options generator, no biometric device.
const options=await handler(new Request(origin+'/api/auth/passkey/login/options',{
  method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'}));
assert.equal(options.status,200);const result=await options.json();
assert.equal(result.ok,true);assert.equal(result.options.rpId,'studio.egaonokiroku.co.jp');
assert.equal(result.options.userVerification,'required');assert(result.options.challenge);
console.log(JSON.stringify({packedChecksPassed:3,strongReads:reads,syntheticWrites:writes,liveNetworkCalls:0,aiCalls:0}));
