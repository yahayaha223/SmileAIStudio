import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installAnalytics,metricValue} from '../neeqoo/analytics.js';
const require=createRequire(import.meta.url);
// Entirely synthetic measurements. Actual owner data must never enter this public repo.
const snapshot={version:1,mode:'manual_snapshot',pinterest:{brandId:1234567,capturedAt:'2020-01-02T01:02:03+09:00',originalNine:{views:60,saves:0,pinClicks:0,outboundClicks:0,variants:[{label:'A',views:10},{label:'B',views:20},{label:'C',views:30}]},daily:{rows:[0,0,0,0,90,null,null,null].map((views,i)=>({date:'2020-01-'+String(i+1).padStart(2,'0'),views}))}},sales:{capturedAt:'2020-01-02T02:03:04+09:00',profitJpy:null,attributedPurchases:null},regularPosts:{capturedAt:'2020-01-02T03:04:05+09:00'}};
const {createCloudApi}=require('../netlify/functions/shared/neeqoo/cloud-api.cjs');
snapshot.regularPosts={...snapshot.regularPosts,published:7,scheduled:2,views:123,saves:4,pinClicks:5,outboundClicks:6};
class Element{
 constructor(tag,doc){this.tag=tag;this.ownerDocument=doc;this.children=[];this.textContent='';}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;this.textContent='';}
 setAttribute(k,v){this[k]=v;}
 get text(){return this.textContent+this.children.map(n=>n.text).join(' ');}
}
function fixture(){const doc={createElement:tag=>new Element(tag,doc)};const root=doc.createElement('div');return {root,ui:installAnalytics(root)};}
test('malformed optional chart rows cannot break the existing state refresh',()=>{
 for(const rows of [{},'bad',[null,{}, {date:'2020-01-01',label:'A',views:Infinity}]]){
 const s=structuredClone(snapshot);s.pinterest.daily.rows=rows;s.pinterest.originalNine.variants=rows;
 const {root,ui}=fixture();assert.doesNotThrow(()=>ui.success({authentication:true,analytics:s}));
 assert.match(root.text,/unknown/);assert.ok(root.text.includes('通常投稿'));
 const visit=n=>{if(n.tag==='meter')assert.ok(Number.isFinite(n.max));n.children.forEach(visit);};visit(root);
 }
});
test('unknown differs from measured zero',()=>{for(const x of [undefined,null,NaN,-1,'0'])assert.match(metricValue(x),/unknown/);assert.equal(metricValue(0),'0');});
test('snapshot preserves separate scopes and dates',()=>{
 assert.equal(snapshot.pinterest.originalNine.views,60);
 assert.equal(snapshot.pinterest.originalNine.variants.reduce((n,r)=>n+r.views,0),60);
 assert.equal(snapshot.pinterest.daily.rows.filter(r=>r.views!==null).reduce((n,r)=>n+r.views,0),90);
 assert.equal(snapshot.pinterest.daily.rows.filter(r=>r.views===null).length,3);
 assert.equal(snapshot.sales.profitJpy,null);assert.equal(snapshot.sales.attributedPurchases,null);
 const {root,ui}=fixture();ui.success({authentication:true,analytics:snapshot});
 for(const text of ['01:02:03','02:03:04','03:04:05','自動連携なし','合算しません','現在の新しい取得値ではありません','予約後に公開されたかは unknown','欠測'])assert.ok(root.text.includes(text),text);
 const meters=[];function walk(n){if(n.tag==='meter')meters.push(n);n.children.forEach(walk);}walk(root);
 assert.equal(meters.length,8);assert.deepEqual(meters.map(n=>n.value),[10,20,30,0,0,0,0,90]);
 const ordinary=root.children.find(n=>n.text.includes('通常投稿（元9実験ピンと分離）'));
 assert.match(ordinary.text,/123/);assert.match(ordinary.text,/公開 7 件/);
 assert.ok(root.text.includes('元9実験ピン'));assert.ok(root.text.includes('日別推移'));
 assert.doesNotMatch(root.text,/表示：150|表示：273/);
});
test('recheck, auth failure and unavailable response remove previous numbers',()=>{
 const {root,ui}=fixture();const good={authentication:true,analytics:snapshot};
 for(const action of [()=>ui.checking(),()=>ui.failure(),()=>ui.success({}),()=>ui.success({authentication:false,analytics:snapshot})]){
 ui.success(good);assert.match(root.text,/60/);action();assert.doesNotMatch(root.text,/60|1234567|01:02:03/);assert.match(root.text,/unknown/);
 }
});
test('existing owner auth guards snapshot; reads never write',async()=>{
 let reads=0,writes=0;const now=1000;
 const store={getWithMetadata:async key=>{reads++;return key==='analytics-snapshot-v1'?{data:snapshot,etag:'synthetic'}:null;},setJSON:async()=>{writes++;throw Error('unexpected');}};
 const session={userId:'owner',roleSnapshot:'owner',purpose:'full',expiresAt:2000,absoluteExpiresAt:3000};
 const reader={getSession:async()=>session,getUser:async()=>({id:'owner',role:'owner',status:'active'})};
 const opts={enabled:true,reader,store,ownerIds:['owner'],now:()=>now};
 const event={httpMethod:'GET',path:'/api/neeqoo/state',headers:{cookie:'smile_studio_session=synthetic'}};
 let response=await createCloudApi(opts)(event);assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.body).analytics.pinterest.originalNine.views,60);assert.equal(response.headers['Cache-Control'],'no-store');
 for(const [options,request,status] of [[opts,{...event,headers:{}},401],[{...opts,ownerIds:[]},event,403],[{...opts,enabled:false},event,503],[opts,{...event,headers:{...event.headers,origin:'https://other.invalid'}},403],[{...opts,reader:{...reader,getSession:async()=>({...session,expiresAt:999})}},event,401]]){
 response=await createCloudApi(options)(request);assert.equal(response.statusCode,status);assert.doesNotMatch(response.body,/analytics|1234567/);
 }
 assert.equal(reads,2);assert.equal(writes,0);
 for(const changed of [{...session,revokedAt:1},{...session,absoluteExpiresAt:999},{...session,roleSnapshot:'staff'}]){
 const denied=await createCloudApi({...opts,reader:{...reader,getSession:async()=>changed}})({...event,path:'/.netlify/functions/api-neeqoo/state'});
 assert.ok([401,403].includes(denied.statusCode));assert.doesNotMatch(denied.body,/analytics|1234567/);
 }
 assert.equal(reads,2);assert.equal(writes,0);
 for(const absent of [null,{data:{version:2}},'error']){
 const absentStore={...store,getWithMetadata:async key=>{if(key!=='analytics-snapshot-v1')return null;if(absent==='error')throw Error('unavailable');return absent;}};
 response=await createCloudApi({...opts,store:absentStore})(event);assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.body).analytics,null);
 }
});

