// Deadline covers both headers and JSON. Abort does not mean the server rolled back.
export async function requestJson(path,options={}, {fetcher=fetch,timeoutMs=15000}={}){
 const controller=new AbortController();let timer;
 try{
  return await Promise.race([
   Promise.resolve().then(async()=>{const response=await fetcher(path,{...options,signal:controller.signal});const data=await response.json();return {response,data};}),
   new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Object.assign(Error('通信の待ち時間を超えました。保存結果は未確認です。'),{code:'request_timeout'}));controller.abort();},timeoutMs);})
  ]);
 }finally{clearTimeout(timer);}
}
