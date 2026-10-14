export const maxUploadBytes=8*1024*1024;
const batchByteLimit=12*1024*1024;
export function uploadIssue(file){
 if(file.size===0)return 'Tệp rỗng. Hãy xuất lại ảnh.';
 if(file.size>maxUploadBytes)return 'Ảnh vượt quá 8 MB. Hãy xuất JPEG sRGB, cạnh dài 2400–4096 px.';
 if(file.type&&!['image/jpeg','image/png','image/webp','application/octet-stream'].includes(file.type))return 'Chỉ hỗ trợ JPEG, PNG và WebP. Hãy xuất JPEG từ Lightroom.';
 return null;
}
// File identity and keys survive batch resizing and lost responses.
export class UploadQueue {
 constructor(files,keyFactory=()=>crypto.randomUUID()){
  this.files=files;this.done=new Set();this.keys=new Map(files.map(file=>[file,keyFactory()]));this.results=new Map();
  for(const file of files){const error=uploadIssue(file);if(error)this.results.set(file,{success:false,error,retryable:false});}
 }
 matches(files){return files.length===this.files.length&&files.every((f,i)=>f===this.files[i]);}
 get pending(){return this.files.filter(f=>!this.done.has(f));}
 get retryable(){return this.pending.filter(f=>this.results.get(f)?.retryable!==false);}
 async run(send,progress=()=>{}){
  const pending=this.retryable;
  progress(this.done.size,this.files.length);
  for(let i=0;i<pending.length;){
   const batch=[];let bytes=0;
   while(i<pending.length&&batch.length<8){const file=pending[i],size=file.size||0;if(batch.length&&bytes+size>batchByteLimit)break;batch.push(file);bytes+=size;i++;}
   let result;
   try{result=await send(batch,batch.map(file=>this.keys.get(file)));}catch(error){
    if(error.data?.results)result=error.data;
    else if(error.status)throw error;
    else throw Error('Kết nối bị gián đoạn. Giữ nguyên trang và bấm “Tải lại các ảnh còn lại” để tiếp tục. Hệ thống sẽ nhận diện những ảnh đã lưu trong lượt tải này.');
   }
   for(const item of result.results||[]){const file=batch[item.index];if(file){this.results.set(file,item);if(item.success)this.done.add(file);}}
   progress(this.done.size,this.files.length);
  }
 }
}
