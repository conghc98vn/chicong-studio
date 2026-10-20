import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../server/app.mjs';
import {openDatabase,id} from '../server/db.mjs';
import {takePageData} from '../web/page-data.mjs';
import {imageSources} from '../web/responsive-image.mjs';
import {homeHeroSlides} from '../web/home-curation.mjs';

async function fixture(){
 const dir=await mkdtemp(path.join(tmpdir(),'studio-perf-test-'));
 let db,server,pool,schema;
 const close=async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await db?.close();if(pool){try{await pool.query('DROP SCHEMA '+schema+' CASCADE');}finally{await pool.end();}}await rm(dir,{recursive:true,force:true});};
 try{
  let url=null;
  if(process.env.STUDIO_TEST_POSTGRES_URL){pool=new pg.Pool({connectionString:process.env.STUDIO_TEST_POSTGRES_URL});schema='perf_test_'+id();await pool.query('CREATE SCHEMA '+schema);const target=new URL(process.env.STUDIO_TEST_POSTGRES_URL);target.searchParams.set('options','-c search_path='+schema);url=target.href;}
  db=await openDatabase(dir,{url});
  for(let i=0;i<9;i++){
   const album='album'+i;
   await db.run('INSERT INTO albums(id,slug,title,category,status,client_name,password,created) VALUES(?,?,?,?,?,?,?,?)',[album,'story-'+i,i===8?'Secret album':'Story '+i,'wedding',i===8?'private':'published','Private customer','private-hash',String(i)]);
   for(const position of [2,0,1])await db.run('INSERT INTO photos(id,album_id,filename,width,height,position) VALUES(?,?,?,?,?,?)',[album+'p'+position,album,album+'p'+position,2400,1600,position]);
   await db.run('INSERT INTO selections(album_id,photo_id,updated) VALUES(?,?,?)',[album,album+'p1','2026-10-13']);
  }
  await db.run('INSERT INTO admins(id,email,password) VALUES(?,?,?)',['owner','test@example.test','unused']);
  await db.run('INSERT INTO sessions(token,admin_id,expires) VALUES(?,?,?)',[createHash('sha256').update('test-session').digest('hex'),'owner',Date.now()+60000]);
  const {app}=await createApp({db,dataDir:dir,env:{}});server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  let queries=0;for(const key of ['all','get']){const original=db[key];db[key]=async(...args)=>{queries++;return original(...args);};}
  return {db,close,get queries(){return queries;},reset(){queries=0;},request:route=>fetch('http://127.0.0.1:'+server.address().port+route),admin:route=>fetch('http://127.0.0.1:'+server.address().port+route,{headers:{Cookie:'studio_admin=test-session'}})};
 }catch(error){await close();throw error;}
}
const embedded=html=>JSON.parse(html.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1]);
test('Public HTML reuses three queries, escapes embedded JSON and excludes private album fields',async()=>{
 const f=await fixture();try{
  const hostile='</script><script>alert(1)</script>';
  await f.db.run("UPDATE settings SET value=? WHERE key='brand'",[hostile]);
  for(const route of ['/','/portfolio']){
   f.reset();const response=await f.request(route),html=await response.text();assert.equal(f.queries,3);assert.equal(response.headers.get('cache-control'),'private,no-cache');
   const data=embedded(html);assert.equal(data.site.brand,hostile);assert.equal(data.path,route);assert.equal(data.albums.length,8);
   assert.doesNotMatch(html,/<script>alert\(1\)<\/script>|Secret album|Private customer|private-hash|album8p/);
   assert.ok(data.albums.every(a=>!('client_name' in a)&&!('password' in a)));
   assert.equal((html.match(/rel="preload" as="image"/g)||[]).length,route==='/'?2:0);
  }
  for(const route of ['/admin','/gallery/album8','/album/story-8','/album/missing']){
   for(const request of [f.request,f.admin]){const html=await(await request(route)).text();assert.doesNotMatch(html,/id="page-data"|rel="preload" as="image"/);}
  }
 }finally{await f.close();}
});
test('Batched album reads preserve order and selections with constant query count and authorization',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('/api/admin/albums')).status,401);
  f.reset();const publicRows=await(await f.request('/api/portfolio')).json();assert.equal(f.queries,5);assert.equal(publicRows.length,8);assert.equal(publicRows[0].id,'album7');
  assert.doesNotMatch(JSON.stringify(publicRows),/album8|Private customer|private-hash/);
  f.reset();const adminRows=await(await f.admin('/api/admin/albums')).json();assert.equal(f.queries,6);assert.equal(adminRows.length,9);
  for(const a of adminRows){assert.equal(a.client_name,'Private customer');assert.equal(a.has_password,true);assert.ok(!('password' in a));assert.deepEqual(a.photos.map(p=>p.position),[0,1,2]);assert.deepEqual(a.photos.map(p=>p.selected),[false,true,false]);}
  await f.db.run("UPDATE albums SET status='draft'");assert.deepEqual(await(await f.request('/api/portfolio')).json(),[]);
 }finally{await f.close();}
});
test('Admin album summaries omit every photo catalogue while retaining counts and covers',async()=>{
 const f=await fixture();try{
  f.reset();const response=await f.admin('/api/admin/albums?view=summary'),rows=await response.json();
  assert.equal(response.status,200);assert.equal(f.queries,5);assert.equal(rows.length,9);
  for(const album of rows){
   assert.equal(album.photo_count,3);assert.equal(album.selected_count,1);assert.ok(album.cover?.id);assert.ok(!('photos' in album));assert.ok(!('optimization' in album));assert.ok(!('password' in album));
  }
  assert.ok(Buffer.byteLength(JSON.stringify(rows))<12*1024,'The album list remains a compact summary.');
 }finally{await f.close();}
});
test('A 1500-photo private gallery includes submission state in six bounded queries and excludes storage and upload data',async t=>{
 const f=await fixture();try{
  for(let start=3;start<1500;start+=100){
   const rows=Array.from({length:Math.min(100,1500-start)},(_,index)=>[(start+index).toString(16).padStart(32,'0'),'album8','private-storage-object','Upload '+(start+index)+'.jpg',2400,1600,start+index,'private-upload-hash']);
   await f.db.run('INSERT INTO photos(id,album_id,filename,original,width,height,position,upload_hash) VALUES '+rows.map(()=>'(?,?,?,?,?,?,?,?)').join(','),rows.flat());
  }
  f.reset();const start=performance.now(),response=await f.admin('/api/gallery/album8'),body=await response.text(),duration=performance.now()-start;
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(f.queries,6);
  const album=JSON.parse(body);assert.equal(album.photos.length,1500);assert.equal(album.photos.at(-1).position,1499);assert.equal(album.photos.filter(p=>p.selected).length,1);
  assert.doesNotMatch(body,/private-storage-object|private-upload-hash|private-hash|Private customer|optimization|source_bytes/);
  assert.ok(Buffer.byteLength(body)<650*1024,'Gallery metadata stays below 650 KiB for 1500 photos');
  t.diagnostic(`1500 photos: ${Buffer.byteLength(body)} bytes, 6 queries, ${duration.toFixed(1)} ms on local test fixture`);
  f.reset();const locked=await f.request('/api/gallery/album8');assert.deepEqual(await locked.json(),{locked:true});assert.equal(f.queries,1);
 }finally{await f.close();}
});
test('Bootstrap data is consumed once and malformed or wrong-page data falls back to API',()=>{
 for(const [text,expected] of [[JSON.stringify({path:'/',site:{brand:'Studio'},albums:[]}),true],['{broken',false],[JSON.stringify({path:'/admin',site:{}}),false],[JSON.stringify({path:'/',site:[]}),false]]){
  let removed=false;const node={textContent:text,remove(){removed=true;}},doc={getElementById:()=>removed?null:node};
  assert.equal(!!takePageData('/',doc),expected);assert.equal(removed,true);assert.equal(takePageData('/',doc),null);
 }
});
test('Hero preload shares rendered fallback and true portrait thumbnail width',()=>{
 const photo={id:'p',width:1600,height:2400,src:'/media/p',thumb:'/media/p?size=thumb'};
 assert.equal(imageSources(photo),'/media/p?size=thumb 600w, /media/p 1600w');
 assert.equal(imageSources({...photo,width:600,height:400}),'/media/p?size=thumb 600w');
 const album={id:'a',photos:[photo]};assert.deepEqual(homeHeroSlides([album],'[]','[]'),[{album,wide:photo,tall:photo}]);assert.deepEqual(homeHeroSlides([]),[]);
});
