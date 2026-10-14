import {randomUUID} from 'node:crypto';
export function uploadTrace(logger){
 return (req,res,next)=>{
  if(req.method!=='POST'||!/^\/api\/admin\/(albums\/[^/]+\/photos|portrait)\/?$/.test(req.path))return next();
  const supplied=req.get('X-Upload-Id'),id=/^[a-f0-9-]{36}$/.test(supplied||'')?supplied:randomUUID();
  const started=performance.now();let stage='request',closed=false;
  // Never log filenames, album IDs, cookies, bodies, storage URLs or error messages.
  const emit=(event,extra={})=>{try{logger({event,upload_id:id,stage,elapsed_ms:Math.round(performance.now()-started),rss_mb:Math.round(process.memoryUsage().rss/1048576),...extra});}catch{}};
  const trace={
   mark(name,extra={}){stage=name;emit('stage',extra);},
   async run(name,fn){trace.mark(name);const start=performance.now();try{const result=await fn();emit('stage_done',{duration_ms:Math.round(performance.now()-start)});return result;}catch(error){emit('stage_error',{error_type:String(error?.name||'Error').replace(/[^a-zA-Z]/g,'').slice(0,40),...(Number.isInteger(error?.storageStatus)?{storage_status:error.storageStatus}:{})});throw error;}},
   file(index,bytes){emit('file',{file_index:index,source_bytes:bytes});}
  };
  req.uploadTrace=trace;res.set('X-Upload-Id',id);emit('request_start');
  const heartbeat=setInterval(()=>emit('waiting'),15000);heartbeat.unref?.();
  const end=event=>{if(closed)return;closed=true;clearInterval(heartbeat);emit(event,{status:res.statusCode,body_received:req.complete});};
  req.once('aborted',()=>end('request_aborted'));res.once('finish',()=>end('response_finished'));res.once('close',()=>end('connection_closed'));
  next();
 };
}
export const quietUploadTrace={mark(){},file(){},run:(_name,fn)=>fn()};
