import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../server/db.mjs';
test('Upgrade preserves old photo records and can be run again',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'chicong-migration-'));let db;try{db=await openDatabase(dir,{url:null});await db.run("INSERT INTO albums(id,title,category) VALUES('album','Existing story','wedding')");await db.run("INSERT INTO photos(id,album_id,filename,width,height) VALUES('photo','album','photo',80,120)");await db.close();db=null;const legacy=new DatabaseSync(path.join(dir,'studio.sqlite'));legacy.exec('DROP INDEX photo_upload_key; ALTER TABLE photos DROP COLUMN upload_key; ALTER TABLE photos DROP COLUMN upload_hash;');legacy.close();db=await openDatabase(dir,{url:null});const photo=await db.get("SELECT * FROM photos WHERE id='photo'");assert.equal(photo.width,80);assert.equal(photo.upload_key,null);assert.equal(photo.upload_hash,null);assert.equal((await db.get("SELECT title FROM albums WHERE id='album'")).title,'Existing story');await db.close();db=await openDatabase(dir,{url:null});assert.equal((await db.all('SELECT * FROM photos')).length,1);}finally{await db?.close();await rm(dir,{recursive:true,force:true});}});

test('Booking notes migration preserves existing requests and notes across restarts',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'chicong-booking-migration-'));let db;
 try{
  db=await openDatabase(dir,{url:null});
  await db.run("INSERT INTO inquiries(id,name,email,service,message,created,date,status) VALUES('existing','Customer','customer@example.com','Wedding','Existing message','2026-01-01','2099-01-01','confirmed')");
  await db.close();db=null;
  const legacy=new DatabaseSync(path.join(dir,'studio.sqlite'));legacy.exec('ALTER TABLE inquiries DROP COLUMN notes');legacy.close();
  db=await openDatabase(dir,{url:null});
  const row=await db.get("SELECT * FROM inquiries WHERE id='existing'");assert.equal(row.notes,'');assert.equal(row.date,'2099-01-01');assert.equal(row.status,'confirmed');assert.equal(row.message,'Existing message');
  await db.run("UPDATE inquiries SET notes='Private studio notes' WHERE id='existing'");
  await db.close();db=await openDatabase(dir,{url:null});
  assert.equal((await db.get("SELECT notes FROM inquiries WHERE id='existing'")).notes,'Private studio notes');
  assert.equal((await db.all('SELECT * FROM inquiries')).length,1);
 }finally{await db?.close();await rm(dir,{recursive:true,force:true});}
});

test('Budget migration preserves existing inquiries and persists across restart',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'chicong-budget-migration-'));let db;
 try{
  db=await openDatabase(dir,{url:null});await db.run("INSERT INTO inquiries(id,name,email,service,message,created) VALUES('existing','Customer','','Wedding','Existing message','2026-01-01')");await db.close();db=null;
  const legacy=new DatabaseSync(path.join(dir,'studio.sqlite'));legacy.exec('ALTER TABLE inquiries DROP COLUMN budget');legacy.close();
  db=await openDatabase(dir,{url:null});assert.equal((await db.get("SELECT * FROM inquiries WHERE id='existing'")).budget,'');
  await db.run("UPDATE inquiries SET budget='Chưa xác định' WHERE id='existing'");await db.close();db=await openDatabase(dir,{url:null});
  const row=await db.get("SELECT * FROM inquiries WHERE id='existing'");assert.equal(row.budget,'Chưa xác định');assert.equal(row.message,'Existing message');
 }finally{await db?.close();await rm(dir,{recursive:true,force:true});}
});

test('Request identity upgrade preserves legacy bookings and retry keys',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'chicong-request-upgrade-'));let db;
 try{
  db=await openDatabase(dir,{url:null});await db.run("INSERT INTO inquiries(id,name,email,service,message,created) VALUES('legacy','Customer','','Wedding','Keep this request','2026-01-01')");await db.close();db=null;
  const legacy=new DatabaseSync(path.join(dir,'studio.sqlite'));legacy.exec('DROP INDEX inquiry_request_key; ALTER TABLE inquiries DROP COLUMN request_key; ALTER TABLE inquiries DROP COLUMN request_hash;');legacy.close();
  db=await openDatabase(dir,{url:null});const row=await db.get("SELECT * FROM inquiries WHERE id='legacy'");assert.equal(row.message,'Keep this request');assert.equal(row.request_key,null);
  await db.run("UPDATE inquiries SET request_key=?,request_hash='digest' WHERE id='legacy'",['a'.repeat(32)]);await db.close();db=await openDatabase(dir,{url:null});assert.equal((await db.get("SELECT request_key FROM inquiries WHERE id='legacy'")).request_key,'a'.repeat(32));
 }finally{await db?.close();await rm(dir,{recursive:true,force:true});}
});

