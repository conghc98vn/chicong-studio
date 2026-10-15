import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';
const pw=await import(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright');
const engine=process.env.STUDIO_BROWSER||'chromium';
const dir=await mkdtemp(path.join(tmpdir(),'admin-proofing-audit-'));
const f=await createApp({dataDir:dir,env:{},seed:false});
const server=f.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port,aid='a'.repeat(32),id=n=>n.toString(16).padStart(32,'0'),out=process.env.STUDIO_BROWSER_EVIDENCE_DIR||'output/proofing-concurrency-fixes';let browser;
try{
 await mkdir(out,{recursive:true});
 await f.db.run('INSERT INTO albums(id,title,category,status,client_name) VALUES(?,?,?,?,?)',[aid,'N & V | Ceremony','wedding','private','Như & Vũ']);
 const sections=['Chi tiết trang trí','Nhà gái chuẩn bị','Nhà trai chuẩn bị','Đón dâu & trao quà','Nghi thức gia tiên','Ảnh nhóm & bạn bè'];
 for(const [i,title] of sections.entries())await f.db.run('INSERT INTO album_sections(id,album_id,title,position) VALUES(?,?,?,?)',[id(100+i),aid,title,i]);
 const image=await sharp({create:{width:900,height:600,channels:3,background:'#b6bca6'}}).webp().toBuffer();
 await f.storage.put(id(999)+'.webp',image);await f.storage.put(id(999)+'-thumb.webp',image);
 for(let i=1;i<=36;i++)await f.db.run('INSERT INTO photos(id,album_id,filename,original,width,height,position,section_id,source_bytes,image_bytes,thumb_bytes,download_bytes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[id(i),aid,id(999),`CC - ${String(i).padStart(4,'0')}.JPG`,900,600,i,id(100+Math.floor((i-1)/6)),12000000,600000,80000,1200000]);
 for(const i of [1,7])await f.db.run('INSERT INTO selections(album_id,photo_id,updated) VALUES(?,?,?)',[aid,id(i),new Date().toISOString()]);
 browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}});const page=await ctx.newPage();page.setDefaultTimeout(12000);
 await ctx.request.post(base+'/api/admin/setup',{headers:{Origin:base},data:{email:'review@test.local',password:'review-password-123'}});
 await page.clock.install();await page.goto(base+'/admin#album/'+aid);await page.locator('.manage-photo').first().waitFor();await page.evaluate(()=>document.fonts.ready);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const visible=()=>page.locator('[data-admin-photo]:not([hidden])');
 const search=page.locator('[data-admin-photo-search]');
 const customer=await browser.newContext();
 const pick=async(n,selected)=>{const r=await customer.request.put(base+`/api/gallery/${aid}/selection/${id(n)}`,{headers:{Origin:base},data:{selected}});assert.equal(r.status(),200);};
 const sync=async()=>{await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('[data-admin-sync]')?.textContent.startsWith('Đã cập nhật'));};
 assert.equal(await page.locator('[data-album-tool=upload]').getAttribute('open'),null);
 assert.equal(await page.locator('[data-album-tool=sections]').getAttribute('open'),null);
 assert.equal(await page.locator('[data-section-photo]').first().isVisible(),false);
 assert.equal(await visible().count(),36);


 const bid='b'.repeat(32);
 await f.db.run('INSERT INTO albums(id,title,category,status) VALUES(?,?,?,?)',[bid,'Album B','wedding','private']);
 await f.db.run('INSERT INTO photos(id,album_id,filename,original,width,height,position) VALUES(?,?,?,?,?,?,?)',[id(501),bid,id(999),'B-ONLY.JPG',900,600,0]);
 await f.db.run('INSERT INTO selections(album_id,photo_id,updated) VALUES(?,?,?)',[bid,id(501),new Date().toISOString()]);
 // A late detail response must not replace the newer destination page.
 await page.locator('[data-action=admin-view][data-view=dashboard]').click();await page.locator('.admin-selection-list').waitFor();
 let releaseDetail,seenDetail;const detailGate=new Promise(r=>releaseDetail=r),detailSeen=new Promise(r=>seenDetail=r);
 await page.route('**/api/admin/albums/'+aid,async route=>{seenDetail();await detailGate;await route.continue();});
 await page.locator(`.admin-selection-list [data-id="${aid}"]`).click();await detailSeen;
 await page.locator('.sidebar [data-action=admin-view][data-view=settings]').click();await page.locator('.settings-panel').first().waitFor();
 const detailResponse=page.waitForResponse(r=>r.url().endsWith('/api/admin/albums/'+aid));releaseDetail();await detailResponse;await page.waitForTimeout(100);
 assert.equal(await page.locator('.admin-heading h1').innerText(),'Cài đặt');assert.equal(await page.locator('.settings-panel').count()>0,true);
 await page.unroute('**/api/admin/albums/'+aid);
 await page.locator('[data-action=admin-view][data-view=clients]').click();await page.locator(`[data-action=edit-album][data-id="${aid}"]`).click();await page.locator('.admin-photo-workspace').waitFor();
 console.log('PASS: Late album responses cannot overwrite a newer admin page');
 // An export belongs to the album that initiated it, including when queued behind a poll.
 await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copiedNames=text}})});
 const downloads=[];page.on('download',download=>downloads.push(download));
 for(const action of ['copy-selected-names','export-admin-selection']){
  if(!page.url().endsWith(aid)){await page.locator('[data-action=album-back]').click();await page.locator(`[data-action=edit-album][data-id="${aid}"]`).click();await page.locator('.admin-photo-workspace').waitFor();}
  let release,entered;const hold=new Promise(r=>release=r),seen=new Promise(r=>entered=r);let first=true;
  await page.route('**/api/admin/albums/'+aid+'/selection',async route=>{if(first){first=false;entered();await hold;}await route.continue();});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await seen;
  await page.locator(`[data-action="${action}"]`).click();
  await page.locator('[data-action=album-back]').click();await page.locator(`[data-action=edit-album][data-id="${bid}"]`).click();await page.locator('.admin-photo-workspace').waitFor();
  release();await page.waitForFunction(()=>!document.querySelector('[data-action=copy-selected-names]').disabled);
  assert.equal(await page.evaluate(()=>window.copiedNames),undefined);assert.equal(downloads.length,0);
  await page.unroute('**/api/admin/albums/'+aid+'/selection');
 }
 await page.locator('[data-action=copy-selected-names]').click();await page.waitForFunction(()=>window.copiedNames==='B-ONLY.JPG');
 console.log('PASS: Queued copy and CSV exports cancel on navigation; normal copy exports the current album');
 // Cancel a CSV whose response is still pending after navigation, and recover after a timeout.
 let releaseCsv,seenCsv;const csvGate=new Promise(r=>releaseCsv=r),csvSeen=new Promise(r=>seenCsv=r);
 await page.route('**/api/admin/albums/'+bid+'/selections.csv',async route=>{seenCsv();await csvGate;await route.continue();});
 await page.locator('[data-action=export-admin-selection]').click();await csvSeen;
 await page.locator('[data-action=admin-view][data-view=dashboard]').click();await page.locator('.admin-selection-list').waitFor();
 const csvResponse=page.waitForResponse(r=>r.url().endsWith('/selections.csv'));releaseCsv();await csvResponse;await page.waitForTimeout(100);
 assert.equal(downloads.length,0);await page.unroute('**/api/admin/albums/'+bid+'/selections.csv');
 await page.locator(`.admin-selection-list [data-id="${bid}"]`).click();await page.locator('.admin-photo-workspace').waitFor();
 let releaseTimeout,seenTimeout;const timeoutGate=new Promise(r=>releaseTimeout=r),timeoutSeen=new Promise(r=>seenTimeout=r);
 await page.route('**/api/admin/albums/'+bid+'/selections.csv',async route=>{seenTimeout();await timeoutGate;await route.abort().catch(()=>{});});
 await page.locator('[data-action=export-admin-selection]').click();await timeoutSeen;await page.clock.fastForward(13000);
 await page.locator('#toast').filter({hasText:'Quá thời gian xuất danh sách'}).waitFor();
 assert.equal(await page.locator('[data-action=export-admin-selection]').isDisabled(),false);
 releaseTimeout();await page.unroute('**/api/admin/albums/'+bid+'/selections.csv');
 const saved=page.waitForEvent('download');await page.locator('[data-action=export-admin-selection]').click();const file=await saved;
 assert.match(file.suggestedFilename(),/^album-b-anh-da-chon-/);assert.equal(await file.failure(),null);await file.delete();
 console.log('PASS: Pending CSV cancels after navigation, timeout releases controls, retry downloads the right album');
 // A pending forced sync also causes background waiters to reject outside the error handler.
 let failRelease,failEntered;const failHold=new Promise(r=>failRelease=r),failSeen=new Promise(r=>failEntered=r);
 await page.route('**/api/admin/albums/'+bid+'/selection',async route=>{failEntered();await failHold;await route.abort('failed');});
 await page.locator('[data-action=admin-sync]').click();await failSeen;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));failRelease();
 await page.locator('[data-admin-sync]').filter({hasText:'Chưa cập nhật'}).waitFor();
 await page.waitForTimeout(100);
 assert.deepEqual(errors,[]);console.log('PASS: Concurrent manual/background failures report retry without an unhandled rejection');
 await page.unroute('**/api/admin/albums/'+bid+'/selection');
 // Setting a cover from a stale tab can undo an album update made elsewhere.
 const bDetail=await (await ctx.request.get(base+'/api/admin/albums/'+bid)).json();
 const archived=await ctx.request.patch(base+'/api/admin/albums/'+bid,{headers:{Origin:base},data:{...bDetail,title:'Archived remotely',status:'archived'}});assert.equal(archived.status(),200);
 await page.locator('.manage-photo summary').first().click();
 const coverResponse=page.waitForResponse(r=>r.url().endsWith('/api/admin/albums/'+bid+'/cover')&&r.request().method()==='PUT');
 await page.locator('.manage-photo [data-action=cover-photo]').first().click();await coverResponse;
 const stored=await f.db.get('SELECT title,status,cover_id FROM albums WHERE id=?',[bid]);
 assert.equal(stored.title,'Archived remotely');assert.equal(stored.status,'archived');assert.equal(stored.cover_id,id(501));
 console.log('PASS: Changing cover from a stale tab preserves newer title and archived status');
 // Client polling receives metadata changes without needing a focus event or reload.
 const client=await customer.newPage();client.on('pageerror',error=>errors.push(error.message));await client.clock.install();await client.goto(base+'/gallery/'+aid);await client.locator('.photo-open').first().waitFor();
 await ctx.request.patch(base+'/api/admin/photos/'+id(1),{headers:{Origin:base},data:{section_id:id(105),caption:'Changed remotely'}});
 await ctx.request.patch(base+'/api/admin/sections/'+id(100),{headers:{Origin:base},data:{title:'Renamed section'}});
 const clientPoll=client.waitForResponse(r=>r.url().endsWith('/api/gallery/'+aid+'/selection'));await client.clock.fastForward(25000);await clientPoll;
 await client.locator(`[data-action=section-filter][data-section="${id(100)}"]`).filter({hasText:'Renamed section'}).waitFor();
 await client.locator(`[data-action=section-filter][data-section="${id(100)}"]`).click();
 assert.equal(await client.locator(`[data-action=open-photo][data-photo="${id(1)}"]`).count(),0);
 await client.locator(`[data-action=section-filter][data-section="${id(105)}"]`).click();
 await client.locator(`[data-action=open-photo][data-photo="${id(1)}"]`).click();
 assert.match(await client.locator('#lightbox figcaption').innerText(),/Changed remotely/);
 // Rename a caption while the photo remains open, then remove its section.
 await ctx.request.patch(base+'/api/admin/photos/'+id(1),{headers:{Origin:base},data:{caption:'Caption while viewing'}});
 await client.clock.fastForward(25000);await client.locator('#lightbox figcaption').filter({hasText:'Caption while viewing'}).waitFor();
 await ctx.request.delete(base+'/api/admin/sections/'+id(105),{headers:{Origin:base}});
 await client.clock.fastForward(25000);await client.locator('#lightbox figcaption').filter({hasText:'Chưa phân loại'}).waitFor();
 assert.equal(await client.locator('#lightbox').evaluate(el=>el.open),true);
 await client.locator('[data-action=close-lightbox]').click();
 assert.equal(await client.locator('[data-action=section-filter][data-section=all]').getAttribute('aria-pressed'),'true');
 assert.deepEqual(errors,[]);console.log('PASS: Client metadata polling, open viewer updates and deleted-section fallback. '+engine);
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await f.db.close();await rm(dir,{recursive:true,force:true});}
