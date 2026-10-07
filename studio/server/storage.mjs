import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
export function createStorage(dir,env=process.env){
 const cloud=!!env.SUPABASE_URL;const bucket=env.SUPABASE_BUCKET||'chicong-private';
 if(!/^[a-z0-9-]{1,63}$/.test(bucket))throw Error('Invalid Storage bucket name');
 const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`};
 if(cloud&&(!env.SUPABASE_SERVICE_ROLE_KEY||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.SUPABASE_URL)))throw Error('Supabase URL and service role key are required');
 const url=name=>`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${name}`;
 return {cloud,
 async init(){if(!cloud)return;const bucketUrl=`${env.SUPABASE_URL}/storage/v1/bucket/${bucket}`;let response=await fetch(bucketUrl,{headers,signal:AbortSignal.timeout(15000)});if(response.status===404){response=await fetch(`${env.SUPABASE_URL}/storage/v1/bucket`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id:bucket,name:bucket,public:false,allowed_mime_types:['image/webp'],file_size_limit:8388608}),signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Cannot create private Storage bucket');response=await fetch(bucketUrl,{headers,signal:AbortSignal.timeout(15000)});}if(!response.ok)throw Error('Cannot verify Storage bucket');const info=await response.json();if(info.public!==false)throw Error('Gallery Storage bucket must be private');},
 async put(name,buffer){if(cloud){const r=await fetch(url(name),{method:'POST',headers:{...headers,'Content-Type':'image/webp'},body:buffer,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Storage upload failed');}else{await mkdir(dir,{recursive:true});await writeFile(path.join(dir,name),buffer);}},
 async get(name){if(!/^[a-f0-9]{32}(-thumb)?\.webp$/.test(name))throw Error('Invalid image');if(cloud){const r=await fetch(url(name),{headers,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Storage read failed');return Buffer.from(await r.arrayBuffer());}return readFile(path.join(dir,name));},
 async remove(name){if(cloud){const r=await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}`,{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[name]}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Storage deletion failed');}else await unlink(path.join(dir,name)).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 };
}
