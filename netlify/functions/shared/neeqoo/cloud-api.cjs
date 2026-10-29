'use strict';
const {createHandler}=require('./neeqoo-auth.cjs');
const {createCloudStore}=require('./cloud-store.cjs');
const json=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
function createCloudApi({reader,store,ownerIds=[],enabled=false,now,release}={}){
 if(!enabled)return async()=>json(503,{error:'NeeQoo未接続・準備中'});
 const db=createCloudStore(store,{now,release});
 return createHandler({origin:'https://studio.egaonokiroku.co.jp',ownerIds,...reader,now,execute:async ctx=>{
  try{
   if(ctx.permission==='read'){
    const state=await db.snapshot();
    // Separate owner-only snapshot, provisioned out of band. Never seed private
    // measurements in this public repository, static assets or an unauthenticated API.
    let analytics=null;
    try{
     const row=await store.getWithMetadata('analytics-snapshot-v1',{type:'json',consistency:'strong'});
     if(row?.data?.version===1&&row.data.mode==='manual_snapshot')analytics=row.data;
    }catch{/* Unavailable analytics must not break the existing instruction state. */}
    return json(200,{...state,analytics});
   }
   if(Buffer.byteLength(ctx.body)>16384)return json(413,{error:'input_too_large'});
   let body;try{body=JSON.parse(ctx.body);}catch{return json(400,{error:'invalid_json'});}
   if(ctx.permission==='instruct')return json(201,await db.submit(body,ctx.actorUserId));
   if(!body||Array.isArray(body)||Object.keys(body).length!==1||!Object.hasOwn(body,'decision'))return json(400,{error:'invalid_decision'});
   return json(200,await db.decide(ctx.path.split('/').at(-1),body.decision,ctx.actorUserId));
  }catch(e){return json(e.status||503,{error:e.status?e.message:'persistent_store_unavailable'});}
 }});
}
module.exports={createCloudApi};

