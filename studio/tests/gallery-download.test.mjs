import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import pg from 'pg';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';
import {openDatabase} from '../server/db.mjs';

const id=()=>randomBytes(16).toString('hex');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const privateResponse=response=>{
 assert.match(response.headers.get('cache-control')||'',/\bno-store\b/);
 assert.match(response.headers.get('cache-control')||'',/\bprivate\b/);
};
const bytes=response=>response.arrayBuffer().then(buffer=>Buffer.from(buffer));

// Read the actual ZIP index and payloads, independently of the archive writer.
function zipEntries(buffer){
 let end=buffer.length-22;
 while(end>=Math.max(0,buffer.length-65557)&&buffer.readUInt32LE(end)!==0x06054b50)end--;
 assert.ok(end>=0,'ZIP has an end-of-central-directory record');
 const count=buffer.readUInt16LE(end+10),entries=[];
 let offset=buffer.readUInt32LE(end+16);
 for(let index=0;index<count;index++){
  assert.equal(buffer.readUInt32LE(offset),0x02014b50);
  const method=buffer.readUInt16LE(offset+10),size=buffer.readUInt32LE(offset+20),plainSize=buffer.readUInt32LE(offset+24);
  const nameLength=buffer.readUInt16LE(offset+28),extraLength=buffer.readUInt16LE(offset+30),commentLength=buffer.readUInt16LE(offset+32);
  const name=buffer.subarray(offset+46,offset+46+nameLength).toString('utf8');
  const local=buffer.readUInt32LE(offset+42);
  assert.equal(buffer.readUInt32LE(local),0x04034b50);
  const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);
  const compressed=buffer.subarray(start,start+size);
  assert.ok(method===0||method===8,'ZIP uses a standard supported compression method');
  const data=method===0?compressed:inflateRawSync(compressed);
  assert.equal(data.length,plainSize);
  entries.push({name,data});
  offset+=46+nameLength+extraLength+commentLength;
 }
 assert.equal(offset,buffer.readUInt32LE(end+16)+buffer.readUInt32LE(end+12));
 return entries;
}

async function fixture(){
 const dir=await mkdtemp(path.join(tmpdir(),'gallery-download-'));
 let pool,schema,url=null;
 if(process.env.STUDIO_TEST_POSTGRES_URL){
  pool=new pg.Pool({connectionString:process.env.STUDIO_TEST_POSTGRES_URL});
  schema='download_test_'+randomBytes(8).toString('hex');
  await pool.query('CREATE SCHEMA '+schema);
  const target=new URL(process.env.STUDIO_TEST_POSTGRES_URL);
  target.searchParams.set('options','-c search_path='+schema);url=target.href;
 }
 const db=await openDatabase(dir,{url}),files=new Map(),reads=[];
 let readHook=async()=>{},adminCookie='';
 const storage={
  put:async(name,data)=>files.set(name,Buffer.from(data)),
  get:async(name,options={})=>{reads.push(name);await readHook(name,options);if(!files.has(name))throw Error('private storage credential: missing object');return files.get(name);},
  remove:async name=>files.delete(name)
 };
 const {app}=await createApp({db,storage,dataDir:dir,env:{},origin:'http://localhost'});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const request=(route,body,{method=body===undefined?'GET':'POST',cookie=adminCookie,headers={},signal}={})=>fetch(base+route,{
  method,signal,headers:{Origin:'http://localhost',Cookie:cookie,...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},
  body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)
 });
 const setup=await request('/api/admin/setup',{email:'download@example.com',password:'download-test-password'});
 assert.equal(setup.status,201);adminCookie=setup.headers.get('set-cookie').split(';')[0];
 let albumNumber=0;
 const createAlbum=async()=>{
  const response=await request('/api/admin/albums',{title:'Download test '+(++albumNumber),category:'wedding',status:'private',password:'gallery-test-password'});
  assert.equal(response.status,201);return (await response.json()).id;
 };
 const album=await createAlbum();
 const unlock=async(target=album)=>{
  const response=await request('/api/gallery/'+target+'/unlock',{password:'gallery-test-password'},{cookie:''});
  assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];
 };
 const galleryCookie=await unlock();
 const seed=async({target=album,original='CC - 0001.jpg',position=0,section=null,selected=true,legacy=false,width=96,height=64,color='#b27c51'}={})=>{
  const key=id(),input=sharp({create:{width,height,channels:3,background:color}});
  const full=await input.clone().webp().toBuffer(),jpeg=await input.clone().jpeg({quality:92}).toBuffer();
  files.set(key+'.webp',full);
  files.set(key+'-thumb.webp',await sharp({create:{width:24,height:16,channels:3,background:'#0000ff'}}).webp().toBuffer());
  if(!legacy)files.set(key+'-download.jpg',jpeg);
  await db.run('INSERT INTO photos(id,album_id,filename,original,width,height,position,section_id,download_bytes) VALUES(?,?,?,?,?,?,?,?,?)',[key,target,key,original,width,height,position,section,legacy?null:jpeg.length]);
  if(selected)await db.run('INSERT INTO selections(album_id,photo_id,updated) VALUES(?,?,?)',[target,key,new Date().toISOString()]);
  return {id:key,jpeg,full};
 };
 const download=(photos,{target=album,cookie=galleryCookie,...options}={})=>request('/api/gallery/'+target+'/download',{photos},{cookie,...options});
 return {dir,db,server,files,reads,request,album,createAlbum,unlock,galleryCookie,seed,download,setReadHook:hook=>{readHook=hook;},close:async()=>{
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await db.close();
  if(pool){await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}
  await rm(dir,{recursive:true,force:true});
 }};
}

