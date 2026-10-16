const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const views=['instructions','approvals','jobs','revenue'];
export function route(hash){const [view,id]=String(hash).replace(/^#/,'').split('/');return {view:views.includes(view)?view:'instructions',id:view==='jobs'&&uuid.test(id||'')?id:null};}
export function loginHref(hash){const r=route(hash);return '/auth-local/login.html?returnTo=neeqoo&view='+r.view+(r.id?'&job='+r.id:'');}
function matches(payload,job){return job&&uuid.test(job.id||'')&&job.idempotency_key===payload.key&&job.instruction===payload.instruction&&job.intent===payload.intent&&job.reason===payload.reason&&job.product_id===payload.productId;}
export function requireSavedMatch(payload,state,expectedId){const rows=state?.authentication===true&&Array.isArray(state.Jobs)?state.Jobs.filter(j=>matches(payload,j)):[];if(rows.length!==1||(expectedId&&rows[0].id!==expectedId))throw Error('保存記録を再読込みで確認できません。同じ送信記録を保持しています。再入力しないでください。');return rows[0];}
export async function saveAndReadBack(payload,post,read){const ack=await post(payload);if(!matches(payload,ack))throw Error('保存応答が送信内容と一致しません。同じ送信記録を保持しています。');return requireSavedMatch(payload,await read(),ack.id);}
export function recordStatus(id,state){if(!id)return '';if(!state)return 'この記録は再確認中、または接続未確認です。';return state.Jobs.some(j=>j.id===id)?'この保存記録をサーバーの一覧で確認しました。端末間の照合は未確認です。':'この記録を現在の一覧で確認できません。再保存せず、同じ画面を保持してください。';}
