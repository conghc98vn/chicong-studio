import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import pg from 'pg';
import {createApp} from '../server/app.mjs';
import {openDatabase,id,hashPassword} from '../server/db.mjs';
import {createStorage} from '../server/storage.mjs';
import {requestSecurity} from '../server/request-security.mjs';

async function fixture({production=false,env={},origin}={}){
 const dir=await mkdtemp(path.join(tmpdir(),'studio-security-'));
 let pool,schema,db,server;
 const close=async()=>{
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  await db?.close();
  if(pool){try{await pool.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');}finally{await pool.end();}}
  await rm(dir,{recursive:true,force:true});
 };
 try{
  let url=null;
  if(process.env.STUDIO_TEST_POSTGRES_URL){
   pool=new pg.Pool({connectionString:process.env.STUDIO_TEST_POSTGRES_URL});
   schema='security_test_'+id();await pool.query('CREATE SCHEMA '+schema);
   const target=new URL(process.env.STUDIO_TEST_POSTGRES_URL);target.searchParams.set('options','-c search_path='+schema);url=target.href;
  }
  db=await openDatabase(dir,{url});
  const storage=createStorage(path.join(dir,'uploads'),{});
  const settings={...(production?{SITE_URL:'https://studio.example',DATABASE_URL:'injected-test-db',SUPABASE_URL:'injected-test-storage',SETUP_TOKEN:'test-setup-token'}:{}),...env};
  const instance=await createApp({production,env:settings,origin,db,storage,dataDir:dir,mailer:{notifyNewInquiry:async()=>({skipped:true})}});
  server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  const request=(route,body,method='GET',cookie='',headers={})=>fetch(base+route,{method,headers:{Origin:origin||settings.SITE_URL||base,...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
  const setup=async()=>{const r=await request('/api/admin/setup',{email:'audit@example.test',password:'temporary-test-password',token:settings.SETUP_TOKEN},'POST');assert.equal(r.status,201);return r.headers.get('set-cookie').split(';')[0];};
  return {...instance,base,request,setup,close};
 }catch(error){await close();throw error;}
}
const setupBody={email:'audit@example.test',password:'temporary-test-password'};
test('Staging excludes every response from indexing and omits production analytics',async()=>{
 const f=await fixture({production:true,env:{SITE_INDEXING:'false',ANALYTICS_ENABLED:'false'}});try{
  for(const route of ['/','/api/health','/robots.txt','/missing-page']){
   const response=await f.request(route);assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');
   const body=await response.text();
   if(route==='/'){assert.match(body,/<meta name="robots" content="noindex,nofollow"/);assert.doesNotMatch(body,/beacon\.min\.js|data-cf-beacon/);}
   if(route==='/robots.txt')assert.equal(body,'User-agent: *\nDisallow: /');
  }
 }finally{await f.close();}
});
function rawRequest(base,route,{method='GET',headers={},body}={}){
 return new Promise((resolve,reject)=>{
  const req=http.request(base+route,{method,headers:{'Content-Type':'application/json',...headers}},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
  });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
 });
}
test('Local rebinding Host is denied before setup and forwarded headers cannot make it trusted',async()=>{
 const f=await fixture();try{
  for(const Host of ['attacker.example','localhost.attacker.example','127.0.0.1.attacker.example']){
   const r=await rawRequest(f.base,'/api/admin/setup',{method:'POST',headers:{Host,Origin:'http://'+Host,'X-Forwarded-Host':'localhost','X-Forwarded-For':'127.0.0.1'},body:setupBody});assert.equal(r.status,403);
   assert.equal((await rawRequest(f.base,'/api/site',{headers:{Host}})).status,403);
  }
  assert.equal((await f.db.all('SELECT * FROM admins')).length,0);
  assert.equal((await f.db.all('SELECT * FROM rate_limits')).length,0);
  await f.setup();
 }finally{await f.close();}
});
test('Local loopback hosts work while malformed hosts fail closed',async()=>{
 const f=await fixture();try{
  for(const Host of ['localhost','127.0.0.1','[::1]']){
   const r=await rawRequest(f.base,'/api/admin/login',{method:'POST',headers:{Host,Origin:'http://'+Host},body:setupBody});assert.equal(r.status,401);
  }
  for(const Host of ['localhost@attacker.example','localhost/anything','localhost?x','localhost#x','[invalid']){
   const r=await rawRequest(f.base,'/api/site',{headers:{Host}});assert.equal(r.status,400);
  }
 }finally{await f.close();}
});
test('Configured setup token is enforced even on loopback',async()=>{
 const f=await fixture({env:{SETUP_TOKEN:'test-token'}});try{
  for(const token of [undefined,'wrong'])assert.equal((await f.request('/api/admin/setup',{...setupBody,token},'POST')).status,403);
  assert.equal((await f.db.all('SELECT * FROM admins')).length,0);await f.setup();
 }finally{await f.close();}
});
test('Explicit LAN origin is allowed but non-loopback Host cannot skip setup token',async()=>{
 const env={SITE_URL:'http://192.168.1.25:4173',SETUP_TOKEN:'lan-test-token'};
 const f=await fixture({env});try{
  const headers={Host:'192.168.1.25:4173',Origin:env.SITE_URL};
  assert.equal((await rawRequest(f.base,'/api/admin/setup',{method:'POST',headers,body:setupBody})).status,403);
  assert.equal((await rawRequest(f.base,'/api/admin/setup',{method:'POST',headers,body:{...setupBody,token:env.SETUP_TOKEN}})).status,201);
 }finally{await f.close();}
});
test('Production API accepts only configured Origin and rejects request Host fallback',async()=>{
 const f=await fixture({production:true});try{
  const cookie=await f.setup();
  for(const Origin of ['https://attacker.example','null','']){
   const r=await rawRequest(f.base,'/api/admin/settings',{method:'PATCH',headers:{Host:'attacker.example',Origin,Cookie:cookie,'X-Forwarded-Proto':'https'},body:{brand:'Injected'}});assert.equal(r.status,403);
  }
  assert.equal((await f.request('/api/admin/settings',{brand:'Valid studio'},'PATCH',cookie)).status,200);
  assert.equal((await f.request('/api/health')).status,200);
 }finally{await f.close();}
});
test('Invalid origin and blanket proxy trust configurations fail at startup',()=>{
 for(const SITE_URL of [undefined,'not-a-url','http://studio.example','https://u:p@studio.example','https://studio.example/path','https://studio.example?x=1'])assert.throws(()=>requestSecurity({production:true,env:{SITE_URL}}));
 assert.throws(()=>requestSecurity({production:false,env:{TRUST_PROXY:'true'}}));
 assert.throws(()=>requestSecurity({production:false,env:{TRUST_PROXY:''}}));
 assert.equal(requestSecurity({production:true,env:{SITE_URL:'https://studio.example'}}).trustProxy,1);
});
test('Direct deployment ignores spoofed forwarding headers when proxy trust is disabled',async()=>{
 const f=await fixture({production:true,env:{TRUST_PROXY:'false'}});try{
  for(let i=0;i<9;i++)assert.equal((await f.request('/api/admin/login',setupBody,'POST','',{'X-Forwarded-For':'198.51.100.'+(i+1)})).status,i<8?401:429);
 }finally{await f.close();}
});
test('Trusted proxy chain uses nearest untrusted client rather than attacker prepended IP',async()=>{
 const f=await fixture({production:true,env:{TRUST_PROXY:'loopback'}});try{
  for(let i=0;i<9;i++)assert.equal((await f.request('/api/admin/login',setupBody,'POST','',{'X-Forwarded-For':`198.51.100.${i+1}, 203.0.113.8`})).status,i<8?401:429);
  assert.equal((await f.request('/api/admin/login',setupBody,'POST','',{'X-Forwarded-For':'203.0.113.9'})).status,401);
 }finally{await f.close();}
});
test('Concurrent unknown gallery IDs share one bounded quota and indexed periodic cleanup',async()=>{
 const f=await fixture();try{
  await f.db.run('INSERT INTO rate_limits(key,count,expires) VALUES(?,?,?)',['expired-test',1,Date.now()-1000]);
  let cleanups=0;const run=f.db.run;f.db.run=async(sql,...args)=>{if(sql.startsWith('DELETE FROM rate_limits'))cleanups++;return run(sql,...args);};
  const responses=await Promise.all(Array.from({length:80},(_,i)=>f.request('/api/gallery/'+(i%2?'invalid-'+i:i.toString(16).padStart(32,'0'))+'/unlock',{password:'wrong'},'POST')));
  assert.equal(responses.filter(r=>r.status===401).length,60);assert.equal(responses.filter(r=>r.status===429).length,20);
  const rows=await f.db.all('SELECT * FROM rate_limits');assert.equal(rows.length,1);assert.equal(Number(rows[0].count),60);assert.equal(cleanups,1);
  const indexes=f.db.cloud?await f.db.all("SELECT indexname AS name FROM pg_indexes WHERE schemaname=current_schema() AND tablename='rate_limits'"):await f.db.all('PRAGMA index_list(rate_limits)');
  assert.ok(indexes.some(index=>index.name==='rate_limits_expires'));
  await f.db.run('UPDATE rate_limits SET expires=?',[Date.now()-1000]);
  assert.equal((await f.request('/api/gallery/'+id()+'/unlock',{password:'wrong'},'POST')).status,401);
  assert.equal(Number((await f.db.get('SELECT count FROM rate_limits')).count),1);
 }finally{await f.close();}
});
test('Known gallery keeps its password quota and successful access after outer guard',async()=>{
 const f=await fixture();try{
  const a=id(),b=id();for(const key of [a,b])await f.db.run('INSERT INTO albums(id,title,category,status,password) VALUES(?,?,?,?,?)',[key,'Private','wedding','private',hashPassword('gallery-password')]);
  for(let i=0;i<9;i++)assert.equal((await f.request('/api/gallery/'+a+'/unlock',{password:'wrong'},'POST')).status,i<8?401:429);
  const unlocked=await f.request('/api/gallery/'+b+'/unlock',{password:'gallery-password'},'POST');assert.equal(unlocked.status,200);
  const cookie=unlocked.headers.get('set-cookie').split(';')[0];const album=await (await f.request('/api/gallery/'+b,undefined,'GET',cookie)).json();assert.equal(album.id,b);
 }finally{await f.close();}
});
test('Media and portrait cache revalidate and revoked media cannot return 304',async()=>{
 const f=await fixture();try{
  const cookie=await f.setup();const a=id(),photo=id(),portrait=id();
  await f.db.run('INSERT INTO albums(id,title,category,status) VALUES(?,?,?,?)',[a,'Published','wedding','published']);
  await f.db.run('INSERT INTO photos(id,album_id,filename,width,height) VALUES(?,?,?,?,?)',[photo,a,photo,16,16]);
  const bytes=await sharp({create:{width:16,height:16,channels:3,background:'white'}}).webp().toBuffer();
  for(const filename of [photo,photo+'-thumb',portrait])await f.storage.put(filename+'.webp',bytes);
  await f.db.run("UPDATE settings SET value=? WHERE key='portrait'",[portrait]);
  for(const route of ['/media/'+photo,'/media/'+photo+'?size=thumb','/portrait/'+portrait]){
   const response=await f.request(route);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private,no-cache');await response.arrayBuffer();
   const etag=response.headers.get('etag');const cached=await f.request(route,undefined,'GET','',{'If-None-Match':etag,'Cache-Control':'max-age=0'});assert.equal(cached.status,304);assert.equal(cached.headers.get('cache-control'),'private,no-cache');
   assert.equal((await f.request(route,undefined,'HEAD')).headers.get('cache-control'),'private,no-cache');
  }
  const etag=(await f.request('/media/'+photo,undefined,'HEAD')).headers.get('etag');
  for(const status of ['private','archived']){
   assert.equal((await f.request('/api/admin/albums/'+a,{title:'Hidden',category:'wedding',status,password:'gallery-password'},'PATCH',cookie)).status,200);
   for(const method of ['GET','HEAD']){
    const r=await f.request('/media/'+photo,undefined,method,'',{'If-None-Match':etag});assert.equal(r.status,404);assert.equal(r.headers.get('cache-control'),'private,no-store');
   }
   assert.equal((await f.request('/media/'+photo,undefined,'GET',cookie)).headers.get('cache-control'),'private,no-store');
  }
  await f.db.run("UPDATE settings SET value='' WHERE key='portrait'");assert.equal((await f.request('/portrait/'+portrait)).status,404);
 }finally{await f.close();}
});

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
for(const initialPassword of ['previous-password',null])test('Unlock rereads credentials after concurrent password change: '+(initialPassword?'password replacement':'enable password'),async()=>{
 const f=await fixture(),read=f.db.get;try{
  const admin=await f.setup(),album=id();await f.db.run('INSERT INTO albums(id,title,category,status,password) VALUES(?,?,?,?,?)',[album,'Before','wedding','private',initialPassword?hashPassword(initialPassword):null]);
  const observed=deferred(),resume=deferred();let held=false;
  f.db.get=async(sql,...args)=>{const value=await read(sql,...args);if(!held&&sql.startsWith('SELECT password FROM albums')){held=true;observed.resolve();await resume.promise;}return value;};
  const unlock=f.request('/api/gallery/'+album+'/unlock',{password:initialPassword||''},'POST');await observed.promise;
  assert.equal((await f.request('/api/admin/albums/'+album,{title:'After',category:'wedding',status:'private',password:'replacement-password',require_password:true},'PATCH',admin)).status,200);
  resume.resolve();const response=await unlock;assert.equal(response.status,401);assert.equal(response.headers.get('set-cookie'),null);assert.equal((await f.db.all('SELECT * FROM sessions WHERE album_id=?',[album])).length,0);
 }finally{f.db.get=read;await f.close();}
});
test('Unlock commits first: changing password revokes it, title-only editing preserves it',async()=>{
 const f=await fixture(),transaction=f.db.transaction;try{
  const admin=await f.setup(),album=id();await f.db.run('INSERT INTO albums(id,title,category,status,password) VALUES(?,?,?,?,?)',[album,'Before','wedding','private',hashPassword('previous-password')]);
  const observed=deferred(),resume=deferred();let held=false;
  f.db.transaction=fn=>transaction(tx=>fn({...tx,get:async(sql,...args)=>{const value=await tx.get(sql,...args);if(!held&&sql.includes("status='private'")){held=true;observed.resolve();await resume.promise;}return value;}}));
  const unlock=f.request('/api/gallery/'+album+'/unlock',{password:'previous-password'},'POST');await observed.promise;
  const patch=f.request('/api/admin/albums/'+album,{title:'After',category:'wedding',status:'private',password:'replacement-password'},'PATCH',admin);
  resume.resolve();const response=await unlock;assert.equal(response.status,200);assert.equal((await patch).status,200);
  const stale=response.headers.get('set-cookie').split(';')[0];assert.equal((await(await f.request('/api/gallery/'+album,undefined,'GET',stale)).json()).locked,true);
  const fresh=await f.request('/api/gallery/'+album+'/unlock',{password:'replacement-password'},'POST');const cookie=fresh.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.request('/api/admin/albums/'+album,{title:'Only the title',category:'wedding',status:'private'},'PATCH',admin)).status,200);
  assert.equal((await(await f.request('/api/gallery/'+album,undefined,'GET',cookie)).json()).locked,undefined);
 }finally{f.db.transaction=transaction;await f.close();}
});

test('Media maintenance blocks all admin media routes with a useful message while gallery reads remain available',async()=>{
 const f=await fixture();try{
  const admin=await f.setup(),album=id();await f.db.run('INSERT INTO albums(id,title,category,status) VALUES(?,?,?,?)',[album,'Open','wedding','private']);
  const lease=await f.mediaControl.acquire('test-backup');
  for(const [route,method,body] of [['/api/admin/settings','PATCH',{brand:'Blocked'}],['/api/admin/albums','POST',{}],['/api/admin/albums/'+album,'PATCH',{}],['/api/admin/sections/'+id(),'DELETE',{}],['/api/admin/photos/'+id(),'DELETE',{}]]){
   const response=await f.request(route,body,method,admin);assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'30');assert.match((await response.json()).error,/tạm khóa/);
  }
  assert.equal((await f.request('/api/gallery/'+album)).status,200);assert.equal((await f.request('/api/admin/media-status',undefined,'GET',admin)).status,200);await f.mediaControl.release(lease);
 }finally{await f.close();}
});
