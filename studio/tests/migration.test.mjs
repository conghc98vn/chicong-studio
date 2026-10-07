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
