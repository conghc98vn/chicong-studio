import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorage} from '../server/storage.mjs';
const env={SUPABASE_URL:'https://test-project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key',SUPABASE_BUCKET:'chicong-private'};
test('Cloud Storage keeps bucket private, sends server auth and stores/reads/deletes media',async()=>{const original=globalThis.fetch;const files=new Map();let exists=false;let sawPrivate=false;let authenticated=0;globalThis.fetch=async(url,options={})=>{assert.equal(options.headers.apikey,'fixture-service-key');assert.equal(options.headers.Authorization,'Bearer fixture-service-key');authenticated++;if(url.endsWith('/bucket/chicong-private'))return new Response(exists?JSON.stringify({public:false}):'{}',{status:exists?200:404});if(url.endsWith('/bucket')&&options.method==='POST'){const body=JSON.parse(options.body);sawPrivate=body.public===false;exists=true;return new Response('{}');}if(url.endsWith('/object/chicong-private')&&options.method==='DELETE'){for(const name of JSON.parse(options.body).prefixes)files.delete(name);return new Response('{}');}const name=url.split('/').at(-1);if(options.method==='POST'){files.set(name,options.body);return new Response('{}');}return new Response(files.get(name)||'',{status:files.has(name)?200:404});};try{const storage=createStorage('/unused',env);await storage.init();assert.ok(sawPrivate);const name='a'.repeat(32)+'.webp';await storage.put(name,Buffer.from('fixture-image'));assert.equal(String(await storage.get(name)),'fixture-image');await storage.remove(name);assert.equal(files.size,0);assert.ok(authenticated>=6);await assert.rejects(()=>storage.get('../../etc/passwd'));}finally{globalThis.fetch=original;}});
test('Production Storage refuses a public bucket',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({public:true}));try{await assert.rejects(()=>createStorage('/unused',env).init(),/must be private/);}finally{globalThis.fetch=original;}});
test('Cloud Storage creates a private bucket for Supabase HTTP 400 NoSuchBucket',async()=>{
 const original=globalThis.fetch;let created=false;let reads=0;
 globalThis.fetch=async(url,options={})=>{
  if(url.endsWith('/bucket')&&options.method==='POST'){
   const body=JSON.parse(options.body);
   assert.equal(body.public,false);assert.deepEqual(body.allowed_mime_types,['image/webp']);assert.equal(body.file_size_limit,8388608);
   created=true;return new Response('{}');
  }
  assert.ok(url.endsWith('/bucket/chicong-private'));reads++;
  return created?new Response(JSON.stringify({public:false})):new Response(JSON.stringify({statusCode:'404',code:'NoSuchBucket',error:'Bucket not found',message:'Bucket not found'}),{status:400});
 };
 try{await createStorage('/unused',env).init();assert.ok(created);assert.equal(reads,2);}finally{globalThis.fetch=original;}
});
test('Cloud Storage never creates a bucket for authentication or other HTTP errors',async()=>{
 const original=globalThis.fetch;
 try{for(const status of [400,401,403,500]){
  let requests=0;
  globalThis.fetch=async(url,options={})=>{requests++;assert.notEqual(options.method,'POST');return new Response(JSON.stringify({code:'InvalidJWT'}),{status});};
  await assert.rejects(()=>createStorage('/unused',env).init(),new RegExp(`Cannot verify Storage bucket \\(HTTP ${status}\\)`));assert.equal(requests,1);
 }}finally{globalThis.fetch=original;}
});
