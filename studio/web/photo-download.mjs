import {downloadByteLimit,downloadFilename} from './gallery-download.mjs';

const wait=(milliseconds,signal)=>new Promise((resolve,reject)=>{
 signal?.throwIfAborted();
 const abort=()=>{clearTimeout(timer);reject(signal.reason);};
 const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},milliseconds);
 signal?.addEventListener('abort',abort,{once:true});
});

// Fetching the file keeps expired sessions and server errors inside the gallery.
// A normal download link can otherwise replace the whole page with JSON.
export async function fetchPhotoDownload(albumId,photoId,{privateGallery=true,signal,onProgress=()=>{},onWaiting=()=>{},fetchImpl=fetch,maxBytes=downloadByteLimit}={}){
 const url=`/api/${privateGallery?'gallery':'albums'}/${encodeURIComponent(albumId)}/photos/${encodeURIComponent(photoId)}/download`;
 let response;
 for(let attempt=0;;attempt++){
  signal?.throwIfAborted();
  response=await fetchImpl(url,{method:'GET',credentials:'same-origin',cache:'no-store',signal});
  const seconds=Number(response.headers.get('retry-after'));
  if(response.status!==429||attempt>=2||!Number.isFinite(seconds)||seconds<=0||seconds>30)break;
  await response.body?.cancel();onWaiting();await wait(seconds*1000,signal);
 }
 if(!response.ok){
  let data;try{data=await response.json();}catch{}
  throw Object.assign(Error(typeof data?.error==='string'?data.error:'Chưa tải được ảnh. Vui lòng thử lại.'),{status:response.status});
 }
 const type=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
 if(type!=='image/jpeg'){await response.body?.cancel();throw Error('Tệp tải xuống không đúng định dạng JPG. Vui lòng thử lại.');}
 const declared=Number(response.headers.get('content-length'))||0;
 const tooLarge=()=>Object.assign(Error('Tệp ảnh quá lớn để tải xuống. Vui lòng liên hệ nhiếp ảnh gia.'),{status:413});
 if(declared>maxBytes){await response.body?.cancel();throw tooLarge();}
 if(!response.body?.getReader)throw Error('Trình duyệt chưa hỗ trợ tải ảnh. Hãy thử bằng Safari hoặc Chrome phiên bản mới.');
 const reader=response.body.getReader(),chunks=[];
 let received=0,finished=false;
 const aborted=()=>{reader.cancel(signal.reason).catch(()=>{});};
 signal?.addEventListener('abort',aborted,{once:true});
 try{
  while(true){
   signal?.throwIfAborted();
   const {done,value}=await reader.read();
   if(done)break;
   received+=value.byteLength;if(received>maxBytes)throw tooLarge();
   chunks.push(value);onProgress(received,declared);
  }
  signal?.throwIfAborted();
  if(!received)throw Error('Tệp tải xuống trống. Vui lòng thử lại.');
  if(declared&&received!==declared)throw Error('Tệp tải xuống chưa đầy đủ. Vui lòng thử lại.');
  const blob=new Blob(chunks,{type}),signature=new Uint8Array(await blob.slice(0,3).arrayBuffer());
  if(signature[0]!==255||signature[1]!==216||signature[2]!==255)throw Error('Tệp tải xuống không đúng định dạng JPG. Vui lòng thử lại.');
  signal?.throwIfAborted();finished=true;
  return {blob,filename:downloadFilename(response.headers.get('content-disposition'),type)};
 }finally{
  signal?.removeEventListener('abort',aborted);
  if(!finished)await reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
}

export function createPhotoDownloads({onExpired=()=>{},onState=()=>{},fetchImpl=fetch,saveFile,windowImpl=globalThis.window,documentImpl=globalThis.document,urlImpl=URL,timeout=180000}={}){
 let active=null,disposed=false;
 const urls=new Map();
 const emit=state=>{if(!disposed)onState(state);};
 const revoke=url=>{clearTimeout(urls.get(url));urls.delete(url);urlImpl.revokeObjectURL(url);};
 const close=()=>active?.abort();
 const pagehide=()=>{close();for(const url of urls.keys())revoke(url);};
 windowImpl?.addEventListener('pagehide',pagehide);
 const save=saveFile||(({blob,filename})=>{
  for(const url of urls.keys())revoke(url);
  const url=urlImpl.createObjectURL(blob),link=documentImpl.createElement('a');
  urls.set(url,setTimeout(()=>revoke(url),60000));
  link.href=url;link.download=filename;link.hidden=true;documentImpl.body.append(link);
  try{link.click();}finally{link.remove();}
 });
 const download=async({albumId,photoId,privateGallery=true})=>{
  if(disposed||active)return false;
  const controller=new AbortController();active=controller;
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeout);
  emit({phase:'preparing',message:'Đang chuẩn bị ảnh JPG…'});
  try{
   const result=await fetchPhotoDownload(albumId,photoId,{privateGallery,fetchImpl,signal:controller.signal,
    onWaiting:()=>emit({phase:'waiting',message:'Máy chủ đang chuẩn bị ảnh. Sẽ thử lại sau ít giây.'}),
    onProgress:(received,total)=>emit({phase:'progress',received,total})});
   if(controller.signal.aborted||disposed)return false;
   await save(result);
   emit({phase:'saved',message:'Đã chuyển ảnh cho trình duyệt. Kiểm tra mục Tải xuống trên thiết bị.'});
   return true;
  }catch(error){
   if(disposed)return false;
   if(controller.signal.aborted)emit({phase:timedOut?'error':'cancelled',message:timedOut?'Tải ảnh mất quá lâu. Kiểm tra kết nối rồi thử lại.':'Đã hủy tải ảnh.'});
   else if(error.status===401){await onExpired();}
   else emit({phase:'error',status:error.status,message:error instanceof TypeError?'Kết nối bị gián đoạn. Kiểm tra mạng rồi thử lại.':error.message});
   return false;
  }finally{
   clearTimeout(timer);if(active===controller)active=null;
   emit({phase:'idle'});
  }
 };
 return {download,close,get busy(){return !!active;},dispose(){disposed=true;pagehide();windowImpl?.removeEventListener('pagehide',pagehide);}};
}
