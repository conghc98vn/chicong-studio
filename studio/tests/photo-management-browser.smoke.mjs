import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createServer} from 'node:http';
import {createApp} from '../server/app.mjs';
const pw=await import(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright'),engine=process.env.STUDIO_BROWSER||'chromium';
const dir=await mkdtemp(path.join(tmpdir(),'photo-management-browser-')),f=await createApp({dataDir:dir,env:{},seed:false});
let uploadFault=null;
const server=createServer((req,res)=>{
 if(uploadFault&&req.method==='POST'&&req.url.endsWith('/photos')){const fault=uploadFault;uploadFault=null;res.end=()=>{fault.status=res.statusCode;fault.policy=req.headers['x-duplicate-policy'];res.flushHeaders();res.write(' ');setTimeout(()=>res.destroy(),10);return res;};}
 f.app(req,res);
}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const evidence=process.env.STUDIO_BROWSER_EVIDENCE_DIR||'output/photo-management/'+engine;await mkdir(evidence,{recursive:true});let browser;
try{
 browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),page=await ctx.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const req=(url,data,method='post')=>ctx.request[method](base+url,{headers:{Origin:base},data});
 await req('/api/admin/setup',{email:'browser@test.local',password:'management-browser-test'});
 const a=await(await req('/api/admin/albums',{title:'N & V | Ceremony',status:'private',require_password:false,category:'wedding'})).json();
 const old=await sharp({create:{width:900,height:600,channels:3,background:'#b9a58d'}}).jpeg().toBuffer(),updated=await sharp({create:{width:600,height:900,channels:3,background:'#678277'}}).jpeg().toBuffer();
 const photos=[];for(const name of ['CC-001.jpg','CC-002.jpg','CC-003.jpg']){const r=await ctx.request.post(base+'/api/admin/albums/'+a.id+'/photos',{headers:{Origin:base},multipart:{photos:{name,mimeType:'image/jpeg',buffer:old}}});assert.equal(r.status(),201);photos.push((await r.json()).results[0].id);}
 await req(`/api/gallery/${a.id}/selection/${photos[0]}`,{selected:true},'put');
 await page.clock.install();await page.goto(base+'/admin#album/'+a.id);await page.locator('.manage-photo').first().waitFor();
 const clientContext=await browser.newContext(),client=await clientContext.newPage();client.on('pageerror',e=>errors.push(e.message));await client.clock.install();await client.goto(base+'/gallery/'+a.id);await client.locator(`[data-action=open-photo][data-photo="${photos[0]}"]`).click();await client.waitForFunction(()=>document.querySelector('#lightbox img').naturalWidth>0);const oldSrc=await client.locator('#lightbox img').getAttribute('src');
 await page.locator('[data-album-tool=upload] > summary').click();
 const form=page.locator('[data-form=upload]'),input=form.locator('input[type=file]');
 assert.equal(await form.locator('[value=skip]').isChecked(),true);
 await input.setInputFiles({name:'CC-001.jpg',mimeType:'image/jpeg',buffer:updated});await form.getByRole('button',{name:'Tải ảnh lên',exact:true}).click();await page.locator('.upload-summary').filter({hasText:'1 bỏ qua'}).waitFor();
 assert.equal((await f.db.all('SELECT id FROM photos WHERE album_id=?',[a.id])).length,3);assert.equal((await f.db.get('SELECT width FROM photos WHERE id=?',[photos[0]])).width,900);
 console.log('PASS: Duplicate policy defaults to skip and reports skipped files without adding photos');
 // Simulate a lost acknowledgement after replacement commits; retry must not replace it again.
 const fault={};uploadFault=fault;
 await input.setInputFiles({name:'CC-001.jpg',mimeType:'image/jpeg',buffer:updated});await form.locator('[value=overwrite]').check();await form.getByRole('button',{name:'Tải ảnh lên',exact:true}).click();await form.locator('.form-error').filter({hasText:'Đã lưu 0/1'}).waitFor();
 const replaced=await f.db.get('SELECT filename,width FROM photos WHERE id=?',[photos[0]]);assert.equal(replaced.width,600);assert.equal(await form.locator('[value=overwrite]').isDisabled(),true);
 await form.getByRole('button',{name:'Tải lại các ảnh còn lại',exact:true}).click();await page.locator('.upload-summary').filter({hasText:'1 ghi đè'}).waitFor();
 assert.equal((await f.db.get('SELECT filename FROM photos WHERE id=?',[photos[0]])).filename,replaced.filename);assert.ok(await f.db.get('SELECT photo_id FROM selections WHERE photo_id=?',[photos[0]]));assert.equal(fault.status,201);assert.equal(fault.policy,'overwrite');
 await client.clock.fastForward(25000);await client.waitForFunction(src=>document.querySelector('#lightbox img').getAttribute('src')!==src,oldSrc);await client.waitForFunction(()=>document.querySelector('#lightbox img').naturalHeight===900);assert.equal(await client.locator('#lightbox').evaluate(e=>e.open),true);
 console.log('PASS: Overwrite keeps customer picks, survives a lost response and refreshes the open client lightbox');
 await page.locator('[data-action=admin-arrange]').click();
 assert.equal(await page.locator('[data-section-photo]').count(),3);assert.equal(await page.locator('[data-bulk-section]').count(),0); // Works without sections.
 await page.locator('[data-section-photo]').first().check();await page.locator('[data-admin-photo-search]').fill('CC-002');assert.equal(await page.locator('[data-section-photo]:checked').count(),0);
 await page.locator('[data-select-visible]').check();await page.locator('[data-action=bulk-delete]').click();await page.locator('#editor[open]').waitFor();assert.match(await page.locator('#editor').innerText(),/Xóa 1 ảnh/);assert.equal(await page.locator('#editor .delete-pick-warning').count(),0);
 await page.locator('#editor .small-btn').click();assert.equal((await f.db.all('SELECT id FROM photos WHERE album_id=?',[a.id])).length,3);
 await page.locator('[data-admin-photo-search]').fill('');await page.locator('[data-select-visible]').check();
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:1000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow at '+width);
  await page.locator('[data-action=bulk-delete]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,`batch-${width}.png`),fullPage:true});
 }
 await page.locator('[data-action=bulk-delete]').click();await page.locator('#editor .delete-pick-warning').filter({hasText:'1 ảnh đã được khách chọn'}).waitFor();
 await page.route('**/photos/delete',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Kho dữ liệu tạm bận. Hãy thử lại.'})}));
 await page.locator('[data-action=confirm-bulk-delete]').click();await page.locator('[data-bulk-delete-error]').filter({hasText:'tạm bận'}).waitFor();assert.equal((await f.db.all('SELECT id FROM photos WHERE album_id=?',[a.id])).length,3);assert.equal(await page.locator('[data-action=confirm-bulk-delete]').isDisabled(),false);
 await page.unroute('**/photos/delete');await page.locator('[data-action=confirm-bulk-delete]').click();await page.locator('#editor').waitFor({state:'hidden'});await page.locator('[data-admin-empty]').waitFor();
 assert.equal((await f.db.all('SELECT id FROM photos WHERE album_id=?',[a.id])).length,0);assert.equal((await f.db.all('SELECT * FROM selections')).length,0);assert.equal((await f.db.get('SELECT cover_id FROM albums WHERE id=?',[a.id])).cover_id,null);
 await client.clock.fastForward(25000);await client.waitForFunction(()=>!document.querySelector('#lightbox').open);
 assert.deepEqual(errors,[]);console.log('PASS: Filtered batch selection, cancel, picked-photo warning, failure/retry, empty album and responsive layout. '+engine);
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await f.photoCleanup.close();await f.db.close();await rm(dir,{recursive:true,force:true});}