test('Legacy album slugs backfill uniquely without changing IDs, photos or saved slugs',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'chicong-slugs-'));let db;
 try{
  db=await openDatabase(dir,{url:null});
  for(const key of ['a','b','c'])await db.run('INSERT INTO albums(id,title,category) VALUES(?,?,?)',[key,'Đám cưới Đà Lạt — Tuấn & Lan','wedding']);
  await db.run("INSERT INTO photos(id,album_id,filename,width,height) VALUES('photo','a','photo',80,120)");
  await db.close();db=null;
  const legacy=new DatabaseSync(path.join(dir,'studio.sqlite'));legacy.exec('DROP TABLE album_slugs; DROP INDEX album_slug; ALTER TABLE albums DROP COLUMN slug;');legacy.close();
  db=await openDatabase(dir,{url:null});
  const rows=await db.all('SELECT id,slug FROM albums ORDER BY id');
  assert.deepEqual(rows.map(a=>a.slug),['dam-cuoi-da-lat-tuan-lan','dam-cuoi-da-lat-tuan-lan-2','dam-cuoi-da-lat-tuan-lan-3']);
  await db.run("UPDATE albums SET title='New title' WHERE id='a'");
  await db.close();db=await openDatabase(dir,{url:null});
  assert.deepEqual(await db.all('SELECT id,slug FROM albums ORDER BY id'),rows);
  assert.equal((await db.get("SELECT album_id FROM photos WHERE id='photo'")).album_id,'a');
 }finally{await db?.close();await rm(dir,{recursive:true,force:true});}
});

test('Slug migration resumes after URL reservation and preserves private gallery data',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'chicong-slug-resume-'));let db;
 try{
  db=await openDatabase(dir,{url:null});
  await db.run("INSERT INTO albums(id,title,category,status,password,client_name,event_date,selection_status,cover_id) VALUES('private','Riêng tư','wedding','private','keep-password-hash','Keep name','2026-01-02','submitted','photo')");
  await db.run("INSERT INTO photos(id,album_id,filename,width,height,position) VALUES('photo','private','original',80,120,7)");
  await db.run("INSERT INTO selections(album_id,photo_id,updated) VALUES('private','photo','keep-date')");
  await db.run("INSERT INTO sessions(token,album_id,expires) VALUES('keep-token','private',9999999999999)");
  // Simulate termination after reservation but before writing albums.slug.
  await db.run("INSERT INTO album_slugs(slug,album_id) VALUES('rieng-tu','private')");
  const before=await db.get("SELECT * FROM albums WHERE id='private'");
  const tables=['photos','selections','sessions'];const snapshot=await Promise.all(tables.map(t=>db.all('SELECT * FROM '+t)));
  await db.close();db=await openDatabase(dir,{url:null});
  assert.deepEqual({...await db.get("SELECT * FROM albums WHERE id='private'")},{...before,slug:'rieng-tu'});
  for(let i=0;i<tables.length;i++)assert.deepEqual(await db.all('SELECT * FROM '+tables[i]),snapshot[i]);
  assert.equal((await db.all('SELECT * FROM album_slugs')).length,1);
 }finally{await db?.close();await rm(dir,{recursive:true,force:true});}
});

test('Slug migration fills multiple blank placeholders before adding its unique index',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'chicong-slug-blank-'));let db;
 try{
  db=await openDatabase(dir,{url:null});await db.exec('DROP INDEX album_slug;');
  for(const id of ['one','two'])await db.run("INSERT INTO albums(id,title,category,slug) VALUES(?,?,?,'')",[id,'Cùng tên','wedding']);
  await db.close();db=null;db=await openDatabase(dir,{url:null});
  assert.deepEqual((await db.all('SELECT slug FROM albums ORDER BY id')).map(a=>a.slug),['cung-ten','cung-ten-2']);
  await assert.rejects(db.run("UPDATE albums SET slug='cung-ten' WHERE id='two'"),/UNIQUE/);
 }finally{await db?.close();await rm(dir,{recursive:true,force:true});}
});
