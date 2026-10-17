// Only allowlisted metadata is displayed/copied. No storage or network writes.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function diagnosticReport(state,id){
 const d=state?.diagnostics;
 if(state?.authentication!==true||!Array.isArray(state.Jobs)||!d||typeof d.keyExists!=='boolean'||!Number.isFinite(Date.parse(d.checkedAt)))throw Error('diagnostic_unavailable');
 const counts={};for(const k of ['Jobs','Approvals','Audit','Orders']){const n=d.counts?.[k];if(d.keyExists?(!Number.isSafeInteger(n)||n<0):n!==null)throw Error('diagnostic_invalid');counts[k]=n;}
 if(d.keyExists?(!Number.isSafeInteger(d.revision)||d.revision<0):d.revision!==null)throw Error('diagnostic_invalid');
 if(d.keyExists&&counts.Jobs!==state.Jobs.length)throw Error('diagnostic_invalid');
 const selected=uuid.test(id||'');const found=selected&&d.keyExists?state.Jobs.some(j=>j.id===id):null;
 const status=!d.keyExists?'key_absent':selected&&!found?'record_absent':counts.Jobs===0?'empty':'read_ok';
 return {status,checkedAt:new Date(d.checkedAt).toISOString(),release:/^[0-9a-f]{40}$/i.test(d.release||'')?d.release:null,keyExists:d.keyExists,revision:d.revision,counts,selectedRecordExists:selected?(d.keyExists?found:false):null};
}
export function diagnosticFailure(error){return {status:error?.status===401?'login_required':error?.status===403?'access_denied':error?.status===503&&['persistent_store_unavailable','persistent_state_invalid','etag_missing'].includes(error.code)?'store_error':'unverified',checkedAt:new Date().toISOString(),release:null,keyExists:null,revision:null,counts:null,selectedRecordExists:null};}
export function diagnosticText(r){return ({checking:'保存状態を確認中です。',key_absent:'保存キーがありません。以前の保存記録の有無は確認できません。再入力・再保存はせず、この診断を確認してください。',empty:'保存キーは存在し、正常に読み取れました。指示は0件です。',record_absent:'保存キーは読み取れましたが、選択した記録がありません。再保存せず、この診断を確認してください。',read_ok:'保存先を読み取りました。',store_error:'保存先の読み取りで障害を検出しました。空のデータとしては扱いません。',login_required:'保存状態の確認には本人ログインが必要です。',access_denied:'保存状態を読む権限を確認できません。',unverified:'保存状態は未確認です。接続または診断応答を確認できません。'})[r.status]||'保存状態は未確認です。';}
export function installDiagnostics({root,button,output,clipboard}){
 let report=null;
 function show(next){report=next;root.textContent=diagnosticText(next||{status:'checking'})+(next?' 確認日時: '+next.checkedAt+' / 公開版: '+(next.release||'未確認')+' / 更新番号: '+(next.revision??'未確認')+' / 指示件数: '+(next.counts?.Jobs??'未確認')+' / 選択記録: '+(next.selectedRecordExists===null?'未指定・未確認':next.selectedRecordExists?'あり':'なし'):'');button.disabled=!next;output.hidden=true;output.value='';}
 button.onclick=async()=>{if(!report)return;const captured=report,text=JSON.stringify(captured,null,2);try{await clipboard.writeText(text);if(report===captured)root.textContent+=' 診断をコピーしました。';}catch{if(report!==captured)return;output.value=text;output.hidden=false;output.focus();output.select();}};
 return {checking(){show(null);},success(state,id){try{show(diagnosticReport(state,id));}catch{show(diagnosticFailure(null));}},failure(error){show(diagnosticFailure(error));}};
}
