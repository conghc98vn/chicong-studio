import {S3Client,HeadBucketCommand,PutObjectCommand,GetObjectCommand,HeadObjectCommand,DeleteObjectCommand,ListObjectsV2Command} from '@aws-sdk/client-s3';
import {createHash} from 'node:crypto';

export function mediaType(name){
 if(/^[a-f0-9]{32}(-thumb)?\.webp$/.test(name))return 'image/webp';
 if(/^[a-f0-9]{32}-download\.jpg$/.test(name))return 'image/jpeg';
 throw Error('Invalid image');
}
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const storageError=(error,operation)=>{
 const status=error?.$metadata?.httpStatusCode;
 const code=error?.name==='AbortError'||error?.name==='TimeoutError'?'STORAGE_TIMEOUT':status===404?'STORAGE_NOT_FOUND':status===401||status===403?'STORAGE_FORBIDDEN':'STORAGE_UNAVAILABLE';
 return Object.assign(Error(`R2 ${operation} failed (${code})`),{code,storageStatus:status,uncertain:operation==='put'&&status!==400&&status!==401&&status!==403});
};

// No ambient AWS credential chain, public URLs, bucket creation or source fallback.
export function createR2Storage(env,{client,timeoutMs=30000}={}){
 const endpoint=env.R2_ENDPOINT,bucket=env.R2_BUCKET;
 if(!/^https:\/\/[a-f0-9]{32}(\.(eu|fedramp))?\.r2\.cloudflarestorage\.com$/.test(endpoint||''))throw Error('R2_ENDPOINT must be an account R2 HTTPS endpoint');
 if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket||''))throw Error('Invalid R2_BUCKET');
 if(!env.R2_ACCESS_KEY_ID||!env.R2_SECRET_ACCESS_KEY)throw Error('R2 server credentials are required');
 const s3=client||new S3Client({region:'auto',endpoint,forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY}});
 const execute=async(operation,fn,{signal}={})=>{
  signal?.throwIfAborted();
  const controller=new AbortController();let body,timer;
  const abort=()=>controller.abort(signal?.reason);
  signal?.addEventListener('abort',abort,{once:true});
  const deadline=new Promise((_,reject)=>{
   controller.signal.addEventListener('abort',()=>{body?.destroy?.();reject(controller.signal.reason);},{once:true});
   timer=setTimeout(()=>controller.abort(new DOMException('Storage deadline exceeded','TimeoutError')),timeoutMs);
  });
  try{return await Promise.race([fn(controller.signal,value=>{body=value;if(controller.signal.aborted)body?.destroy?.();}),deadline]);}
  catch(error){throw storageError(error,operation);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);body?.destroy?.();}
 };
 const send=async(command,signal)=>{
  const readOnly=command instanceof GetObjectCommand||command instanceof HeadObjectCommand||command instanceof HeadBucketCommand||command instanceof ListObjectsV2Command;
  for(let attempt=0;;attempt++){
   try{return await s3.send(command,{abortSignal:signal});}
   catch(error){const status=error?.$metadata?.httpStatusCode;signal.throwIfAborted();if(!readOnly||attempt>=1||(status&&status<500)||error?.name==='AbortError')throw error;}
  }
 };
 return {
  cloud:true,provider:'r2',identity:`r2:${endpoint}/${bucket}`,bucket,
  init:()=>execute('init',signal=>send(new HeadBucketCommand({Bucket:bucket}),signal)),
  async put(name,bytes,options={}){
   const ContentType=mediaType(name);
   return execute('put',signal=>send(new PutObjectCommand({Bucket:bucket,Key:name,Body:bytes,ContentType,ContentLength:bytes.length,Metadata:{sha256:sha256(bytes)}}),signal),options);
  },
  async get(name,options={}){
   const expected=mediaType(name);
   return execute('get',async(signal,setBody)=>{
    const result=await send(new GetObjectCommand({Bucket:bucket,Key:name}),signal);setBody(result.Body);
    if(result.ContentType!==expected)throw Error('Unexpected media type');
    const chunks=[];for await(const chunk of result.Body){signal.throwIfAborted();chunks.push(Buffer.from(chunk));}
    signal.throwIfAborted();const bytes=Buffer.concat(chunks);
    if(result.ContentLength!=null&&bytes.length!==Number(result.ContentLength))throw Error('Incomplete object');
    if(result.Metadata?.sha256&&sha256(bytes)!==result.Metadata.sha256)throw Error('Checksum mismatch');
    return bytes;
   },options);
  },
  async stat(name,options={}){mediaType(name);return execute('head',async signal=>{const r=await send(new HeadObjectCommand({Bucket:bucket,Key:name}),signal);return {bytes:Number(r.ContentLength),contentType:r.ContentType,sha256:r.Metadata?.sha256||null};},options);},
  async list(){return execute('list',async signal=>{const files=[];let token;do{const r=await send(new ListObjectsV2Command({Bucket:bucket,ContinuationToken:token}),signal);files.push(...(r.Contents||[]).map(o=>({key:o.Key,bytes:Number(o.Size)})));token=r.IsTruncated?r.NextContinuationToken:undefined;if(r.IsTruncated&&!token)throw Error('Incomplete listing');}while(token);return files;});},
  async remove(name,options={}){mediaType(name);return execute('delete',signal=>send(new DeleteObjectCommand({Bucket:bucket,Key:name}),signal),options);},
  close:()=>s3.destroy?.()
 };
}
