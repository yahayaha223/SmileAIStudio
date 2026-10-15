// Reuses existing server step-up endpoints; never approves a job automatically.
export function decode(value){const s=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(s,c=>c.charCodeAt(0)).buffer;}
export function encode(value){return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export async function reauthenticate({fetcher=fetch,credentials=navigator.credentials}={}){
 const call=async(path,body,csrf)=>{const r=await fetcher('/api/auth/'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok||d.ok!==true)throw Error('再認証を完了できませんでした。');return d;};
 const session=await call('session');
 if(!session.authenticated||session.purpose!=='full'||!session.csrfToken)throw Error('先に既存のログイン画面でログインしてください。');
 const {options}=await call('passkey/step-up/options',{},session.csrfToken);
 const publicKey={...options,challenge:decode(options.challenge),allowCredentials:(options.allowCredentials||[]).map(c=>({...c,id:decode(c.id)}))};
 const cred=await credentials.get({publicKey});if(!cred)throw Error('再認証をキャンセルしました。');
 const r=cred.response,credential={id:cred.id,rawId:encode(cred.rawId),type:cred.type,authenticatorAttachment:cred.authenticatorAttachment||undefined,clientExtensionResults:cred.getClientExtensionResults?.()||{},response:{clientDataJSON:encode(r.clientDataJSON),authenticatorData:encode(r.authenticatorData),signature:encode(r.signature),userHandle:r.userHandle?encode(r.userHandle):null}};
 await call('passkey/step-up/verify',{credential},session.csrfToken);
 const checked=await call('session');if(!checked.authenticated||checked.purpose!=='full'||!(checked.stepUpRemainingSec>0))throw Error('再認証状態を確認できませんでした。');
}
export function installReauthentication(){const root=document.querySelector('#approvals');const b=document.createElement('button');b.type='button';b.textContent='承認前にパスキーで再認証';root.prepend(b);b.onclick=async()=>{b.disabled=true;const message=document.querySelector('#message');try{await reauthenticate();message.textContent='再認証しました。対象を確認して承認または却下を押してください。';}catch{message.textContent='再認証できませんでした。既存ログイン画面でログイン後、再認証ボタンを押してください。';}finally{b.disabled=false;}};}
