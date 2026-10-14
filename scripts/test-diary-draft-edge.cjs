// No personal profile, live APIs or external resources. Real Edge DOM + IndexedDB.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),out=fs.mkdtempSync(path.join(root,'../diary-edge-offline-'));
const source=fs.readFileSync(path.join(root,'script.js'),'utf8');
function fn(name){const start=source.indexOf('  function '+name+'(');if(start<0)throw Error(name);const end=source.indexOf('\n  }',start)+4;return source.slice(start,end);}
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
html=html.slice(html.lastIndexOf('<div',html.indexOf('id="simple-diary-modal"')),html.lastIndexOf('<div',html.indexOf('id="simple-diary-delete-modal"')));
const setup=`
var editingDiaryId='fake-entry', diaryImageItems=[], simpleDiaryBusy=false, simpleDiaryPendingConfirm=false;
var simpleDiaryEditingId=null,simpleDiarySourceValues=null, advanced={title:'',content:'',photoMemo:'',publishDate:'2026-10-14'}, messages=[],calls=[];
function readWebDiaryFormValues(){return advanced;}
function ensureEditingDiaryId(){if(!editingDiaryId)editingDiaryId='fake-new';}
function initMediaDbAvailability(){}
function syncSimpleDiaryPreview(){}
function setModalOpen(id,open){document.getElementById(id).classList.toggle('is-open',open);}
function showToast(s){messages.push(s);}
function setSimpleDiaryStatus(s){messages.push(s);}
${['simpleDiaryContextMatches','openSimpleDiary','closeSimpleDiary','beginSimpleDiaryConfirm','cancelSimpleDiaryConfirm'].map(fn).join('\n')}
var resolver, mode='immediate';
var diaryDraftEditor=SmileDiaryDraft.attach({document,storage:sessionStorage,AbortController,setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window),confirm:()=>true,
getContext:()=>editingDiaryId,getCsrfToken:()=> 'fake-csrf',isPublishing:()=>false,onBodyChange:cancelSimpleDiaryConfirm,
fetch:async(url,opts)=>{calls.push(JSON.parse(opts.body));if(mode==='wait')return new Promise(r=>resolver=r);return {ok:true,status:200,json:async()=>({ok:true,text:'架空の生成文'})};}});
const checks=[];
function check(value,label){if(!value)throw Error(label);checks.push(label);}
async function run(){
 document.getElementById('test-result').textContent='started';
 const el=id=>document.getElementById(id);
 localStorage.setItem('smileAIStudio_blogDrafts',JSON.stringify([{id:'untouched',body:'架空の保存済み本文'}]));
 const original=localStorage.getItem('smileAIStudio_blogDrafts');
 const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
 const blob=new Blob([bytes],{type:'image/png'});
 document.getElementById('test-result').textContent='waiting for IndexedDB';
 await SmileMediaDB.saveDiaryImageBlob({imageId:'fake-image',diaryId:'fake-entry',blob});
 openSimpleDiary();
 diaryImageItems.push({imageId:'fake-image',blob,url:URL.createObjectURL(blob)});
 const img=document.createElement('img');img.src=diaryImageItems[0].url;document.body.append(img);await img.decode();
 el('simple-diary-notes').value='架空のメモ';el('simple-diary-body').value='本人の下書き';
 await diaryDraftEditor.generate();check(el('simple-diary-body').value==='本人の下書き','generation preserves body');
 el('simple-diary-ai-candidate').value='本人が修正した候補';diaryDraftEditor.apply();check(el('simple-diary-body').value==='本人が修正した候補','editable candidate applies explicitly');
 closeSimpleDiary();openSimpleDiary();check(diaryImageItems.length===1&&img.naturalWidth===1,'close/reopen preserves image and selected photo');
 mode='wait';const pending=diaryDraftEditor.generate();await diaryDraftEditor.generate();const before=calls.length;
 diaryDraftEditor.cancel();resolver({ok:true,status:200,json:async()=>({ok:true,text:'遅延結果'})});await pending;
 check(calls.length===before&&el('simple-diary-ai-candidate').value==='本人が修正した候補','duplicate click and cancelled late result');
 const record=await SmileMediaDB.getDiaryImageBlob('fake-image');
 check(JSON.stringify(Array.from(new Uint8Array(await record.blob.arrayBuffer())))===JSON.stringify(Array.from(new Uint8Array(await blob.arrayBuffer()))),'IndexedDB image bytes unchanged');
 check(localStorage.getItem('smileAIStudio_blogDrafts')===original,'existing saved drafts unchanged');
 check(calls.every(x=>Object.keys(x).sort().join(',')==='notes,requestId'),'only notes and request ID sent to mock API');
 advanced.content='別の編集';beginSimpleDiaryConfirm();check(!simpleDiaryPendingConfirm,'advanced edit blocks publication');
 advanced.content='';editingDiaryId='different';beginSimpleDiaryConfirm();check(!simpleDiaryPendingConfirm,'different entry blocks publication');
 closeSimpleDiary();openSimpleDiary();check(!el('simple-diary-modal').classList.contains('is-open'),'different entry cannot silently reuse composer');
 editingDiaryId='fake-entry';openSimpleDiary();
 document.getElementById('test-result').textContent=JSON.stringify({ok:true,checks,calls:calls.length,liveApiCalls:0,networkPolicy:'CSP connect-src none + dead proxy'});
}
run().catch(e=>document.getElementById('test-result').textContent=JSON.stringify({ok:false,error:e.message,stack:e.stack,checks}));
`;
const page='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; connect-src \'none\'; form-action \'none\'"><style>'+fs.readFileSync(path.join(root,'style.css'),'utf8')+'</style>'+html+'<pre id="test-result">pending</pre><script>'+fs.readFileSync(path.join(root,'js/smile-media-db.js'),'utf8')+'</script><script>'+fs.readFileSync(path.join(root,'js/smile-diary-draft.js'),'utf8')+'</script><script>'+setup+'</script>';
const file=path.join(out,'fixture.html');
fs.writeFileSync(file,page.replace('<pre id="test-result">pending</pre>','<pre id="test-result">pending</pre><script>window.onerror=function(message){document.getElementById("test-result").textContent=JSON.stringify({ok:false,error:String(message)})};</script>'));
async function browserTest(){
const child=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',[
 '--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-sync',
 '--proxy-server=127.0.0.1:9','--proxy-bypass-list=<-loopback>','--host-resolver-rules=MAP * ~NOTFOUND',
 '--user-data-dir='+path.join(out,'profile'),'--remote-debugging-port=0',pathToFileURL(file).href
],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let stderr='',ws;child.stderr.on('data',x=>stderr+=x);const delay=()=>new Promise(r=>setTimeout(r,100));
try{
 const portFile=path.join(out,'profile','DevToolsActivePort');
 for(let i=0;i<100&&!fs.existsSync(portFile);i++)await delay();
 const port=fs.readFileSync(portFile,'utf8').split('\n')[0];
 const tabs=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const tab=tabs.find(t=>t.type==='page'&&t.url===pathToFileURL(file).href);if(!tab)throw Error('test tab missing');
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
 const call=(method,params)=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
 let report;
 for(let i=0;i<150;i++){
  const r=await call('Runtime.evaluate',{expression:'document.getElementById("test-result").textContent',returnByValue:true});
  const value=r.result?.result?.value||'';
  if(value.startsWith('{')){report=JSON.parse(value);break;}await delay();
 }
 if(!report)throw Error('test did not complete in real-time window');
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));
 const shot=await call('Page.captureScreenshot',{format:'png'});if(shot.result?.data)fs.writeFileSync(path.join(out,'screenshot.png'),Buffer.from(shot.result.data,'base64'));
 console.log(JSON.stringify({...report,out}));if(!report.ok)process.exitCode=1;
 ws.send(JSON.stringify({id:++id,method:'Browser.close'}));
}finally{if(ws)ws.close();child.kill();fs.writeFileSync(path.join(out,'browser-stderr.txt'),stderr);}
}
browserTest().catch(e=>{console.log(JSON.stringify({ok:false,out,error:e.message}));process.exitCode=1;});