test('A newly uploaded selected photo downloads the stored source-derived JPEG without altering the submitted selection',async()=>{
 const f=await fixture();try{
  const source=await sharp({create:{width:3000,height:2000,channels:3,background:'#b17b68'}}).jpeg().toBuffer();
  const body=new FormData();body.append('photos',new Blob([source],{type:'image/jpeg'}),'CC - 0201.jpg');
  const uploaded=await f.request('/api/admin/albums/'+f.album+'/photos',body);assert.equal(uploaded.status,201);
  const photo=(await uploaded.json()).results[0];assert.equal(photo.success,true);
  const row=await f.db.get('SELECT * FROM photos WHERE id=?',[photo.id]),stored=f.files.get(row.filename+'-download.jpg');
  assert.ok(stored?.length);assert.equal(row.download_bytes,stored.length);
  assert.equal((await f.request('/api/gallery/'+f.album+'/selection/'+photo.id,{selected:true},{method:'PUT',cookie:f.galleryCookie})).status,200);
  assert.equal((await f.request('/api/gallery/'+f.album+'/submit',{}, {cookie:f.galleryCookie})).status,200);
  const selections=await f.db.all('SELECT * FROM selections WHERE album_id=?',[f.album]);f.reads.length=0;
  const response=await f.download([photo.id]);assert.equal(response.status,200);privateResponse(response);
  assert.match(response.headers.get('content-type'),/^image\/jpeg/);
  assert.match(response.headers.get('content-disposition'),/^attachment;.*\.jpg/i);
  const output=await bytes(response);assert.deepEqual(output,stored);
  assert.equal(Number(response.headers.get('content-length')),output.length);
  const info=await sharp(output).metadata();assert.equal(info.format,'jpeg');assert.equal(info.width,2400);assert.equal(info.height,1600);
  assert.deepEqual(f.reads,[row.filename+'-download.jpg']);
  assert.deepEqual(await f.db.all('SELECT * FROM selections WHERE album_id=?',[f.album]),selections);
  assert.equal((await f.db.get('SELECT selection_status FROM albums WHERE id=?',[f.album])).selection_status,'submitted');
 }finally{await f.close();}
});

