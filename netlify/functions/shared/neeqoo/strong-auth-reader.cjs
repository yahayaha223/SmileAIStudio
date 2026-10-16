'use strict';
// Provider must honor strong reads or reject. No eventual/memory/file fallback.
function createStrongAuthReader({store,sessionKey,userKey,timeoutMs=1500}={}){
 if(!store||typeof store.get!=='function'||typeof sessionKey!=='function'||typeof userKey!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('strong_reader_not_configured');
 async function read(key){
  if(typeof key!=='string'||!key||key.length>1024)throw Error('invalid_auth_key');
  let timer;
  try{
   const value=await Promise.race([Promise.resolve().then(()=>store.get(key,{type:'json',consistency:'strong'})),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),timeoutMs);})]);
   if(value===null)return null;
   if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_record');
   return structuredClone(value);
  }catch{throw Error('strong_auth_unavailable');}finally{clearTimeout(timer);}
 }
 return Object.freeze({getSession:raw=>read(sessionKey(raw)),getUser:id=>read(userKey(id))});
}
module.exports={createStrongAuthReader};
