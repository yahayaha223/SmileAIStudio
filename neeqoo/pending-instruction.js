// Same-tab reload recovery. No automatic send; storage must succeed before POST.
const storageKey='neeqoo.pending-instruction.v1';
const fields=['intent','reason','productId','instruction'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validInstruction(text){return typeof text==='string'&&text.trim().length>0&&text.length<=2000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);}
function valid(payload){return payload&&typeof payload==='object'&&!Array.isArray(payload)&&Object.keys(payload).length===5&&fields.every(k=>typeof payload[k]==='string')&&validInstruction(payload.instruction)&&uuid.test(payload.key||'');}
function same(a,b){return fields.every(k=>a[k]===b[k]);}
export function createPendingStore(storage,newKey=()=>crypto.randomUUID()){
 function read(){const raw=storage.getItem(storageKey);if(raw===null)return null;const record=JSON.parse(raw);if(record?.version!==1||!valid(record.payload))throw Error('pending_record_invalid');return record.payload;}
 return {
  read,
  begin(input){const existing=read();if(existing){if(!same(existing,input))throw Error('pending_instruction_exists');return existing;}
   const payload={...input,key:newKey()};if(!valid(payload))throw Error('invalid_instruction');
   const raw=JSON.stringify({version:1,payload});storage.setItem(storageKey,raw);if(storage.getItem(storageKey)!==raw)throw Error('pending_storage_unavailable');return payload;
  },
  confirm(job){const pending=read();if(!pending)return false;
   if(!job||!uuid.test(job.id||'')||job.idempotency_key!==pending.key||!same(pending,{...job,productId:job.product_id}))throw Error('save_not_confirmed');
   storage.removeItem(storageKey);if(storage.getItem(storageKey)!==null)throw Error('pending_cleanup_failed');return true;
  }
 };
}
export function instructionText(document,job){const node=document.createElement('p');node.style.whiteSpace='pre-wrap';node.textContent=job.instruction??'旧記録：元の指示文は保存されていません。';return node;}
