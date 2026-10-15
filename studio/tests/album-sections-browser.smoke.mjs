import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';
const pw=await import(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright');
const chromium=pw.chromium||pw.default?.chromium;
const evidenceDir=process.env.STUDIO_BROWSER_EVIDENCE_DIR||path.join(tmpdir(),'chicong-sections-evidence');
const dir=await mkdtemp(path.join(tmpdir(),'chicong-sections-browser-'));
const instance=await createApp({dataDir:dir,env:{}});
const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/admin');await page.getByLabel('Email quản trị').fill('section-browser@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('browser-test-password');await page.getByRole('button',{name:'Tạo tài khoản quản trị',exact:true}).click();
 await page.getByRole('button',{name:'Tạo bộ ảnh',exact:true}).click();const form=page.locator('[data-form=album]');
 await form.locator('[name=title]').fill('Minh & An — Ngày chung đôi');await form.locator('[name=status]').selectOption('private');await form.locator('[name=password]').fill('gallery-pass');await form.getByRole('button',{name:'Tạo bộ ảnh',exact:true}).click();
 await page.getByRole('button',{name:'Thông tin bộ ảnh'}).waitFor();const id=new URL(page.url()).hash.slice('#album/'.length);
 await page.locator('[data-album-tool=sections]>summary').click();
 for(const title of ['Trang trí','Lễ gia tiên','Ảnh nhóm']){
  await page.getByRole('button',{name:'+ Thêm phần',exact:true}).click();await page.locator('[data-form=section] [name=title]').fill(title);await page.getByRole('button',{name:'Lưu phần',exact:true}).click();await page.locator('#editor').waitFor({state:'hidden'});await page.locator('.section-title strong').filter({hasText:title}).waitFor();
 }
 let sections=await instance.db.all('SELECT * FROM album_sections WHERE album_id=? ORDER BY position,id',[id]);const [decoration,ceremony,group]=sections;
 const image=await sharp({create:{width:1200,height:800,channels:3,background:'#789080'}}).jpeg().toBuffer();
 await page.locator('[data-form=upload] input[type=file]').setInputFiles(['01-flower','02-vows','03-family'].map(name=>({name:name+'.jpg',mimeType:'image/jpeg',buffer:image})));
 await page.getByRole('button',{name:'Tải ảnh lên',exact:true}).click();await page.locator('.manage-photo').nth(2).waitFor();
 await page.locator('[data-action=admin-arrange]').click();
 await page.locator('[data-section-photo]').nth(0).check();await page.locator('[data-section-photo]').nth(1).check();await page.locator('[data-bulk-section]').selectOption(ceremony.id);await page.getByRole('button',{name:'Chuyển phần',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-bulk-count]').textContent==='0 ảnh đang chọn');
 let photos=await instance.db.all('SELECT * FROM photos WHERE album_id=? ORDER BY position,id',[id]);assert.equal(photos[0].section_id,ceremony.id);assert.equal(photos[1].section_id,ceremony.id);
 await page.locator(`[data-photo-section="${photos[2].id}"]`).selectOption(group.id);await page.waitForFunction(id=>document.querySelector(`[data-photo-section="${id}"]`)?.disabled===false,photos[2].id);
 await page.locator(`[data-action=admin-section-filter][data-section="${ceremony.id}"]`).click();assert.equal(await page.locator('.manage-photo').count(),2);
 await page.locator('[data-select-visible]').check();assert.equal(await page.locator('[data-bulk-count]').textContent(),'2 ảnh đang chọn');await page.getByRole('button',{name:'Bỏ chọn',exact:true}).click();
 // Failed assignment preserves the chosen photos and can be retried.
 await page.locator('[data-section-photo]').first().check();await page.route('**/photos/sections',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Thử lại sau'})}));await page.getByRole('button',{name:'Chuyển phần',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Thử lại sau');assert.equal(await page.locator('[data-section-photo]:checked').count(),1);await page.unroute('**/photos/sections');
 await page.getByRole('button',{name:'Bỏ chọn',exact:true}).click();
 // Upload directly into the currently selected section.
 await page.locator('[data-form=upload] input[type=file]').setInputFiles({name:'vows-extra.jpg',mimeType:'image/jpeg',buffer:image});await page.getByRole('button',{name:'Tải ảnh lên',exact:true}).click();await page.locator('.manage-photo').nth(2).waitFor();
 assert.equal((await instance.db.all('SELECT id FROM photos WHERE section_id=?',[ceremony.id])).length,3);
 await page.locator(`[data-action=section-move][data-id="${group.id}"][data-direction=up]`).click();await page.waitForFunction(id=>document.querySelectorAll('[data-section-row]')[1]?.dataset.sectionRow===id,group.id);
 await page.locator(`[data-section-row="${group.id}"] .section-drag`).dragTo(page.locator(`[data-section-row="${decoration.id}"]`));await page.waitForFunction(id=>document.querySelector('[data-section-row]')?.dataset.sectionRow===id,group.id);
 await page.locator(`[data-action=section-rename][data-id="${ceremony.id}"]`).click();await page.locator('[data-form=section] [name=title]').fill('Nghi thức gia tiên');await page.getByRole('button',{name:'Lưu phần',exact:true}).click();await page.locator('#editor').waitFor({state:'hidden'});await page.getByRole('button',{name:'Nghi thức gia tiên 3',exact:true}).waitFor();
 await mkdir(evidenceDir,{recursive:true});await page.screenshot({path:path.join(evidenceDir,'admin-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(evidenceDir,'admin-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const client=await browser.newPage({viewport:{width:390,height:844}});client.on('pageerror',e=>errors.push(e.message));await client.goto(base+'/gallery/'+id);await client.getByLabel('Mật khẩu bộ ảnh').fill('gallery-pass');await client.getByRole('button',{name:'Mở bộ ảnh',exact:true}).click();await client.locator('.photo-item').nth(3).waitFor();
 await client.locator(`[data-action=section-filter][data-section="${ceremony.id}"]`).click();assert.equal(await client.locator('.photo-item').count(),3);
 await client.locator('.photo-open').first().click();assert.match(await client.locator('#lightbox figcaption').textContent(),/Nghi thức gia tiên/);await client.getByRole('button',{name:'Chọn ảnh này',exact:true}).click();await client.getByRole('button',{name:'Bỏ chọn ảnh này',exact:true}).waitFor();await client.getByRole('button',{name:'Ảnh tiếp theo',exact:true}).click();assert.equal(await client.locator('#lightbox-counter').textContent(),'2 / 3');await client.keyboard.press('Escape');
 await client.locator(`[data-action=section-filter][data-section="${group.id}"]`).click();assert.equal(await client.locator('.photo-item').count(),1);await client.locator('.pick').click();await client.waitForFunction(()=>document.querySelector('.client-toolbar strong').textContent==='2 ảnh đã chọn');
 await client.getByRole('button',{name:'Xem ảnh đã chọn',exact:true}).click();assert.equal(await client.locator('.photo-item').count(),1);await client.locator(`[data-action=section-filter][data-section="${ceremony.id}"]`).click();assert.equal(await client.locator('.photo-item').count(),1);await client.locator('.photo-open').click();await client.getByRole('button',{name:'Bỏ chọn ảnh này',exact:true}).click();await client.locator('#lightbox').waitFor({state:'hidden'});assert.equal(await client.locator('.photo-item').count(),0);
 await client.getByRole('button',{name:'Xem tất cả',exact:true}).click();assert.equal(await client.locator('[data-action=submit-picks]').count(),0);
 await client.screenshot({path:path.join(evidenceDir,'gallery-mobile.png'),fullPage:true});assert.ok(await client.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await client.setViewportSize({width:1440,height:1000});await client.screenshot({path:path.join(evidenceDir,'gallery-desktop.png'),fullPage:true});
 // Delete a section while keeping its photos and the saved customer selection.
 await page.locator(`[data-action=section-remove][data-id="${group.id}"]`).click();await page.locator('[data-action=section-confirm-remove]').click();await page.locator('#editor').waitFor({state:'hidden'});await page.waitForFunction(id=>!document.querySelector(`[data-section-row="${id}"]`),group.id);
 assert.equal((await instance.db.get('SELECT COUNT(*) AS n FROM photos WHERE album_id=?',[id])).n,4);assert.equal((await instance.db.get('SELECT COUNT(*) AS n FROM selections WHERE album_id=?',[id])).n,1);
 await client.reload();await client.locator('[data-section=unassigned]').click();assert.equal(await client.locator('.photo-item').count(),1);assert.equal(await client.locator('.pick[aria-pressed=true]').count(),1);
 // Public albums use the same filtering and lightbox, without private selection controls.
 await instance.db.run("UPDATE albums SET status='published' WHERE id=?",[id]);await client.goto(base+'/album/'+id);await client.locator(`[data-action=section-filter][data-section="${ceremony.id}"]`).click();assert.equal(await client.locator('.photo-item').count(),3);assert.equal(await client.locator('.pick').count(),0);await client.locator('.photo-open').first().click();assert.match(await client.locator('#lightbox figcaption').textContent(),/Nghi thức gia tiên/);await client.keyboard.press('Escape');
 // Preset is safe to apply twice and retains existing sections.
 await page.getByRole('button',{name:'Dùng mẫu ngày cưới',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-section-row]').length===7);await page.getByRole('button',{name:'Dùng mẫu ngày cưới',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.startsWith('Đã thêm các phần'));assert.equal((await instance.db.all('SELECT * FROM album_sections WHERE album_id=?',[id])).length,7);
 // A successfully acknowledged preset request must not be reused after a rename.
 const preset=await instance.db.get('SELECT id FROM album_sections WHERE album_id=? AND title=?',[id,'Chi tiết trang trí']);
 await page.locator(`[data-action=section-rename][data-id="${preset.id}"]`).click();await page.getByLabel('Tên phần',{exact:true}).fill('Trang trí đã đổi tên');await page.getByRole('button',{name:'Lưu phần',exact:true}).click();await page.locator('#editor').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Dùng mẫu ngày cưới',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-section-row]').length===8);
 assert.equal((await instance.db.all('SELECT id FROM album_sections WHERE album_id=? AND title=?',[id,'Chi tiết trang trí'])).length,1);
 assert.deepEqual(errors,[]);console.log('PASS: section CRUD, bulk assignment and failure recovery, upload destination, button/drag ordering, desktop/mobile, private filters + selections + lightbox + automatic saving, deletion preserves picks, public filters, preset repeat and no browser errors. Evidence: '+evidenceDir);
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await instance.db.close();await rm(dir,{recursive:true,force:true});}
