import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {request as httpRequest} from 'node:http';
import {createApp} from '../server/app.mjs';

function getWithHost(url,host){
 const target=new URL(url);
 return new Promise((resolve,reject)=>{
  const request=httpRequest({hostname:target.hostname,port:target.port,path:target.pathname,headers:{host}},response=>{
   let body='';response.setEncoding('utf8');response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body}));
  });
  request.on('error',reject);request.end();
 });
}

async function fixture(options={}){
 const dir=await mkdtemp(path.join(tmpdir(),'chicong-freelancer-'));
 const env={NODE_ENV:'test',SITE_URL:'http://freelancer.chicongphoto.vn',FREELANCER_HOST:'freelancer.chicongphoto.vn',FREELANCER_PRICE_CODE:'partner-code',FREELANCER_PRICE_SECRET:'fixture-secret'};
 const service=await createApp({dataDir:dir,env,...options});
 const server=service.app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 return {dir,env,service,server,base,close:async()=>{await new Promise(resolve=>server.close(resolve));await service.photoCleanup.close();await service.mediaControl.close();service.storage.close?.();await service.db.close();await rm(dir,{recursive:true,force:true});}};
}

test('freelancer profile is host/path scoped and excludes search indexing',async()=>{
 const f=await fixture();try{
  const page=await fetch(f.base+'/freelancer');
  assert.equal(page.status,200);
  const html=await page.text();
  assert.match(html,/Chụp truyền thống/);assert.match(html,/Máy chính/);assert.match(html,/02<\/strong> vị trí nhận chụp/);assert.match(html,/01<\/strong> job mỗi ngày/);assert.match(html,/Phản hồi trong ngày/);assert.match(html,/freelancer-nav-cta/);assert.match(html,/BẢNG GIÁ ĐỐI TÁC/);assert.doesNotMatch(html,/ĐANG HOÀN THIỆN/);assert.match(html,/Chưa có lịch xác nhận/);assert.match(html,/Lịch cập nhật:/);assert.match(html,/data-calendar-selection/);for(const id of ['profile','work','gear','price','process','contact'])assert.match(html,new RegExp(`data-freelancer-nav="${id}"`));assert.match(html,/id="process"/);assert.match(html,/freelancer-sticky-cta/);assert.match(html,/noindex,nofollow/);
  assert.equal(page.headers.get('x-robots-tag'),'noindex, nofollow');
  const hostPage=await getWithHost(f.base,'freelancer.chicongphoto.vn');
  assert.equal(hostPage.status,200);assert.match(hostPage.body,/HỒ SƠ DÀNH CHO ĐỐI TÁC/);
  const hostRobots=await getWithHost(f.base+'/robots.txt','freelancer.chicongphoto.vn');
  assert.equal(hostRobots.status,200);assert.equal(hostRobots.body,'User-agent: *\nDisallow: /');
  const hostSitemap=await getWithHost(f.base+'/sitemap.xml','freelancer.chicongphoto.vn');
  assert.equal(hostSitemap.status,200);assert.equal(hostSitemap.body,'');
  const main=await fetch(f.base+'/');assert.equal(main.status,200);assert.doesNotMatch(await main.text(),/HỒ SƠ DÀNH CHO ĐỐI TÁC/);
  const calendar=await fetch(f.base+'/api/freelancer/availability');assert.equal(calendar.status,200);assert.deepEqual(Object.keys(await calendar.json()).sort(),['blocked','today']);
 }finally{await f.close();}
});

test('partner price remains locked until the server checks the shared code',async()=>{
 const f=await fixture();try{
  await f.service.db.run("INSERT INTO settings(key,value) VALUES('freelancerPricing',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[JSON.stringify([{title:'Bí mật',scope:'Không công khai',price:'PRICE_SECRET_999',delivery:'Nội dung riêng'}])]);
  const locked=await fetch(f.base+'/freelancer');const lockedHtml=await locked.text();assert.doesNotMatch(lockedHtml,/Đã mở/);assert.doesNotMatch(lockedHtml,/PRICE_SECRET_999/);assert.doesNotMatch(lockedHtml,/Nội dung riêng/);
  const invalid=await fetch(f.base+'/freelancer/access',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'code=wrong',redirect:'manual'});
  assert.equal(invalid.status,303);assert.match(invalid.headers.get('location'),/price=invalid/);
  const valid=await fetch(f.base+'/freelancer/access',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'code=partner-code',redirect:'manual'});
  assert.equal(valid.status,303);const cookie=valid.headers.get('set-cookie');assert.match(cookie,/freelancer_price=/);
  const unlocked=await fetch(f.base+'/freelancer',{headers:{cookie:cookie.split(';')[0]}});const unlockedHtml=await unlocked.text();assert.match(unlockedHtml,/Đã mở/);assert.match(unlockedHtml,/PRICE_SECRET_999/);assert.match(unlockedHtml,/Nội dung riêng/);
 }finally{await f.close();}
});