test('Selected ZIP contains only requested photos in section and photo order, with unique safe JPG filenames',async()=>{
 const f=await fixture();try{
  const first=id(),second=id();
  for(const [key,position] of [[first,0],[second,1]])await f.db.run('INSERT INTO album_sections(id,album_id,title,position) VALUES(?,?,?,?)',[key,f.album,'Section '+position,position]);
  const early=await f.seed({section:first,position:2,original:'same.JPG',color:'#aa2211'});
  const late=await f.seed({section:first,position:20,original:'../../evil\r\n.jpg',color:'#22aa11'});
  const next=await f.seed({section:second,position:0,original:'C:\\private\\same.JPG',color:'#1122aa'});
  const loose=await f.seed({position:-9,original:'.',color:'#bb33aa'});
  await f.seed({section:first,position:0,original:'not-requested.jpg'});
  const response=await f.download([loose.id,next.id,late.id,early.id]);assert.equal(response.status,200);privateResponse(response);
  assert.match(response.headers.get('content-type'),/^application\/zip/);
  assert.match(response.headers.get('content-disposition'),/^attachment;.*\.zip/i);
  const output=await bytes(response);assert.equal(Number(response.headers.get('content-length')),output.length);
  const entries=zipEntries(output);assert.equal(entries.length,4);
  assert.equal(new Set(entries.map(entry=>entry.name.toLowerCase())).size,4);
  const expected=[early,late,next,loose];
  for(const [index,entry] of entries.entries()){
   assert.match(entry.name,new RegExp('^'+String(index+1).padStart(3,'0')));
   assert.match(entry.name,/\.jpg$/);assert.doesNotMatch(entry.name,/[\\/\x00-\x1f\x7f]|\.\./);
   assert.deepEqual(entry.data,expected[index].jpeg);assert.equal((await sharp(entry.data).metadata()).format,'jpeg');
  }
  assert.match(entries[0].name,/same\.jpg$/i);assert.match(entries[2].name,/same\.jpg$/i);
 }finally{await f.close();}
});

test('Legacy photos use the full WebP for JPEG conversion and never the small thumbnail',async()=>{
 const f=await fixture();try{
  const photo=await f.seed({legacy:true,width:2400,height:1600,color:'#cd7d55'});
  const response=await f.download([photo.id]);assert.equal(response.status,200);privateResponse(response);
  const output=await bytes(response),info=await sharp(output).metadata();
  assert.equal(info.format,'jpeg');assert.equal(info.width,2400);assert.equal(info.height,1600);
  const sample=await sharp(output).resize(1,1).raw().toBuffer();assert.ok(sample[0]>sample[2],'full-image warm colors survive, rather than blue thumbnail');
  assert.deepEqual(f.reads,[photo.id+'.webp']);
  assert.equal((await f.db.get('SELECT download_bytes FROM photos WHERE id=?',[photo.id])).download_bytes,null);
 }finally{await f.close();}
});

test('Private downloads require a live gallery or admin session and reject closed albums and foreign origins',async()=>{
 const f=await fixture();try{
  const photo=await f.seed();
  let response=await f.download([photo.id],{cookie:''});assert.equal(response.status,401);privateResponse(response);
  assert.match(response.headers.get('content-type'),/json/);assert.equal(f.reads.length,0);
  const other=await f.createAlbum(),otherCookie=await f.unlock(other);
  response=await f.download([photo.id],{cookie:otherCookie});assert.equal(response.status,401);privateResponse(response);assert.equal(f.reads.length,0);
  response=await f.request('/api/gallery/'+f.album+'/download',{photos:[photo.id]});assert.equal(response.status,200);await response.arrayBuffer();
  response=await f.download([photo.id],{headers:{Origin:'https://foreign.example'}});assert.equal(response.status,403);assert.match(response.headers.get('cache-control'),/no-store/);
  assert.equal((await f.request('/api/gallery/'+f.album+'/logout',{}, {cookie:f.galleryCookie})).status,200);
  response=await f.download([photo.id]);assert.equal(response.status,401);privateResponse(response);
  const cookie=await f.unlock();
  assert.equal((await f.request('/api/admin/albums/'+f.album,{title:'Changed password',category:'wedding',status:'private',password:'new-gallery-password'},{method:'PATCH'})).status,200);
  response=await f.download([photo.id],{cookie});assert.equal(response.status,401);privateResponse(response);
  await f.db.run("UPDATE albums SET status='published' WHERE id=?",[f.album]);
  response=await f.request('/api/gallery/'+f.album+'/download',{photos:[photo.id]});assert.equal(response.status,404);privateResponse(response);
  response=await f.download([photo.id],{target:id()});assert.equal(response.status,404);privateResponse(response);
 }finally{await f.close();}
});

