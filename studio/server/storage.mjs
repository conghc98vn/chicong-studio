import {createR2Storage,mediaType} from './r2-storage.mjs';
import {mkdir,writeFile,readFile,unlink,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
// Derived 4:4:4 JPEGs can exceed their compressed source. This does not change
// the separate 20 MiB input upload limit in image-optimizer.mjs.
export const derivedFileSizeLimit=24*1024*1024;
const permitsJpeg=types=>types==null||types.some(type=>['image/jpeg','image/*','*/*'].includes(type));
const needsLargerLimit=value=>value!=null&&Number.isFinite(Number(value))&&Number(value)>0&&Number(value)<derivedFileSizeLimit;
export function createStorage(dir,env=process.env){
 const provider=env.MEDIA_STORAGE_PROVIDER||(env.NODE_ENV==='production'?null:env.SUPABASE_URL?'supabase':'local');
 if(!['local','supabase','r2'].includes(provider))throw Error('Set MEDIA_STORAGE_PROVIDER to local, supabase or r2');
 if(env.NODE_ENV==='production'&&provider==='local')throw Error('Production requires persistent cloud media storage');
 if(provider==='r2')return createR2Storage(env);
 const cloud=provider==='supabase';const bucket=env.SUPABASE_BUCKET||'chicong-private';
 if(!/^[a-z0-9-]{1,63}$/.test(bucket))throw Error('Invalid Storage bucket name');
 const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`};
 if(cloud&&(!env.SUPABASE_SERVICE_ROLE_KEY||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.SUPABASE_URL)))throw Error('Supabase URL and service role key are required');
 const url=name=>`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${name}`;
 return {cloud,provider,bucket:cloud?bucket:null,identity:cloud?`supabase:${env.SUPABASE_URL}/${bucket}`:`local:${path.resolve(dir)}`,
 async stat(name){const type=mediaType(name);if(!cloud)return {bytes:(await stat(path.join(dir,name))).size,contentType:type};const r=await fetch(url(name),{method:'HEAD',headers,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Object.assign(Error('Storage metadata failed'),{storageStatus:r.status,code:r.status===404?'STORAGE_NOT_FOUND':'STORAGE_UNAVAILABLE'});return {bytes:Number(r.headers.get('content-length')),contentType:r.headers.get('content-type')};},
 async list(){if(!cloud){await mkdir(dir,{recursive:true});return Promise.all((await readdir(dir)).map(async key=>({key,bytes:(await stat(path.join(dir,key))).size})));}const files=[];for(let offset=0;;offset+=100){const r=await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/${bucket}`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({prefix:'',limit:100,offset,sortBy:{column:'name',order:'asc'}}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Storage inventory failed');const page=await r.json();files.push(...page.map(o=>({key:o.name,bytes:o.metadata?.size??null})));if(page.length<100)return files;}},
 async init(){
  if(!cloud)return;
  const bucketUrl=`${env.SUPABASE_URL}/storage/v1/bucket/${bucket}`;
  let response=await fetch(bucketUrl,{headers,signal:AbortSignal.timeout(15000)});
  const error=response.ok?null:await response.clone().json().catch(()=>null);
  // Supabase Storage reports NoSuchBucket as HTTP 400 with a logical 404.
  const missing=response.status===404||(response.status===400&&error?.code==='NoSuchBucket');
  if(missing){
   response=await fetch(`${env.SUPABASE_URL}/storage/v1/bucket`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id:bucket,name:bucket,public:false,allowed_mime_types:['image/webp','image/jpeg'],file_size_limit:derivedFileSizeLimit}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error(`Cannot create private Storage bucket (HTTP ${response.status})`);
   response=await fetch(bucketUrl,{headers,signal:AbortSignal.timeout(15000)});
  }
  if(!response.ok)throw Error(`Cannot verify Storage bucket (HTTP ${response.status})`);
  const info=await response.json();
  if(info.public!==false)throw Error('Gallery Storage bucket must be private');
  // Keep privacy and unrelated MIME rules. Raise only a smaller positive file
  // ceiling; preserve larger ceilings and unlimited buckets.
  const addJpeg=!permitsJpeg(info.allowed_mime_types),raiseLimit=needsLargerLimit(info.file_size_limit);
  if(addJpeg||raiseLimit){
   const policy={public:false,allowed_mime_types:addJpeg?[...info.allowed_mime_types,'image/jpeg']:info.allowed_mime_types};
   if(info.file_size_limit!==undefined)policy.file_size_limit=raiseLimit?derivedFileSizeLimit:info.file_size_limit;
   response=await fetch(bucketUrl,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(policy),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error(`Cannot enable JPEG downloads in Storage bucket (HTTP ${response.status})`);
   response=await fetch(bucketUrl,{headers,signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error(`Cannot verify Storage bucket (HTTP ${response.status})`);
   const updated=await response.json();
   if(updated.public!==false)throw Error('Gallery Storage bucket must be private');
   if(!permitsJpeg(updated.allowed_mime_types))throw Error('Storage bucket does not allow JPEG downloads');
   if(updated.file_size_limit!==null&&!(Number(updated.file_size_limit)>=derivedFileSizeLimit))throw Error('Storage bucket file size limit is too small for JPEG downloads');
  }
 },
 async put(name,buffer){const type=mediaType(name);if(cloud){const r=await fetch(url(name),{method:'POST',headers:{...headers,'Content-Type':type},body:buffer,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Object.assign(Error('Storage upload failed'),{storageStatus:r.status,uncertain:![400,401,403,413,415].includes(r.status)});}else{await mkdir(dir,{recursive:true});await writeFile(path.join(dir,name),buffer);}},
 async get(name,{signal}={}){mediaType(name);signal?.throwIfAborted();if(cloud){const timeout=AbortSignal.timeout(30000),requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;const r=await fetch(url(name),{headers,signal:requestSignal});if(!r.ok)throw Object.assign(Error('Storage read failed'),{storageStatus:r.status,code:r.status===404?'STORAGE_NOT_FOUND':'STORAGE_UNAVAILABLE'});return Buffer.from(await r.arrayBuffer());}return readFile(path.join(dir,name),{signal});},
 async remove(name){mediaType(name);if(cloud){const r=await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}`,{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[name]}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Storage deletion failed');}else await unlink(path.join(dir,name)).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 };
}
