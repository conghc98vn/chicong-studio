import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {openDatabase} from '../server/db.mjs';
import {createMediaControl,trackedStorage} from '../server/media-control.mjs';
import {photoDeletion} from '../server/photo-deletion.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function fixture(postgres){
 const dir=await mkdtemp(path.join(tmpdir(),'media-control-'));let pool,schema,url=null;
 if(postgres){pool=new pg.Pool({connectionString:process.env.STUDIO_TEST_POSTGRES_URL});schema='media_'+randomUUID().replaceAll('-','');await pool.query('CREATE SCHEMA '+schema);const parsed=new URL(process.env.STUDIO_TEST_POSTGRES_URL);parsed.searchParams.set('options','-c search_path='+schema);url=parsed.href;}
 const db=await openDatabase(dir,{url}),control=await createMediaControl(db,'fixture-source');
 return {db,control,dir,close:async()=>{await db.close();if(pool){await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}await rm(dir,{recursive:true,force:true});}};
}
for(const postgres of [false,true]){
 const config={skip:postgres&&!process.env.STUDIO_TEST_POSTGRES_URL},label=postgres?'PostgreSQL':'SQLite';
 test(label+': lock waits for actual writers, crosses process instances and fences old providers',config,async()=>{
  const f=await fixture(postgres);try{
   const second=await createMediaControl(f.db,'fixture-source'),started=deferred(),finish=deferred();
   const writer=f.control.run('upload',async()=>{started.resolve();await finish.promise;});await started.promise;
   const lease=await second.acquire('migration');await assert.rejects(second.assertDrained(lease),/writers/);await assert.rejects(second.run('new',async()=>{}),{code:'MEDIA_LOCKED'});
   finish.resolve();await writer;await second.assertDrained(lease);
   await second.switchStorage(lease,'fixture-target');await assert.rejects(f.control.run('old-process',async()=>{}),{code:'STORAGE_BINDING_MISMATCH'});
   await assert.rejects(createMediaControl(f.db,'fixture-source'),{code:'STORAGE_BINDING_MISMATCH'});
   const target=await createMediaControl(f.db,'fixture-target');await assert.rejects(target.run('blocked-on-restart',async()=>{}),{code:'MEDIA_LOCKED'});await target.release(lease);await target.run('new-provider',async()=>{});
  }finally{await f.close();}
 });
 test(label+': unknown PUT protects late bytes across restart and prevents snapshot/cutover',config,async()=>{
  const f=await fixture(postgres);try{
   const files=new Map(),key='a'.repeat(32)+'.webp';let late;
   const raw={put:async(k,v)=>{late=()=>files.set(k,v);throw Error('lost response');},remove:async k=>files.delete(k)};
   const storage=trackedStorage(f.db,raw,f.control);await assert.rejects(storage.put(key,Buffer.from('bytes')));
   const restarted=await createMediaControl(f.db,'fixture-source');assert.equal((await restarted.status()).unknown.length,1);
   await assert.rejects(storage.remove(key),/Unresolved/);assert.equal(files.size,0);late();assert.equal(files.size,1);
   const lease=await restarted.acquire('backup');await assert.rejects(restarted.assertDrained(lease),/Unresolved/);await assert.rejects(restarted.switchStorage(lease,'target'),/Unresolved/);
  }finally{await f.close();}
 });
 test(label+': cleanup drains 40 jobs on source; lock blocks worker and queue prevents provider switch',config,async()=>{
  const f=await fixture(postgres);let worker;try{
   const files=new Map();for(let i=0;i<40;i++){const key=i.toString(16).padStart(32,'0');await f.db.run('INSERT INTO photo_cleanup(photo_id,filename,has_download) VALUES(?,?,1)',[key,key]);for(const suffix of ['.webp','-thumb.webp','-download.jpg'])files.set(key+suffix,Buffer.from('x'));}
   let fail=true;const storage=trackedStorage(f.db,{remove:async key=>{if(fail&&key.endsWith('-thumb.webp'))throw Error('offline');files.delete(key);}},f.control);
   worker=photoDeletion({db:f.db,storage,mediaControl:f.control});const lease=await f.control.acquire('migration');
   await assert.rejects(worker.cleanup(true),{code:'MEDIA_LOCKED'});assert.equal(files.size,120);await assert.rejects(f.control.switchStorage(lease,'target'),/queue/);
   await worker.cleanup(true,{owner:lease.owner});assert.equal((await f.db.all('SELECT * FROM photo_cleanup')).length,40);
   fail=false;await worker.cleanup(true,{owner:lease.owner});assert.equal(files.size,0);await f.control.assertDrained(lease,{queue:true});await f.control.release(lease);
  }finally{await worker?.close();await f.close();}
 });
 test(label+': expired lease recovery remains locked and rejects the old runner',config,async()=>{
  const f=await fixture(postgres);try{
   const old=await f.control.acquire('dead-runner');await f.db.run('UPDATE media_control SET deadline=0 WHERE id=1');
   await assert.rejects(f.control.release(old),/expired/);const next=await f.control.recover();assert.notEqual(next.owner,old.owner);await assert.rejects(f.control.assertLease(old),/lost/);
   await assert.rejects(f.control.run('admin',async()=>{}),{code:'MEDIA_LOCKED'});await f.control.release(next);
  }finally{await f.close();}
 });
 test(label+': background child work cannot inherit a finished writer permit',config,async()=>{
  const f=await fixture(postgres);try{
   const trigger=deferred(),result=deferred();
   await f.control.run('parent',async()=>{void trigger.promise.then(()=>f.control.run('late-child',async()=>{})).then(()=>result.resolve('allowed'),error=>result.resolve(error.code));});
   const lease=await f.control.acquire('snapshot');trigger.resolve();assert.equal(await result.promise,'MEDIA_LOCKED');await f.control.release(lease);
  }finally{await f.close();}
 });
}
