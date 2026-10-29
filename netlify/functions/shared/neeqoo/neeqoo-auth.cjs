'use strict';
const {timingSafeEqual}=require('node:crypto');
const reply=(statusCode,error)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body:JSON.stringify({ok:false,error})});
function header(event,name){const values=Object.entries(event.headers||{}).filter(([k])=>k.toLowerCase()===name).map(([,v])=>v);return values.length===1&&typeof values[0]==='string'?values[0]:'';}
function cookies(event){const result=Object.create(null);for(const part of header(event,'cookie').split(';')){const at=part.indexOf('=');if(at<0)continue;const key=part.slice(0,at).trim();if(Object.hasOwn(result,key))throw Error('duplicate');result[key]=decodeURIComponent(part.slice(at+1).trim());}return result;}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||!a||a.length>512||b.length>512)return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function route(event){const p=event.path||'';const m=event.httpMethod;const root='(?:/api/neeqoo|/\\.netlify/functions/api-neeqoo)';if(m==='GET'&&new RegExp('^'+root+'/state$').test(p))return 'read';if(m==='POST'&&new RegExp('^'+root+'/analytics$').test(p))return 'analytics';if(m==='POST'&&new RegExp('^'+root+'/jobs$').test(p))return 'instruct';if(m==='POST'&&new RegExp('^'+root+'/approvals/[a-f0-9-]{36}$').test(p))return 'approve';return null;}
// Dependencies must be bound to server-owned session/user stores, never to request data.
// No cookie minting, auth configuration writes, session touch, or global enforcement mode changes.
function createHandler(deps={}){
 return async function handler(event){
  const permission=route(event);if(!permission)return reply(404,'not_found');
  try{
   if(deps.origin!=='https://studio.egaonokiroku.co.jp'||typeof deps.getSession!=='function'||typeof deps.getUser!=='function')return reply(503,'auth_unavailable');
   const origin=header(event,'origin');if((origin&&origin!==deps.origin)||(event.httpMethod==='POST'&&!origin)||header(event,'sec-fetch-site')==='cross-site')return reply(403,'forbidden');
   const jar=cookies(event),raw=jar.smile_studio_session;
   if(!raw||raw.length>512)return reply(401,'unauthorized');
   const s=await deps.getSession(raw);const now=deps.now?deps.now():Date.now();
   if(!s||s.revokedAt!=null||s.purpose!=='full'||!Number.isFinite(s.expiresAt)||!Number.isFinite(s.absoluteExpiresAt)||s.expiresAt<=now||s.absoluteExpiresAt<=now||typeof s.userId!=='string')return reply(401,'unauthorized');
   const user=await deps.getUser(s.userId);
   if(!user||user.id!==s.userId||user.status!=='active')return reply(401,'unauthorized');
   // Check current role, not just the role snapshot. Empty allowlist is deny-by-default.
   if(user.role!=='owner'||s.roleSnapshot!=='owner'||!Array.isArray(deps.ownerIds)||!deps.ownerIds.includes(user.id))return reply(403,'forbidden');
   if(event.httpMethod==='POST'&&(!equal(header(event,'x-csrf-token'),s.csrfToken)||!equal(jar.smile_studio_csrf,s.csrfToken)))return reply(403,'forbidden');
   if(permission==='approve'&&(!Number.isFinite(s.stepUpUntil)||s.stepUpUntil<=now))return reply(401,'step_up_required');
   if(typeof deps.execute!=='function')return reply(503,'backend_unconnected');
   // No raw cookie/session/CSRF value reaches the business handler or its logs.
   return await deps.execute({permission,actorUserId:user.id,path:event.path,body:event.body||''});
  }catch{return reply(503,'auth_or_backend_unavailable');}
 };
}
module.exports={createHandler};

