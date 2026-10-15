import {maxUploadBytes,uploadSizeLabel,isPreparedPhotoFile} from './upload-policy.mjs';
export {maxUploadBytes} from './upload-policy.mjs';
export function uploadIssue(file){
 if(file.size===0)return 'Tệp rỗng. Hãy xuất lại ảnh.';
 if(file.size>maxUploadBytes)return isPreparedPhotoFile(file)?`Gói ảnh vượt quá ${uploadSizeLabel}. Hãy kiểm tra báo cáo của công cụ chuẩn bị ảnh.`:`Ảnh vượt quá ${uploadSizeLabel}. Hãy xuất JPEG sRGB, cạnh dài 2400–4096 px.`;
 if(!isPreparedPhotoFile(file)&&file.type&&!['image/jpeg','image/png','image/webp','application/octet-stream'].includes(file.type))return 'Chỉ hỗ trợ JPEG, PNG, WebP và gói .ccphoto đã chuẩn bị trên máy.';
 return null;
}
const retryNote=' Giữ nguyên trang và bấm “Tải lại các ảnh còn lại” để tiếp tục.';
function transferFailure(error){
 let message;
 if(error.status)message=error.message;
 else if(['UPLOAD_TIMEOUT','UPLOAD_NETWORK_ERROR','INVALID_RESPONSE'].includes(error.code))message=error.message+retryNote;
 else if(error.code==='REQUEST_TIMEOUT')message='Máy chủ chưa xác nhận ảnh trong 3 phút.'+retryNote+' Ảnh đã lưu trong lượt này sẽ không bị tải trùng.';
 else message='Kết nối bị gián đoạn.'+retryNote+' Hệ thống sẽ nhận diện những ảnh đã lưu trong lượt tải này.';
 return Object.assign(Error(message),{code:error.code,status:error.status,requestId:error.requestId});
}
function validAcknowledgements(result,count){
 if(!Array.isArray(result?.results)||result.results.length!==count)return false;
 const indexes=new Set();
 return result.results.every(item=>{
  if(!item||!Number.isInteger(item.index)||item.index<0||item.index>=count||indexes.has(item.index)||typeof item.success!=='boolean'||(item.retryable!==undefined&&typeof item.retryable!=='boolean'))return false;
  indexes.add(item.index);return true;
 });
}
// File identity and keys survive batch resizing and lost responses.
export class UploadQueue {
 constructor(files,keyFactory=()=>crypto.randomUUID()){
  this.files=files;this.done=new Set();this.keys=new Map(files.map(file=>[file,keyFactory()]));this.results=new Map();
  this.aborted=false;this.activeAbort=null;
  for(const file of files){const error=uploadIssue(file);if(error)this.results.set(file,{success:false,error,retryable:false});}
 }
 abort(){
  this.aborted=true;
  if(this.activeAbort)try{this.activeAbort();}catch{}
 }
 matches(files){return files.length===this.files.length&&files.every((f,i)=>f===this.files[i]);}
 get pending(){return this.files.filter(f=>!this.done.has(f));}
 get retryable(){return this.pending.filter(f=>this.results.get(f)?.retryable!==false);}
 async run(send,progress=()=>{}){
  this.aborted=false;
  const pending=this.retryable;
  progress(this.done.size,this.files.length);
  for(let i=0;i<pending.length;){
   if(this.aborted)throw Object.assign(Error('Lượt tải ảnh đã được hủy. Bấm “Tải lại các ảnh còn lại” để tiếp tục.'),{code:'UPLOAD_CANCELLED',retryable:true});
   const batch=[pending[i++]];
   let result;
   try{
    try{
     result=await send(batch,batch.map(file=>this.keys.get(file)),abortFn=>{this.activeAbort=abortFn;});
    }catch(error){
     if(this.aborted)throw error;
     if(Array.isArray(error.data?.results))result=error.data;
     else throw error;
    }finally{
     this.activeAbort=null;
    }
    if(this.aborted)throw Object.assign(Error('Lượt tải ảnh đã được hủy. Bấm “Tải lại các ảnh còn lại” để tiếp tục.'),{code:'UPLOAD_CANCELLED',retryable:true});
    if(!validAcknowledgements(result,batch.length))throw Object.assign(Error('Máy chủ chưa xác nhận đầy đủ kết quả lưu ảnh.'),{code:'INVALID_RESPONSE'});
   }catch(error){
    if(this.aborted){
     this.results.set(batch[0],{index:0,success:false,retryable:true,error:'Đã dừng chờ xác nhận. Ảnh có thể đã được lưu; tải lại sẽ không tạo ảnh trùng.',code:'UPLOAD_CANCELLED'});
     progress(this.done.size,this.files.length);
     throw Object.assign(Error('Lượt tải ảnh đã được hủy. Bấm “Tải lại các ảnh còn lại” để tiếp tục.'),{code:'UPLOAD_CANCELLED',retryable:true});
    }
    const failure=transferFailure(error);
    this.results.set(batch[0],{index:0,success:false,retryable:true,error:failure.message,code:failure.code});
    progress(this.done.size,this.files.length);
    throw failure;
   }
   for(const item of result.results){const file=batch[item.index];this.results.set(file,item);if(item.success)this.done.add(file);}
   progress(this.done.size,this.files.length);
  }
 }
}
