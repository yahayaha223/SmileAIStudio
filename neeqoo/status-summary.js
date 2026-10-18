// A read timestamp is not a job update or proof of execution.
export function checkedTime(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value)||!Number.isFinite(Date.parse(value)))return '未確認';
 return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value))+'（日本時間）';
}
export function installStatusSummary({execution,checked,waiting}){
 let lastChecked='未確認',fresh=false,worker=null,hasPending=false,sending=false,unavailable=false,failure='';
 function render(){
  execution.textContent=!fresh?'実作業：現在の接続状態は未確認です。':worker===false?'実作業：実行処理は未接続です。保存済みでも自動実行されません。':worker===true?'実作業：接続情報を取得しました。実行中・完了は各記録で確認してください。':'実作業：実行処理の接続情報を確認できません。';
  checked.textContent='最終読込確認：'+lastChecked+(lastChecked==='未確認'?'。有効な確認日時をまだ取得していません。':fresh?'。作業の更新日時ではありません。':'。前回の情報であり、現在の状態は未確認です。');
  waiting.textContent=unavailable?'保存確認：端末の送信記録を読めないため確認できません。記録を削除せず確認を依頼してください。':sending?'保存確認：送信・再読込みの応答を待っています。':failure?'保存確認：'+failure+(hasPending?' 同じタブの送信記録を保持しています。':' 保存結果はこの接続状態だけでは判断できません。'):hasPending?'保存確認：送信内容と保存一覧の一致が未確認です。同じ指示の再確認・再送を使ってください。':'保存確認：確認待ちの送信記録はこのタブにありません。実作業の完了を示すものではありません。';
 }
 render();
 return {
  checking(){fresh=false;failure='接続を再確認しています。';render();},
  success(state){fresh=true;worker=state.workerConnected;lastChecked=checkedTime(state.diagnostics?.checkedAt);failure='';render();},
  failure(error){fresh=false;failure=error?.status===401?'ログインが必要なため確認できません。':error?.status===403?'アクセス条件を確認できません。':error?.code==='request_timeout'?'通信の待ち時間を超えたため結果は未確認です。':'通信または応答を確認できません。';render();},
  pending(p,inFlight=false,storageUnavailable=false){hasPending=!!p;sending=inFlight;unavailable=storageUnavailable;render();}
 };
}
