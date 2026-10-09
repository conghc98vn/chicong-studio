import test from 'node:test';
import {createHash} from 'node:crypto';
import {validateInquiry} from '../web/inquiry-validation.mjs';
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

test('Editorial copy preserves custom text and updates sharing metadata',async()=>{
 const f=await fixture();try{
  await f.setup();
  await f.db.run("UPDATE settings SET value=? WHERE key='headline'",['Những câu chuyện xứng đáng được lưu giữ.']);
  const s=await(await f.client('/api/site')).json();assert.equal(s.headline,'Ngày cưới qua đi.\nCảm xúc ở lại.');
  assert.equal((await f.client('/api/admin/settings',{headline:'A personal headline',intro:'My custom public introduction',phone:'0969 910 198',name:'Chí Công'},'PATCH')).status,200);
  const html=await(await fetch(f.base+'/')).text();assert.match(html,/My custom public introduction/);assert.match(html,/Wedding Photographer/);
  assert.equal((await(await f.client('/api/site')).json()).headline,'A personal headline');
  assert.equal((await f.client('/api/admin/settings',{phone:'not a phone'},'PATCH')).status,422);
  assert.equal((await f.client('/api/admin/settings',{zalo:'javascript:alert(1)'},'PATCH')).status,422);
 }finally{await f.close();}
});

test('Curation validates public membership and commits settings atomically',async()=>{
 const f=await fixture();try{
  await f.setup();const published=await createAlbum(f,'published'),hidden=await createAlbum(f,'private','private-test-password');await upload(f,published);await upload(f,hidden);
  const albums=await(await f.client('/api/admin/albums')).json();const photo=albums.find(a=>a.id===published).photos[0].id,privatePhoto=albums.find(a=>a.id===hidden).photos[0].id;
  const heroSelection=JSON.stringify([{albumId:published,wideId:photo,tallId:photo}]);
  assert.equal((await f.client('/api/admin/settings',{heroSelection,storySelection:JSON.stringify([{albumId:published,photoId:photo}])},'PATCH')).status,200);
  const before=await(await f.client('/api/site')).json();
  for(const choices of [[{albumId:hidden,wideId:privatePhoto,tallId:privatePhoto}],[{albumId:published,wideId:privatePhoto,tallId:photo}],[{albumId:published,wideId:photo,tallId:photo},{albumId:published,wideId:photo,tallId:photo}]]){
   assert.equal((await f.client('/api/admin/settings',{brand:'Should not save',heroSelection:JSON.stringify(choices)},'PATCH')).status,422);
   assert.deepEqual(await(await f.client('/api/site')).json(),before);
  }
  assert.match(await(await fetch(f.base+'/')).text(),new RegExp('og:image[^>]+/media/'+photo));
  assert.equal((await f.client('/api/admin/settings',{heroSelection:'['},'PATCH')).status,422);
  assert.equal((await f.client('/api/admin/settings',{heroSelection:'[]'},'PATCH')).status,200);
 }finally{await f.close();}
});

test('Portrait upload requires owner, rejects bad images, serves only current portrait',async()=>{
 const f=await fixture();try{
  const bytes=await sharp({create:{width:60,height:90,channels:3,background:'#ccc'}}).jpeg().toBuffer();
  const body=()=>{const fd=new FormData();fd.append('portrait',new Blob([bytes],{type:'image/jpeg'}),'portrait.jpg');return fd;};
  assert.equal((await f.client('/api/admin/portrait',body(),'POST',false)).status,401);
  await f.setup();assert.equal((await f.client('/api/admin/portrait',body(),'POST')).status,201);
  const first=(await(await f.client('/api/site')).json()).portrait;assert.match(first,/^[a-f0-9]{32}$/);
  assert.equal((await fetch(f.base+'/portrait/'+first)).status,200);
  const invalid=new FormData();invalid.append('portrait',new Blob(['broken'],{type:'image/jpeg'}),'broken.jpg');
  assert.equal((await f.client('/api/admin/portrait',invalid,'POST')).status,422);
  assert.equal((await(await f.client('/api/site')).json()).portrait,first);
  assert.equal((await f.client('/api/admin/portrait',body(),'POST')).status,201);
  assert.equal((await fetch(f.base+'/portrait/'+first)).status,404);
  assert.equal((await f.client('/api/admin/settings',{portrait:'../../secret'},'PATCH')).status,422);
  assert.equal((await f.client('/api/admin/settings',{portrait:''},'PATCH')).status,200);
 }finally{await f.close();}
});