test('Invalid lists and stale, unselected, or cross-album photos fail before any private file is read',async()=>{
 const f=await fixture();try{
  const selected=await f.seed(),unselected=await f.seed({selected:false}),other=await f.createAlbum(),foreign=await f.seed({target:other});
  const invalid=[undefined,null,[],{},'not-an-array',[selected.id,selected.id],[null],['../private'],Array.from({length:51},id)];
  for(const photos of invalid){
   const response=await f.download(photos);assert.equal(response.status,422,JSON.stringify(photos));privateResponse(response);
   assert.equal(response.headers.get('content-disposition'),null);
  }
  for(const photos of [[unselected.id],[foreign.id],[id()],[selected.id,unselected.id]]){
   const response=await f.download(photos);assert.equal(response.status,409);privateResponse(response);
   assert.match(response.headers.get('content-type'),/json/);assert.equal(response.headers.get('content-disposition'),null);
  }
  assert.deepEqual(f.reads,[]);
 }finally{await f.close();}
});

test('Missing stored JPEG or failed archive preparation returns sanitized JSON, then releases capacity for retry',async()=>{
 const f=await fixture();try{
  const first=await f.seed({position:0}),second=await f.seed({position:1});
  f.files.delete(second.id+'-download.jpg');
  const response=await f.download([first.id,second.id]);assert.equal(response.status,503);privateResponse(response);
  assert.match(response.headers.get('content-type'),/json/);assert.equal(response.headers.get('content-disposition'),null);
  assert.doesNotMatch(await response.text(),/credential|missing object|private storage/);
  assert.ok(!f.reads.includes(second.id+'.webp'),'missing new rendition must not silently fall back to a lower-quality image');
  f.files.set(second.id+'-download.jpg',second.jpeg);
  const retried=await f.download([first.id,second.id]);assert.equal(retried.status,200);assert.equal(zipEntries(await bytes(retried)).length,2);
 }finally{await f.close();}
});

test('Album and global download concurrency limits reject duplicate work and recover after completion', {timeout:30000},async()=>{
 const f=await fixture(),release=deferred();try{
  const first=await f.seed(),secondAlbum=await f.createAlbum(),thirdAlbum=await f.createAlbum();
  const second=await f.seed({target:secondAlbum}),third=await f.seed({target:thirdAlbum});
  const secondCookie=await f.unlock(secondAlbum),thirdCookie=await f.unlock(thirdAlbum);
  const startedFirst=deferred(),startedSecond=deferred();
  f.setReadHook(async name=>{if(name===first.id+'-download.jpg'){startedFirst.resolve();await release.promise;}if(name===second.id+'-download.jpg'){startedSecond.resolve();await release.promise;}});
  const pendingFirst=f.download([first.id]);await startedFirst.promise;
  const duplicate=await f.download([first.id]);assert.equal(duplicate.status,429);privateResponse(duplicate);
  const pendingSecond=f.download([second.id],{target:secondAlbum,cookie:secondCookie});await startedSecond.promise;
  const busy=await f.download([third.id],{target:thirdAlbum,cookie:thirdCookie});assert.equal(busy.status,429);privateResponse(busy);
  release.resolve();
  for(const response of await Promise.all([pendingFirst,pendingSecond])){assert.equal(response.status,200);await response.arrayBuffer();}
  const retry=await f.download([third.id],{target:thirdAlbum,cookie:thirdCookie});assert.equal(retry.status,200);await retry.arrayBuffer();
 }finally{release.resolve();await f.close();}
});

