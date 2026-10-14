import pg from 'pg';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';
import {openDatabase} from '../server/db.mjs';
import {orderedPhotos,sectionPhotos,sectionTabs} from '../web/album-sections.mjs';

async function fixture(){
 const dir=await mkdtemp(path.join(tmpdir(),'chicong-sections-'));
 let pool,schema,url=null;
 if(process.env.STUDIO_TEST_POSTGRES_URL){pool=new pg.Pool({connectionString:process.env.STUDIO_TEST_POSTGRES_URL});schema='sections_test_'+randomBytes(8).toString('hex');await pool.query('CREATE SCHEMA '+schema);const target=new URL(process.env.STUDIO_TEST_POSTGRES_URL);target.searchParams.set('options','-c search_path='+schema);url=target.href;}
 const db=await openDatabase(dir,{url});
 const {app}=await createApp({db,dataDir:dir,env:{},origin:'http://localhost'});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 let cookie='';
 const request=(url,data,method='GET',auth=true,headers={})=>fetch(base+url,{method,headers:{Origin:'http://localhost',...(data instanceof FormData?{}:{'Content-Type':'application/json'}),...(auth?{Cookie:cookie}:{}),...headers},body:data instanceof FormData?data:data===undefined?undefined:JSON.stringify(data)});
 const setup=await request('/api/admin/setup',{email:'sections@example.com',password:'sections-test-password'},'POST');assert.equal(setup.status,201);cookie=setup.headers.get('set-cookie').split(';')[0];
 const album=async(status='published')=>{const r=await request('/api/admin/albums',{title:'Ngày cưới',category:'wedding',status,password:status==='private'?'gallery-pass':''},'POST');assert.equal(r.status,201);return (await r.json()).id;};
 const add=async(a,title)=>{const r=await request(`/api/admin/albums/${a}/sections`,{title},'POST');assert.equal(r.status,201);return r.json();};
 const photo=async(a,key,position=0)=>db.run('INSERT INTO photos(id,album_id,filename,original,caption,width,height,position) VALUES(?,?,?,?,?,?,?,?)',[key,a,key,key+'.jpg','Keep caption',80,120,position]);
 return {db,dir,request,album,add,photo,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await db.close();if(pool){await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}await rm(dir,{recursive:true,force:true});}};
}
test('Section CRUD, exact reordering, DTO and backup preserve legacy albums',async()=>{
 const f=await fixture();try{
  const a=await f.album(),b=await f.album();await f.photo(a,'p');
  let dto=await(await f.request('/api/albums/'+a)).json();assert.deepEqual(dto.sections,[]);assert.equal(dto.photos[0].section_id,null);
  const first=await f.add(a,'Trang trí'),second=await f.add(a,'Gia tiên'),foreign=await f.add(b,'Other');
  const endpoint=`/api/admin/albums/${a}/sections`;
  for(const title of ['',null,' '.repeat(5),'x'.repeat(121)])assert.equal((await f.request(endpoint,{title},'POST')).status,422);
  assert.equal((await f.request('/api/admin/sections/'+first.id,{position:-1},'PATCH')).status,422);
  for(const order of [[first.id],[first.id,first.id],[foreign.id,first.id]])assert.equal((await f.request(endpoint+'/order',{sections:order},'PUT')).status,422);
  assert.equal((await f.request(endpoint+'/order',{sections:[second.id,first.id]},'PUT')).status,200);
  assert.equal((await f.request('/api/admin/sections/'+first.id,{title:'Chi tiết trang trí'},'PATCH')).status,200);
  dto=await(await f.request('/api/albums/'+a)).json();assert.deepEqual(dto.sections.map(s=>s.id),[second.id,first.id]);assert.equal(dto.sections[1].title,'Chi tiết trang trí');assert.deepEqual(dto.sections.map(s=>s.position),[0,1]);
  assert.deepEqual(await(await f.request(endpoint)).json(),dto.sections);
  const backup=await(await f.request('/api/admin/export')).json();assert.equal(backup.album_sections.length,3);assert.equal(backup.photos[0].section_id,null);
  assert.equal((await f.request('/api/admin/albums/missing/sections')).status,404);
  assert.equal((await f.request('/api/admin/sections/missing',{},'DELETE')).status,404);
 }finally{await f.close();}
});
test('Assignments reject foreign IDs and invalid batches atomically; patch preserves caption',async()=>{
 const f=await fixture();try{
  const a=await f.album(),b=await f.album(),s=await f.add(a,'Lễ'),foreign=await f.add(b,'Other');
  await f.photo(a,'p1');await f.photo(a,'p2',1);await f.photo(b,'foreign');
  const endpoint=`/api/admin/albums/${a}/photos/sections`,good={photo_id:'p1',section_id:s.id};
  for(const assignments of [[],null,[good,good],[good,{photo_id:'foreign',section_id:s.id}],[good,{photo_id:'p2',section_id:foreign.id}],[good,{photo_id:'p2'}],[null]]){
   assert.equal((await f.request(endpoint,{assignments},'PUT')).status,422);
   assert.equal((await f.db.get("SELECT section_id FROM photos WHERE id='p1'")).section_id,null);
  }
  assert.equal((await f.request('/api/admin/photos/p1',{section_id:foreign.id},'PATCH')).status,422);
  assert.equal((await f.request('/api/admin/photos/p1',{section_id:s.id},'PATCH')).status,200);
  assert.equal((await f.db.get("SELECT caption FROM photos WHERE id='p1'")).caption,'Keep caption');
  assert.equal((await f.request('/api/admin/photos/p1',{caption:'Edited'},'PATCH')).status,200);
  assert.equal((await f.db.get("SELECT section_id FROM photos WHERE id='p1'")).section_id,s.id);
  assert.equal((await f.request(endpoint,{assignments:[{photo_id:'p1',section_id:null},{photo_id:'p2',section_id:s.id}]},'PUT')).status,200);
  const dto=await(await f.request('/api/albums/'+a)).json();assert.deepEqual(dto.photos.map(p=>p.section_id),[null,s.id]);
  assert.equal((await f.request(endpoint,{assignments:[{photo_id:'p2',section_id:null}]},'PUT')).status,200);
  assert.equal((await f.db.get("SELECT section_id FROM photos WHERE id='p2'")).section_id,null);
 }finally{await f.close();}
});
test('Private sections stay locked; section removal retains photos, picks and CSV content',async()=>{
 const f=await fixture();try{
  const a=await f.album('private'),s=await f.add(a,'=Gia tiên,"nhà gái"');await f.photo(a,'p');
  await f.request('/api/admin/photos/p',{section_id:s.id},'PATCH');
  assert.deepEqual(await(await f.request('/api/gallery/'+a,undefined,'GET',false)).json(),{locked:true});
  assert.equal((await f.request('/api/albums/'+a,undefined,'GET',false)).status,404);
  const unlocked=await f.request('/api/gallery/'+a+'/unlock',{password:'gallery-pass'},'POST',false),headers={Cookie:unlocked.headers.get('set-cookie').split(';')[0]};
  const dto=await(await f.request('/api/gallery/'+a,undefined,'GET',false,headers)).json();assert.equal(dto.sections[0].title,s.title);
  assert.equal((await f.request(`/api/gallery/${a}/selection/p`,{selected:true},'PUT',false,headers)).status,200);
  const csv=await(await f.request(`/api/admin/albums/${a}/selections.csv`)).text();assert.match(csv,/ID,File,Caption,Section/);assert.ok(csv.includes('"\'=Gia tiên,""nhà gái"""'));
  for(const [url,method,body] of [[`/api/admin/albums/${a}/sections`,'GET'],[`/api/admin/albums/${a}/sections`,'POST',{title:'x'}],[`/api/admin/sections/${s.id}`,'PATCH',{title:'x'}],[`/api/admin/sections/${s.id}`,'DELETE'],[`/api/admin/albums/${a}/sections/order`,'PUT',{sections:[s.id]}],[`/api/admin/albums/${a}/photos/sections`,'PUT',{assignments:[{photo_id:'p',section_id:null}]}]])assert.equal((await f.request(url,body,method,false,headers)).status,401);
  assert.equal((await f.request('/api/admin/sections/'+s.id,undefined,'DELETE')).status,200);
  const after=await(await f.request('/api/gallery/'+a,undefined,'GET',false,headers)).json();assert.deepEqual(after.sections,[]);assert.equal(after.photos[0].section_id,null);assert.equal(after.photos[0].selected,true);
  assert.match(await(await f.request(`/api/admin/albums/${a}/selections.csv`)).text(),/Chưa phân loại/);
 }finally{await f.close();}
});
test('Upload destination persists and retry does not move a previously acknowledged photo',async()=>{
 const f=await fixture();try{
  const a=await f.album(),b=await f.album(),s=await f.add(a,'Lễ'),other=await f.add(b,'Other');
  const bytes=await sharp({create:{width:50,height:60,channels:3,background:'#557755'}}).jpeg().toBuffer();
  const upload=async(section,key)=>{const fd=new FormData();fd.append('photos',new Blob([bytes],{type:'image/jpeg'}),'test.jpg');return f.request(`/api/admin/albums/${a}/photos`,fd,'POST',true,{'X-Album-Section':section,'X-Upload-Keys':JSON.stringify([key])});};
  assert.equal((await upload(other.id,'a'.repeat(32))).status,422);assert.equal((await f.db.all('SELECT * FROM photos')).length,0);
  const r=await upload(s.id,'a'.repeat(32));assert.equal(r.status,201);const key=(await r.json()).results[0].id;
  assert.equal((await f.db.get('SELECT section_id FROM photos WHERE id=?',[key])).section_id,s.id);
  await f.request('/api/admin/photos/'+key,{section_id:null},'PATCH');const retry=await upload(s.id,'a'.repeat(32));assert.equal((await retry.json()).results[0].reused,true);
  assert.equal((await f.db.all('SELECT * FROM photos')).length,1);assert.equal((await f.db.get('SELECT section_id FROM photos WHERE id=?',[key])).section_id,null);
 }finally{await f.close();}
});
test('Section migration upgrades real legacy tables, is repeatable and cascades safely',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sections-migration-'));let db;
 try{
  const raw=new DatabaseSync(path.join(dir,'studio.sqlite'));
  raw.exec("CREATE TABLE albums(id TEXT PRIMARY KEY,title TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'draft',password TEXT,cover_id TEXT,client_name TEXT NOT NULL DEFAULT '',event_date TEXT NOT NULL DEFAULT '',selection_status TEXT NOT NULL DEFAULT 'draft',created TEXT NOT NULL DEFAULT ''); CREATE TABLE photos(id TEXT PRIMARY KEY,album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,filename TEXT NOT NULL,original TEXT NOT NULL DEFAULT '',caption TEXT NOT NULL DEFAULT '',width INTEGER NOT NULL,height INTEGER NOT NULL,position INTEGER NOT NULL DEFAULT 0); INSERT INTO albums(id,title,category) VALUES('a','Existing','wedding'); INSERT INTO photos(id,album_id,filename,width,height) VALUES('p','a','original',100,200);");raw.close();
  db=await openDatabase(dir,{url:null});assert.equal((await db.get("SELECT section_id FROM photos WHERE id='p'")).section_id,null);
  await db.run("INSERT INTO album_sections(id,album_id,title) VALUES('s','a','Lễ')");await db.run("UPDATE photos SET section_id='s' WHERE id='p'");await db.close();
  db=await openDatabase(dir,{url:null});assert.equal((await db.get("SELECT section_id FROM photos WHERE id='p'")).section_id,'s');assert.equal((await db.get("SELECT filename FROM photos WHERE id='p'")).filename,'original');
  await db.run("DELETE FROM albums WHERE id='a'");assert.deepEqual(await db.all('SELECT * FROM album_sections'),[]);assert.deepEqual(await db.all('SELECT * FROM photos'),[]);
 }finally{await db?.close();await rm(dir,{recursive:true,force:true});}
});
test('All photos follow section order; filters compose with picks without mutating album',()=>{
 const album={sections:[{id:'b',title:'Second'},{id:'a',title:'<img src=x>'}],photos:[{id:'p0',position:0,section_id:null,selected:true},{id:'p1',position:1,section_id:'a',selected:true},{id:'p2',position:2,section_id:'b',selected:false},{id:'p3',position:3,section_id:'a',selected:false}]};
 assert.deepEqual(orderedPhotos(album).map(p=>p.id),['p2','p1','p3','p0']);assert.deepEqual(album.photos.map(p=>p.id),['p0','p1','p2','p3']);
 assert.deepEqual(sectionPhotos(album,'a',true).map(p=>p.id),['p1']);assert.deepEqual(sectionPhotos(album,'unassigned',true).map(p=>p.id),['p0']);assert.deepEqual(sectionPhotos(album,'b',true),[]);
 assert.match(sectionTabs(album),/&lt;img src=x&gt;/);assert.doesNotMatch(sectionTabs(album),/<img/);
 const legacy={...album,sections:[]};assert.equal(orderedPhotos(legacy),legacy.photos);assert.equal(sectionTabs(legacy),'');
});

