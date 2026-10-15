// Real HTTP/database/browser regression. All data is disposable; never loads .env.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';
import {hashPassword} from '../server/db.mjs';
const pw=await import(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright');
const dir=await mkdtemp(path.join(tmpdir(),'gallery-sync-browser-'));
const f=await createApp({dataDir:dir,env:{}}),aid='a'.repeat(32),ids=['b'.repeat(32),'c'.repeat(32)];
let uploadFault;const keys=[];
// Hold the real server response after saving. WebKit route.fetch cannot replay
// multipart file bodies reliably, so upload faults must live at the HTTP server.
const server=createServer((req,res)=>{
 if(req.method==='POST'&&req.url.endsWith('/photos')){
  keys.push(req.headers['x-upload-keys']);
  if(uploadFault){const fault=uploadFault;uploadFault=null;const end=res.end.bind(res);res.end=(...args)=>{fault.status=res.statusCode;fault.stored();fault.gate.then(()=>{if(!res.destroyed)end(...args);});return res;};}
 }
 f.app(req,res);
}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port,errors=[];
const engine=process.env.STUDIO_BROWSER||'chromium';let browser,releaseUpload;
const evidence=path.resolve(process.env.STUDIO_BROWSER_EVIDENCE_DIR||'output/gallery-sync-review');
try{
 await mkdir(evidence,{recursive:true});
 await f.db.run('INSERT INTO albums(id,title,category,status,password) VALUES(?,?,?,?,?)',[aid,'Kiểm tra đồng bộ gallery','wedding','private',hashPassword('gallery-password')]);
 const full=await sharp({create:{width:1200,height:1800,channels:3,background:'#678'}}).webp().toBuffer();
 const thumb=await sharp(full).resize({height:900}).webp().toBuffer();
 for(const [i,id] of ids.entries()){
  await f.db.run('INSERT INTO photos(id,album_id,filename,original,width,height,position) VALUES(?,?,?,?,?,?,?)',[id,aid,id,'photo-'+i+'.jpg',1200,1800,i]);
  await f.storage.put(id+'.webp',full);await f.storage.put(id+'-thumb.webp',thumb);
 }
 browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
 const unlock=ctx=>ctx.request.post(base+'/api/gallery/'+aid+'/unlock',{headers:{Origin:base},data:{password:'gallery-password'}});
 const client=async options=>{const ctx=await browser.newContext(options);await unlock(ctx);const page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/gallery/'+aid);await page.locator('.client-toolbar').waitFor();return {ctx,page};};
 const a=await client({viewport:{width:1280,height:800}}),b=await client({viewport:{width:1280,height:800}}),page=a.page;
 const put=(id,selected)=>b.ctx.request.put(base+'/api/gallery/'+aid+'/selection/'+id,{headers:{Origin:base},data:{selected}});
 const count=(page,n)=>page.waitForFunction(n=>document.querySelector('.client-toolbar strong')?.textContent===`${n} ảnh đã chọn`,n);
 const sync=page=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.locator('.pick').first().click();await count(page,1);
 await sync(b.page);await count(b.page,1);
 await b.page.locator('.pick').nth(1).click();await count(b.page,2);
 await sync(page);await count(page,2);
 console.log('PASS: Two independent clients reconcile the shared selection without reloading images');

 await page.locator('[data-action=submit-picks]').click();await page.locator('#editor[open]').waitFor();
 assert.match(await page.locator('.submit-confirm-content').textContent(),/2 ảnh đã chọn/);
 await b.page.locator('.pick').first().click();await count(b.page,1);
 await page.locator('[data-action=confirm-submit-picks]').click();
 await page.locator('#editor').waitFor({state:'hidden'});await count(page,1);
 await page.locator('#toast').filter({hasText:'đã thay đổi ở một phiên khác'}).waitFor();
 assert.equal((await f.db.get('SELECT selection_status FROM albums WHERE id=?',[aid])).selection_status,'draft');
 await page.locator('[data-action=submit-picks]').click();await page.locator('[data-action=confirm-submit-picks]').click();await page.locator('.success-note').waitFor();
 console.log('PASS: Stale confirmation is rejected; the customer reviews the actual list before submitting');

 await put(ids[0],true);await sync(page);await count(page,2);
 await page.locator('[data-action=selected-only]').click();
 await put(ids[0],false);await put(ids[1],false);await sync(page);await count(page,0);
 assert.equal(await page.locator('.photo-item').count(),0);
 await page.locator('[data-action=selected-only]').click();
 console.log('PASS: Removing several selections remotely leaves the selected-only view usable');

 await put(ids[0],false);await put(ids[1],false);await page.reload();await count(page,0);
 await page.route('**/selection/*',async route=>{await route.fetch();await route.abort('failed');});
 await page.locator('.pick').first().click();await count(page,1);
 assert.equal(await page.locator('.pick').first().getAttribute('aria-pressed'),'true');
 await page.locator('#toast').filter({hasText:'Đã đối chiếu'}).waitFor();
 assert.equal((await f.db.all('SELECT * FROM selections WHERE album_id=?',[aid])).length,1);
 console.log('PASS: A lost acknowledgement after a real save reconciles the UI with the database');

 await page.route('**/api/gallery/'+aid,route=>route.abort('failed'));
 await page.locator('.pick').nth(1).click();
 await page.locator('[data-action=retry-selection]').waitFor({state:'visible'});
 assert.equal(await page.locator('[data-action=submit-picks]').isDisabled(),true);
 assert.match(await page.locator('.client-save-status').textContent(),/Chưa xác nhận/);
 await page.unroute('**/selection/*');await page.unroute('**/api/gallery/'+aid);
 await page.locator('[data-action=retry-selection]').click();await count(page,2);
 assert.equal(await page.locator('[data-action=submit-picks]').isEnabled(),true);
 console.log('PASS: Offline ambiguity is visible and blocks stale submission; retry restores the confirmed state');

 await page.locator('[data-action=submit-picks]').click();await page.locator('#editor[open]').waitFor();
 await a.ctx.clearCookies();await page.locator('[data-action=confirm-submit-picks]').click();
 await page.getByLabel('Mật khẩu bộ ảnh').fill('gallery-password');
 assert.equal(await page.locator('#editor').evaluate(e=>e.open),false);
 await page.getByRole('button',{name:'Mở bộ ảnh',exact:true}).click();await count(page,2);
 console.log('PASS: Expired confirmation closes the modal and permits unlocking immediately');

 await page.locator('.photo-open').first().click();await page.waitForFunction(()=>document.querySelector('#lightbox img').naturalWidth>0);
 await page.locator('#lightbox-zoom').click();
 await page.waitForFunction(()=>{const img=document.querySelector('#lightbox img');return img.complete&&img.naturalWidth>0&&!img.currentSrc.includes('size=thumb');});
 await page.screenshot({path:path.join(evidence,engine+'-zoom.png')});
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 console.log('PASS: Zoom upgrades the displayed portrait to the full rendition');

 const mobile=await client({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});
 await mobile.page.locator('.photo-open').first().tap();await mobile.page.waitForFunction(()=>document.querySelector('#lightbox img').naturalWidth>0);
 const box=await mobile.page.locator('#lightbox img').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
 const doubleTap=async()=>{await mobile.page.touchscreen.tap(x,y);await mobile.page.waitForTimeout(80);await mobile.page.touchscreen.tap(x,y);};
 await doubleTap();assert.equal(await mobile.page.locator('#lightbox.is-zoomed').count(),1);
 await mobile.page.waitForTimeout(350);await doubleTap();assert.equal(await mobile.page.locator('#lightbox.is-zoomed').count(),0);
 console.log('PASS: Real touch double-tap zooms in and out without a duplicate synthetic click');

 const setup=await a.ctx.request.post(base+'/api/admin/setup',{headers:{Origin:base},data:{email:'admin@test.local',password:'admin-password-123'}});assert.equal(setup.status(),201);
 await page.goto(base+'/admin#album/'+aid);await page.locator('[data-form=upload]').waitFor();
 let uploaded;const stored=new Promise(r=>uploaded=r),gate=new Promise(r=>releaseUpload=r);
 const fault={stored:uploaded,gate};uploadFault=fault;
 const jpeg=await sharp(full).jpeg().toBuffer();
 await page.locator('[data-form=upload] input[type=file]').setInputFiles({name:'saved-before-cancel.jpg',mimeType:'image/jpeg',buffer:jpeg});
 await page.getByRole('button',{name:'Tải ảnh lên',exact:true}).click();await stored;
 assert.equal(fault.status,201);
 assert.equal(Number((await f.db.get('SELECT COUNT(*) AS count FROM photos WHERE album_id=?',[aid])).count),3);
 await page.locator('.upload-cancel').click();releaseUpload();
 await page.getByRole('button',{name:'Tải lại các ảnh còn lại',exact:true}).waitFor();
 assert.match(await page.locator('.upload-panel').textContent(),/Ảnh có thể đã được lưu/);
 await page.getByRole('button',{name:'Tải lại các ảnh còn lại',exact:true}).click();
 await page.getByRole('button',{name:'Tải ảnh lên',exact:true}).waitFor();
 assert.equal(Number((await f.db.get('SELECT COUNT(*) AS count FROM photos WHERE album_id=?',[aid])).count),3);
 assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
 await sync(b.page);await b.page.locator('.photo-open').nth(2).waitFor();
 console.log('PASS: Cancelling after durable upload and retrying reuses the key, saves no duplicate, and updates the viewer catalog');
 assert.deepEqual(errors,[]);
 console.log('PASS: '+engine+' gallery synchronization regression completed');
}finally{releaseUpload?.();await browser?.close();await new Promise(r=>server.close(r));await f.db.close();await rm(dir,{recursive:true,force:true});}