test('Revoking access or removing a selection during preparation prevents prepared private bytes from being sent', {timeout:30000},async()=>{
 const f=await fixture();let release;try{
  const photo=await f.seed();
  for(const action of ['revoke','deselect','close']){
   await f.db.run("UPDATE albums SET status='private' WHERE id=?",[f.album]);
   await f.db.run('INSERT INTO selections(album_id,photo_id,updated) VALUES(?,?,?) ON CONFLICT(album_id,photo_id) DO NOTHING',[f.album,photo.id,new Date().toISOString()]);
   const cookie=await f.unlock(),started=deferred();release=deferred();
   f.setReadHook(async()=>{started.resolve();await release.promise;});
   const pending=f.download([photo.id],{cookie});await started.promise;
   if(action==='revoke')await f.request('/api/gallery/'+f.album+'/logout',{}, {cookie});
   else if(action==='deselect')await f.db.run('DELETE FROM selections WHERE album_id=? AND photo_id=?',[f.album,photo.id]);
   else await f.db.run("UPDATE albums SET status='archived' WHERE id=?",[f.album]);
   release.resolve();const response=await pending;
   assert.equal(response.status,action==='revoke'?401:action==='deselect'?409:404,action);privateResponse(response);
   assert.match(response.headers.get('content-type'),/json/);assert.equal(response.headers.get('content-disposition'),null);
  }
 }finally{release?.resolve();await f.close();}
});

test('The response size limit uses actual stored bytes and returns JSON rather than a truncated archive',async()=>{
 const f=await fixture();try{
  const photos=await Promise.all([0,1,2].map(position=>f.seed({position})));
  // Storage can disagree with historical byte metadata. Reuse one padded valid
  // JPEG buffer so the test covers the real 100 MiB boundary with modest memory.
  const oversized=Buffer.alloc(34*1024*1024);photos[0].jpeg.copy(oversized);
  for(const photo of photos)f.files.set(photo.id+'-download.jpg',oversized);
  const response=await f.download(photos.map(photo=>photo.id));assert.equal(response.status,413);privateResponse(response);
  assert.match(response.headers.get('content-type'),/json/);assert.equal(response.headers.get('content-disposition'),null);
  assert.ok((await response.text()).length<1000);
  for(const photo of photos)f.files.set(photo.id+'-download.jpg',photo.jpeg);
  const retry=await f.download(photos.map(photo=>photo.id));assert.equal(retry.status,200);assert.equal(zipEntries(await bytes(retry)).length,3);
 }finally{await f.close();}
});

test('Aborting a client download cancels storage preparation and releases the album slot', {timeout:30000},async()=>{
 const f=await fixture(),controller=new AbortController();try{
  const photo=await f.seed(),started=deferred(),stopped=deferred();let block=true;
  f.setReadHook(async(name,{signal})=>{
   if(!block)return;
   assert.ok(signal instanceof AbortSignal);started.resolve();
   await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{stopped.resolve();reject(signal.reason);},{once:true}));
  });
  const pending=f.download([photo.id],{signal:controller.signal});await started.promise;
  block=false;controller.abort();await assert.rejects(pending,{name:'AbortError'});await stopped.promise;
  const retry=await f.download([photo.id]);assert.equal(retry.status,200);assert.deepEqual(await bytes(retry),photo.jpeg);
 }finally{controller.abort();await f.close();}
});

test('Long Unicode source names remain downloadable without invalid filename headers',async()=>{
 const f=await fixture();try{
  const photo=await f.seed({original:'a'.repeat(99)+'🌸 ảnh cô dâu.jpg'});
  const response=await f.download([photo.id]);assert.equal(response.status,200);privateResponse(response);
  assert.match(response.headers.get('content-disposition'),/^attachment;/);
  assert.deepEqual(await bytes(response),photo.jpeg);
 }finally{await f.close();}
});

