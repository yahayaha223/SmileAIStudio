// Classification runs only in the browser. Confirmed instructions may be saved as data; never executed.
export function propose(text) {
  if(typeof text!=='string'||!text.trim()||text.length>2000)return {status:'needs_clarification',message:'1〜2,000文字で目的を入力してください。',candidates:[]};
  const rules=[['credentials',/認証|権限|パスワード|トークン|API.?キー/i],['purchase',/購入|決済|広告|支出|支払/],['contract',/契約|有料|課金/],['price_change',/価格|値上|値下|値段/],['publish',/公開|出品/],['post',/投稿|ピン|Pinterest/i],['review_design',/デザイン|品質|作品|承認/],['research',/調査|市場|競合|調べ/],['report',/集計|状況|売上|利益|進捗|レポート/]];
  const candidates=rules.filter(([,r])=>r.test(text)).map(([intent])=>intent);
  if(!candidates.length)return {status:'needs_clarification',message:'目的を分類できません。下の実施内容を選ぶか、指示を具体化してください。',candidates:[]};
  return {status:'draft',message:'候補を作成しました。対象・実施内容・理由を確認してから登録してください。複数の目的は1件ずつ登録します。',candidates};
}