test('Consultation accepts phone or email and keeps budget private in studio records',async()=>{
 const f=await fixture();try{
  await f.setup();
  const request={name:'Khách thử',service:'Mình muốn được tư vấn thêm',message:'Tư vấn chụp ngày cưới',budget:'10–15 triệu VNĐ'};
  assert.equal((await f.client('/api/inquiries',{...request,phone:'0969 910 198'},'POST',false)).status,201);
  assert.equal((await f.client('/api/inquiries',{...request,email:'couple@example.com',budget:''},'POST',false)).status,201);
  assert.equal((await f.client('/api/inquiries',request,'POST',false)).status,422);
  assert.equal((await f.client('/api/inquiries',{...request,phone:'not-a-phone'},'POST',false)).status,422);
  assert.equal((await f.client('/api/inquiries',{...request,email:'couple@example.com',budget:'x'.repeat(101)},'POST',false)).status,422);
  const rows=await (await f.client('/api/admin/inquiries')).json();
  assert.equal(rows.length,2);assert.equal(rows.find(r=>r.phone).budget,request.budget);assert.equal(rows.find(r=>r.phone).email,'');
  const exported=await (await f.client('/api/admin/export')).json();assert.equal(exported.inquiries.find(r=>r.phone).budget,request.budget);
  assert.equal((await f.client('/api/admin/inquiries',null,'GET',false)).status,401);
  assert.doesNotMatch(JSON.stringify(await (await f.client('/api/availability')).json()),/triệu|0969|couple/);
  assert.equal((await f.client('/api/admin/settings',{facebook:'javascript:alert(1)'},'PATCH')).status,422);
  assert.equal((await f.client('/api/admin/settings',{facebook:'https://www.facebook.com/CC.PhotoLife'},'PATCH')).status,200);
 }finally{await f.close();}
});

