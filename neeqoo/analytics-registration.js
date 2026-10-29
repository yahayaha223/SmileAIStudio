export function installAnalyticsRegistration({root,api,refresh}){
 const d=root.ownerDocument,details=d.createElement('details'),summary=d.createElement('summary'),note=d.createElement('p'),input=d.createElement('input'),button=d.createElement('button'),status=d.createElement('p');
 summary.textContent='実測スナップショットの初回登録';
 note.textContent='取得元・取得日時を確認したJSONファイルだけ登録します。既存データは上書きしません。送信結果が不明な場合は再送せず、保存状態を確認してください。';
 input.type='file';input.accept='.json,application/json';input.setAttribute('aria-label','実測スナップショットJSON');
 button.type='button';button.textContent='確認済みデータを初回登録';status.setAttribute('role','status');
 details.append(summary,note,input,button,status);root.append(details);
 let allowed=false,attempted=false;
 const controls=()=>{input.disabled=!allowed||attempted;button.disabled=!allowed||attempted||!input.files?.length;};
 input.onchange=controls;
 button.onclick=async()=>{
  if(!allowed||attempted)return;const file=input.files?.[0];if(!file)return;
  if(file.size>16384){status.textContent='ファイルが大きすぎます（上限16KB）。';return;}
  let payload;try{payload=JSON.parse(await file.text());}catch{status.textContent='JSONを読み取れません。';return;}
  if(!allowed)return;attempted=true;controls();status.textContent='登録と読取り確認中です。再送しないでください。';
  try{const result=await api('/api/neeqoo/analytics',payload);if(result?.created!==true)throw Error('unverified');status.textContent='初回登録とサーバーでの読取り一致を確認しました。';}
  catch(e){status.textContent=e?.code==='analytics_already_exists'?'既存データがあるため登録しませんでした。上書きはしていません。':e?.code==='invalid_analytics_snapshot'?'入力データが登録形式に合わないため停止しました。':'登録結果は未確認です。再送せず、保存状態を確認してください。';}
  input.value='';try{await refresh();}catch{/* retain outcome message; no retry */}
 };
 controls();
 return {checking(){allowed=false;controls();},success(s){allowed=s?.authentication===true&&!s.analytics;controls();}};
}
