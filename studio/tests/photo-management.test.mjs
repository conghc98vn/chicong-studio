import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';
import {encodePreparedPhoto} from '../server/prepared-photo.mjs';
import {optimizePhoto} from '../server/image-optimizer.mjs';
import {photoDeletion} from '../server/photo-deletion.mjs';
import {openDatabase} from '../server/db.mjs';
async function fixture(){
 const dir=await mkdtemp(path.join(tmpdir(),'photo-management-')),files=new Map();let failPut=false,failRemove=false;
 const storage={put:async(k,v)=>{if(failPut&&k.endsWith('-download.jpg'))throw Error('storage failed');files.set(k,v);},get:async k=>{if(!files.has(k))throw Error('missing');return files.get(k);},remove:async k=>{if(failRemove)throw Error('storage offline');files.delete(k);}};
 let pool,schema,url=null;
 if(process.env.STUDIO_TEST_POSTGRES_URL){pool=new pg.Pool({connectionString:process.env.STUDIO_TEST_POSTGRES_URL});schema='photo_management_'+randomBytes(8).toString('hex');await pool.query('CREATE SCHEMA '+schema);const target=new URL(process.env.STUDIO_TEST_POSTGRES_URL);target.searchParams.set('options','-c search_path='+schema);url=target.href;}
 const db=await openDatabase(dir,{url});
 const app=await createApp({db,dataDir:dir,env:{},seed:false,storage});const server=app.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;let cookie='';
 const request=(url,data,method='GET',headers={})=>fetch(base+url,{method,headers:{Origin:base,Cookie:cookie,...(data instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},body:data===undefined?undefined:data instanceof FormData?data:JSON.stringify(data)});
 const setup=await request('/api/admin/setup',{email:'manage@test.local',password:'management-test-pass'},'POST');cookie=setup.headers.get('set-cookie').split(';')[0];
 const create=async()=>{const r=await request('/api/admin/albums',{title:'Khách hàng',category:'wedding',status:'private',require_password:false},'POST');assert.equal(r.status,201);return (await r.json()).id;};
 const album=await create();
 const upload=async(name,bytes,{policy='skip',key=randomUUID(),target=album,section}={})=>{const fd=new FormData();fd.append('photos',new Blob([bytes],{type:'image/jpeg'}),name);const response=await request('/api/admin/albums/'+target+'/photos',fd,'POST',{'X-Duplicate-Policy':policy,'X-Upload-Keys':JSON.stringify([key]),...(section?{'X-Album-Section':section}:{})});return {status:response.status,...await response.json()};};
 return {...app,base,album,files,request,create,upload,set failPut(v){failPut=v;},set failRemove(v){failRemove=v;},close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await app.photoCleanup.close();await app.db.close();if(pool){await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}await rm(dir,{recursive:true,force:true});}};
}
const jpeg=(color='#aa5533',width=100)=>sharp({create:{width,height:120,channels:3,background:color}}).jpeg().toBuffer();
const first=r=>{assert.equal(r.status,201);assert.equal(r.results[0].success,true);return r.results[0];};
test('Duplicate skip is album scoped, case insensitive and durable across retries',async()=>{
 const f=await fixture();try{
  const a=first(await f.upload('PHOTO.JPG',await jpeg()));
  const before=await f.db.get('SELECT * FROM photos WHERE id=?',[a.id]);
  f.failPut=true;const key=randomUUID(),b=first(await f.upload('photo.jpg',await jpeg('#abcdef'),{key}));assert.equal(b.skipped,true);assert.equal(b.id,a.id);f.failPut=false;
  assert.deepEqual(await f.db.get('SELECT * FROM photos WHERE id=?',[a.id]),before);await f.photoCleanup.cleanup(true);assert.equal(f.files.size,3);
  assert.equal(first(await f.upload('photo.jpg',await jpeg('#abcdef'),{key})).reused,true);
  const other=await f.create();assert.notEqual(first(await f.upload('PHOTO.JPG',await jpeg(),{target:other})).id,a.id);
  assert.equal((await f.upload('new.jpg',await jpeg(),{policy:'bad'})).status,422);
 }finally{await f.close();}
});
test('Overwrite preserves picks, cover, custom caption, section and order; invalidates previews and ETags',async()=>{
 const f=await fixture();try{
  const bytes=await jpeg(),newBytes=await jpeg('#4455ff',160),initialKey=randomUUID();
  const a=first(await f.upload('photo.jpg',bytes,{key:initialKey}));
  const section=(await(await f.request('/api/admin/albums/'+f.album+'/sections',{title:'Buổi lễ'},'POST')).json()).id;
  await f.request('/api/admin/photos/'+a.id,{caption:'Ghi chú riêng',section_id:section,position:9},'PATCH');
  await f.request(`/api/gallery/${f.album}/selection/${a.id}`,{selected:true},'PUT');
  await f.db.run("UPDATE albums SET selection_status='submitted' WHERE id=?",[f.album]);
  const selection=await f.db.get('SELECT * FROM selections WHERE photo_id=?',[a.id]);
  const before=await(await f.request('/api/gallery/'+f.album)).json();const media=await f.request('/media/'+a.id),tag=media.headers.get('etag');await media.arrayBuffer();
  const key=randomUUID(),replaced=first(await f.upload('PHOTO.JPG',newBytes,{policy:'overwrite',key}));assert.equal(replaced.replaced,true);assert.equal(replaced.id,a.id);
  const after=await(await f.request('/api/gallery/'+f.album)).json(),photo=after.photos[0];
  assert.equal(photo.selected,true);assert.equal(photo.caption,'Ghi chú riêng');assert.equal(photo.section_id,section);assert.equal(photo.position,9);assert.equal(after.cover_id,a.id);assert.equal(after.selection_status,'submitted');assert.equal(after.photos.length,1);
  assert.deepEqual(await f.db.get('SELECT * FROM selections WHERE photo_id=?',[a.id]),selection);
  assert.notEqual(photo.src,before.photos[0].src);assert.notEqual(after.gallery_version,before.gallery_version);
  const renewed=await f.request('/media/'+a.id,undefined,'GET',{'If-None-Match':tag,'Cache-Control':'max-age=0'});assert.equal(renewed.status,200);assert.notEqual(renewed.headers.get('etag'),tag);assert.equal((await sharp(Buffer.from(await renewed.arrayBuffer())).metadata()).width,160);
  const download=await f.request(`/api/gallery/${f.album}/photos/${a.id}/download`);assert.equal(download.status,200);
  assert.equal((await sharp(Buffer.from(await download.arrayBuffer())).metadata()).width,160);const row=await f.db.get('SELECT filename FROM photos WHERE id=?',[a.id]);assert.equal((await sharp(f.files.get(row.filename+'-download.jpg')).metadata()).width,160);
  // A delayed replay from before the overwrite must not restore the old image.
  assert.equal(first(await f.upload('photo.jpg',bytes,{key:initialKey})).reused,true);
  assert.equal(first(await f.upload('PHOTO.JPG',newBytes,{policy:'overwrite',key})).reused,true);
  assert.equal((await f.db.get('SELECT filename FROM photos WHERE id=?',[a.id])).filename,row.filename);await f.photoCleanup.cleanup(true);assert.equal(f.files.size,3);
  assert.equal((await f.upload('PHOTO.JPG',bytes,{policy:'overwrite',key})).results[0].code,'UPLOAD_CONFLICT');
 }finally{await f.close();}
});
test('Failed replacement keeps old bytes and selections; retry and prepared replacement succeed',async()=>{
 const f=await fixture();try{
  const a=first(await f.upload('photo.jpg',await jpeg())),before=await f.db.get('SELECT * FROM photos WHERE id=?',[a.id]);
  await f.request(`/api/gallery/${f.album}/selection/${a.id}`,{selected:true},'PUT');
  const key=randomUUID(),bytes=await jpeg('#0000ff');f.failPut=true;
  assert.equal((await f.upload('photo.jpg',bytes,{policy:'overwrite',key})).results[0].retryable,true);
  assert.deepEqual(await f.db.get('SELECT * FROM photos WHERE id=?',[a.id]),before);await f.photoCleanup.cleanup(true);assert.equal(f.files.size,3);f.failPut=false;
  assert.equal(first(await f.upload('photo.jpg',bytes,{policy:'overwrite',key})).id,a.id);
  const optimized=await optimizePhoto(await jpeg('#00ffff',200)),bundle=encodePreparedPhoto({originalName:'photo.jpg',sourceHash:'b'.repeat(64),...optimized});
  assert.equal(first(await f.upload('renamed.ccphoto',bundle,{policy:'overwrite'})).id,a.id);
  assert.equal((await f.db.get('SELECT width FROM photos WHERE id=?',[a.id])).width,200);assert.ok(await f.db.get('SELECT photo_id FROM selections WHERE photo_id=?',[a.id]));await f.photoCleanup.cleanup(true);assert.equal(f.files.size,3);
 }finally{await f.close();}
});
test('A lost database COMMIT acknowledgement preserves published image files and retry identity',async()=>{
 const f=await fixture();const transaction=f.db.transaction;
 try{
  const original=first(await f.upload('commit.jpg',await jpeg()));await f.request(`/api/gallery/${f.album}/selection/${original.id}`,{selected:true},'PUT');
  let failed=false;f.db.transaction=async fn=>{const result=await transaction(fn);if(!failed){failed=true;throw Error('COMMIT acknowledgement lost');}return result;};
  const bytes=await jpeg('#44aaee',190),key=randomUUID(),response=await f.upload('commit.jpg',bytes,{policy:'overwrite',key});assert.equal(response.results[0].retryable,true);
  const row=await f.db.get('SELECT * FROM photos WHERE id=?',[original.id]);
  for(const suffix of ['.webp','-thumb.webp','-download.jpg'])assert.ok(f.files.has(row.filename+suffix),'published rendition survives uncertain commit');
  assert.ok(await f.db.get('SELECT photo_id FROM selections WHERE photo_id=?',[original.id]));
  const replay=first(await f.upload('commit.jpg',bytes,{policy:'overwrite',key}));assert.equal(replay.id,original.id);assert.equal(replay.reused,true);
  assert.equal((await f.db.get('SELECT filename FROM photos WHERE id=?',[original.id])).filename,row.filename);
  await f.photoCleanup.cleanup(true);assert.equal(f.files.size,3);
 }finally{f.db.transaction=transaction;await f.close();}
});
test('Concurrent uploads serialize name collisions and key replays without duplicate records or files',async()=>{
 const f=await fixture();try{
  const bytes=await jpeg(),key=randomUUID();
  const result=await Promise.all([f.upload('same.jpg',bytes,{key}),f.upload('same.jpg',bytes,{key}),f.upload('SAME.JPG',bytes)]);result.forEach(first);
  assert.equal((await f.db.all('SELECT id FROM photos')).length,1);await f.photoCleanup.cleanup(true);assert.equal(f.files.size,3);
  const replacements=await Promise.all([f.upload('same.jpg',await jpeg('#aaffff'),{policy:'overwrite'}),f.upload('same.jpg',await jpeg('#55ff00'),{policy:'overwrite'})]);replacements.forEach(first);
  await f.request('/api/admin/albums');assert.equal((await f.db.all('SELECT id FROM photos')).length,1);await f.photoCleanup.cleanup(true);assert.equal(f.files.size,3);
 }finally{await f.close();}
});
test('Bulk deletion validates whole request, preserves survivors and retries safely through storage failures',async()=>{
 const f=await fixture();try{
  const photos=[];for(let i=0;i<3;i++)photos.push(first(await f.upload(`p${i}.jpg`,await jpeg())).id);
  const other=await f.create(),foreign=first(await f.upload('foreign.jpg',await jpeg(),{target:other})).id;
  const url='/api/admin/albums/'+f.album+'/photos/delete';
  for(const ids of [[],[photos[0],foreign],[photos[0],photos[0]],['bad'],Array.from({length:1001},(_,i)=>i.toString(16).padStart(32,'0'))])assert.equal((await f.request(url,{photos:ids},'POST')).status,422);
  assert.equal((await f.db.all('SELECT id FROM photos WHERE album_id=?',[f.album])).length,3);
  assert.equal((await fetch(f.base+url,{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json'},body:JSON.stringify({photos})})).status,401);
  await f.request(`/api/gallery/${f.album}/selection/${photos[0]}`,{selected:true},'PUT');await f.db.run("UPDATE albums SET selection_status='submitted' WHERE id=?",[f.album]);
  f.failRemove=true;const deleted=await f.request(url,{photos:photos.slice(0,2)},'POST');assert.equal(deleted.status,200);assert.equal((await deleted.json()).deleted,2);
  assert.equal((await f.db.get('SELECT cover_id FROM albums WHERE id=?',[f.album])).cover_id,photos[2]);assert.equal((await f.db.get('SELECT selection_status FROM albums WHERE id=?',[f.album])).selection_status,'draft');assert.equal((await f.db.all('SELECT * FROM selections')).length,0);
  assert.equal((await f.request('/media/'+photos[0])).status,404);assert.equal((await f.db.all('SELECT * FROM photo_cleanup')).length,2);
  f.failRemove=false;assert.equal((await(await f.request(url,{photos:photos.slice(0,2)},'POST')).json()).deleted,0);await f.photoCleanup.cleanup(true);assert.equal((await f.db.all('SELECT * FROM photo_cleanup')).length,0);assert.equal(f.files.size,6);
  await f.request(url,{photos:[photos[2]]},'POST');assert.equal((await f.db.get('SELECT cover_id FROM albums WHERE id=?',[f.album])).cover_id,null);
 }finally{await f.close();}
});
test('Historical duplicate names cannot overwrite an arbitrary existing photo',async()=>{
 const f=await fixture();try{
  const a=first(await f.upload('same.jpg',await jpeg())),b=first(await f.upload('other.jpg',await jpeg()));await f.db.run('UPDATE photos SET original=? WHERE id=?',['SAME.JPG',b.id]);
  const result=await f.upload('same.jpg',await jpeg('#22ff33'),{policy:'overwrite'});assert.equal(result.results[0].code,'AMBIGUOUS_FILENAME');assert.equal(result.results[0].retryable,false);assert.equal(f.files.size,6);
  assert.equal(first(await f.upload('same.jpg',await jpeg())).skipped,true);assert.ok(await f.db.get('SELECT id FROM photos WHERE id=?',[a.id]));
 }finally{await f.close();}
});
test('Vietnamese filenames match normalized names inside prepared packages',async()=>{
 const f=await fixture();try{
  const name='Ảnh cưới.JPG',a=first(await f.upload(name.normalize('NFD'),await jpeg()));
  assert.equal((await f.db.get('SELECT original FROM photos WHERE id=?',[a.id])).original,name);
  const optimized=await optimizePhoto(await jpeg('#ffeedd',180)),bundle=encodePreparedPhoto({originalName:name.toLowerCase(),sourceHash:'a'.repeat(64),...optimized});
  const result=first(await f.upload('prepared.ccphoto',bundle,{policy:'overwrite'}));assert.equal(result.id,a.id);assert.equal(result.replaced,true);assert.equal((await f.db.all('SELECT id FROM photos')).length,1);
 }finally{await f.close();}
});
test('Bulk delete drains more than 24 jobs without waiting for slow storage; transaction rollback retains all photos',async()=>{
 const f=await fixture();let release;const gate=new Promise(r=>release=r),remove=f.storage.remove;
 try{
  const ids=Array.from({length:26},(_,i)=>i.toString(16).padStart(32,'0'));
  for(const id of ids){await f.db.run('INSERT INTO photos(id,album_id,filename,width,height) VALUES(?,?,?,?,?)',[id,f.album,id,100,100]);f.files.set(id+'.webp',Buffer.from('a'));f.files.set(id+'-thumb.webp',Buffer.from('b'));}
  const transaction=f.db.transaction;
  f.db.transaction=fn=>transaction(tx=>fn({...tx,run:async(sql,p)=>{if(sql.startsWith('DELETE FROM photos'))throw Error('simulated database failure');return tx.run(sql,p);}}));
  assert.equal((await f.request('/api/admin/albums/'+f.album+'/photos/delete',{photos:ids.slice(0,25)},'POST')).status,500);
  assert.equal((await f.db.all('SELECT id FROM photos')).length,26);assert.equal((await f.db.all('SELECT * FROM photo_cleanup')).length,0);f.db.transaction=transaction;
  f.storage.remove=async key=>{await gate;return remove(key);};
  const response=await f.request('/api/admin/albums/'+f.album+'/photos/delete',{photos:ids.slice(0,25)},'POST');assert.equal(response.status,200);assert.equal((await response.json()).deleted,25);
  assert.equal(f.files.size,52,'response arrives before storage is released');
  assert.equal((await f.request('/api/admin/photos/'+ids[25],undefined,'DELETE')).status,200,'single deletion does not wait for the existing cleanup');release();await f.photoCleanup.cleanup(true);
  assert.equal((await f.db.all('SELECT * FROM photo_cleanup')).length,0);assert.equal(f.files.size,0);
 }finally{release();await f.photoCleanup.close();await f.close();}
});
test('Background cleanup retries transient database errors without another mutation',async t=>{
 const f=await fixture();const all=f.db.all;try{
  await f.db.run('INSERT INTO photo_cleanup(photo_id,filename) VALUES(?,?)',['retry-job','stale']);f.files.set('stale.webp',Buffer.from('a'));f.files.set('stale-thumb.webp',Buffer.from('b'));
  t.mock.timers.enable({apis:['setTimeout']});let failed=false;
  f.db.all=async(sql,args)=>{if(!failed&&sql.includes('photo_cleanup WHERE')){failed=true;throw Error('temporary database error');}return all(sql,args);};
  await assert.rejects(f.photoCleanup.cleanup(true),/temporary database/);
  t.mock.timers.tick(30000);await f.photoCleanup.cleanup();
  assert.equal(f.files.size,0);assert.equal((await all('SELECT * FROM photo_cleanup')).length,0);
 }finally{f.db.all=all;await f.photoCleanup.close();t.mock.timers.reset();await f.close();}
});
test('Shutdown finishes the current cleanup job and restart drains remaining durable jobs',async()=>{
 const f=await fixture();let release,started;
 const gate=new Promise(r=>release=r),entered=new Promise(r=>started=r),remove=f.storage.remove;
 let restarted;
 try{
  for(const name of ['first','second']){await f.db.run('INSERT INTO photo_cleanup(photo_id,filename) VALUES(?,?)',[name,name]);f.files.set(name+'.webp',Buffer.from('a'));f.files.set(name+'-thumb.webp',Buffer.from('b'));}
  f.storage.remove=async key=>{started();await gate;return remove(key);};
  const drain=f.photoCleanup.cleanup(true);await entered;const closing=f.photoCleanup.close();release();await closing;await drain;
  assert.deepEqual((await f.db.all('SELECT photo_id FROM photo_cleanup')).map(row=>row.photo_id),['second']);assert.equal(f.files.size,2);
  restarted=photoDeletion({db:f.db,storage:f.storage});await restarted.initialize();await restarted.cleanup();
  assert.equal((await f.db.all('SELECT * FROM photo_cleanup')).length,0);assert.equal(f.files.size,0);
 }finally{release();await restarted?.close();await f.close();}
});

test('Failed upload staging is queued durably when storage rollback also fails',async()=>{
 const f=await fixture();try{
  const original=first(await f.upload('keep.jpg',await jpeg()));await f.request(`/api/gallery/${f.album}/selection/${original.id}`,{selected:true},'PUT');
  f.failPut=true;f.failRemove=true;
  const bytes=await jpeg('#ddeeff',180),key=randomUUID(),response=await f.upload('keep.jpg',bytes,{policy:'overwrite',key});
  assert.equal(response.status,422);assert.equal(response.results[0].retryable,true);
  assert.equal(f.files.size,5);assert.equal((await f.db.all('SELECT * FROM photo_cleanup')).length,1);
  f.failPut=false;f.failRemove=false;await f.photoCleanup.cleanup(true);
  assert.equal(f.files.size,3);assert.equal((await f.db.all('SELECT * FROM photo_cleanup')).length,0);
  assert.ok(await f.db.get('SELECT photo_id FROM selections WHERE photo_id=?',[original.id]));
  assert.equal(first(await f.upload('keep.jpg',bytes,{policy:'overwrite',key})).id,original.id);await f.photoCleanup.cleanup(true);assert.equal(f.files.size,3);
 }finally{await f.close();}
});
test('Photo ordering persists integer positions and rejects a list made stale by deletion',async()=>{
 const f=await fixture();try{
  const ids=[];for(let i=0;i<3;i++)ids.push(first(await f.upload(`order-${i}.jpg`,await jpeg())).id);
  const reverse=ids.toReversed(),url=`/api/admin/albums/${f.album}/order`;
  const result=await f.request(url,{photos:reverse},'PUT');assert.equal(result.status,200,await result.text());
  assert.deepEqual((await f.db.all('SELECT id,position FROM photos ORDER BY position')).map(p=>[p.id,p.position]),reverse.map((id,i)=>[id,i]));
  await f.request(`/api/admin/albums/${f.album}/photos/delete`,{photos:[reverse[1]]},'POST');
  const before=await f.db.all('SELECT id,position FROM photos ORDER BY position');assert.equal((await f.request(url,{photos:reverse},'PUT')).status,422);
  assert.deepEqual(await f.db.all('SELECT id,position FROM photos ORDER BY position'),before);
 }finally{await f.close();}
});
test('Album metadata saving serializes with deleting its final cover photo',async()=>{
 const f=await fixture(),run=f.db.run,get=f.db.get,transaction=f.db.transaction;let release,entered,queued;
 const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),mutationQueued=new Promise(r=>queued=r);let holding=false,intercept=true;
 const hold=async(base,sql,args)=>{if(intercept&&sql.startsWith('UPDATE albums SET slug=')){intercept=false;holding=true;entered();await gate;}return base(sql,args);};
 try{
  const p=first(await f.upload('cover.jpg',await jpeg()));
  f.db.run=(sql,args)=>hold(run,sql,args);
  f.db.get=(sql,args)=>{if(holding&&sql.startsWith('SELECT * FROM sessions'))queued();return get(sql,args);};
  f.db.transaction=fn=>{if(holding)queued();return transaction(tx=>fn({...tx,run:(sql,args)=>hold(tx.run,sql,args)}));};
  const metadata={title:'Đổi tên đồng thời',category:'wedding',status:'private',require_password:false};
  const saving=f.request('/api/admin/albums/'+f.album,metadata,'PATCH');await started;
  const removing=f.request(`/api/admin/albums/${f.album}/photos/delete`,{photos:[p.id]},'POST');await mutationQueued;release();
  for(const response of await Promise.all([saving,removing]))assert.equal(response.status,200,await response.text());
  assert.equal((await f.db.get('SELECT cover_id FROM albums WHERE id=?',[f.album])).cover_id,null);
  assert.equal((await f.request('/api/admin/albums/'+f.album,{...metadata,title:'Vẫn chỉnh sửa được'},'PATCH')).status,200);
  // Repair any dangling cover inherited from an older server version too.
  await run('UPDATE albums SET cover_id=? WHERE id=?',[p.id,f.album]);
  assert.equal((await f.request('/api/admin/albums/'+f.album,metadata,'PATCH')).status,200);
  assert.equal((await f.db.get('SELECT cover_id FROM albums WHERE id=?',[f.album])).cover_id,null);
 }finally{release();f.db.run=run;f.db.get=get;f.db.transaction=transaction;await f.close();}
});
