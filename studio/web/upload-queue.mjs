// Track acknowledged files by object identity: two photos may share a filename.
export class UploadQueue {
 constructor(files,keyFactory=()=>crypto.randomUUID()){this.files=files;this.done=new Set();this.keys=new Map(files.map(file=>[file,keyFactory()]));}
 matches(files){return files.length===this.files.length&&files.every((f,i)=>f===this.files[i]);}
 get pending(){return this.files.filter(f=>!this.done.has(f));}
 async run(send,progress=()=>{}){
  const pending=this.pending;
  progress(this.done.size,this.files.length);
  for(let i=0;i<pending.length;i+=8){
   const batch=pending.slice(i,i+8);let result;
   try{result=await send(batch,batch.map(file=>this.keys.get(file)));}catch(error){
    if(error.data?.results)result=error.data;
    else if(error.status)throw error;
    else throw Error('Kết nối bị gián đoạn. Bấm thử lại để tiếp tục; hệ thống sẽ nhận diện các ảnh đã lưu trong đợt vừa rồi.');
   }
   for(const item of result.results||[])if(item.success&&batch[item.index])this.done.add(batch[item.index]);
   progress(this.done.size,this.files.length);
  }
 }
}
