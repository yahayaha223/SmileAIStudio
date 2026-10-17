// Candidate only. Disabled unless production build, explicit enable and owner allowlist agree.
import {createRequire} from 'node:module';
import {getStore} from 'netlify-blobs-trial';
import auth from './shared/neeqoo/strong-auth-reader.cjs';
import api from './shared/neeqoo/cloud-api.cjs';
import trial from './shared/diary-ai-trial.js';
import cryptoUtil from './shared/auth/crypto-util.js';
import authConfig from './shared/auth/config.js';
const require=createRequire(import.meta.url);
const response=(status,error)=>new Response(JSON.stringify({error}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export default async function handler(request){
 try{
  const url=new URL(request.url);
  if(process.env.NEEQOO_ENABLED!=='1')return response(503,'NeeQoo未接続・準備中');
  const build=require('./shared/diary-ai-trial-context.json');
  if(!build.production||authConfig.getAuthEnvironment()!=='production'||authConfig.getRpId()!=='studio.egaonokiroku.co.jp'||url.origin!=='https://studio.egaonokiroku.co.jp'||url.search)return response(403,'forbidden');
  const ownerIds=(process.env.NEEQOO_OWNER_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(!ownerIds.length)return response(503,'owner_access_unconfigured');
  const storeOptions={consistency:'strong',fetch:trial.storageFetch()};
  const reader=auth.createStrongAuthReader({store:getStore({name:'smile-studio-auth',...storeOptions}),sessionKey:raw=>'production/sessions/'+cryptoUtil.hashToken(raw),userKey:id=>'production/users/'+id});
  const getSession=async raw=>{const s=await reader.getSession(raw);return s&&s.sessionHash===cryptoUtil.hashToken(raw)?s:null;};
  let body='',length=0;
  if(request.body){const stream=request.body.getReader(),chunks=[];try{for(;;){const r=await stream.read();if(r.done)break;length+=r.value.byteLength;if(length>16384){await stream.cancel();return response(413,'input_too_large');}chunks.push(Buffer.from(r.value));}body=Buffer.concat(chunks).toString('utf8');}finally{stream.releaseLock();}}
  const result=await api.createCloudApi({enabled:true,ownerIds,release:build.commitRef,reader:{...reader,getSession},store:getStore({name:'smile-neeqoo-state',...storeOptions})})({httpMethod:request.method,path:url.pathname,headers:Object.fromEntries(request.headers),body});
  return new Response(result.body,{status:result.statusCode,headers:result.headers});
 }catch{return response(503,'neeqoo_unavailable');}
}
