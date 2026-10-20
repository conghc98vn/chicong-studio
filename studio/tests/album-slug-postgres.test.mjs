import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import {openDatabase} from '../server/db.mjs';
import {createApp} from '../server/app.mjs';

// Explicit opt-in; all tables live in a disposable schema, never public.
const connectionString=process.env.STUDIO_TEST_POSTGRES_URL;
test('PostgreSQL: legacy migration, URL history, sections, RLS and concurrent album writes',{skip:!connectionString},async()=>{
 const pool=new pg.Pool({connectionString});
 const schema='slug_test_'+randomBytes(8).toString('hex');
 const dir=await mkdtemp(path.join(tmpdir(),'chicong-pg-'));
 let db,server;
 try{
  await pool.query('CREATE SCHEMA '+schema);
  const url=new URL(connectionString);url.searchParams.set('options','-c search_path='+schema);
  db=await openDatabase(dir,{url:url.href});
  for(const id of ['legacy1','legacy2'])await db.run('INSERT INTO albums(id,title,category) VALUES(?,?,?)',[id,'Đám cưới Đà Lạt','wedding']);
  // The emulated legacy schema predates Drive triggers which reference slug
  // and section_id; production migrations remain additive.
  await db.exec('DROP TRIGGER drive_album_revision ON albums; DROP TRIGGER drive_photos_update ON photos; DROP TABLE album_slugs; DROP INDEX album_slug; ALTER TABLE albums DROP COLUMN slug; ALTER TABLE photos DROP COLUMN section_id; DROP TABLE album_sections; ALTER TABLE photos DROP COLUMN source_bytes; ALTER TABLE photos DROP COLUMN image_bytes; ALTER TABLE photos DROP COLUMN thumb_bytes; ALTER TABLE photos DROP COLUMN download_bytes;');
  await db.close();db=await openDatabase(dir,{url:url.href});
  assert.deepEqual((await db.all('SELECT slug FROM albums ORDER BY id')).map(a=>a.slug),['dam-cuoi-da-lat','dam-cuoi-da-lat-2']);
  await db.exec("DROP INDEX album_slug; UPDATE albums SET slug='';");
  await db.close();db=await openDatabase(dir,{url:url.href});
  assert.deepEqual((await db.all('SELECT slug FROM albums ORDER BY id')).map(a=>a.slug),['dam-cuoi-da-lat','dam-cuoi-da-lat-2']);
  const rls=await db.get("SELECT relrowsecurity FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace WHERE relname='album_slugs' AND n.nspname=current_schema()");assert.equal(rls.relrowsecurity,true);
  const instance=await createApp({db,dataDir:dir,env:{},origin:'http://localhost'});
  server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  let cookie='';
  const send=async(route,data,method='POST')=>fetch(base+route,{method,headers:{Origin:'http://localhost','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(data)});
  const setup=await send('/api/admin/setup',{email:'test@example.com',password:'postgres-test-password'});assert.equal(setup.status,201);cookie=setup.headers.get('set-cookie').split(';')[0];
  const payload={title:'Cùng một tên',category:'wedding',status:'published'};
  const responses=await Promise.all(Array.from({length:20},()=>send('/api/admin/albums',payload)));
  for(const r of responses)assert.equal(r.status,201);
  const albums=await Promise.all(responses.map(r=>r.json()));assert.equal(new Set(albums.map(a=>a.slug)).size,20);
  // Verify section schema migration, Postgres parameter types and FK delete behavior.
  const sectionRls=await db.get("SELECT relrowsecurity FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace WHERE relname='album_sections' AND n.nspname=current_schema()");assert.equal(sectionRls.relrowsecurity,true);
  const sectionPath='/api/admin/albums/'+albums[0].id+'/sections';
  const firstResponse=await send(sectionPath,{title:'Trang trí'});assert.equal(firstResponse.status,201);const firstSection=await firstResponse.json();
  const secondResponse=await send(sectionPath,{title:'Gia tiên'});assert.equal(secondResponse.status,201);const secondSection=await secondResponse.json();
  assert.equal((await send(sectionPath+'/order',{sections:[secondSection.id,firstSection.id]},'PUT')).status,200);
  assert.deepEqual((await db.all('SELECT id FROM album_sections WHERE album_id=? ORDER BY position,id',[albums[0].id])).map(s=>s.id),[secondSection.id,firstSection.id]);
  await db.run('INSERT INTO photos(id,album_id,filename,width,height) VALUES(?,?,?,?,?)',['section-test-photo',albums[0].id,'section-test-photo',100,200]);
  const legacyPhoto=await db.get("SELECT source_bytes,image_bytes,thumb_bytes,download_bytes FROM photos WHERE id='section-test-photo'");
  assert.deepEqual(legacyPhoto,{source_bytes:null,image_bytes:null,thumb_bytes:null,download_bytes:null});
  const assignmentPath='/api/admin/albums/'+albums[0].id+'/photos/sections';
  for(const section_id of [firstSection.id,null,secondSection.id]){
   assert.equal((await send(assignmentPath,{assignments:[{photo_id:'section-test-photo',section_id}]},'PUT')).status,200);
   assert.equal((await db.get("SELECT section_id FROM photos WHERE id='section-test-photo'")).section_id,section_id);
  }
  assert.equal((await send('/api/admin/sections/'+secondSection.id,{},'DELETE')).status,200);
  assert.equal((await db.get("SELECT section_id FROM photos WHERE id='section-test-photo'")).section_id,null);

  const edits=await Promise.all(albums.map(a=>send('/api/admin/albums/'+a.id,{...payload,slug:'Một đường dẫn mới'},'PATCH')));
  for(const r of edits)assert.equal(r.status,200);
  const renamed=await Promise.all(edits.map(r=>r.json()));assert.equal(new Set(renamed.map(a=>a.slug)).size,20);
  for(let i=0;i<albums.length;i++){
   for(const key of [albums[i].id,albums[i].slug]){
    const r=await fetch(base+'/album/'+key,{redirect:'manual'});assert.equal(r.status,301);assert.equal(r.headers.get('location'),'/album/'+renamed[i].slug);
   }
  }
  const cards=await fetch(base+'/api/portfolio?view=cards');assert.equal(cards.status,200);assert.equal((await cards.json()).length,20);
  const before=await db.all('SELECT id,slug FROM albums ORDER BY id');
  const reopened=await openDatabase(dir,{url:url.href});
  try{assert.deepEqual(await reopened.all('SELECT id,slug FROM albums ORDER BY id'),before);assert.equal((await reopened.all('SELECT * FROM album_slugs')).length,42);}finally{await reopened.close();}
  // Exercise the production SQL path for new JPG uploads and mixed legacy ZIPs.
  const privateResponse=await send('/api/admin/albums',{title:'Download regression',category:'wedding',status:'private',password:'private-gallery-test'});
  assert.equal(privateResponse.status,201);const privateAlbum=await privateResponse.json();
  const sectionResponse=await send('/api/admin/albums/'+privateAlbum.id+'/sections',{title:'Ceremony'});
  assert.equal(sectionResponse.status,201);const section=await sectionResponse.json();
  const image=await sharp({create:{width:1200,height:800,channels:3,background:'#846e55'}}).jpeg().toBuffer();
  const form=new FormData();for(const name of ['source.jpg','legacy.jpg'])form.append('photos',new Blob([image],{type:'image/jpeg'}),name);
  const upload=await fetch(base+'/api/admin/albums/'+privateAlbum.id+'/photos',{method:'POST',headers:{Origin:'http://localhost',Cookie:cookie,'X-Album-Section':section.id},body:form});
  assert.equal(upload.status,201);const result=await upload.json();assert.equal(result.uploaded,2);
  const uploaded=result.results.map(item=>item.id);
  const saved=await db.all('SELECT section_id,download_bytes FROM photos WHERE album_id=?',[privateAlbum.id]);
  assert.equal(saved.length,2);for(const row of saved){assert.equal(row.section_id,section.id);assert.ok(row.download_bytes>0);}
  for(const photoId of uploaded)assert.equal((await send('/api/gallery/'+privateAlbum.id+'/selection/'+photoId,{selected:true},'PUT')).status,200);
  await db.run('UPDATE photos SET download_bytes=NULL WHERE id=?',[uploaded[1]]);
  const download=await send('/api/gallery/'+privateAlbum.id+'/download',{photos:uploaded});
  assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'application/zip');assert.equal(download.headers.get('x-photo-count'),'2');
  const zip=Buffer.from(await download.arrayBuffer());assert.equal(zip.length,Number(download.headers.get('content-length')));assert.equal(zip.readUInt32LE(0),0x04034b50);
  assert.ok(zip.includes(Buffer.from('001-source.jpg')));assert.ok(zip.includes(Buffer.from('002-legacy.jpg')));
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await db?.close();
  await pool.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await pool.end();
  await rm(dir,{recursive:true,force:true});
 }
});
