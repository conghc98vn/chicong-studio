import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {openDatabase,id} from '../server/db.mjs';
import {createApp} from '../server/app.mjs';
import {photoDeletion} from '../server/photo-deletion.mjs';

for(const engine of ['sqlite','postgres'])test('Shared gallery consistency on '+engine,{skip:engine==='postgres'&&!process.env.STUDIO_TEST_POSTGRES_URL,timeout:60000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'selection-test-')),schema='selection_'+randomBytes(6).toString('hex');
 let pool,db,server;
 try{
  let url;
  if(engine==='postgres'){pool=new pg.Pool({connectionString:process.env.STUDIO_TEST_POSTGRES_URL});await pool.query('CREATE SCHEMA '+schema);const parsed=new URL(process.env.STUDIO_TEST_POSTGRES_URL);parsed.searchParams.set('options','-c search_path='+schema);url=parsed.href;}
  db=await openDatabase(dir,{url});
  const f=await createApp({db,dataDir:dir,env:{}});
  server=f.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port,album=id(),photos=[id(),id()];
  await db.run('INSERT INTO albums(id,title,category,status) VALUES(?,?,?,?)',[album,'Shared album','wedding','private']);
  for(const [position,photo] of photos.entries())await db.run('INSERT INTO photos(id,album_id,filename,width,height,position) VALUES(?,?,?,?,?,?)',[photo,album,photo,1200,1800,position]);
  const request=(route,body,method='POST')=>fetch(base+'/api/gallery/'+album+route,{method,headers:{Origin:base,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const pick=(photo,selected)=>request('/selection/'+photo,{selected},'PUT');
  const state=async()=>{const r=await request('/selection',undefined,'GET');assert.equal(r.status,200);return r.json();};

  await t.test('Passwordless private galleries share selections; snapshots include a compact catalog version',async()=>{
   const before=await state();assert.equal(before.selected.length,0);
   assert.equal((await pick(photos[0],true)).status,200);
   const after=await state();assert.deepEqual(after.selected,[photos[0]]);assert.equal(after.photo_version,before.photo_version);
   const gallery=await (await request('',undefined,'GET')).json();assert.equal(gallery.photo_version,after.photo_version);
  });
  await t.test('Reject a stale confirmation, even if the count is unchanged',async()=>{
   await pick(photos[0],false);await pick(photos[1],true);
   const r=await request('/submit',{photos:[photos[0]]});assert.equal(r.status,409);const body=await r.json();assert.deepEqual(body.selected,[photos[1]]);
   assert.equal((await state()).selection_status,'draft');
  });
  await t.test('Successful submit is idempotent and a repeated unchanged pick preserves submitted status',async()=>{
   assert.equal((await request('/submit',{photos:[photos[1]]})).status,200);
   assert.equal((await request('/submit',{photos:[photos[1]]})).status,200);
   await pick(photos[1],true);assert.equal((await state()).selection_status,'submitted');
   for(const photos of [[1],['duplicate','duplicate'],'bad'])assert.equal((await request('/submit',{photos})).status,422);
  });
  await t.test('A selection failure rolls back both selection and submission status',async()=>{
   const transaction=db.transaction;db.transaction=fn=>transaction(async tx=>fn({...tx,run:async(sql,...args)=>{if(sql.includes("selection_status='draft'"))throw Error('injected failure');return tx.run(sql,...args);}}));
   try{assert.equal((await pick(photos[1],false)).status,500);}finally{db.transaction=transaction;}
   const after=await state();assert.deepEqual(after.selected,[photos[1]]);assert.equal(after.selection_status,'submitted');
  });
  await t.test('Concurrent submit and deselect cannot leave an empty submitted album',async()=>{
   let release,entered;const gate=new Promise(r=>release=r),seen=new Promise(r=>entered=r);
   const transaction=db.transaction;let hold=true;
   db.transaction=fn=>transaction(tx=>fn({...tx,run:async(sql,...args)=>{if(hold&&sql.includes("selection_status='submitted'")){hold=false;entered();await gate;}return tx.run(sql,...args);}}));
   try{
    const submitting=request('/submit',{photos:[photos[1]]});await seen;
    let done=false;const deselecting=pick(photos[1],false).then(r=>{done=true;return r;});
    await new Promise(r=>setTimeout(r,80));assert.equal(done,false);release();
    assert.equal((await submitting).status,200);assert.equal((await deselecting).status,200);
    const after=await state();assert.deepEqual(after.selected,[]);assert.equal(after.selection_status,'draft');
    assert.equal((await request('/submit',{photos:[]})).status,422);
   }finally{release();db.transaction=transaction;}
  });
  await t.test('Invalid/cross-album IDs never change selections',async()=>{
   assert.equal((await pick(id(),true)).status,404);
   assert.equal((await request('/selection/'+photos[0],{selected:'true'},'PUT')).status,422);
   assert.deepEqual((await state()).selected,[]);
  });
  await t.test('Deleting a selected photo during a storage outage updates cover, status and catalog; cleanup survives reopening',async()=>{
   await pick(photos[0],true);await request('/submit',{photos:[photos[0]]});
   await db.run('UPDATE albums SET cover_id=? WHERE id=?',[photos[0],album]);
   await db.run('UPDATE photos SET download_bytes=123 WHERE id=?',[photos[0]]);
   const files=new Set(['.webp','-thumb.webp','-download.jpg'].map(s=>photos[0]+s));let broken=true;
   const storage={remove:async name=>{if(broken&&name.endsWith('-thumb.webp'))throw Error('storage unavailable');files.delete(name);}};
   const before=await state();await photoDeletion({db,storage}).remove(photos[0]);
   assert.equal(await db.get('SELECT id FROM photos WHERE id=?',[photos[0]]),undefined);
   const after=await state();assert.deepEqual(after.selected,[]);assert.equal(after.selection_status,'draft');assert.notEqual(after.photo_version,before.photo_version);
   assert.equal((await db.get('SELECT cover_id FROM albums WHERE id=?',[album])).cover_id,photos[1]);
   assert.equal((await db.all('SELECT * FROM photo_cleanup')).length,1);assert.equal(files.size,2);
   await db.close();db=await openDatabase(dir,{url});broken=false;
   await photoDeletion({db,storage}).cleanup();assert.equal(files.size,0);assert.equal((await db.all('SELECT * FROM photo_cleanup')).length,0);
  });
 }finally{if(server)await new Promise(r=>server.close(r));await db?.close();if(pool){await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}await rm(dir,{recursive:true,force:true});}
});
