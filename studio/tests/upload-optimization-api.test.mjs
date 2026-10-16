import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';
import {openDatabase} from '../server/db.mjs';
import {largeJpeg} from './fixtures/large-photo.mjs';
import {maxUploadBytes} from '../web/upload-policy.mjs';
import {encodePreparedPhoto} from '../server/prepared-photo.mjs';
import {optimizePhoto} from '../server/image-optimizer.mjs';
async function fixture(storage,uploadLogger){
 const dir=await mkdtemp(path.join(tmpdir(),'upload-quality-'));let pool,schema,url=null;
 if(process.env.STUDIO_TEST_POSTGRES_URL){pool=new pg.Pool({connectionString:process.env.STUDIO_TEST_POSTGRES_URL});schema='upload_test_'+randomBytes(8).toString('hex');await pool.query('CREATE SCHEMA '+schema);const target=new URL(process.env.STUDIO_TEST_POSTGRES_URL);target.searchParams.set('options','-c search_path='+schema);url=target.href;}
 const db=await openDatabase(dir,{url});const instance=await createApp({db,dataDir:dir,env:{},storage,uploadLogger,origin:'http://localhost'});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;let cookie='';
 const request=(path,body,method='GET',headers={})=>fetch(base+path,{method,headers:{Origin:'http://localhost',Cookie:cookie,...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 const setup=await request('/api/admin/setup',{email:'upload@example.com',password:'upload-test-password'},'POST');cookie=setup.headers.get('set-cookie').split(';')[0];
 const a=await request('/api/admin/albums',{title:'Upload quality',category:'wedding',status:'published'},'POST'),album=(await a.json()).id;
 const upload=(buffers,keys=buffers.map((_,i)=>String(i).repeat(32)))=>{const body=new FormData();for(const buffer of buffers)body.append('photos',new Blob([buffer],{type:'image/jpeg'}),'same.jpg');return request('/api/admin/albums/'+album+'/photos',body,'POST',{'X-Upload-Keys':JSON.stringify(keys)});};
 return {dir,db,album,request,upload,url,photoCleanup:instance.photoCleanup,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await instance.photoCleanup.close();await db.close();if(pool){await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}await rm(dir,{recursive:true,force:true});}};
}
const sample=()=>sharp({create:{width:3000,height:2000,channels:3,background:'#bb7733'}}).jpeg().toBuffer();
test('JPEG above 10 MiB uploads as album photo and portrait; files over 20 MiB are rejected without writes',async()=>{
 const f=await fixture();try{
  const bytes=await largeJpeg(),response=await f.upload([bytes]);assert.equal(response.status,201);
  const result=(await response.json()).results[0];assert.equal(result.optimization.source_bytes,bytes.length);
  assert.equal((await readdir(path.join(f.dir,'uploads'))).length,3);
  for(const [suffix,format] of [['.webp','webp'],['-thumb.webp','webp'],['-download.jpg','jpeg']]){
   const image=await sharp(await readFile(path.join(f.dir,'uploads',result.id+suffix))).metadata();assert.equal(image.format,format);assert.ok(Math.max(image.width,image.height)<=2400);
  }
  const portrait=new FormData();portrait.append('portrait',new Blob([bytes],{type:'image/jpeg'}),'portrait.jpg');
  assert.equal((await f.request('/api/admin/portrait',portrait,'POST')).status,201);
  const filesBefore=await readdir(path.join(f.dir,'uploads'));
  const oversized=Buffer.alloc(maxUploadBytes+1),tooLarge=await f.upload([oversized]);assert.equal(tooLarge.status,422);assert.match((await tooLarge.json()).error,/20 MB/);
  const invalidPortrait=new FormData();invalidPortrait.append('portrait',new Blob([oversized],{type:'image/jpeg'}),'large.jpg');
  const rejected=await f.request('/api/admin/portrait',invalidPortrait,'POST');assert.equal(rejected.status,422);assert.match((await rejected.json()).error,/20 MB/);
  assert.deepEqual(await readdir(path.join(f.dir,'uploads')),filesBefore);assert.equal((await f.db.all('SELECT id FROM photos')).length,1);
 }finally{await f.close();}
});
test('Upload measurements match actual stored renditions, survive restart/retry and stay admin-only',async()=>{
 const f=await fixture();try{
  const bytes=await sample(),response=await f.upload([bytes]);assert.equal(response.status,201);const r=(await response.json()).results[0],o=r.optimization;
  assert.equal(o.source_bytes,bytes.length);assert.equal(o.width,2400);assert.equal(o.height,1600);
  assert.equal((await readFile(path.join(f.dir,'uploads',r.id+'.webp'))).length,o.image_bytes);assert.equal((await readFile(path.join(f.dir,'uploads',r.id+'-thumb.webp'))).length,o.thumb_bytes);
  const jpeg=await readFile(path.join(f.dir,'uploads',r.id+'-download.jpg'));assert.equal(jpeg.length,o.download_bytes);assert.equal((await sharp(jpeg).metadata()).format,'jpeg');
  const second=await openDatabase(f.dir,{url:f.url});try{assert.equal((await second.get('SELECT image_bytes FROM photos WHERE id=?',[r.id])).image_bytes,o.image_bytes);}finally{await second.close();}
  const retried=(await(await f.upload([bytes])).json()).results[0];assert.equal(retried.id,r.id);assert.equal(retried.reused,true);assert.deepEqual(retried.optimization,o);
  const admin=await(await f.request('/api/admin/albums')).json();assert.deepEqual(admin[0].photos[0].optimization,o);
  const publicAlbum=await(await f.request('/api/albums/'+f.album)).json();assert.equal(publicAlbum.photos[0].optimization,undefined);
  assert.equal((await readdir(path.join(f.dir,'uploads'))).length,3);
 }finally{await f.close();}
});
test('Mixed valid, corrupt and disguised unsupported images report exact per-file errors',async()=>{
 const f=await fixture();try{
  const r=await f.upload([await sample(),Buffer.from('broken'),Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')]);assert.equal(r.status,201);const result=await r.json();assert.equal(result.uploaded,1);
  assert.equal(result.results[1].code,'INVALID_IMAGE');assert.equal(result.results[2].code,'UNSUPPORTED_FORMAT');for(const fail of result.results.slice(1)){assert.equal(fail.retryable,false);assert.ok(fail.error);}
  assert.equal((await f.db.all('SELECT * FROM photos')).length,1);assert.equal((await readdir(path.join(f.dir,'uploads'))).length,3);
 }finally{await f.close();}
});
test('Failed thumbnail storage rolls back files/record, reports retryable failure and retries once',async()=>{
 // This synchronous fixture has a known, settled failure; no late provider PUT.
 const files=new Map();let broken=true;
 const storage={put:async(key,bytes)=>{if(broken&&key.endsWith('-thumb.webp'))throw Object.assign(Error('private backend credential must not leak'),{uncertain:false});files.set(key,bytes);},remove:async key=>files.delete(key),get:async key=>files.get(key)};
 const f=await fixture(storage);try{
  const bytes=await sample(),response=await f.upload([bytes]);assert.equal(response.status,422);const result=(await response.json()).results[0];assert.equal(result.code,'SAVE_FAILED');assert.equal(result.retryable,true);assert.doesNotMatch(result.error,/credential/);assert.equal(files.size,0);assert.equal((await f.db.all('SELECT * FROM photos')).length,0);
  broken=false;const retry=await f.upload([bytes]);assert.equal(retry.status,201);assert.equal((await f.db.all('SELECT * FROM photos')).length,1);assert.equal(files.size,3);
 }finally{await f.close();}
});
test('Failed download rendition storage rolls back all files and a retry persists exactly three',async()=>{
 // This synchronous fixture has a known, settled failure; no late provider PUT.
 const files=new Map();let broken=true;
 const storage={put:async(key,bytes)=>{files.set(key,bytes);if(broken&&key.endsWith('-download.jpg'))throw Object.assign(Error('private upload error'),{uncertain:false});},remove:async key=>files.delete(key),get:async key=>files.get(key)};
 const f=await fixture(storage);try{
  const bytes=await sample(),response=await f.upload([bytes]);assert.equal(response.status,422);const result=(await response.json()).results[0];assert.equal(result.code,'SAVE_FAILED');assert.equal(result.retryable,true);assert.equal(files.size,0);assert.equal((await f.db.all('SELECT * FROM photos')).length,0);
  broken=false;const retry=await f.upload([bytes]);assert.equal(retry.status,201);const saved=(await retry.json()).results[0];assert.equal(files.size,3);assert.equal(saved.optimization.download_bytes,files.get(saved.id+'-download.jpg').length);
  assert.equal((await f.request('/api/admin/photos/'+saved.id,{},'DELETE')).status,200);assert.equal((await f.db.all('SELECT * FROM photos')).length,0);await f.photoCleanup.cleanup(true);assert.equal(files.size,0);
 }finally{await f.close();}
});

test('Upload tracing identifies processing stages and failures without disclosing filenames or secrets',async()=>{
 const events=[],storage={put:async()=>{throw Error('secret storage credentials');},remove:async()=>{}};
 const f=await fixture(storage,event=>events.push(event));try{
  const response=await f.upload([await sample()]);assert.equal(response.status,422);const traceId=response.headers.get('x-upload-id');assert.ok(traceId);
  const stages=events.filter(e=>e.event==='stage').map(e=>e.stage);
  for(const stage of ['authenticate','receive_body','validate','deduplicate','optimize_decode','optimize_webp','optimize_thumbnail','optimize_jpeg','store_webp','file_error','rollback'])assert.ok(stages.includes(stage),stage);
  assert.ok(events.some(e=>e.event==='stage_error'&&e.stage==='store_webp'));assert.ok(events.some(e=>e.event==='response_finished'&&e.status===422));
  assert.ok(events.every(e=>e.upload_id===traceId&&e.elapsed_ms>=0));assert.doesNotMatch(JSON.stringify(events),/secret|credentials|same\.jpg|Cookie|upload@example/);
 }finally{await f.close();}
});

test('Prepared uploads store exact local renditions, keep section/name and deduplicate without reencoding',async()=>{
 const events=[],f=await fixture(undefined,event=>events.push(event));try{
  const bytes=await sample(),optimized=await optimizePhoto(bytes),bundle=encodePreparedPhoto({originalName:'CC - 0001.jpg',sourceHash:'b'.repeat(64),...optimized});
  const sectionResponse=await f.request('/api/admin/albums/'+f.album+'/sections',{title:'Chi tiết'},'POST');assert.equal(sectionResponse.status,201);const section=(await sectionResponse.json()).id;
  const send=(name='CC - 0001.jpg.ccphoto',key='c'.repeat(32))=>{const form=new FormData();form.append('photos',new Blob([bundle],{type:'application/octet-stream'}),name);return f.request('/api/admin/albums/'+f.album+'/photos',form,'POST',{'X-Upload-Keys':JSON.stringify([key]),'X-Album-Section':section});};
  const response=await send();assert.equal(response.status,201);const saved=(await response.json()).results[0];assert.deepEqual(saved.optimization,optimized.optimization);
  for(const [suffix,data] of [['.webp',optimized.data],['-thumb.webp',optimized.thumbnail],['-download.jpg',optimized.download]])assert.deepEqual(await readFile(path.join(f.dir,'uploads',saved.id+suffix)),data);
  const photo=await f.db.get('SELECT original,caption,section_id FROM photos WHERE id=?',[saved.id]);assert.deepEqual({...photo},{original:'CC - 0001.jpg',caption:'CC - 0001',section_id:section});
  const again=(await(await send()).json()).results[0];assert.equal(again.id,saved.id);assert.equal(again.reused,true);assert.equal((await f.db.all('SELECT id FROM photos')).length,1);
  const stages=events.filter(e=>e.event==='stage').map(e=>e.stage);assert.ok(stages.includes('prepared_validate'));assert.ok(!stages.some(stage=>stage.startsWith('optimize_')));
  const disguised=await send('ordinary.jpg','d'.repeat(32));assert.equal(disguised.status,201);assert.equal((await disguised.json()).results[0].skipped,true);assert.equal((await f.db.all('SELECT id FROM photos')).length,1);
 }finally{await f.close();}
});

test('Malformed prepared files fail permanently; interrupted storage rolls back and retries safely',async()=>{
 const files=new Map();let failStorage=true;
 const storage={put:async(key,data)=>{files.set(key,data);if(failStorage&&key.endsWith('-download.jpg'))throw Object.assign(Error('private storage problem'),{uncertain:false});},remove:async key=>files.delete(key),get:async key=>files.get(key)};
 const f=await fixture(storage);try{
  const source=await sample(),bundle=encodePreparedPhoto({originalName:'sample.jpg',sourceHash:'e'.repeat(64),...await optimizePhoto(source)});
  const send=(bytes,key='f'.repeat(32))=>{const form=new FormData();form.append('photos',new Blob([bytes]),'sample.jpg.ccphoto');return f.request('/api/admin/albums/'+f.album+'/photos',form,'POST',{'X-Upload-Keys':JSON.stringify([key])});};
  const invalid=await send(source);assert.equal(invalid.status,422);const rejected=(await invalid.json()).results[0];assert.equal(rejected.code,'PREPARED_INVALID');assert.equal(rejected.retryable,false);assert.equal(files.size,0);
  const corrupted=Buffer.from(bundle);corrupted[corrupted.length-20]^=1;assert.equal((await(await send(corrupted)).json()).results[0].code,'PREPARED_CHECKSUM');assert.equal(files.size,0);
  const failed=(await(await send(bundle)).json()).results[0];assert.equal(failed.code,'SAVE_FAILED');assert.equal(failed.retryable,true);assert.equal(files.size,0);assert.equal((await f.db.all('SELECT id FROM photos')).length,0);
  failStorage=false;const response=await send(bundle);assert.equal(response.status,201);const saved=(await response.json()).results[0];assert.equal(files.size,3);
  const replay=(await(await send(bundle)).json()).results[0];assert.equal(replay.id,saved.id);assert.equal(replay.reused,true);assert.equal((await f.db.all('SELECT id FROM photos')).length,1);
 }finally{await f.close();}
});

test('Ambiguous PUT keeps staging and journal after a late write; retry does not delete the new photo',async()=>{
 const files=new Map();let fail=true,late;
 const storage={put:async(key,bytes)=>{if(fail&&key.endsWith('-download.jpg')){late=()=>files.set(key,bytes);throw Error('lost PUT response');}files.set(key,bytes);},remove:async key=>files.delete(key),get:async key=>files.get(key)};
 const f=await fixture(storage);try{
  const bytes=await sample();assert.equal((await f.upload([bytes])).status,422);assert.equal(files.size,2);await f.photoCleanup.cleanup(true);assert.equal(files.size,2);
  assert.equal((await f.db.all("SELECT * FROM media_writes WHERE state='unknown'")).length,1);late();assert.equal(files.size,3);
  fail=false;assert.equal((await f.upload([bytes])).status,201);await f.photoCleanup.cleanup(true);assert.equal(files.size,6);assert.equal((await f.db.all('SELECT * FROM photos')).length,1);
  assert.equal((await f.db.all('SELECT * FROM photo_cleanup')).length,1);
 }finally{await f.close();}
});
