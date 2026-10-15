import {uploadRequestTimeout} from './api-request.mjs';
import {isPreparedPhotoFile} from './upload-policy.mjs';
// XHR exposes upload byte progress; fetch does not. 100% means sent by the
// browser, not stored by the application. Only the JSON acknowledgement counts.
export function uploadRequest(url,{body,headers={},onProgress=()=>{}},{xhrFactory=()=>new XMLHttpRequest(),requestId=crypto.randomUUID(),timeout=uploadRequestTimeout}={}){
 let cancelXhr=()=>{};
 const promise=new Promise((resolve,reject)=>{
  const xhr=xhrFactory();let sent=false,settled=false;
  cancelXhr=()=>{try{xhr.abort?.();}catch{} if(!settled&&typeof xhr.onabort==='function')try{xhr.onabort();}catch{}};
  const finish=(error,data)=>{if(settled)return;settled=true;xhr.onload=xhr.onerror=xhr.ontimeout=xhr.onabort=null;xhr.upload.onprogress=xhr.upload.onload=null;error?reject(error):resolve(data);};
  const failure=(code,message)=>Object.assign(Error(message+' Mã kiểm tra: '+requestId+'.'),{code,requestId,uploadSent:sent});
  xhr.open('POST',url,true);xhr.timeout=timeout;
  for(const [name,value]of Object.entries({...headers,'X-Upload-Id':requestId}))xhr.setRequestHeader(name,value);
  xhr.upload.onprogress=e=>onProgress({phase:'sending',loaded:e.loaded,total:e.lengthComputable?e.total:null});
  xhr.upload.onload=()=>{sent=true;onProgress({phase:'processing'});};
  xhr.ontimeout=()=>finish(failure('UPLOAD_TIMEOUT',sent?'Đã gửi dữ liệu nhưng chưa nhận xác nhận lưu ảnh trong 3 phút.':'Chưa gửi xong dữ liệu ảnh trong 3 phút. Kiểm tra kết nối mạng rồi thử lại.'));
  xhr.onerror=()=>finish(failure('UPLOAD_NETWORK_ERROR','Kết nối upload bị gián đoạn.'));
  xhr.onabort=()=>finish(failure('UPLOAD_NETWORK_ERROR','Lượt upload đã bị ngắt.'));
  xhr.onload=()=>{
   let data;try{data=JSON.parse(xhr.responseText);}catch{}
   if(Array.isArray(data?.results))for(const item of data.results)if(item?.success===false)item.error=(item.error||'Chưa lưu được ảnh.')+' Mã kiểm tra: '+requestId+'.';
   if(xhr.status<200||xhr.status>=300)return finish(Object.assign(failure('UPLOAD_HTTP_ERROR',data?.error||`Máy chủ trả về lỗi HTTP ${xhr.status}.`),{status:xhr.status,data}));
   if(!data||typeof data!=='object'||Array.isArray(data))return finish(failure('INVALID_RESPONSE','Máy chủ trả về phản hồi chưa đầy đủ.'));
   finish(null,data);
  };
  onProgress({phase:'sending',loaded:0,total:null});
  try{xhr.send(body);}catch{finish(failure('UPLOAD_NETWORK_ERROR','Không gửi được dữ liệu ảnh.'));}
 });
 promise.abort=cancelXhr;
 return promise;
}
export function uploadProgressText(name,progress){
 if(progress.phase==='processing')return `${name}: đã gửi dữ liệu, đang chờ máy chủ ${isPreparedPhotoFile({name})?'kiểm tra và lưu ảnh':'xử lý và xác nhận lưu ảnh'}…`;
 const percent=progress.total?` ${Math.min(100,Math.floor(progress.loaded/progress.total*100))}%`:'';
 return `${name}: đang gửi${percent}…`;
}
