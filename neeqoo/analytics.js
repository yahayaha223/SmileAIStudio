import {checkedTime} from './status-summary.js';
export const metricValue=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?String(value):'unknown（未取得）';
const time=value=>checkedTime(value)==='未確認'?'unknown（未取得）':checkedTime(value);
const rows=value=>Array.isArray(value)?value.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)):[];
const label=value=>typeof value==='string'&&value.trim()?value:'unknown（未取得）';
export function installAnalytics(root){
 const doc=root.ownerDocument;
 const el=(tag,text)=>{const n=doc.createElement(tag);n.textContent=text;return n;};
 const paragraph=(parent,text)=>parent.append(el('p',text));
 function chart(parent,title,rows){
  const block=el('article','');block.append(el('h3',title));
  const max=rows.reduce((max,r)=>Number.isFinite(r.value)&&r.value>=0?Math.max(max,r.value):max,1);
  if(!rows.length)paragraph(block,'unknown（未取得）：グラフのデータがありません。');
  for(const row of rows){
   const line=el('div','');line.className='analytics-row';
   line.append(el('span',row.label+'：'+metricValue(row.value)));
   if(typeof row.value==='number'&&Number.isFinite(row.value)&&row.value>=0){
    const meter=el('meter','');meter.min=0;meter.max=max;meter.value=row.value;meter.setAttribute('aria-label',row.label+' '+row.value+' 表示');line.append(meter);
   }else paragraph(line,'欠測：棒は表示しません');
   block.append(line);
  }
  parent.append(block);
 }
 function unavailable(text='unknown（未取得）：認証済みの解析情報を確認しています。'){root.replaceChildren(el('p',text));}
 unavailable();
 return {checking:unavailable,failure(){unavailable('unknown（未取得）：ログイン・アクセス条件・接続状態を確認してください。');},success(state){
  const s=state?.analytics;
  if(state?.authentication!==true||s?.version!==1||s.mode!=='manual_snapshot'){unavailable('unknown（未取得）：解析スナップショットは取得できません。');return;}
  root.replaceChildren();
  paragraph(root,'日時付きスナップショット / 自動連携なし。画面の再読込みでは提供元の実績は更新されません。');
  const p=s.pinterest||{},nine=p.originalNine||{},sales=s.sales||{},regular=s.regularPosts||{};
  paragraph(root,'Pinterest 最終取得：'+time(p.capturedAt)+' ／ Metricool brand '+(p.brandId??'unknown'));
  paragraph(root,'提供側のデータ鮮度：unknown。勝者・商品失敗は、まだ判定できません。');
  const funnel=el('article','');funnel.append(el('h3','元9実験ピン：集客から購入へ'));
  const list=el('ol','');list.className='analytics-flow';
  for(const [label,value] of [['表示',nine.views],['保存',nine.saves],['ピンクリック',nine.pinClicks],['外部クリック',nine.outboundClicks],['投稿に帰属する購入',sales.attributedPurchases]])list.append(el('li',label+'：'+metricValue(value)));
  funnel.append(list);paragraph(funnel,'保存は独立した反応指標です。この順序は導線の目安で、同じ人の移動や購入との紐付けを示しません。');root.append(funnel);
  chart(root,'A / B / C 比較（元9ピン・表示数）',rows(nine.variants).map(r=>({label:label(r.label),value:r.views})));
  chart(root,'日別推移（表示数）',rows(p.daily?.rows).map(r=>({label:label(r.date),value:r.views})));
  paragraph(root,'日別は元9ピンとは集計範囲が異なります。日別合計と元9ピンの表示数は合算しません。日付は提供元の日別ラベルです。');
  const daily=el('details','');daily.append(el('summary','日別の保存・クリックを確認'));
  for(const row of rows(p.daily?.rows))paragraph(daily,label(row.date)+' ／ 保存 '+metricValue(row.saves)+' ／ ピンクリック '+metricValue(row.pinClicks)+' ／ 外部クリック '+metricValue(row.outboundClicks));
  root.append(daily);
  const money=el('article','');money.append(el('h3','購入・売上の確認（投稿への帰属とは別）'));
  paragraph(money,'SUZURI 最終確認：'+time(sales.capturedAt)+'。この時点の販売画面の記録です。現在の新しい取得値ではありません。');
  paragraph(money,'販売行：'+metricValue(sales.salesRows)+' ／ 累積トリブン：'+metricValue(sales.cumulativeToribunJpy)+' 円');
  paragraph(money,'売上金額：'+metricValue(sales.salesJpy)+' ／ 純利益：'+metricValue(sales.profitJpy)+'（費用未照合）');
  paragraph(money,'販売行・トリブン・売上金額は別指標です。購入がどの投稿によるものかは unknown。');root.append(money);
  const normal=el('article','');normal.append(el('h3','通常投稿（元9実験ピンと分離）'));
  paragraph(normal,'確認：'+time(regular.capturedAt)+' ／ 公開 '+metricValue(regular.published)+' 件・予約 '+metricValue(regular.scheduled)+' 件');
  paragraph(normal,'予約日時：'+time(regular.scheduledFor)+'。予約後に公開されたかは unknown。');
  paragraph(normal,'表示 '+metricValue(regular.views)+' ／ 保存 '+metricValue(regular.saves)+' ／ ピンクリック '+metricValue(regular.pinClicks)+' ／ 外部クリック '+metricValue(regular.outboundClicks));root.append(normal);
 }};
}

