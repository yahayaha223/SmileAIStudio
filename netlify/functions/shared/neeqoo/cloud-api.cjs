'use strict';
const {createHandler}=require('./neeqoo-auth.cjs');
const {createCloudStore}=require('./cloud-store.cjs');
const json=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
function createCloudApi({reader,store,ownerIds=[],enabled=false,now}={}){
 if(!enabled)return async()=>json(503,{error:'NeeQoo未接続・準備中'});
 const db=createCloudStore(store,{now});
 return createHandler({origin:'https://studio.egaonokiroku.co.jp',ownerIds,...reader,now,execute:async ctx=>{
  try{
   if(ctx.permission==='read')return json(200,await db.snapshot());
   if(Buffer.byteLength(ctx.body)>4096)return json(413,{error:'input_too_large'});
   let body;try{body=JSON.parse(ctx.body);}catch{return json(400,{error:'invalid_json'});}
   if(ctx.permission==='instruct')return json(201,await db.submit(body,ctx.actorUserId));
   if(!body||Array.isArray(body)||Object.keys(body).length!==1||!Object.hasOwn(body,'decision'))return json(400,{error:'invalid_decision'});
   return json(200,await db.decide(ctx.path.split('/').at(-1),body.decision,ctx.actorUserId));
  }catch(e){return json(e.status||503,{error:e.status?e.message:'persistent_store_unavailable'});}
 }});
}
module.exports={createCloudApi};