test('Exactly 50 selected photos form one complete ZIP at the supported batch boundary',async()=>{
 const f=await fixture();try{
  const first=await f.seed(),photos=[first.id];
  for(let position=1;position<50;position++){
   const key=id();photos.push(key);f.files.set(key+'-download.jpg',first.jpeg);
   await f.db.run('INSERT INTO photos(id,album_id,filename,original,width,height,position,download_bytes) VALUES(?,?,?,?,?,?,?,?)',[key,f.album,key,'same.jpg',96,64,position,first.jpeg.length]);
   await f.db.run('INSERT INTO selections(album_id,photo_id,updated) VALUES(?,?,?)',[f.album,key,new Date().toISOString()]);
  }
  const response=await f.download(photos);assert.equal(response.status,200);privateResponse(response);
  const entries=zipEntries(await bytes(response));assert.equal(entries.length,50);assert.equal(new Set(entries.map(entry=>entry.name)).size,50);
  assert.match(entries.at(-1).name,/^050-/);for(const entry of entries)assert.deepEqual(entry.data,first.jpeg);
 }finally{await f.close();}
});


test('Disconnecting during selection lookup does not start archive work or occupy a download slot', {timeout:30000},async()=>{
 const f=await fixture(),controller=new AbortController(),release=deferred(),started=deferred(),closed=deferred(),finished=deferred();
 try{
  const photo=await f.seed(),all=f.db.all.bind(f.db);let hold=true;
  f.db.all=async(...args)=>{
   if(hold&&args[0].startsWith('SELECT p.* FROM photos p JOIN selections')){
    hold=false;started.resolve();await release.promise;
    try{return await all(...args);}finally{finished.resolve();}
   }
   return all(...args);
  };
  f.server.once('request',(req,res)=>res.once('close',closed.resolve));
  const pending=f.download([photo.id],{signal:controller.signal});await started.promise;
  controller.abort();await assert.rejects(pending,{name:'AbortError'});await closed.promise;
  release.resolve();await finished.promise;await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.reads,[],'An already disconnected request must not read private files');
  const retry=await f.download([photo.id]);assert.equal(retry.status,200);assert.deepEqual(await bytes(retry),photo.jpeg);
 }finally{release.resolve();controller.abort();await f.close();}
});

test('Direct single photo download route validates session and serves high-res JPEG',async()=>{
 const f=await fixture();
 try{
  const photo=await f.seed({original:'wedding ceremony.jpg',caption:'Lễ gia tiên'});
  const unauth=await f.request('/api/gallery/'+f.album+'/photos/'+photo.id+'/download',undefined,{cookie:''});
  assert.equal(unauth.status,401);
  const res=await f.request('/api/gallery/'+f.album+'/photos/'+photo.id+'/download',undefined,{cookie:f.galleryCookie});
  assert.equal(res.status,200);
  assert.equal(res.headers.get('content-type'),'image/jpeg');
  assert.match(res.headers.get('content-disposition')||'',/attachment/);
  assert.deepEqual(await bytes(res),photo.jpeg);
  const notFound=await f.request('/api/gallery/'+f.album+'/photos/'+id()+'/download',undefined,{cookie:f.galleryCookie});
  assert.equal(notFound.status,404);
 }finally{await f.close();}
});

const direct=(f,photo,{kind='gallery',target=f.album,cookie=f.galleryCookie,...options}={})=>f.request(`/api/${kind}/${target}/photos/${photo}/download`,undefined,{cookie,...options});

test('Direct downloads allow unselected photos, preserve public slug access, and never cross album boundaries',async()=>{
 const f=await fixture();try{
  const photo=await f.seed({selected:false}),other=await f.createAlbum(),foreign=await f.seed({target:other});
  for(const kind of ['gallery','albums']){
   const response=await direct(f,photo.id,{kind});assert.equal(response.status,200);privateResponse(response);assert.deepEqual(await bytes(response),photo.jpeg);
   f.reads.length=0;
   assert.equal((await direct(f,foreign.id,{kind})).status,404);assert.deepEqual(f.reads,[]);
   assert.equal((await direct(f,photo.id,{kind,cookie:''})).status,kind==='gallery'?401:404);assert.deepEqual(f.reads,[]);
  }
  await f.db.run("UPDATE albums SET status='published' WHERE id=?",[f.album]);
  const {slug}=await f.db.get('SELECT slug FROM albums WHERE id=?',[f.album]);
  const response=await direct(f,photo.id,{kind:'albums',target:slug,cookie:''});assert.equal(response.status,200);privateResponse(response);assert.deepEqual(await bytes(response),photo.jpeg);
  assert.deepEqual(await f.db.all('SELECT * FROM selections WHERE album_id=?',[f.album]),[]);
 }finally{await f.close();}
});

