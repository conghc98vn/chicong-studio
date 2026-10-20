import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {openDatabase,id} from '../server/db.mjs';
import {selectionState,photoVersion,galleryVersion,catalogVersion} from '../server/gallery-selection.mjs';

async function fixture(count=3){
 const dir=await mkdtemp(path.join(tmpdir(),'studio-gallery-poll-'));
 let db,pool,schema;
 const close=async()=>{await db?.close();if(pool){try{await pool.query('DROP SCHEMA '+schema+' CASCADE');}finally{await pool.end();}}await rm(dir,{recursive:true,force:true});};
 try{
  let url=null;
  if(process.env.STUDIO_TEST_POSTGRES_URL){pool=new pg.Pool({connectionString:process.env.STUDIO_TEST_POSTGRES_URL});schema='gallery_poll_'+id();await pool.query('CREATE SCHEMA '+schema);const target=new URL(process.env.STUDIO_TEST_POSTGRES_URL);target.searchParams.set('options','-c search_path='+schema);url=target.href;}
  db=await openDatabase(dir,{url});
  await db.run("INSERT INTO albums(id,slug,title,category,status) VALUES('album','album','Gallery','wedding','private')");
  await db.run("INSERT INTO album_sections(id,album_id,title,position) VALUES('section','album','First',0)");
  for(let start=0;start<count;start+=100){
   const rows=Array.from({length:Math.min(100,count-start)},(_,offset)=>['photo'+(start+offset),'album','object'+(start+offset),'Photo '+(start+offset)+'.jpg',2400,1600,start+offset]);
   await db.run('INSERT INTO photos(id,album_id,filename,original,width,height,position) VALUES '+rows.map(()=>'(?,?,?,?,?,?,?)').join(','),rows.flat());
  }
  const reads={queries:0,photoRows:0,sectionRows:0};
  for(const method of ['get','all']){
   const original=db[method];db[method]=async(sql,params)=>{
    const result=await original(sql,params);reads.queries++;
    if(method==='all'&&/FROM photos WHERE/.test(sql))reads.photoRows+=result.length;
    if(method==='all'&&/FROM album_sections WHERE/.test(sql))reads.sectionRows+=result.length;
    return result;
   };
  }
  const album=()=>db.get("SELECT * FROM albums WHERE id='album'");
  const read=async()=>selectionState(db,'album',{galleryAlbum:await album()});
  const reset=()=>Object.assign(reads,{queries:0,photoRows:0,sectionRows:0});
  const expected=async()=>{const a=await album(),photos=await db.all("SELECT * FROM photos WHERE album_id='album' ORDER BY position,id"),sections=await db.all("SELECT * FROM album_sections WHERE album_id='album' ORDER BY position,id");return {photo_version:photoVersion(photos),gallery_version:galleryVersion(a,photos,sections),catalog_version:catalogVersion(a,photos,sections)};};
  return {db,close,album,read,reads,reset,expected};
 }catch(error){await close();throw error;}
}

test('5000-photo selection polling retains protocol hashes without re-reading or hashing the unchanged catalogue',async t=>{
 const f=await fixture(5000);try{
  f.reset();const cold=await f.read(),coldWork={...f.reads};
  assert.equal(coldWork.photoRows,5000);assert.equal(coldWork.sectionRows,1);assert.equal(coldWork.queries,7);
  const expected=await f.expected();assert.equal(cold.gallery_version,expected.gallery_version);assert.equal(cold.photo_version,expected.photo_version);
  f.reset();const start=performance.now();for(let i=0;i<20;i++)assert.deepEqual(await f.read(),cold);
  const elapsed=performance.now()-start;
  assert.deepEqual(f.reads,{queries:80,photoRows:0,sectionRows:0});
  await f.db.run("INSERT INTO selections(album_id,photo_id,updated) VALUES('album','photo4999','now')");
  f.reset();const selected=await f.read();assert.deepEqual(selected.selected,['photo4999']);assert.equal(selected.gallery_version,cold.gallery_version);assert.equal(selected.selection_revision,cold.selection_revision+1);assert.equal(f.reads.photoRows,0);
  t.diagnostic(`5000 photos: cold ${coldWork.queries} reads / ${coldWork.photoRows} photo rows; warm 4 reads / 0 photo rows per poll (includes album authorization lookup); 20 warm polls ${elapsed.toFixed(1)} ms`);
 }finally{await f.close();}
});