test('Caption edits preserve a section assignment changed by another admin',async()=>{
 const f=await fixture();const original=f.db.get;try{
  const a=await f.album(),s=await f.add(a,'Lễ');await f.photo(a,'p');let intercepted=false;
  f.db.get=async(sql,params)=>{const row=await original(sql,params);if(!intercepted&&sql==='SELECT * FROM photos WHERE id=?'){intercepted=true;await f.db.run('UPDATE photos SET section_id=? WHERE id=?',[s.id,'p']);}return row;};
  assert.equal((await f.request('/api/admin/photos/p',{caption:'New caption'},'PATCH')).status,200);
  const after=await original("SELECT * FROM photos WHERE id='p'");assert.equal(after.section_id,s.id);assert.equal(after.caption,'New caption');
 }finally{f.db.get=original;await f.close();}
});
test('Renaming a section preserves its concurrently changed order',async()=>{
 const f=await fixture();const original=f.db.get;try{
  const a=await f.album(),s=await f.add(a,'Lễ');let intercepted=false;
  f.db.get=async(sql,params)=>{const row=await original(sql,params);if(!intercepted&&sql==='SELECT * FROM album_sections WHERE id=?'){intercepted=true;await f.db.run('UPDATE album_sections SET position=? WHERE id=?',[17,s.id]);}return row;};
  assert.equal((await f.request('/api/admin/sections/'+s.id,{title:'Tên mới'},'PATCH')).status,200);
  const after=await original('SELECT * FROM album_sections WHERE id=?',[s.id]);assert.equal(after.position,17);assert.equal(after.title,'Tên mới');
 }finally{f.db.get=original;await f.close();}
});
test('Concurrent section creation does not break an in-flight reorder',async()=>{
 const f=await fixture();const original=f.db.all;try{
  const a=await f.album(),s=await f.add(a,'Lễ');let intercepted=false;
  f.db.all=async(sql,params)=>{const rows=await original(sql,params);if(!intercepted&&sql==='SELECT id FROM album_sections WHERE album_id=?'){intercepted=true;await f.db.run('INSERT INTO album_sections(id,album_id,title,position) VALUES(?,?,?,?)',['new-section',a,'New',1]);}return rows;};
  assert.equal((await f.request(`/api/admin/albums/${a}/sections/order`,{sections:[s.id]},'PUT')).status,200);
  assert.equal((await f.db.get("SELECT position FROM album_sections WHERE id='new-section'")).position,1);
 }finally{f.db.all=original;await f.close();}
});
test('Section creation is retry-safe with a stable request ID',async()=>{
 const f=await fixture();try{
  const a=await f.album(),b=await f.album(),endpoint=`/api/admin/albums/${a}/sections`,request_id='f'.repeat(32),payload={title:'Lễ',request_id};
  const results=await Promise.all([f.request(endpoint,payload,'POST'),f.request(endpoint,payload,'POST')]);for(const r of results)assert.equal(r.status,201);
  const rows=await Promise.all(results.map(r=>r.json()));assert.equal(rows[0].id,rows[1].id);assert.equal((await f.db.all('SELECT * FROM album_sections WHERE album_id=?',[a])).length,1);
  assert.equal((await f.request(endpoint,{...payload,title:'Changed request'},'POST')).status,409);
  assert.equal((await f.request(`/api/admin/albums/${b}/sections`,payload,'POST')).status,409);
  assert.equal((await f.request(endpoint,{title:'Lễ',request_id:'invalid'},'POST')).status,422);
 }finally{await f.close();}
});
test('Bulk assignments support 1000 real IDs and reject oversized or cross-origin writes',async()=>{
 const f=await fixture();try{
  const a=await f.album(),s=await f.add(a,'Lễ'),assignments=[];
  for(let i=0;i<1000;i++){const key=i.toString(16).padStart(32,'0');await f.photo(a,key,i);assignments.push({photo_id:key,section_id:s.id});}
  const endpoint=`/api/admin/albums/${a}/photos/sections`;
  assert.equal((await f.request(endpoint,{assignments},'PUT',true,{Origin:'https://evil.example'})).status,403);
  assert.equal((await f.request(endpoint,{assignments:[...assignments,{photo_id:'extra',section_id:s.id}]},'PUT')).status,422);
  assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM photos WHERE section_id IS NOT NULL')).n),0);
  assert.equal((await f.request(endpoint,{assignments},'PUT')).status,200);
  assert.equal(Number((await f.db.get('SELECT COUNT(*) AS n FROM photos WHERE section_id=?',[s.id])).n),1000);
 }finally{await f.close();}
});