test('Invalid consultation fields do not spend the valid-submission quota',async()=>{
 const f=await fixture();try{
  const data={name:'Khách thử',email:'review@example.com',phone:'123',service:'Tư vấn',message:'Tư vấn chụp ngày cưới'};
  for(let i=0;i<8;i++){const r=await f.client('/api/inquiries',data,'POST',false);assert.equal(r.status,422);assert.match((await r.json()).fields.phone,/bỏ trống/);}
  for(let i=0;i<5;i++)assert.equal((await f.client('/api/inquiries',{...data,phone:''},'POST',false)).status,201);
  assert.equal((await f.client('/api/inquiries',{...data,phone:''},'POST',false)).status,429);
  assert.equal((await f.db.all('SELECT * FROM inquiries')).length,5);
 }finally{await f.close();}
});
test('Consultation replay is durable, concurrent-safe and bound to the same content',async()=>{
 const f=await fixture();try{
  const data={name:'Khách thử',phone:'0900000000',service:'Tư vấn',date:'2099-10-10',message:'Tư vấn chụp ngày cưới',budget:'Chưa xác định',requestKey:'a'.repeat(32)};
  const responses=await Promise.all([f.client('/api/inquiries',data,'POST',false),f.client('/api/inquiries',data,'POST',false)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
  const results=await Promise.all(responses.map(r=>r.json()));assert.equal(results[0].reference,results[1].reference);
  const rows=await f.db.all('SELECT * FROM inquiries');assert.equal(rows.length,1);
  // A replay still succeeds when that date has since become unavailable.
  await f.db.run("INSERT INTO blocked_dates(date,note) VALUES(?,'test')",[data.date]);
  const second=await openDatabase(f.dir,{url:null});try{assert.equal((await second.get('SELECT request_key FROM inquiries WHERE id=?',[rows[0].id])).request_key,data.requestKey);}finally{await second.close();}
  assert.equal((await f.client('/api/inquiries',data,'POST',false)).status,200);
  assert.equal((await f.client('/api/inquiries',{...data,budget:'Khác'},'POST',false)).status,409);
  for(let i=0;i<4;i++)assert.equal((await f.client('/api/inquiries',{...data,date:'',requestKey:String(i).repeat(32)},'POST',false)).status,201);
  assert.equal((await f.client('/api/inquiries',{...data,date:'',requestKey:'f'.repeat(32)},'POST',false)).status,429);
  assert.equal((await f.client('/api/inquiries',data,'POST',false)).status,200);
  assert.equal((await f.db.all('SELECT * FROM inquiries')).length,5);
 }finally{await f.close();}
});
test('Calendar conflicts identify date and allow an undated consultation',async()=>{
 const f=await fixture();try{
  await f.db.run("INSERT INTO blocked_dates(date,note) VALUES('2099-10-10','Private')");
  const data={name:'Khách thử',phone:'0900000000',service:'Tư vấn',date:'2099-10-10',message:'Tư vấn chụp ngày cưới',requestKey:'b'.repeat(32)};
  const busy=await f.client('/api/inquiries',data,'POST',false);assert.equal(busy.status,409);assert.match((await busy.json()).fields.date,/kín lịch/);
  assert.equal((await f.client('/api/inquiries',{...data,date:''},'POST',false)).status,201);
 }finally{await f.close();}
});
test('Portfolio cards preserve curated images and counts without loading the entire album',async()=>{
 const f=await fixture();try{
  await f.setup();const a=await createAlbum(f,'published'),privateAlbum=await createAlbum(f,'private','private-pass');
  for(let i=0;i<6;i++)await upload(f,a);await upload(f,privateAlbum);
  const full=await (await f.client('/api/portfolio')).json();const photos=full[0].photos;
  const choice={albumId:a,wideId:photos[2].id,tallId:photos[3].id};
  assert.equal((await f.client('/api/admin/settings',{heroSelection:JSON.stringify([choice]),storySelection:JSON.stringify([{albumId:a,photoId:photos[4].id}])},'PATCH')).status,200);
  const cards=await (await f.client('/api/portfolio?view=cards')).json();assert.equal(cards.length,1);assert.equal(cards[0].photo_count,6);assert.ok(cards[0].photos.length<6);
  for(const p of [photos[2],photos[3],photos[4]])assert.ok(cards[0].photos.some(x=>x.id===p.id));
  assert.ok(cards[0].photos.every(p=>!('original' in p)&&!('selected' in p)));
  assert.equal((await (await f.client('/api/albums/'+a)).json()).photos.length,6);
 }finally{await f.close();}
});

test('Concurrent retries cannot exhaust unused consultation quota',async()=>{
 const f=await fixture();try{
  const data={name:'Retry test',email:'retry@example.com',service:'Tư vấn',message:'Please advise about wedding photography',requestKey:'c'.repeat(32)};
  const responses=await Promise.all(Array.from({length:10},()=>f.client('/api/inquiries',data,'POST',false)));
  assert.equal(responses.filter(r=>r.status===201).length,1);
  assert.ok(responses.every(r=>[200,201,429].includes(r.status)));
  assert.equal((await f.db.all('SELECT * FROM inquiries')).length,1);
  for(let i=0;i<4;i++)assert.equal((await f.client('/api/inquiries',{...data,requestKey:String(i).repeat(32)},'POST',false)).status,201);
  assert.equal((await f.client('/api/inquiries',{...data,requestKey:'d'.repeat(32)},'POST',false)).status,429);
 }finally{await f.close();}
});
test('Historical saved consultation replays while new past dates are rejected',async()=>{
 const f=await fixture();try{
  const request={name:'Historical retry',email:'retry@example.com',date:'2020-01-01',service:'Tư vấn',message:'Please advise about wedding photography',requestKey:'e'.repeat(32)};
  const {data}=validateInquiry(request),hash=createHash('sha256').update(JSON.stringify(data)).digest('hex');
  await f.db.run("INSERT INTO inquiries(id,name,email,phone,date,service,message,status,created,budget,request_key,request_hash) VALUES(?,?,?,?,?,?,?,'new',?,?,?,?)",['f'.repeat(32),data.name,data.email,data.phone,data.date,data.service,data.message,'2020-01-01',data.budget,request.requestKey,hash]);
  const replay=await f.client('/api/inquiries',request,'POST',false);assert.equal(replay.status,200);assert.equal((await replay.json()).reference,'ffffffff');
  const fresh=await f.client('/api/inquiries',{...request,requestKey:'a'.repeat(32)},'POST',false);assert.equal(fresh.status,422);assert.ok((await fresh.json()).fields.date);
 }finally{await f.close();}
});

test('Album SEO URLs preserve ID and slug history, privacy and concurrent uniqueness',async()=>{
 const f=await fixture();
 try{
  await f.setup();
  const payload={title:'Đám cưới Đà Lạt — Tuấn & Lan',category:'wedding',status:'published',description:'Câu chuyện ngày cưới tại Đà Lạt.'};
  const responses=await Promise.all(Array.from({length:3},()=>f.client('/api/admin/albums',payload,'POST')));
  for(const r of responses)assert.equal(r.status,201);
  const created=await Promise.all(responses.map(r=>r.json()));
  assert.deepEqual(created.map(a=>a.slug).sort(),['dam-cuoi-da-lat-tuan-lan','dam-cuoi-da-lat-tuan-lan-2','dam-cuoi-da-lat-tuan-lan-3']);
  const a=created.find(a=>a.slug==='dam-cuoi-da-lat-tuan-lan');
  const redirect=await fetch(f.base+'/album/'+a.id,{redirect:'manual'});
  assert.equal(redirect.status,301);assert.equal(redirect.headers.get('location'),'/album/'+a.slug);
  for(const key of [a.id,a.slug])assert.equal((await (await f.client('/api/albums/'+key,null,'GET',false)).json()).id,a.id);
  const html=await (await fetch(f.base+'/album/'+a.slug)).text();
  assert.match(html,new RegExp('<link rel="canonical" href="https://chicongphoto.vn/album/'+a.slug+'"'));
  assert.match(html,/Câu chuyện ngày cưới tại Đà Lạt\./);
  let update=await f.client('/api/admin/albums/'+a.id,{...payload,title:'New title'},'PATCH');
  assert.equal((await update.json()).slug,a.slug);
  update=await f.client('/api/admin/albums/'+a.id,{...payload,slug:'Ảnh cưới Đà Lạt'},'PATCH');
  assert.equal((await update.json()).slug,'anh-cuoi-da-lat');
  for(const key of [a.id,a.slug]){
   const r=await fetch(f.base+'/album/'+key,{redirect:'manual'});assert.equal(r.status,301);assert.equal(r.headers.get('location'),'/album/anh-cuoi-da-lat');
  }
  const reuse=await (await f.client('/api/admin/albums',{...payload,slug:a.slug},'POST')).json();assert.notEqual(reuse.slug,a.slug);
  const privateId=await createAlbum(f,'private','client-password');
  const privateAlbum=await f.db.get('SELECT * FROM albums WHERE id=?',[privateId]);
  for(const key of [privateId,privateAlbum.slug]){
   const r=await fetch(f.base+'/album/'+key,{redirect:'manual'});assert.equal(r.status,404);assert.equal(r.headers.get('location'),null);
   assert.equal((await f.client('/api/albums/'+key,null,'GET',false)).status,404);
  }
  assert.equal((await fetch(f.base+'/gallery/'+privateId,{redirect:'manual'})).status,200);
  assert.equal((await fetch(f.base+'/gallery/'+privateAlbum.slug)).status,404);
  assert.deepEqual(await (await f.client('/api/gallery/'+privateId,null,'GET',false)).json(),{locked:true});
  const sitemap=await (await fetch(f.base+'/sitemap.xml')).text();assert.match(sitemap,/\/album\/anh-cuoi-da-lat/);assert.doesNotMatch(sitemap,new RegExp(a.id+'|'+privateAlbum.slug+'|'+privateId));
  const cards=await (await f.client('/api/portfolio?view=cards',null,'GET',false)).json();assert.equal(cards.find(x=>x.id===a.id).slug,'anh-cuoi-da-lat');
  await f.client('/api/admin/albums/'+a.id,{...payload,status:'archived'},'PATCH');
  for(const key of [a.id,a.slug,'anh-cuoi-da-lat'])assert.equal((await fetch(f.base+'/album/'+key,{redirect:'manual'})).status,404);
 }finally{await f.close();}
});

test('Long duplicate slugs remain unchanged when saving album information',async()=>{
 const f=await fixture();try{
  await f.setup();const payload={title:'a'.repeat(120),category:'wedding',status:'published'};
  const first=await (await f.client('/api/admin/albums',payload,'POST')).json();
  const second=await (await f.client('/api/admin/albums',payload,'POST')).json();
  assert.ok(second.slug.length<=120,'Numeric suffix must fit inside the slug limit');
  await f.client('/api/admin/albums/'+first.id,{...payload,slug:'short-title'},'PATCH');
  const updated=await (await f.client('/api/admin/albums/'+second.id,{...payload,slug:second.slug},'PATCH')).json();
  assert.equal(updated.slug,second.slug);
 }finally{await f.close();}
});

test('Album URL migration and redirects normalize route casing without bypassing privacy',async()=>{
 const f=await fixture();try{
  await f.setup();const id=await createAlbum(f,'published');
  assert.equal((await fetch(f.base+'/GALLERY/'+id,{redirect:'manual'})).status,404);
  const privateId=await createAlbum(f,'private','test-password');
  assert.equal((await fetch(f.base+'/ALBUM/'+privateId,{redirect:'manual'})).status,404);
 }finally{await f.close();}
});

test('Multiple slug edits, reset, HEAD and encoded URLs resolve directly to one canonical URL',async()=>{
 const f=await fixture();try{
  await f.setup();const payload={title:'Đám cưới Đà Lạt',category:'wedding',status:'published'};
  const a=await (await f.client('/api/admin/albums',payload,'POST')).json();
  const old=[a.id,a.slug];
  for(const slug of ['Tuấn & Lan','Câu chuyện mới','']){
   const r=await f.client('/api/admin/albums/'+a.id,{...payload,title:'Tên cuối cùng',slug},'PATCH');assert.equal(r.status,200);
   const saved=await r.json();old.push(saved.slug);
  }
  const canonical='/album/ten-cuoi-cung';
  for(const key of old.slice(0,-1)){
   for(const method of ['GET','HEAD']){
    const r=await fetch(f.base+'/album/'+key+'?utm_source=test',{method,redirect:'manual'});
    assert.equal(r.status,301);assert.equal(r.headers.get('location'),canonical);
   }
   const api=await f.client('/api/albums/'+key,null,'GET',false);assert.equal(api.status,200);assert.equal((await api.json()).id,a.id);
  }
  for(const route of ['/album/ten-cuoi-cung/','/album/%74en-cuoi-cung','/ALBUM/ten-cuoi-cung']){
   const r=await fetch(f.base+route,{redirect:'manual'});assert.equal(r.status,301);assert.equal(r.headers.get('location'),canonical);
  }
  const final=await fetch(f.base+canonical,{redirect:'manual'});assert.equal(final.status,200);assert.equal(final.headers.get('location'),null);
  const html=await final.text();assert.match(html,/property="og:url" content="https:\/\/chicongphoto.vn\/album\/ten-cuoi-cung"/);
  const backup=await (await f.client('/api/admin/export')).json();
  for(const slug of old.slice(1))assert.ok(backup.album_slugs.some(row=>row.slug===slug&&row.album_id===a.id));
 }finally{await f.close();}
});

test('Reserved IDs, unsafe slug input and literal template tokens cannot corrupt URLs or metadata',async()=>{
 const f=await fixture();try{
  await f.setup();const payload={title:'Safe title',category:'wedding',status:'published'};
  for(const slug of ['a'.repeat(32),'../../Ánh cưới?x=<script>','💒']){
   const r=await f.client('/api/admin/albums',{...payload,slug},'POST');assert.equal(r.status,201);
   const a=await r.json();assert.match(a.slug,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);assert.doesNotMatch(a.slug,/^[a-f0-9]{32}$/);
   assert.equal((await fetch(f.base+'/album/'+a.slug)).status,200);
  }
  const a=await (await f.client('/api/admin/albums',{...payload,title:'$& __DESCRIPTION__ <script>',description:'$& __CANONICAL__ " onload="bad'},'POST')).json();
  const html=await (await fetch(f.base+'/album/'+a.slug)).text();
  assert.match(html,/<title>\$&amp; __DESCRIPTION__ &lt;script&gt;/);
  assert.match(html,/name="description" content="\$&amp; __CANONICAL__ &quot; onload=&quot;bad"/);
  assert.doesNotMatch(html,/<script>|content="[^"\n]*" onload=/);
 }finally{await f.close();}
});

test('Renaming a private gallery preserves its ID session, photos and selection access',async()=>{
 const f=await fixture();try{
  await f.setup();const id=await createAlbum(f,'private','client-pass');await upload(f,id);
  const adminCookie=f.cookie;const a=(await (await f.client('/api/admin/albums')).json()).find(a=>a.id===id);
  await f.client('/api/gallery/'+id+'/unlock',{password:'client-pass'},'POST',false);
  const response=await fetch(f.base+'/api/admin/albums/'+id,{method:'PATCH',headers:{Cookie:adminCookie,Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({...a,slug:'khach-rieng-moi'})});assert.equal(response.status,200);
  const gallery=await (await f.client('/api/gallery/'+id)).json();assert.equal(gallery.id,id);assert.equal(gallery.photos.length,1);
  assert.equal((await f.client(`/api/gallery/${id}/selection/${a.photos[0].id}`,{selected:true},'PUT')).status,200);
  for(const slug of [a.slug,'khach-rieng-moi']){
   const page=await fetch(f.base+'/album/'+slug,{redirect:'manual'});assert.equal(page.status,404);assert.match(await page.text(),/noindex,nofollow/);
   assert.equal((await fetch(f.base+'/api/gallery/'+slug)).status,404);
  }
  const page=await fetch(f.base+'/gallery/'+id);assert.match(page.headers.get('cache-control'),/private,no-store/);assert.match(await page.text(),/noindex,nofollow/);
 }finally{await f.close();}
});

test('Portfolio card query count stays constant as albums grow',async()=>{
 const f=await fixture();try{
  await f.setup();
  for(let i=0;i<8;i++){const a=await createAlbum(f,'published');await upload(f,a);}
  const original=f.db.all;let reads=0;f.db.all=async(...args)=>{reads++;return original(...args);};
  const response=await f.client('/api/portfolio?view=cards',null,'GET',false);const cards=await response.json();
  assert.equal(response.status,200);assert.equal(cards.length,8);assert.equal(reads,3);
  for(const a of cards){assert.equal(a.photo_count,1);assert.equal(a.photos.length,1);assert.ok(!('album_id' in a.photos[0]));}
 }finally{await f.close();}
});

test('Media validators skip storage reads without bypassing gallery permissions',async()=>{
 const f=await fixture();try{
  await f.setup();const a=await createAlbum(f,'published'),b=await createAlbum(f,'private','gallery-pass');await upload(f,a);await upload(f,b);
  const albums=await(await f.client('/api/admin/albums')).json();const photo=albums.find(x=>x.id===a).photos[0].id,privatePhoto=albums.find(x=>x.id===b).photos[0].id;
  const original=f.storage.get;let reads=0;f.storage.get=async(...args)=>{reads++;return original(...args);};
  const first=await fetch(f.base+'/media/'+photo);assert.equal(first.status,200);await first.arrayBuffer();assert.equal(reads,1);const etag=first.headers.get('etag');assert.ok(etag);
  const cached=await fetch(f.base+'/media/'+photo,{headers:{'If-None-Match':etag,'Cache-Control':'max-age=0'}});assert.equal(cached.status,304);assert.equal(reads,1);
  assert.equal((await fetch(f.base+'/media/'+photo,{method:'HEAD'})).status,200);assert.equal(reads,1);
  const thumb=await fetch(f.base+'/media/'+photo+'?size=thumb',{headers:{'If-None-Match':etag,'Cache-Control':'max-age=0'}});assert.equal(thumb.status,200);assert.notEqual(thumb.headers.get('etag'),etag);await thumb.arrayBuffer();assert.equal(reads,2);
  assert.equal((await f.client('/api/gallery/'+b+'/unlock',{password:'gallery-pass'},'POST',false)).status,200);
  const secret=await f.client('/media/'+privatePhoto);assert.equal(secret.status,200);assert.equal(secret.headers.get('cache-control'),'private,no-store');await secret.arrayBuffer();const before=reads;
  assert.equal((await fetch(f.base+'/media/'+privatePhoto,{headers:{'If-None-Match':secret.headers.get('etag')}})).status,404);assert.equal(reads,before);
  await f.db.run("UPDATE albums SET status='archived' WHERE id=?",[a]);assert.equal((await fetch(f.base+'/media/'+photo,{headers:{'If-None-Match':etag,'Cache-Control':'max-age=0'}})).status,404);assert.equal(reads,before);
 }finally{await f.close();}
});

test('Public HTML hides fallback behind a loading screen until startup completes',async()=>{
 const f=await fixture();try{
  for(const route of ['/','/portfolio','/about','/contact']){
   const html=await (await fetch(f.base+route)).text();
   assert.match(html,/<div id="root" hidden>/);
   assert.match(html,/id="startup-status"/);
   assert.match(html,/<script defer src="\/app\/bootstrap.js"><\/script>/);
   assert.doesNotMatch(html,/<script type="module" src="\/app\/main.js"/);
  }
  const entry=await fetch(f.base+'/app/bootstrap.js');assert.equal(entry.status,200);
  assert.match(entry.headers.get('content-type'),/javascript/);
  assert.match(await entry.text(),/import\('\.\/main.js'\)/);
 }finally{await f.close();}
});