test('gallery cache invalidates for every public photo field, ordering, sections and album metadata',async()=>{
 const f=await fixture();try{
  let previous=await f.read();
  const changes=[
   ["UPDATE photos SET filename='replacement' WHERE id='photo0'"],
   ["UPDATE photos SET original='Renamed.jpg' WHERE id='photo0'"],
   ["UPDATE photos SET caption='Caption' WHERE id='photo0'"],
   ["UPDATE photos SET width=1800 WHERE id='photo0'"],
   ["UPDATE photos SET height=1200 WHERE id='photo0'"],
   ["UPDATE photos SET position=10 WHERE id='photo0'"],
   ["UPDATE photos SET section_id='section' WHERE id='photo0'"],
   ["UPDATE album_sections SET title='Renamed section' WHERE id='section'"],
   ["UPDATE album_sections SET position=4 WHERE id='section'"],
   ["UPDATE albums SET title='New gallery' WHERE id='album'"],
   ["UPDATE albums SET description='New description' WHERE id='album'"],
   ["UPDATE albums SET event_date='2026-10-17' WHERE id='album'"],
   ["UPDATE albums SET password='new-hash' WHERE id='album'"],
   ["INSERT INTO photos(id,album_id,filename,width,height,position) VALUES('new','album','new',2400,1600,20)"],
   ["DELETE FROM photos WHERE id='photo2'"],
   ["DELETE FROM album_sections WHERE id='section'"],
  ];
  for(const [sql] of changes){
   await f.db.run(sql);f.reset();const current=await f.read();assert.ok(f.reads.photoRows>0,sql);
   const expected=await f.expected();assert.equal(current.gallery_version,expected.gallery_version,sql);assert.equal(current.photo_version,expected.photo_version,sql);assert.notEqual(current.gallery_version,previous.gallery_version,sql);
   f.reset();assert.deepEqual(await f.read(),current);assert.equal(f.reads.photoRows,0,sql);previous=current;
  }
 }finally{await f.close();}
});

test('admin catalogue polling still detects byte sizes and created changes absent from revision triggers',async()=>{
 const f=await fixture();try{
  const publicBefore=await f.read();let previous=await selectionState(f.db,'album',{catalogAlbum:await f.album()});
  for(const column of ['source_bytes','image_bytes','thumb_bytes','download_bytes']){
   await f.db.run(`UPDATE photos SET ${column}=? WHERE id='photo0'`,[1234]);
   const current=await selectionState(f.db,'album',{catalogAlbum:await f.album()});
   assert.equal(current.catalog_revision,previous.catalog_revision);assert.notEqual(current.catalog_version,previous.catalog_version);assert.equal(current.catalog_version,(await f.expected()).catalog_version);previous=current;
  }
  await f.db.run("UPDATE albums SET created='2026-10-16' WHERE id='album'");
  const current=await selectionState(f.db,'album',{catalogAlbum:await f.album()});assert.equal(current.catalog_revision,previous.catalog_revision);assert.notEqual(current.catalog_version,previous.catalog_version);
  f.reset();assert.deepEqual(await f.read(),publicBefore);assert.equal(f.reads.photoRows,0);
 }finally{await f.close();}
});

test('cache identities are isolated per database even when album IDs and revisions match',async()=>{
 const first=await fixture(),second=await fixture();try{
  await first.db.run("UPDATE photos SET caption='First database' WHERE id='photo0'");
  await second.db.run("UPDATE photos SET caption='Second database' WHERE id='photo0'");
  const one=await first.read(),two=await second.read();assert.equal(one.catalog_revision,two.catalog_revision);assert.notEqual(one.gallery_version,two.gallery_version);
  first.reset();second.reset();assert.deepEqual(await first.read(),one);assert.deepEqual(await second.read(),two);assert.equal(first.reads.photoRows,0);assert.equal(second.reads.photoRows,0);
 }finally{await first.close();await second.close();}
});

test('transactional reads cannot publish rolled-back versions into the polling cache',async()=>{
 const f=await fixture();try{
  let rolledBack;
  await assert.rejects(f.db.transaction(async tx=>{
   await tx.run("UPDATE photos SET caption='Rolled back' WHERE id='photo0'");
   rolledBack=await selectionState(tx,'album',{galleryAlbum:await tx.get("SELECT * FROM albums WHERE id='album'")});
   throw Error('rollback fixture');
  }),/rollback fixture/);
  await f.db.run("UPDATE photos SET caption='Committed' WHERE id='photo0'");
  f.reset();const committed=await f.read();assert.equal(committed.catalog_revision,rolledBack.catalog_revision);assert.notEqual(committed.gallery_version,rolledBack.gallery_version);assert.equal(f.reads.photoRows,3);assert.equal(committed.gallery_version,(await f.expected()).gallery_version);
 }finally{await f.close();}
});

test('a publication between metadata reads prevents caching a mixed snapshot',async()=>{
 const f=await fixture();try{
  const all=f.db.all;let changed=false;
  f.db.all=async(sql,params)=>{
   const rows=await all(sql,params);
   if(!changed&&/FROM photos WHERE/.test(sql)){changed=true;await f.db.run("UPDATE photos SET caption='Concurrent publication' WHERE id='photo0'");}
   return rows;
  };
  const raced=await f.read();f.reset();const fresh=await f.read();assert.equal(f.reads.photoRows,3);assert.notEqual(fresh.gallery_version,raced.gallery_version);assert.equal(fresh.gallery_version,(await f.expected()).gallery_version);
  f.reset();assert.deepEqual(await f.read(),fresh);assert.equal(f.reads.photoRows,0);
 }finally{await f.close();}
});

test('gallery digest cache evicts least recently used albums after 128 entries',async()=>{
 const f=await fixture(1);try{
  await f.read();
  for(let index=0;index<128;index++){
   const albumId='other'+index;await f.db.run("INSERT INTO albums(id,slug,title,category,status) VALUES(?,?,?,'wedding','private')",[albumId,albumId,albumId]);
   const album=await f.db.get('SELECT * FROM albums WHERE id=?',[albumId]);await selectionState(f.db,albumId,{galleryAlbum:album});
  }
  f.reset();await f.read();assert.equal(f.reads.photoRows,1);
  f.reset();await f.read();assert.equal(f.reads.photoRows,0);
 }finally{await f.close();}
});
