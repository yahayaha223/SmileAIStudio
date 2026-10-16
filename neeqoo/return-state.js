// Optional same-tab drafts only. Never localStorage, credentials, or automatic POST.
const draftKey='neeqoo.optional-draft.v1';
const fields=['instruction','intent','reason','productId'];
const ttl=30*60*1000;
function valid(p){return p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===4&&fields.every(k=>typeof p[k]==='string')&&p.instruction.length<=2000&&p.intent.length<=32&&p.reason.length<=32&&p.productId==='otter-mug';}
export function createDraftStore(storage,now=Date.now){
 function clear(){storage.removeItem(draftKey);if(storage.getItem(draftKey)!==null)throw Error('draft_cleanup_failed');}
 function readRecord(){const raw=storage.getItem(draftKey);if(raw===null)return null;const r=JSON.parse(raw);if(r?.version!==1||!Number.isFinite(r.expires)||!valid(r.payload))throw Error('draft_invalid');const editedAt=r.editedAt??r.expires-ttl;if(!Number.isFinite(editedAt)||r.expires!==editedAt+ttl)throw Error('draft_invalid');if(r.expires<=now()||editedAt>now()){clear();return null;}return {...r,editedAt};}
 return {clear,readRecord,read(){return readRecord()?.payload??null;},write(payload,editedAt=now()){if(!valid(payload)||!Number.isFinite(editedAt)||editedAt>now())throw Error('draft_invalid');if(editedAt+ttl<=now()){clear();return false;}const raw=JSON.stringify({version:1,editedAt,expires:editedAt+ttl,payload});storage.setItem(draftKey,raw);if(storage.getItem(draftKey)!==raw)throw Error('draft_write_failed');return true;}};
}
export function connectionText(status){return status===401?'ログインが必要です。入力を保ったまま、同じブラウザーでログインしてください。':status===403?'アクセス条件を確認できません。再ログイン後も続く場合は確認を依頼してください。':status===503?'サーバー接続は準備中、または一時的に利用できません。':'接続を確認できません。表示データを最新として扱わないでください。';}
export function createConnectionState(render){let epoch=0;return {begin(){const token=++epoch;render('接続を確認中です。指示の保存成功を示すものではありません。',false);return token;},success(token){if(token!==epoch)return false;render('認証済みの管理データを読み込みました。新しい指示の保存は別途確認します。',true);return true;},failure(token,status){if(token!==epoch)return false;render(connectionText(status),false);return true;}};}
export function installDraftRetention({form,input,checkbox,status,storage,getPending,now=Date.now}){
 const store=createDraftStore(storage,now);
 const current=()=>Object.fromEntries(new FormData(form));
 let editedAt=now();
 const error=()=>{status.textContent='タブ内の下書き保持・消去を確認できません。入力は画面に残しています。タブを閉じず確認を依頼してください。';};
 try{const record=store.readRecord(),saved=record?.payload;if(saved&&!getPending()){editedAt=record.editedAt;input.value=saved.instruction;form.elements.intent.value=saved.intent;form.elements.reason.value=saved.reason;form.elements.productId.value=saved.productId;checkbox.checked=true;status.textContent='このタブの未送信下書きを復元しました。サーバーには保存していません。';}}catch{error();}
 function persist(){if(!checkbox.checked||getPending())return;try{if(!store.write(current(),editedAt)){status.textContent="下書きの復元期限が切れたためタブ内記録を削除しました。画面の入力は残しています。編集するまで保持を再開しません。";return;}status.textContent='このタブ内で未送信下書きを保持中です（復元期限：最終編集から30分）。サーバーには保存していません。';}catch{error();}}
 checkbox.addEventListener('change',()=>{if(checkbox.checked)persist();else try{store.clear();status.textContent='下書きのタブ内保持を解除しました。画面を離れると入力を失う場合があります。';}catch{checkbox.checked=true;error();}});
 const signature=p=>JSON.stringify(fields.map(k=>p[k]));
 let lastPayload=signature({productId:form.elements.productId.value,intent:form.elements.intent.value,reason:form.elements.reason.value,instruction:input.value});
 function onEdit(){if(getPending())return;const next=signature(current());if(next!==lastPayload){editedAt=now();lastPayload=next;}persist();}
 form.addEventListener('input',onEdit);input.addEventListener('input',onEdit);
 // Page exit is best effort on mobile; never promise retention after closing a tab.
 const onExit=e=>{persist();if(input.value&&!getPending()){e.preventDefault();e.returnValue='';}};
 window.addEventListener('beforeunload',onExit);
 return {persist,clear(){try{store.clear();checkbox.checked=false;status.textContent='未送信下書きの保持を解除しました。';}catch{error();}}};
}
