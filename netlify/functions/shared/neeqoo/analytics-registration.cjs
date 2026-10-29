'use strict';
const {createHash}=require('node:crypto');
const KEY='analytics-snapshot-v1';
function fail(status,message){throw Object.assign(Error(message),{status});}
function object(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(v,k)))fail(400,'invalid_analytics_snapshot');}
function text(v,max=300){if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f]/.test(v))fail(400,'invalid_analytics_snapshot');}
function metric(v){if(v!==null&&(!Number.isSafeInteger(v)||v<0))fail(400,'invalid_analytics_snapshot');}
function date(v,nullable=false){if(nullable&&v===null)return;if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v)))fail(400,'invalid_analytics_snapshot');}
function validate(s){
 object(s,['version','mode','providerFreshness','evidence','pinterest','sales','regularPosts']);
 if(s.version!==1||s.mode!=='manual_snapshot'||s.providerFreshness!==null)fail(400,'invalid_analytics_snapshot');
 object(s.evidence,['source','capturedAtPrecision','note']);text(s.evidence.source);text(s.evidence.note);if(s.evidence.capturedAtPrecision!=='second')fail(400,'invalid_analytics_snapshot');
 const p=s.pinterest;object(p,['source','brandId','capturedAt','originalNine','daily']);text(p.source);metric(p.brandId);if(!p.brandId)fail(400,'invalid_analytics_snapshot');date(p.capturedAt);
 const n=p.originalNine;object(n,['views','saves','pinClicks','outboundClicks','variants']);for(const k of ['views','saves','pinClicks','outboundClicks'])metric(n[k]);
 if(!Array.isArray(n.variants)||n.variants.length!==3)fail(400,'invalid_analytics_snapshot');for(const r of n.variants){object(r,['label','views']);text(r.label,80);metric(r.views);}if(new Set(n.variants.map(r=>r.label)).size!==3||n.variants.some(r=>r.views===null)||n.variants.reduce((a,r)=>a+r.views,0)!==n.views)fail(400,'invalid_analytics_snapshot');
 const d=p.daily;object(d,['scope','reportedTotalViews','lastDataDate','distributionVerified','rows','query','providerUpdatedAt']);text(d.scope);metric(d.reportedTotalViews);if(d.distributionVerified!==true||d.providerUpdatedAt!==null)fail(400,'invalid_analytics_snapshot');
 object(d.query,['start','end','timeZone']);date(d.query.start);date(d.query.end);if(d.query.timeZone!=='Asia/Tokyo'||Date.parse(d.query.start)>Date.parse(d.query.end)||Date.parse(d.query.end)>Date.parse(p.capturedAt))fail(400,'invalid_analytics_snapshot');
 if(!Array.isArray(d.rows)||d.rows.length<1||d.rows.length>366)fail(400,'invalid_analytics_snapshot');let prior='',total=0,last=null;
 for(const r of d.rows){object(r,['date','views','saves','pinClicks','outboundClicks']);if(typeof r.date!=='string'||!/^\d{4}-\d\d-\d\d$/.test(r.date)||new Date(r.date+'T00:00:00Z').toISOString().slice(0,10)!==r.date||r.date<=prior||r.date<d.query.start.slice(0,10)||r.date>d.query.end.slice(0,10))fail(400,'invalid_analytics_snapshot');prior=r.date;for(const k of ['views','saves','pinClicks','outboundClicks'])metric(r[k]);if(r.views===null){if(['saves','pinClicks','outboundClicks'].some(k=>r[k]!==null))fail(400,'invalid_analytics_snapshot');}else{total+=r.views;last=r.date;}}
 if(total!==d.reportedTotalViews||last!==d.lastDataDate)fail(400,'invalid_analytics_snapshot');
 const sales=s.sales;object(sales,['source','capturedAt','salesRows','cumulativeToribunJpy','salesJpy','profitJpy','attributedPurchases']);text(sales.source);date(sales.capturedAt,true);for(const k of ['salesRows','cumulativeToribunJpy','salesJpy','profitJpy','attributedPurchases']){metric(sales[k]);if(sales.capturedAt===null&&sales[k]!==null)fail(400,'invalid_analytics_snapshot');}
 const r=s.regularPosts;object(r,['capturedAt','returnedPinCount','published','scheduled','scheduledFor','views','saves','pinClicks','outboundClicks']);date(r.capturedAt);date(r.scheduledFor,true);for(const k of ['returnedPinCount','published','scheduled','views','saves','pinClicks','outboundClicks'])metric(r[k]);
 return s;
}
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
const digest=s=>createHash('sha256').update(JSON.stringify(canonical(s))).digest('hex');
async function register(store,s){
 validate(s);
 let before;try{before=await store.getWithMetadata(KEY,{type:'json',consistency:'strong'});}catch{fail(503,'analytics_read_unavailable');}
 if(before!==null){if(!before)fail(503,'analytics_read_unavailable');fail(409,'analytics_already_exists');}
 let result;try{result=await store.setJSON(KEY,s,{onlyIfNew:true});}catch{fail(503,'analytics_write_outcome_unknown');}
 if(result?.modified===false)fail(409,'analytics_already_exists');
 if(result?.modified!==true||!result.etag)fail(503,'analytics_write_outcome_unknown');
 let saved;try{saved=await store.getWithMetadata(KEY,{type:'json',consistency:'strong'});}catch{fail(503,'analytics_write_outcome_unknown');}
 if(!saved?.data||digest(saved.data)!==digest(s))fail(503,'analytics_write_outcome_unknown');
 return {created:true,key:KEY,sha256:digest(s)};
}
module.exports={validate,register,digest};