test('Direct HEAD requests authorize but never read or convert stored and legacy images',async()=>{
 const f=await fixture();try{
  for(const legacy of [false,true]){
   const photo=await f.seed({legacy});
   for(const kind of ['gallery','albums']){
    const response=await direct(f,photo.id,{kind,method:'HEAD'});assert.equal(response.status,200);privateResponse(response);
    assert.equal(response.headers.get('content-type'),'image/jpeg');
    assert.equal(response.headers.get('content-length'),legacy?null:String(photo.jpeg.length));
    assert.equal((await bytes(response)).length,0);
   }
  }
  assert.deepEqual(f.reads,[]);
 }finally{await f.close();}
});

test('Direct downloads share archive capacity and return Retry-After until active reads complete', {timeout:30000},async()=>{
 const f=await fixture(),release=deferred();try{
  const photo=await f.seed(),secondAlbum=await f.createAlbum(),thirdAlbum=await f.createAlbum();
  const second=await f.seed({target:secondAlbum}),third=await f.seed({target:thirdAlbum});
  const secondCookie=await f.unlock(secondAlbum),thirdCookie=await f.unlock(thirdAlbum),started=deferred(),startedSecond=deferred();
  f.setReadHook(async name=>{if(name===photo.id+'-download.jpg'){started.resolve();await release.promise;}if(name===second.id+'-download.jpg'){startedSecond.resolve();await release.promise;}});
  const pending=direct(f,photo.id);await started.promise;
  for(const request of [()=>direct(f,photo.id,{kind:'albums'}),()=>f.download([photo.id])]){
   const response=await request();assert.equal(response.status,429);privateResponse(response);assert.equal(response.headers.get('retry-after'),'5');
  }
  const pendingSecond=f.download([second.id],{target:secondAlbum,cookie:secondCookie});await startedSecond.promise;
  assert.equal((await direct(f,third.id,{target:thirdAlbum,cookie:thirdCookie})).status,429);
  release.resolve();
  for(const response of await Promise.all([pending,pendingSecond])){assert.equal(response.status,200);await response.arrayBuffer();}
  assert.equal((await direct(f,third.id,{target:thirdAlbum,cookie:thirdCookie})).status,200);
 }finally{release.resolve();await f.close();}
});

test('Direct downloads recheck logout, photo deletion and album closure after delayed storage reads', {timeout:30000},async()=>{
 const f=await fixture();let release;try{
  for(const kind of ['gallery','albums'])for(const action of ['logout','delete','close']){
   const photo=await f.seed(),cookie=await f.unlock(),started=deferred();release=deferred();
   f.setReadHook(async()=>{started.resolve();await release.promise;});
   const pending=direct(f,photo.id,{kind,cookie});await started.promise;
   if(action==='logout')await f.request('/api/gallery/'+f.album+'/logout',{}, {cookie});
   else if(action==='delete')await f.db.run('DELETE FROM photos WHERE id=?',[photo.id]);
   else await f.db.run("UPDATE albums SET status='archived' WHERE id=?",[f.album]);
   release.resolve();const response=await pending;
   assert.equal(response.status,kind==='gallery'&&action==='logout'?401:404,kind+' '+action);privateResponse(response);
   assert.match(response.headers.get('content-type'),/json/);assert.equal(response.headers.get('content-disposition'),null);
   await f.db.run("UPDATE albums SET status='private' WHERE id=?",[f.album]);
  }
  await f.db.run("UPDATE albums SET status='published' WHERE id=?",[f.album]);
  const photo=await f.seed(),started=deferred();release=deferred();
  f.setReadHook(async()=>{started.resolve();await release.promise;});
  const pending=direct(f,photo.id,{kind:'albums',cookie:''});await started.promise;
  await f.db.run("UPDATE albums SET status='private' WHERE id=?",[f.album]);
  release.resolve();assert.equal((await pending).status,404);
 }finally{release?.resolve();await f.close();}
});

