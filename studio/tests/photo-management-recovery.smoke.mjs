import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';
const pw=await import(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright'),engine=process.env.STUDIO_BROWSER||'chromium';
const dir=await mkdtemp(path.join(tmpdir(),'photo-recovery-')),f=await createApp({dataDir:dir,env:{},seed:false});
const server=f.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
let browser,release;
try{
 browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
 const ctx=await browser.newContext(),page=await ctx.newPage(),client=await(await browser.newContext()).newPage(),errors=[];
 for(const p of [page,client]){p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));await p.clock.install();}
 const req=(url,data,method='post')=>ctx.request[method](base+url,{headers:{Origin:base},data});
 assert.equal((await req('/api/admin/setup',{email:'recovery@test.local',password:'recovery-browser-test'})).status(),201);
 const metadata={title:'Bộ ảnh phục hồi',status:'private',require_password:false,category:'wedding',event_date:'2026-10-12'};
 const a=await(await req('/api/admin/albums',metadata)).json(),bytes=await sharp({create:{width:100,height:120,channels:3,background:'#788c77'}}).jpeg().toBuffer(),ids=[];
 for(let i=1;i<=3;i++){const response=await ctx.request.post(base+`/api/admin/albums/${a.id}/photos`,{headers:{Origin:base},multipart:{photos:{name:`image-${i}.jpg`,mimeType:'image/jpeg',buffer:bytes}}});assert.equal(response.status(),201);ids.push((await response.json()).results[0].id);}
 await page.goto(base+'/admin#album/'+a.id);await page.locator('.manage-photo').first().waitFor();
 await client.goto(base+'/gallery/'+a.id);await client.locator('.album-line').filter({hasText:'12/10/2026'}).waitFor();
 let fullFetches=0;client.on('request',r=>{if(new URL(r.url()).pathname===`/api/gallery/${a.id}`)fullFetches++;});
 assert.equal((await req('/api/admin/albums/'+a.id,{...metadata,event_date:'2026-10-16'},'patch')).status(),200);
 await client.clock.fastForward(25000);await client.locator('.album-line').filter({hasText:'16/10/2026'}).waitFor();assert.equal(fullFetches,1);
 for(let i=0;i<2;i++){const synced=client.waitForResponse(r=>r.url().endsWith('/selection'));await client.clock.fastForward(25000);await synced;await client.waitForLoadState('networkidle');}
 assert.equal(fullFetches,1,'stable metadata does not repeatedly reload the full catalog');
 console.log('PASS: Date-only changes sync to the client and stop requesting the unchanged full gallery');
 const openDelete=async id=>{const card=page.locator(`[data-admin-photo="${id}"]`);await card.locator('.photo-menu summary').click();await card.locator('[data-action=remove-photo]').click();await page.locator('#editor[open]').waitFor();};
 let started;const entered=new Promise(r=>started=r),gate=new Promise(r=>release=r),deleteUrl='**/api/admin/photos/'+ids[0];
 await openDelete(ids[0]);await page.route(deleteUrl,async route=>{started();await gate;await route.continue();});
 await page.locator('[data-action=confirm-remove-photo]').click();await entered;
 assert.equal(await page.locator('#editor [data-action=close-editor]').first().isDisabled(),true);assert.equal(await page.locator('[data-action=confirm-remove-photo]').isDisabled(),true);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#editor').evaluate(d=>d.open),true,'an active deletion cannot close another editor');
 release();await page.locator('#editor').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelectorAll('.manage-photo').length===2);await page.unroute(deleteUrl);
 console.log('PASS: Single delete blocks duplicate submission, cancel and Escape while the request is pending');
 const failedUrl='**/api/admin/photos/'+ids[1];await openDelete(ids[1]);await page.route(failedUrl,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Chưa xóa được ảnh. Hãy thử lại.'})}));
 await page.locator('[data-action=confirm-remove-photo]').click();await page.locator('[data-photo-delete-error]').filter({hasText:'Chưa xóa được'}).waitFor();assert.equal(await page.locator('[data-action=confirm-remove-photo]').isDisabled(),false);assert.equal((await f.db.all('SELECT id FROM photos')).length,2);
 await page.unroute(failedUrl);await page.locator('#editor .small-btn').click();
 await page.locator('[data-action=admin-arrange]').click();await page.locator('[data-select-visible]').check();await page.locator('[data-action=bulk-delete]').click();await page.locator('#editor[open]').waitFor();
 const albumUrl='**/api/admin/albums/'+a.id;await page.route(albumUrl,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Mất kết nối khi cập nhật bộ ảnh.'})}));
 await page.locator('[data-action=confirm-bulk-delete]').click();await page.locator('#editor').waitFor({state:'hidden'});await page.locator('[data-admin-empty]').waitFor();
 await page.locator('[data-admin-sync]').filter({hasText:'Đã xóa ảnh. Chưa cập nhật được'}).waitFor();assert.equal(await page.locator('.manage-photo').count(),0);assert.equal((await f.db.all('SELECT id FROM photos')).length,0);
 await page.unroute(albumUrl);await page.locator('[data-action=admin-sync]').click();await page.locator('[data-admin-sync]').filter({hasText:'Đã cập nhật lúc'}).waitFor();assert.equal(await page.locator('.manage-photo').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS: Failed deletion stays retryable; successful deletion survives refresh failure and visible retry recovers. '+engine);
}finally{release?.();await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await f.photoCleanup.close();await f.db.close();await rm(dir,{recursive:true,force:true});}
