import {installReauthentication} from './reauth.js';
installReauthentication();
import { propose } from './planner.js';
const labels={queued:'待機中',awaiting_approval:'承認待ち',running:'実行中',blocked:'保留・未接続',succeeded:'ローカル処理完了',rejected:'却下'};
const intents={report:'ローカル状況集計',review_design:'デザイン品質確認',research:'市場調査',publish:'商品公開',post:'集客投稿',price_change:'価格変更',purchase:'実購入・支出',contract:'有料契約',credentials:'認証・権限変更'};
const message=document.querySelector('#message');let submitting=false;let retryPayload=null;
function el(tag,text){const n=document.createElement(tag);n.textContent=text;return n;}
document.querySelector('#make-plan').onclick=()=>{
 const input=document.querySelector('#natural-instruction');const plan=propose(input.value);input.value='';
 const root=document.querySelector('#plan-preview');root.replaceChildren(el('p',plan.message));
 document.querySelector('[name=intent]').value='';
 for(const intent of plan.candidates){const b=el('button',`${intents[intent]} — ${intent==='report'?'ローカル集計のみ':'承認が必要'}`);b.type='button';b.onclick=()=>{document.querySelector('[name=intent]').value=intent;document.querySelector('[data-view=instructions]').click();message.textContent=`実行案：${intents[intent]}。外部実行なし。下の内容を確認して登録してください。`;};root.append(b);}
};
async function api(path,body){const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('smile_studio_csrf='))?.slice('smile_studio_csrf='.length)||'')},body:JSON.stringify(body)}:{cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(r.status===401?'共通入口でログイン／再認証してください。':r.status===503?'接続準備中または保存を確認できません。同じ指示を再送して照合できます。':data.error||'通信失敗');return data;}
function cards(target,items,render,empty){const root=document.querySelector(target);root.replaceChildren();if(!items.length)root.append(el('p',empty));for(const item of items)root.append(render(item));}
async function refresh(){const s=await api('/api/neeqoo/state');
 cards('#job-list',[...s.Jobs].reverse(),j=>{const c=el('article','');c.append(el('h3',intents[j.intent]),el('strong',labels[j.status]),el('p',j.result||'未実行'),el('small',`${j.created_at} / 試行 ${j.attempts} / 記録費用 ${j.cost_jpy===null?'未確定':j.cost_jpy+'円'}`));return c;},'まだ指示はありません。');
 cards('#approval-list',s.Approvals.filter(a=>a.status==='pending'),a=>{const j=s.Jobs.find(j=>j.id===a.job_id);const c=el('article','');c.append(el('h3',intents[j.intent]),el('p',a.scope),el('p',`対象：${s.Products.find(p=>p.id===j.product_id).name} ／ 期限：${a.expires_at}`));for(const [decision,label] of [['approved','承認を記録'],['rejected','却下を記録']]){const b=el('button',label);b.disabled=Date.parse(a.expires_at)<Date.now();b.onclick=async()=>{b.disabled=true;try{await api(`/api/neeqoo/approvals/${a.id}`,{decision});message.textContent='判断を記録しました。';await refresh();}catch(e){message.textContent=e.message;b.disabled=false;}};c.append(b);}return c;},'承認待ちはありません。');
 cards('#audit-list',[...s.Audit].reverse().slice(0,30),a=>{const c=el('article','');c.append(el('small',a.at),el('p',`${a.action} / ${a.reason} / ${a.result}`));return c;},'履歴はありません。');
}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('main section').forEach(s=>s.hidden=s.id!==b.dataset.view);document.querySelectorAll('nav button').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));});
document.querySelector('#instruction-form').onsubmit=async e=>{e.preventDefault();if(submitting)return;submitting=true;const b=e.target.querySelector('button');b.disabled=true;try{const fields=Object.fromEntries(new FormData(e.target));if(!retryPayload||Object.keys(fields).some(k=>retryPayload[k]!==fields[k]))retryPayload={...fields,key:crypto.randomUUID()};await api('/api/neeqoo/jobs',retryPayload);retryPayload=null;message.textContent='指示を保存しました。外部実行は行っていません。';await refresh();}catch(e){message.textContent=e.message+' 再送時は同じ重複防止キーを使います。';}finally{submitting=false;b.disabled=false;}};
refresh().catch(()=>message.textContent='サーバーに接続できません。');setInterval(()=>{if(!document.hidden)refresh().catch(()=>message.textContent='接続確認が必要です。');},60000);
