// Consent is explicit; never enable draft retention merely because auth expired.
export function allowLoginNavigation({hasInput,getPending,retention,ask}){
 try{if(getPending())return true;}catch{return ask('送信記録を確認できません。移動すると入力を失う場合があります。保持を確認できないまま移動しますか？');}
 if(!hasInput)return true;
 if(retention?.isEnabled()){
  if(retention.persist())return true;
 }else if(ask('ログイン前に、未送信下書きをこのタブ内だけに一時保持しますか？ 原文・分類・理由を最終編集から30分保持します。キャンセルすると保持しません。')){
  if(retention?.retainForLogin())return true;
 }else{
  return ask('下書きを保持しないため、移動すると入力が失われる場合があります。保持せず移動しますか？');
 }
 return ask('下書きの書込み成功を確認できません。移動すると入力が失われる場合があります。それでも移動しますか？');
}

export function installLoginNavigation({document,getState,ask}){
 document.querySelectorAll('[data-neeqoo-login],a[href="/index.html"]').forEach(link=>link.addEventListener('click',e=>{
  const state=getState();
  if(!allowLoginNavigation({...state,ask})){e.preventDefault();return;}
  // Only this explicitly confirmed same-tab departure may skip the generic warning.
  if(!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey&&(!link.target||link.target==='_self'))state.retention?.confirmDeparture();
 }));
}
