import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
// Derived 4:4:4 JPEGs can exceed their compressed source. This does not change
// the separate 20 MiB input upload limit in image-optimizer.mjs.
export const derivedFileSizeLimit=24*1024*1024;
function mediaType(name){
 if(/^[a-f0-9]{32}(-thumb)?\.webp$/.test(name))return 'image/webp';
 if(/^[a-f0-9]{32}-download\.jpg$/.test(name))return 'image/jpeg';
 throw Error('Invalid image');
}
const permitsJpeg=types=>types==null||types.some(type=>['image/jpeg','image/*','*/*'].includes(type));
const needsLargerLimit=value=>value!=null&&Number.isFinite(Number(value))&&Number(value)>0&&Number(value)<derivedFileSizeLimit;
export function createStorage(dir,env=process.env){
 const cloud=!!env.SUPABASE_URL;const bucket=env.SUPABASE_BUCKET||'chicong-private';
 if(!/^[a-z0-9-]{1,63}$/.test(bucket))throw Error('Invalid Storage bucket name');
 const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`};
 if(cloud&&(!env.SUPABASE_SERVICE_ROLE_KEY||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.SUPABASE_URL)))throw Error('Supabase URL and service role key are required');
 const url=name=>`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${name}`;
 return {cloud,
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
 async put(name,buffer){const type=mediaType(name);if(cloud){const r=await fetch(url(name),{method:'POST',headers:{...headers,'Content-Type':type},body:buffer,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Object.assign(Error('Storage upload failed'),{storageStatus:r.status});}else{await mkdir(dir,{recursive:true});await writeFile(path.join(dir,name),buffer);}},
 async get(name,{signal}={}){mediaType(name);signal?.throwIfAborted();if(cloud){const timeout=AbortSignal.timeout(30000),requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;const r=await fetch(url(name),{headers,signal:requestSignal});if(!r.ok)throw Error('Storage read failed');return Buffer.from(await r.arrayBuffer());}return readFile(path.join(dir,name),{signal});},
 async remove(name){mediaType(name);if(cloud){const r=await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}`,{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[name]}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Storage deletion failed');}else await unlink(path.join(dir,name)).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 };
}
