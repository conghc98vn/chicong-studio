import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';
import {openDatabase} from '../server/db.mjs';
async function fixture(){const dir=await mkdtemp(path.join(tmpdir(),'chicong-tests-'));const instance=await createApp({dataDir:dir,env:{},origin:'http://localhost',seed:false});const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;let cookie='';const client=async(url,data,method='GET',authenticated=true)=>{const response=await fetch(base+url,{method,headers:{Origin:'http://localhost',...(data instanceof FormData?{}:{'Content-Type':'application/json'}),...(authenticated&&cookie?{Cookie:cookie}:{})},body:data?data instanceof FormData?data:JSON.stringify(data):undefined});const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return response;};const setup=async()=>{const r=await client('/api/admin/setup',{email:'studio@example.com',password:'temporary-test-password'},'POST');assert.equal(r.status,201);};return {...instance,dir,base,client,setup,get cookie(){return cookie;},close:async()=>{await new Promise(r=>server.close(r));await instance.db.close();await rm(dir,{recursive:true,force:true});}};}
async function createAlbum(f,status='draft',password=''){const r=await f.client('/api/admin/albums',{title:'A new story',category:'wedding',status,password},'POST');assert.equal(r.status,201);return (await r.json()).id;}
async function upload(f,album){const bytes=await sharp({create:{width:80,height:120,channels:3,background:'#326754'}}).jpeg().toBuffer();const fd=new FormData();fd.append('photos',new Blob([bytes],{type:'image/jpeg'}),'client-photo.jpg');const response=await f.client('/api/admin/albums/'+album+'/photos',fd,'POST');assert.equal(response.status,201);return response.json();}
test('Owner setup, login, private routes and CSRF checks',async()=>{const f=await fixture();try{assert.equal((await f.client('/api/admin/albums',null,'GET',false)).status,401);assert.equal((await f.client('/api/admin/session')).status,200);await f.setup();assert.equal((await f.client('/api/admin/setup',{email:'other@example.com',password:'another-test-password'},'POST')).status,409);const csrf=await fetch(f.base+'/api/admin/albums',{method:'POST',headers:{Origin:'https://other.test',Cookie:f.cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(csrf.status,403);await f.client('/api/admin/logout',{},'POST');assert.equal((await f.client('/api/admin/albums')).status,401);assert.equal((await f.client('/api/admin/login',{email:'studio@example.com',password:'wrong'},'POST')).status,401);assert.equal((await f.client('/api/admin/login',{email:'studio@example.com',password:'temporary-test-password'},'POST')).status,200);}finally{await f.close();}});
test('Upload, privacy, customer selections, CSV and password revocation',async()=>{const f=await fixture();try{await f.setup();const album=await createAlbum(f,'private','client-pass');await upload(f,album);const adminCookie=f.cookie;let records=await (await f.client('/api/admin/albums')).json();const photo=records[0].photos[0];assert.equal(photo.width,80);assert.equal((await f.client('/media/'+photo.id,null,'GET',false)).status,404);assert.deepEqual(await (await f.client('/api/portfolio',null,'GET',false)).json(),[]);assert.deepEqual(await (await f.client('/api/gallery/'+album,null,'GET',false)).json(),{locked:true});assert.equal((await f.client('/api/gallery/'+album+'/unlock',{password:'bad'},'POST',false)).status,401);assert.equal((await f.client('/api/gallery/'+album+'/unlock',{password:'client-pass'},'POST',false)).status,200);const galleryCookie=f.cookie;assert.equal((await f.client('/media/'+photo.id)).status,200);assert.equal((await f.client(`/api/gallery/${album}/selection/${photo.id}`,{selected:true},'PUT')).status,200);assert.equal((await f.client('/api/gallery/'+album+'/submit',{},'POST')).status,200);assert.equal((await f.client('/api/admin/albums')).status,401);const csv=await fetch(f.base+'/api/admin/albums/'+album+'/selections.csv',{headers:{Cookie:adminCookie}});assert.equal(csv.status,200);assert.match(await csv.text(),/client-photo.jpg/);const updated=await fetch(f.base+'/api/admin/albums/'+album,{method:'PATCH',headers:{Cookie:adminCookie,Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({...records[0],password:'new-client-pass'})});assert.equal(updated.status,200);const stale=await fetch(f.base+'/api/gallery/'+album,{headers:{Cookie:galleryCookie}});assert.deepEqual(await stale.json(),{locked:true});const selections=await f.db.all('SELECT * FROM selections');assert.equal(selections.length,1);}finally{await f.close();}});
test('Only published portfolios visible; archive hides photos; local data persists',async()=>{const f=await fixture();try{await f.setup();const album=await createAlbum(f,'published');await upload(f,album);const rows=await (await f.client('/api/portfolio',null,'GET',false)).json();assert.equal(rows.length,1);assert.equal((await f.client('/media/'+rows[0].photos[0].id,null,'GET',false)).status,200);await f.client('/api/admin/albums/'+album,{...rows[0],status:'archived'},'PATCH');assert.equal((await f.client('/media/'+rows[0].photos[0].id,null,'GET',false)).status,404);const second=await openDatabase(f.dir,{url:null});assert.equal((await second.get('SELECT status FROM albums WHERE id=?',[album])).status,'archived');await second.close();}finally{await f.close();}});
test('Booking persists; private notes stay private; one confirmed booking per day',async()=>{const f=await fixture();try{await f.setup();const inquiry={name:'Test customer',email:'customer@example.com',service:'Ngày cưới',date:'2099-03-04',message:'A wedding photography inquiry'};const first=await f.client('/api/inquiries',inquiry,'POST',false);assert.equal(first.status,201);assert.equal((await f.client('/api/inquiries',inquiry,'POST',false)).status,201);const requests=await (await f.client('/api/admin/inquiries')).json();assert.equal(requests.length,2);assert.equal((await f.client('/api/admin/inquiries/'+requests[0].id,{status:'confirmed'},'PATCH')).status,200);assert.equal((await f.client('/api/admin/inquiries/'+requests[1].id,{status:'confirmed'},'PATCH')).status,409);assert.equal((await f.client('/api/inquiries',inquiry,'POST',false)).status,409);await f.client('/api/admin/dates',{date:'2099-04-01',note:'Private family plans'},'POST');const publicDates=await (await f.client('/api/availability',null,'GET',false)).json();assert.ok(publicDates.blocked.includes('2099-03-04'));assert.ok(publicDates.blocked.includes('2099-04-01'));assert.doesNotMatch(JSON.stringify(publicDates),/Private family|customer@example/);assert.equal((await f.client('/api/inquiries',{...inquiry,date:'2099-02-30'},'POST',false)).status,422);}finally{await f.close();}});
test('Rejects invalid image uploads and requires private gallery passwords',async()=>{const f=await fixture();try{await f.setup();assert.equal((await f.client('/api/admin/albums',{title:'Private',category:'wedding',status:'private'},'POST')).status,422);const album=await createAlbum(f);const fd=new FormData();fd.append('photos',new Blob(['fake JPEG'],{type:'image/jpeg'}),'bad.jpg');assert.equal((await f.client('/api/admin/albums/'+album+'/photos',fd,'POST')).status,422);assert.equal((await f.db.all('SELECT * FROM photos')).length,0);const settings=await f.client('/api/admin/settings',{brand:'<script>alert(1)</script>'},'PATCH');assert.equal(settings.status,200);const html=await (await fetch(f.base+'/')).text();assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<title><script>/);}finally{await f.close();}});
test('Cross-album selection requests do not grant media access',async()=>{const f=await fixture();try{await f.setup();const a=await createAlbum(f,'private','first-pass'),b=await createAlbum(f,'private','second-pass');await upload(f,a);await upload(f,b);const rows=await (await f.client('/api/admin/albums')).json();const photoB=rows.find(x=>x.id===b).photos[0];await f.client('/api/gallery/'+a+'/unlock',{password:'first-pass'},'POST',false);assert.equal((await f.client(`/api/gallery/${a}/selection/${photoB.id}`,{selected:true},'PUT')).status,404);assert.equal((await f.client('/media/'+photoB.id)).status,404);}finally{await f.close();}});

test('Settings validation commits all fields together',async()=>{const f=await fixture();try{await f.setup();const before=await (await f.client('/api/site')).json();for(const invalid of [{email:'invalid'},{instagram:'https://other.example/profile'}]){const r=await f.client('/api/admin/settings',{brand:'Must not be saved',...invalid},'PATCH');assert.equal(r.status,422);assert.deepEqual(await (await f.client('/api/site')).json(),before);}assert.equal((await f.client('/api/admin/settings',{brand:'My Studio',email:'hello@example.com'},'PATCH')).status,200);const after=await (await f.client('/api/site')).json();assert.equal(after.brand,'My Studio');assert.equal(after.email,'hello@example.com');}finally{await f.close();}});
test('Upload response identifies each success and failure in a mixed batch',async()=>{const f=await fixture();try{await f.setup();const album=await createAlbum(f);const bytes=await sharp({create:{width:40,height:60,channels:3,background:'#326754'}}).jpeg().toBuffer();const fd=new FormData();fd.append('photos',new Blob([bytes],{type:'image/jpeg'}),'same.jpg');fd.append('photos',new Blob(['broken'],{type:'image/jpeg'}),'same.jpg');const r=await f.client('/api/admin/albums/'+album+'/photos',fd,'POST');assert.equal(r.status,201);const result=await r.json();assert.equal(result.uploaded,1);assert.equal(result.results[0].index,0);assert.equal(result.results[0].success,true);assert.deepEqual(result.results[1],{index:1,success:false});assert.equal((await f.db.all('SELECT * FROM photos')).length,1);}finally{await f.close();}});

test('Lost upload response and concurrent retry store one photo per upload key',async()=>{const f=await fixture();try{await f.setup();const album=await createAlbum(f);const bytes=await sharp({create:{width:45,height:65,channels:3,background:'#315746'}}).jpeg().toBuffer();const key='b'.repeat(32);const post=async(buffer=bytes,keys=[key])=>{const fd=new FormData();fd.append('photos',new Blob([buffer],{type:'image/jpeg'}),'repeat.jpg');return fetch(f.base+'/api/admin/albums/'+album+'/photos',{method:'POST',headers:{Origin:'http://localhost',Cookie:f.cookie,'X-Upload-Keys':JSON.stringify(keys)},body:fd});};
 const responses=await Promise.all([post(),post()]);assert.deepEqual(responses.map(r=>r.status),[201,201]);const ids=await Promise.all(responses.map(async r=>(await r.json()).results[0].id));assert.equal(ids[0],ids[1]);assert.equal((await f.db.all('SELECT * FROM photos')).length,1);
 const changed=await sharp({create:{width:45,height:65,channels:3,background:'#ff0000'}}).jpeg().toBuffer();assert.equal((await post(changed)).status,422);assert.equal((await f.client('/media/'+ids[0])).status,200);
 assert.equal((await post(bytes,['invalid'])).status,422);assert.equal((await f.db.all('SELECT * FROM photos')).length,1);
 const replay=await post();assert.equal((await replay.json()).results[0].reused,true);
 }finally{await f.close();}});
test('Reorder validates full album membership and commits one complete order',async()=>{const f=await fixture();try{await f.setup();const a=await createAlbum(f),b=await createAlbum(f);for(let i=0;i<3;i++)await upload(f,a);await upload(f,b);let rows=await (await f.client('/api/admin/albums')).json();const original=rows.find(x=>x.id===a).photos.map(p=>p.id),foreign=rows.find(x=>x.id===b).photos[0].id;
 for(const invalid of [original.slice(1),[original[0],original[0],original[2]],[foreign,...original.slice(1)]])assert.equal((await f.client('/api/admin/albums/'+a+'/order',{photos:invalid},'PUT')).status,422);
 assert.deepEqual((await f.db.all('SELECT id FROM photos WHERE album_id=? ORDER BY position,id',[a])).map(p=>p.id),original);
 const ordered=[...original].reverse();assert.equal((await f.client('/api/admin/albums/'+a+'/order',{photos:ordered},'PUT')).status,200);assert.deepEqual((await f.db.all('SELECT id FROM photos WHERE album_id=? ORDER BY position,id',[a])).map(p=>p.id),ordered);
 }finally{await f.close();}});
test('Dashboard readiness is owner-only and reflects usable published portfolios',async()=>{const f=await fixture();try{await f.setup();assert.equal((await f.client('/api/admin/dashboard',null,'GET',false)).status,401);let d=await (await f.client('/api/admin/dashboard')).json();assert.deepEqual(d.readiness,{contact:false,portfolio:false,cloud:false,production:false});const album=await createAlbum(f,'published');d=await (await f.client('/api/admin/dashboard')).json();assert.equal(d.readiness.portfolio,false);await upload(f,album);await f.client('/api/admin/settings',{phone:'0900000000'},'PATCH');d=await (await f.client('/api/admin/dashboard')).json();assert.equal(d.readiness.contact,true);assert.equal(d.readiness.portfolio,true);assert.equal((await f.client('/api/admin/settings',{brand:''},'PATCH')).status,422);assert.equal((await f.client('/api/admin/albums',{title:'Invalid date',category:'wedding',event_date:'2099-02-30'},'POST')).status,422);}finally{await f.close();}});
test('Health returns a sanitized 503 if database is unavailable',async()=>{const f=await fixture();const get=f.db.get;try{f.db.get=async()=>{throw Error('private connection password');};const r=await fetch(f.base+'/api/health');assert.equal(r.status,503);assert.deepEqual(await r.json(),{ok:false});}finally{f.db.get=get;await f.close();}});

async function bookingRequest(f,date='',name='Khách kiểm thử'){
 const response=await f.client('/api/inquiries',{name,email:'booking-test@example.com',service:'Ngày cưới',date,message:'Yêu cầu kiểm thử buổi chụp ảnh',notes:'Public input must not create private notes'},'POST',false);
 assert.equal(response.status,201);
 return (await f.db.all('SELECT * FROM inquiries ORDER BY created DESC'))[0];
}
test('Reschedule confirmed booking releases old date and persists private notes',async()=>{
 const f=await fixture();try{
  await f.setup();const inquiry=await bookingRequest(f,'2099-05-10');
  const endpoint='/api/admin/inquiries/'+inquiry.id;
  assert.equal(inquiry.notes,'');
  assert.equal((await f.client(endpoint,{status:'confirmed',notes:'Trao đổi riêng tại studio'},'PATCH')).status,200);
  assert.equal((await f.client(endpoint,{date:'2099-05-12'},'PATCH')).status,200);
  const availability=await (await f.client('/api/availability',null,'GET',false)).json();
  assert.ok(availability.blocked.includes('2099-05-12'));assert.ok(!availability.blocked.includes('2099-05-10'));
  assert.doesNotMatch(JSON.stringify(availability),/Trao đổi|booking-test|Khách kiểm thử/);
  const row=(await (await f.client('/api/admin/inquiries')).json())[0];
  assert.equal(row.status,'confirmed');assert.equal(row.notes,'Trao đổi riêng tại studio');assert.equal(row.date,'2099-05-12');
  const second=await openDatabase(f.dir,{url:null});try{assert.equal((await second.get('SELECT notes FROM inquiries WHERE id=?',[inquiry.id])).notes,row.notes);}finally{await second.close();}
  const backup=await (await f.client('/api/admin/export')).json();assert.equal(backup.inquiries[0].notes,row.notes);
  assert.equal((await f.client(endpoint,{notes:'Changed publicly'},'PATCH',false)).status,401);
  assert.equal((await f.client('/api/admin/inquiries',null,'GET',false)).status,401);
  assert.equal((await f.client(endpoint,{status:'cancelled'},'PATCH')).status,200);
  assert.ok(!(await (await f.client('/api/availability')).json()).blocked.includes('2099-05-12'));
 }finally{await f.close();}
});
test('Conflicting reschedule leaves original date status and notes unchanged',async()=>{
 const f=await fixture();try{
  await f.setup();const a=await bookingRequest(f,'2099-06-10'),b=await bookingRequest(f,'2099-06-11');
  const endpoint='/api/admin/inquiries/'+a.id;
  await f.client(endpoint,{status:'confirmed',notes:'Original notes'},'PATCH');
  await f.client('/api/admin/inquiries/'+b.id,{status:'confirmed'},'PATCH');
  await f.client('/api/admin/dates',{date:'2099-06-12',note:'Private blocked day'},'POST');
  const original=await f.db.get('SELECT * FROM inquiries WHERE id=?',[a.id]);
  for(const date of ['2099-06-11','2099-06-12']){
   assert.equal((await f.client(endpoint,{date,status:'confirmed',notes:'Must not save'},'PATCH')).status,409);
   assert.deepEqual(await f.db.get('SELECT * FROM inquiries WHERE id=?',[a.id]),original);
  }
  assert.equal((await f.client('/api/admin/inquiries/'+b.id,{status:'cancelled'},'PATCH')).status,200);
  assert.equal((await f.client(endpoint,{date:'2099-06-11'},'PATCH')).status,200);
 }finally{await f.close();}
});
test('Booking validation requires confirmation date and rejects malformed partial updates',async()=>{
 const f=await fixture();try{
  await f.setup();const inquiry=await bookingRequest(f),endpoint='/api/admin/inquiries/'+inquiry.id;
  const original=await f.db.get('SELECT * FROM inquiries WHERE id=?',[inquiry.id]);
  for(const data of [{status:'confirmed'},{date:'2099-02-30'},{date:'2099-03-01extra'},{date:123},{date:null},{date:'2000-01-01'},{status:'unknown'},{notes:[]},{notes:'x'.repeat(3001)}]){
   assert.equal((await f.client(endpoint,data,'PATCH')).status,422,JSON.stringify(data).slice(0,120));
   assert.deepEqual(await f.db.get('SELECT * FROM inquiries WHERE id=?',[inquiry.id]),original);
  }
  assert.equal((await f.client(endpoint,{date:'2099-07-10',status:'confirmed',notes:'  Preparation details  '},'PATCH')).status,200);
  assert.equal((await f.client(endpoint,{date:''},'PATCH')).status,422);
  assert.equal((await f.client(endpoint,{notes:''},'PATCH')).status,200);
  assert.equal((await f.client(endpoint,{date:'',status:'contacted'},'PATCH')).status,200);
  const row=await f.db.get('SELECT * FROM inquiries WHERE id=?',[inquiry.id]);assert.equal(row.date,'');assert.equal(row.notes,'');assert.equal(row.status,'contacted');
  assert.equal((await f.client('/api/admin/inquiries/missing',{status:'new'},'PATCH')).status,404);
 }finally{await f.close();}
});
test('Concurrent reschedules cannot confirm two bookings for the same day',async()=>{
 const f=await fixture();try{
  await f.setup();const a=await bookingRequest(f,'2099-08-10'),b=await bookingRequest(f,'2099-08-11');
  for(const row of [a,b])assert.equal((await f.client('/api/admin/inquiries/'+row.id,{status:'confirmed'},'PATCH')).status,200);
  const responses=await Promise.all([a,b].map(row=>f.client('/api/admin/inquiries/'+row.id,{date:'2099-08-12'},'PATCH')));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const rows=await f.db.all("SELECT * FROM inquiries WHERE status='confirmed'");
  assert.equal(rows.filter(r=>r.date==='2099-08-12').length,1);
  const loser=rows.find(r=>r.date!=='2099-08-12');assert.equal(loser.date,loser.id===a.id?a.date:b.date);
 }finally{await f.close();}
});
test('Historical booking notes can be edited without moving the date',async()=>{
 const f=await fixture();try{
  await f.setup();const row=await bookingRequest(f,'2099-09-10');
  await f.db.run("UPDATE inquiries SET date='2000-01-01',status='confirmed' WHERE id=?",[row.id]);
  assert.equal((await f.client('/api/admin/inquiries/'+row.id,{date:'2000-01-01',status:'completed',notes:'Đã bàn giao ảnh'},'PATCH')).status,200);
  assert.equal((await f.db.get('SELECT notes FROM inquiries WHERE id=?',[row.id])).notes,'Đã bàn giao ảnh');
 }finally{await f.close();}
});