test('freelancer profile skeleton renders configurable copy and roles',async()=>{
 const f=await fixture();try{
  const roles=[{title:'Chụp event',description:'Ghi lại diễn biến chương trình và phối hợp theo timeline của studio.',tags:['Máy chính','Máy phụ']}];
  const values={
   freelancerHeadline:'Ảnh event.\nẢnh cưới.',
   freelancerLead:'Mô tả mở đầu riêng cho đối tác.',
   freelancerAbout:'Giới thiệu riêng khi studio book Công.',
   freelancerWorkIntro:'Mô tả các bộ ảnh đã chọn.',
   freelancerGearIntro:'Mô tả thiết bị theo từng job.',
   freelancerProcessIntro:'Mô tả quy trình phối hợp.',
   freelancerCalendarIntro:'Mô tả lịch bận và ngày chưa kiểm tra.',
   freelancerBookingIntro:'Mô tả cách gửi yêu cầu booking.',
   freelancerRoles:JSON.stringify(roles)
  };
  for(const [key,value] of Object.entries(values))await f.service.db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[key,value]);
  const page=await fetch(f.base+'/freelancer');const html=await page.text();
  assert.equal(page.status,200);assert.match(html,/Ảnh event\.<br><em>Ảnh cưới\.<\/em>/);for(const value of Object.values(values).slice(1,8))assert.match(html,new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.match(html,/Chụp event/);assert.doesNotMatch(html,/Chụp truyền thống/);
 }finally{await f.close();}
});

test('freelancer portfolio is explicitly curated and has private detail pages',async()=>{
 const f=await fixture();try{
  const selected='a'.repeat(32),hidden='b'.repeat(32);
  await f.service.db.run('INSERT INTO albums(id,slug,title,category,status,description,created) VALUES(?,?,?,?,?,?,?)',[selected,'selected-job','Selected job','wedding','published','Bộ được chọn cho đối tác','2026-01-01']);
  await f.service.db.run('INSERT INTO albums(id,slug,title,category,status,description,created) VALUES(?,?,?,?,?,?,?)',[hidden,'hidden-job','Hidden job','wedding','published','Không hiển thị','2026-01-02']);
  await f.service.db.run('INSERT INTO photos(id,album_id,filename,original,width,height,position) VALUES(?,?,?,?,?,?,?)',['c'.repeat(32),selected,'selected.webp','selected.jpg',1200,800,0]);
  await f.service.db.run('INSERT INTO photos(id,album_id,filename,original,width,height,position) VALUES(?,?,?,?,?,?,?)',['d'.repeat(32),hidden,'hidden.webp','hidden.jpg',1200,800,0]);
  await f.service.db.run("INSERT INTO settings(key,value) VALUES('freelancerSelection',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[JSON.stringify([selected])]);
  const page=await fetch(f.base+'/freelancer');const html=await page.text();
  assert.equal(page.status,200);assert.match(html,/Selected job/);assert.doesNotMatch(html,/Hidden job/);assert.match(html,/\/freelancer\/album\/selected-job/);
  const detail=await fetch(f.base+'/freelancer/album/selected-job');const detailHtml=await detail.text();assert.equal(detail.status,200);assert.match(detailHtml,/Selected job/);assert.match(detailHtml,/\/media\//);
 }finally{await f.close();}
});

test('freelancer availability combines confirmed studio days with Google Calendar',async()=>{
 const f=await fixture({googleCalendar:{read:async()=>({configured:true,blocked:['2030-01-01'],unavailable:false,through:'2032-01-01'})}});try{
  const calendar=await fetch(f.base+'/api/freelancer/availability');const data=await calendar.json();
  assert.equal(calendar.status,200);assert.ok(data.blocked.includes('2030-01-01'));assert.equal(data.unavailable,false);assert.equal(data.through,'2032-01-01');
 }finally{await f.close();}
});

test('production profile is served only on the configured freelancer host',async()=>{
 const f=await fixture();
 const production=await createApp({dataDir:f.dir,env:{...f.env,NODE_ENV:'production',SITE_URL:'https://chicongphoto.vn',DATABASE_URL:'postgresql://test-placeholder'},production:true,db:f.service.db,storage:f.service.storage});
 const server=production.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const mainPath=await getWithHost(base+'/freelancer','chicongphoto.vn');
  assert.equal(mainPath.status,404);assert.doesNotMatch(mainPath.body,/HỒ SƠ DÀNH CHO ĐỐI TÁC/);
  const freelancerRoot=await getWithHost(base+'/','freelancer.chicongphoto.vn');
  assert.equal(freelancerRoot.status,200);assert.match(freelancerRoot.body,/HỒ SƠ DÀNH CHO ĐỐI TÁC/);assert.equal(freelancerRoot.headers['x-robots-tag'],'noindex, nofollow');
 }finally{
  await new Promise(resolve=>server.close(resolve));await production.photoCleanup.close();await production.mediaControl.close();await f.close();
 }
});
