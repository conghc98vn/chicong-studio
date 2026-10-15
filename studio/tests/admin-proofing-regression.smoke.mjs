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
const base='http://127.0.0.1:'+server.address().port,aid='a'.repeat(32),id=n=>n.toString(16).padStart(32,'0'),out=process.env.STUDIO_BROWSER_EVIDENCE_DIR||'output/proofing-review-fixes';let browser;
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

 // Focused dashboard counters.
 await page.locator('[data-action=admin-view][data-view=dashboard]').click();
 const row=page.locator('.admin-selection-list [data-action=edit-album]');await row.focus();await row.evaluate(el=>window.retainedRow=el);
 await pick(2,true);await page.clock.fastForward(16000);await page.waitForFunction(()=>document.querySelector('[data-admin-sync]')?.textContent.startsWith('Đã cập nhật'));
 await page.waitForFunction(()=>document.querySelector('.admin-selection-list strong').textContent==='3 ảnh');
 assert.equal(await row.evaluate(el=>el===window.retainedRow&&el===document.activeElement),true);
 console.log('PASS: Focused dashboard updates its count without replacing the button');
 await row.click();await page.locator('.admin-photo-workspace').waitFor();
 // Bulk selection remains after a remotely deselected image disappears.
 await page.locator('[data-action=admin-pick-filter][data-filter=selected]').click();await page.locator('[data-action=admin-arrange]').click();
 await page.locator(`[data-section-photo="${id(1)}"]`).check();await page.locator(`[data-section-photo="${id(7)}"]`).check();await pick(1,false);
 await page.clock.fastForward(16000);await page.waitForFunction(id=>document.querySelector(`[data-admin-photo="${id}"]`).hidden,id(1));
 assert.equal(await page.locator(`[data-section-photo="${id(1)}"]`).isChecked(),false);
 assert.equal(await page.locator('[data-bulk-count]').innerText(),'1 ảnh đang chọn');
 await page.locator('[data-bulk-section]').selectOption(id(102));await page.locator('[data-action=section-assign]').click();await page.waitForFunction(()=>document.querySelector('[data-bulk-count]').textContent==='0 ảnh đang chọn');
 assert.equal((await f.db.get('SELECT section_id FROM photos WHERE id=?',[id(1)])).section_id,id(100));
 assert.equal((await f.db.get('SELECT section_id FROM photos WHERE id=?',[id(7)])).section_id,id(102));
 // Removing the last checked image also disables the mutation.
 await page.locator(`[data-section-photo="${id(2)}"]`).check();await pick(2,false);await page.clock.fastForward(16000);
 await page.waitForFunction(()=>document.querySelector('[data-bulk-count]').textContent==='0 ảnh đang chọn');
 assert.equal(await page.locator('[data-action=section-assign]').isDisabled(),true);
 console.log('PASS: Remote deselection prunes hidden bulk selections and only visible checked photos move');
 // First-column menu at a narrow viewport.
 await page.locator('[data-action=admin-arrange]').click();await page.locator('[data-action=admin-pick-filter][data-filter=all]').click();
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:844});
  for(const index of [0,1]){
   const card=visible().nth(index);await card.locator('summary').click();
   await page.waitForFunction(id=>{const box=document.querySelector(`[data-admin-photo="${id}"] .photo-actions`).getBoundingClientRect();return box.left>=7&&box.right<=document.documentElement.clientWidth-7;},await card.getAttribute('data-admin-photo'));
   if(width===320&&index===0)await page.screenshot({path:out+`/${engine}-menu-320.png`});
   await card.locator('[data-action=photo-details]').click();await page.locator('#editor[open]').waitFor();await page.locator('#editor [data-action=close-editor]').click();
  }
 }
 const first=visible().first();await first.locator('summary').click();await page.setViewportSize({width:320,height:844});
 await page.waitForFunction(()=>document.querySelector('.photo-menu[open] .photo-actions').getBoundingClientRect().left>=7);await first.locator('summary').click();
 console.log('PASS: Menus stay within viewport in both columns, open on resize, and actions remain usable');
 // Section changes in a second studio tab leave counts stale even after polling.
 const version=async()=>(await (await ctx.request.get(base+`/api/admin/albums/${aid}/selection`)).json()).catalog_version;
 const versionBefore=await version();
 await page.locator('[data-action=admin-section-filter][data-section="'+id(100)+'"]').click();
 await ctx.request.patch(base+'/api/admin/photos/'+id(3),{headers:{Origin:base},data:{section_id:id(105)}});
 assert.notEqual(await version(),versionBefore);
 await page.clock.fastForward(16000);await page.waitForFunction(id=>!document.querySelector(`[data-admin-photo="${id}"]`),id(3));
 await page.locator('[data-action=admin-section-filter][data-section="'+id(105)+'"]').click();assert.equal(await page.locator(`[data-admin-photo="${id(3)}"]`).count(),1);
 await page.locator('[data-album-tool=upload]>summary').click();await page.locator('[data-form=upload] input[type=file]').setInputFiles({name:'pending.webp',mimeType:'image/webp',buffer:image});
 await search.fill('updated caption');
 await ctx.request.patch(base+'/api/admin/photos/'+id(3),{headers:{Origin:base},data:{caption:'Updated caption'}});
 await ctx.request.patch(base+'/api/admin/sections/'+id(105),{headers:{Origin:base},data:{title:'Nhóm ảnh mới'}});
 await page.clock.fastForward(16000);await page.waitForFunction(()=>document.querySelectorAll('[data-admin-photo]:not([hidden])').length===1);
 assert.match(await page.locator('[data-action=admin-section-filter][data-section="'+id(105)+'"]').innerText(),/Nhóm ảnh mới/);
 assert.equal(await search.inputValue(),'updated caption');assert.equal(await page.locator('[data-form=upload] input[type=file]').evaluate(el=>el.files.length),1);
 console.log('PASS: Polling detects remote photo assignment, caption, section rename and preserves pending files/search');
 await page.locator('[data-action=admin-view][data-view=dashboard]').click();await page.locator('.admin-selection-list button').focus();
 await pick(7,false);await page.clock.fastForward(16000);await page.waitForFunction(()=>!document.querySelector('.admin-selection-list button'));
 assert.equal(await page.evaluate(()=>document.activeElement?.dataset.action),'admin-sync');
 assert.deepEqual(errors,[]);console.log('PASS: Empty dashboard removes stale rows and restores focus. '+engine);

}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await f.db.close();await rm(dir,{recursive:true,force:true});}