test('Direct download abort cancels upstream read and a storage failure releases capacity for retry', {timeout:30000},async()=>{
 const f=await fixture(),controller=new AbortController();try{
  const photo=await f.seed(),started=deferred(),stopped=deferred();
  f.setReadHook(async(name,{signal})=>{
   assert.ok(signal instanceof AbortSignal);started.resolve();
   await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{stopped.resolve();reject(signal.reason);},{once:true}));
  });
  const pending=direct(f,photo.id,{signal:controller.signal});await started.promise;controller.abort();
  await assert.rejects(pending,{name:'AbortError'});await stopped.promise;
  f.setReadHook(async()=>{});f.files.delete(photo.id+'-download.jpg');
  const failed=await direct(f,photo.id);assert.equal(failed.status,503);privateResponse(failed);assert.match(failed.headers.get('content-type'),/json/);assert.doesNotMatch(await failed.text(),/credential|private storage/);
  f.files.set(photo.id+'-download.jpg',photo.jpeg);
  const retried=await direct(f,photo.id);assert.equal(retried.status,200);assert.deepEqual(await bytes(retried),photo.jpeg);
 }finally{controller.abort();await f.close();}
});

test('Direct legacy downloads convert the full image and reject oversized stored metadata before reading',async()=>{
 const f=await fixture();try{
  const photo=await f.seed({legacy:true,width:1200,height:800});
  const response=await direct(f,photo.id);assert.equal(response.status,200);
  const metadata=await sharp(await bytes(response)).metadata();assert.equal(metadata.format,'jpeg');assert.equal(metadata.width,1200);assert.equal(metadata.height,800);
  assert.deepEqual(f.reads,[photo.id+'.webp']);f.reads.length=0;
  await f.db.run('UPDATE photos SET download_bytes=? WHERE id=?',[101*1024*1024,photo.id]);
  const oversized=await direct(f,photo.id);assert.equal(oversized.status,413);privateResponse(oversized);assert.equal(oversized.headers.get('content-disposition'),null);assert.deepEqual(f.reads,[]);
 }finally{await f.close();}
});

test('Abandoning a gallery image cancels its storage read without affecting subsequent views', {timeout:30000},async()=>{
 const f=await fixture(),controller=new AbortController();try{
  const photo=await f.seed(),started=deferred(),stopped=deferred();
  f.setReadHook(async(name,{signal})=>{
   assert.ok(signal instanceof AbortSignal);started.resolve();
   await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{stopped.resolve();reject(signal.reason);},{once:true}));
  });
  const pending=f.request('/media/'+photo.id,undefined,{cookie:f.galleryCookie,signal:controller.signal});await started.promise;controller.abort();
  await assert.rejects(pending,{name:'AbortError'});await stopped.promise;
  f.setReadHook(async()=>{});
  const response=await f.request('/media/'+photo.id,undefined,{cookie:f.galleryCookie});assert.equal(response.status,200);privateResponse(response);assert.deepEqual(await bytes(response),photo.full);
 }finally{controller.abort();await f.close();}
});

test('Failed media reads return uncached sanitized JSON and remain retriable',async()=>{
 const f=await fixture();try{
  const photo=await f.seed();f.files.delete(photo.id+'.webp');
  for(const status of ['private','published']){
   await f.db.run('UPDATE albums SET status=? WHERE id=?',[status,f.album]);
   const response=await f.request('/media/'+photo.id,undefined,{cookie:f.galleryCookie});assert.equal(response.status,500);privateResponse(response);
   assert.match(response.headers.get('content-type'),/application\/json/);assert.doesNotMatch(await response.text(),/credential|private storage/);
  }
  f.files.set(photo.id+'.webp',photo.full);
  const retry=await f.request('/media/'+photo.id);assert.equal(retry.status,200);assert.deepEqual(await bytes(retry),photo.full);
 }finally{await f.close();}
});
