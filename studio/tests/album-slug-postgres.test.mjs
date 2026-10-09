import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {openDatabase} from '../server/db.mjs';
import {createApp} from '../server/app.mjs';

// Explicit opt-in; all tables live in a disposable schema, never public.
const connectionString=process.env.STUDIO_TEST_POSTGRES_URL;
test('PostgreSQL: legacy migration, URL history, RLS and concurrent album writes',{skip:!connectionString},async()=>{
 const pool=new pg.Pool({connectionString});
 const schema='slug_test_'+randomBytes(8).toString('hex');
 const dir=await mkdtemp(path.join(tmpdir(),'chicong-pg-'));
 let db,server;
 try{
  await pool.query('CREATE SCHEMA '+schema);
  const url=new URL(connectionString);url.searchParams.set('options','-c search_path='+schema);
  db=await openDatabase(dir,{url:url.href});
  for(const id of ['legacy1','legacy2'])await db.run('INSERT INTO albums(id,title,category) VALUES(?,?,?)',[id,'Đám cưới Đà Lạt','wedding']);
  await db.exec('DROP TABLE album_slugs; DROP INDEX album_slug; ALTER TABLE albums DROP COLUMN slug;');
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
  const edits=await Promise.all(albums.map(a=>send('/api/admin/albums/'+a.id,{...payload,slug:'Một đường dẫn mới'},'PATCH')));
  for(const r of edits)assert.equal(r.status,200);
  const renamed=await Promise.all(edits.map(r=>r.json()));assert.equal(new Set(renamed.map(a=>a.slug)).size,20);
  for(let i=0;i<albums.length;i++){
   for(const key of [albums[i].id,albums[i].slug]){
    const r=await fetch(base+'/album/'+key,{redirect:'manual'});assert.equal(r.status,301);assert.equal(r.headers.get('location'),'/album/'+renamed[i].slug);
   }
  }
  const before=await db.all('SELECT id,slug FROM albums ORDER BY id');
  const reopened=await openDatabase(dir,{url:url.href});
  try{assert.deepEqual(await reopened.all('SELECT id,slug FROM albums ORDER BY id'),before);assert.equal((await reopened.all('SELECT * FROM album_slugs')).length,42);}finally{await reopened.close();}
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await db?.close();
  await pool.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await pool.end();
  await rm(dir,{recursive:true,force:true});
 }
});
