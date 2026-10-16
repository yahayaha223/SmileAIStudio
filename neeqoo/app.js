import {route,loginHref,requireSavedMatch,saveAndReadBack,recordStatus} from './save-receipt.js';
import {createConnectionState,installDraftRetention} from './return-state.js';
import {propose} from './planner.js';
import {installReauthentication} from './reauth.js';
import {createPendingStore,validInstruction,instructionText} from './pending-instruction.js';
installReauthentication();
const labels={queued:'待機中',awaiting_approval:'承認待ち',running:'実行中',blocked:'保留・未接続',succeeded:'ローカル処理完了',rejected:'却下'};
const intents={report:'状況集計',review_design:'デザイン品質確認',research:'市場調査',publish:'商品公開',post:'集客投稿',price_change:'価格変更',purchase:'実購入・支出',contract:'有料契約',credentials:'認証・権限変更'};
const reasons={operations:'運用確認',quality:'品質確認',growth:'販売改善',verification:'動作検証'};
const message=document.querySelector('#message'),form=document.querySelector('#instruction-form');
const input=document.querySelector('#natural-instruction'),review=document.querySelector('#submission-review');
const pendingPanel=document.querySelector('#pending-instruction'),pendingBody=document.querySelector('#pending-body');
const sendButton=document.querySelector('#confirm-submit'),retryButton=document.querySelector('#retry-submit');
let draftRetention;
let selected=route(location.hash);
let lastRecordId=selected.id;try{lastRecordId=lastRecordId||route("#jobs/"+sessionStorage.getItem("neeqoo.last-record-id")).id;}catch{};
const recordMessage=document.querySelector('#record-status');
let focusRecord=!!selected.id;
function focusSavedRecord(){if(!focusRecord||selected.view!=='jobs'||!selected.id)return;const card=document.getElementById('job-'+selected.id);if(card){card.focus({preventScroll:true});card.scrollIntoView({block:'nearest'});focusRecord=false;}}
const connection=createConnectionState((text,fresh)=>{document.querySelector('#connection-status').textContent=text;if(!fresh){recordMessage.textContent=recordStatus(lastRecordId,null);if(message.textContent.startsWith('保存後の再読込み'))message.textContent='保存後の記録を再確認しています。現在の確認結果は下の記録欄をご覧ください。';}for(const id of ['#job-list','#approval-list','#audit-list'])document.querySelector(id).hidden=!fresh;});
let pendingStore,reviewed=null,sending=false,storageFailed=false;
function el(tag,text){const n=document.createElement(tag);n.textContent=text;return n;}
function current(){return Object.fromEntries(new FormData(form));}
function summary(root,payload){root.replaceChildren(instructionText(document,payload),el('p',`分類：${intents[payload.intent]||payload.intent} ／ 理由：${reasons[payload.reason]||payload.reason} ／ 対象：ラッコのマグカップ`));}
function storageError(){storageFailed=true;message.textContent='端末内の送信記録を確認できないため送信を停止しました。同じタブの記録を削除せず、保存状況の確認を依頼してください。';}
function pending(){try{return pendingStore?.read()||null;}catch{storageError();return null;}}
function updateControls(){const p=pending();const locked=storageFailed||sending||!!p;for(const n of [...form.elements,input,document.querySelector('#make-plan')])n.disabled=locked;document.querySelector('#retain-draft').disabled=locked;sendButton.disabled=locked;retryButton.disabled=storageFailed||sending;pendingPanel.hidden=!p;if(p){summary(pendingBody,p);review.hidden=true;}return p;}
try{pendingStore=createPendingStore(window.sessionStorage);pendingStore.read();}catch{storageError();}
document.querySelector('#make-plan').onclick=()=>{const plan=propose(input.value),root=document.querySelector('#plan-preview');root.replaceChildren(el('p',plan.message));form.elements.intent.value='';review.hidden=true;reviewed=null;for(const intent of plan.candidates){const b=el('button',intents[intent]);b.type='button';b.onclick=()=>{form.elements.intent.value=intent;reviewed=null;review.hidden=true;document.querySelector('[data-view=instructions]').click();};root.append(b);}};
async function api(path,body){const headers={'Content-Type':'application/json','X-CSRF-Token':decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('smile_studio_csrf='))?.slice('smile_studio_csrf='.length)||'')};const r=await fetch(path,{cache:'no-store',credentials:'same-origin',...(body?{method:'POST',headers,body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Object.assign(Error(r.status===401?'ログイン／パスキー再認証を確認してください。':r.status===503?'接続準備中、または保存結果を確認できません。':'保存できませんでした。内容と接続状態を確認してください。'),{status:r.status});return data;}
function cards(target,items,render,empty){const root=document.querySelector(target);root.replaceChildren();if(!items.length)root.append(el('p',empty));for(const item of items)root.append(render(item));}
function confirmed(job){if(!pendingStore.confirm(job))return;draftRetention?.clear();reviewed=null;review.hidden=true;form.reset();input.value='';document.querySelector('#plan-preview').replaceChildren();message.textContent='保存後の再読込みで指示の一致を確認しました。外部実行は行っていません。';selectView('jobs',job.id);updateControls();}
async function refresh(){const token=connection.begin();try{const s=await api('/api/neeqoo/state');if(s?.authentication!==true||!['Jobs','Approvals','Audit','Products'].every(k=>Array.isArray(s[k])))throw Error('invalid_state_response');if(!connection.success(token))return;const p=pending();if(p&&!sending&&!storageFailed){const saved=s.Jobs.find(j=>j.idempotency_key===p.key);if(saved)confirmed(requireSavedMatch(p,s));}
 cards('#job-list',[...s.Jobs].reverse(),j=>{const c=el('article','');c.id='job-'+j.id;c.tabIndex=-1;c.append(el('h3',intents[j.intent]),el('strong',labels[j.status]),instructionText(document,j),el('p',`理由：${reasons[j.reason]||j.reason}`),el('p',j.result||'未実行'),el('small',`${j.created_at} / 試行 ${j.attempts} / 記録費用 ${j.cost_jpy===null?'未確認':j.cost_jpy+'円'}`));return c;},'まだ指示はありません。');
 cards('#approval-list',s.Approvals.filter(a=>a.status==='pending'),a=>{const j=s.Jobs.find(j=>j.id===a.job_id),c=el('article','');c.append(el('h3',intents[j.intent]),instructionText(document,j),el('p',`理由：${reasons[j.reason]||j.reason}`),el('p',a.scope),el('p',`対象：${s.Products.find(p=>p.id===j.product_id).name} ／ 期限：${a.expires_at}`));for(const [decision,label] of [['approved','承認を記録'],['rejected','却下を記録']]){const b=el('button',label);b.disabled=Date.parse(a.expires_at)<Date.now();b.onclick=async()=>{b.disabled=true;try{await api(`/api/neeqoo/approvals/${a.id}`,{decision});message.textContent='判断を記録しました。';await refresh();}catch(e){message.textContent=e.message;b.disabled=false;}};c.append(b);}return c;},'承認待ちはありません。');
 cards('#audit-list',[...s.Audit].reverse().slice(0,30),a=>{const c=el('article','');c.append(el('small',a.at),el('p',`${a.action} / ${a.reason} / ${a.result}`));return c;},'履歴はありません。');
recordMessage.textContent=recordStatus(lastRecordId,s);focusSavedRecord();if(lastRecordId&&!s.Jobs.some(j=>j.id===lastRecordId))message.textContent='以前の保存記録を再確認できません。再入力・新規保存はせず、同じ画面を保持してください。';
}catch(e){connection.failure(token,e.status);throw e;}
}
function selectView(view,id=null){selected=route('#'+view+(id?'/'+id:''));focusRecord=selected.view==='jobs'&&!!selected.id;if(selected.id){lastRecordId=selected.id;try{sessionStorage.setItem("neeqoo.last-record-id",lastRecordId);}catch{}};history.replaceState(null,'','#'+selected.view+(selected.id?'/'+selected.id:''));document.querySelectorAll('main section').forEach(s=>s.hidden=s.id!==selected.view);document.querySelectorAll('nav button').forEach(n=>n.setAttribute('aria-pressed',String(n.dataset.view===selected.view)));document.querySelectorAll('[data-neeqoo-login]').forEach(a=>a.href=loginHref(location.hash));const link=document.querySelector('#saved-record-link');link.hidden=!lastRecordId;link.href='/neeqoo/#jobs/'+(lastRecordId||'');recordMessage.textContent=recordStatus(lastRecordId,null);focusSavedRecord();}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>selectView(b.dataset.view,b.dataset.view==='jobs'?lastRecordId:null));
window.addEventListener('hashchange',()=>{const r=route(location.hash);selectView(r.view,r.id);void refresh().catch(()=>{});});
selectView(selected.view,selected.id);
function cancelReview(){reviewed=null;review.hidden=true;}
form.addEventListener('input',cancelReview);input.addEventListener('input',cancelReview);
document.querySelector('#edit-instruction').onclick=()=>{cancelReview();input.focus();};
form.onsubmit=e=>{e.preventDefault();if(sending||storageFailed||pending())return;const fields=current();if(!validInstruction(fields.instruction)){message.textContent='元の指示を1〜2,000文字で入力してください。';return;}reviewed=fields;summary(document.querySelector('#review-body'),fields);review.hidden=false;message.textContent='原文・分類・理由を確認し、保存する場合だけ下のボタンを押してください。';};
async function send(payload){if(sending||storageFailed)return;sending=true;updateControls();try{const job=await saveAndReadBack(payload,p=>api('/api/neeqoo/jobs',p),()=>api('/api/neeqoo/state'));confirmed(job);}catch(e){message.textContent=e.message+' 結果未確認の記録を保持しています。同じタブで再読込みするか、同じ指示を再確認・再送してください。';}finally{sending=false;updateControls();}try{await refresh();}catch{/* Keep the pending record until a matching server record is confirmed. */}}
sendButton.onclick=()=>{if(!reviewed||sending||storageFailed)return;const fields=current();if(JSON.stringify(fields)!==JSON.stringify(reviewed)){cancelReview();message.textContent='内容が変わりました。もう一度確認してください。';return;}let payload;try{payload=pendingStore.begin(reviewed);}catch{storageError();updateControls();return;}void send(payload);};
retryButton.onclick=()=>{const p=pending();if(p&&!storageFailed)void send(p);};
updateControls();
try{draftRetention=installDraftRetention({form,input,checkbox:document.querySelector('#retain-draft'),status:document.querySelector('#draft-status'),storage:window.sessionStorage,getPending:pending});}catch{document.querySelector('#draft-status').textContent='下書き保持は利用できません。入力したままタブを閉じないでください。';}
if(pending())message.textContent='前回の保存結果を確認します。未確認なら同じ記録の再送ボタンを使ってください。';
const checkConnection=()=>{void refresh().catch(()=>{});};
document.addEventListener('visibilitychange',()=>{if(document.hidden){draftRetention?.persist();connection.begin();}else checkConnection();});
window.addEventListener('pageshow',checkConnection);
window.addEventListener('pagehide',()=>{draftRetention?.persist();connection.begin();});
checkConnection();
setInterval(()=>{if(!document.hidden)checkConnection();},60000);
