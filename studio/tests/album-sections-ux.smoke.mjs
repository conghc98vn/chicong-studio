// Extended regression scenarios. All data and browser sessions are disposable.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';
import {id,hashPassword} from '../server/db.mjs';
const pw=await import(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright');
const dir=await mkdtemp(path.join(tmpdir(),'sections-ux-'));
const instance=await createApp({dataDir:dir,env:{}}),{db}=instance;
const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
const evidence=process.env.STUDIO_BROWSER_EVIDENCE_DIR||path.resolve('output/sections-review');await mkdir(evidence,{recursive:true});
let browser;const failures=[],errors=[];let scenarios=0;
const scenario=async(name,run)=>{scenarios++;try{await run();console.log('PASS: '+name);}catch(e){failures.push({name,error:e.message});console.error('FAIL: '+name+'\n'+e.stack);}};
try{
 await db.run('INSERT INTO admins(id,email,password) VALUES(?,?,?)',['owner','ux@example.com',hashPassword('ux-test-password')]);
 const album=id(),s1=id(),s2=id(),s3=id();
 await db.run('INSERT INTO albums(id,slug,title,category,status,password) VALUES(?,?,?,?,?,?)',[album,'ux-album','Ngày cưới — Kiểm thử các phần','wedding','private',hashPassword('gallery-pass')]);
 for(const [key,title,position] of [[s1,'Trang trí',0],[s2,'Gia tiên',1],[s3,'Ảnh nhóm',2]])await db.run('INSERT INTO album_sections(id,album_id,title,position) VALUES(?,?,?,?)',[key,album,title,position]);
 const bytes=process.env.STUDIO_SAMPLE_IMAGE?await sharp(process.env.STUDIO_SAMPLE_IMAGE).resize(900,600,{fit:'cover'}).webp().toBuffer():await sharp({create:{width:900,height:600,channels:3,background:'#8b9e91'}}).webp().toBuffer();const photos=[];
 for(let i=0;i<12;i++){const key=id();photos.push(key);await instance.storage.put(key+'.webp',bytes);await instance.storage.put(key+'-thumb.webp',bytes);await db.run('INSERT INTO photos(id,album_id,filename,original,caption,width,height,position,section_id) VALUES(?,?,?,?,?,?,?,?,?)',[key,album,key,`photo-${i}.webp`,`Ảnh ${i+1}`,900,600,i,i<4?s1:i<8?s2:i<10?s3:null]);}
 const chromium=pw.chromium||pw.default?.chromium;browser=await chromium.launch({channel:'chrome',headless:true});
 const adminContext=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await adminContext.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
 const openManagement=async()=>{await page.locator('.admin-photo-workspace').waitFor();for(const tool of ['upload','sections']){const panel=page.locator(`[data-album-tool=${tool}]`);if(await panel.getAttribute('open')===null)await panel.locator(':scope > summary').click();}const arrange=page.locator('[data-action=admin-arrange]');if(await arrange.getAttribute('aria-pressed')!=='true')await arrange.click();};
 const goAdmin=async()=>{if(page.url()===base+'/admin#album/'+album)await page.reload();else await page.goto(base+'/admin#album/'+album);await page.locator('#root').waitFor({state:'visible'});await openManagement();};
 await page.goto(base+'/admin#album/'+album);await page.getByLabel('Email quản trị').fill('ux@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('ux-test-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await openManagement();
 const filter=async key=>{await page.locator(`[data-action=admin-section-filter][data-section="${key}"]`).click();};
 const uploadFile={name:'pending.webp',mimeType:'image/webp',buffer:bytes};
 await scenario('Pending upload survives section filtering without changing destination',async()=>{
  await page.locator('[data-form=upload] [name=section_id]').selectOption(s1);await page.locator('[data-form=upload] input[type=file]').setInputFiles(uploadFile);await filter(s2);
  assert.equal(await page.locator('[data-form=upload] input[type=file]').evaluate(el=>el.files.length),1);
  assert.equal(await page.locator('[data-form=upload] [name=section_id]').inputValue(),s1);
 });
 await goAdmin();
 await scenario('Photo reorder boundary controls are disabled across sections',async()=>{
  assert.equal(await page.locator(`[data-action=move-photo][data-id="${photos[3]}"][data-direction=down]`).isDisabled(),true);
  assert.equal(await page.locator(`[data-action=move-photo][data-id="${photos[4]}"][data-direction=up]`).isDisabled(),true);
 });
 await scenario('Moving one photo keeps keyboard focus on its section selector',async()=>{
  await page.locator(`[data-photo-section="${photos[0]}"]`).selectOption(s2);await page.waitForFunction(id=>document.querySelector(`[data-photo-section="${id}"]`)?.disabled===false,photos[0]);
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.photoSection),photos[0]);
 });
 await goAdmin();
 await scenario('Partial upload failure refreshes tab counts and keeps retry files',async()=>{
  await filter(s1);await page.locator('[data-form=upload] input[type=file]').setInputFiles([uploadFile,{name:'bad.webp',mimeType:'image/webp',buffer:Buffer.from('broken')}]);
  await page.getByRole('button',{name:'Tải ảnh lên',exact:true}).click();await page.locator('[data-form=upload] .form-error').filter({hasText:'Đã lưu 1/2'}).waitFor();
  const count=(await db.get('SELECT COUNT(*) AS n FROM photos WHERE section_id=?',[s1])).n;
  assert.equal(Number(await page.locator(`[data-action=admin-section-filter][data-section="${s1}"] span`).textContent()),count);
  await filter(s2);assert.equal(await page.locator('[data-form=upload] input[type=file]').evaluate(el=>el.files.length),2);
  assert.equal(await page.locator('[data-form=upload] button').isDisabled(),true);assert.match(await page.locator('[data-upload-report]').textContent(),/bad.webp/);
 });
 await goAdmin();
 await scenario('Busy save exposes status and blocks duplicate changes',async()=>{
  let release,handled;const gate=new Promise(r=>release=r),settled=new Promise(r=>handled=r);await page.route('**/photos/sections',async route=>{await gate;try{await route.continue();}finally{handled();}});
  await page.locator('[data-section-photo]').first().check();await page.locator('[data-bulk-section]').selectOption(s1);await page.getByRole('button',{name:'Chuyển phần',exact:true}).click();
  try{await page.locator('[aria-busy=true]').waitFor();assert.equal(await page.locator('[data-action=section-assign]').isDisabled(),true);}finally{release();await settled;await page.unroute('**/photos/sections');await page.waitForFunction(()=>document.querySelector('[data-bulk-count]')?.textContent==='0 ảnh đang chọn');}
  await page.waitForFunction(()=>document.querySelector('[data-bulk-count]')?.textContent==='0 ảnh đang chọn');
 });
 await goAdmin();
 await scenario('Lost create response can be retried without duplicate sections',async()=>{
  let lost=false;await page.route('**/api/admin/albums/*/sections',async route=>{if(route.request().method()==='POST'&&!lost){lost=true;await route.fetch();await route.abort('connectionreset');}else await route.continue();});
  await page.getByRole('button',{name:'+ Thêm phần',exact:true}).click();await page.getByLabel('Tên phần',{exact:true}).fill('Phần thử mất kết nối');await page.getByRole('button',{name:'Lưu phần',exact:true}).click();
  await page.locator('[data-form=section] .form-error').filter({hasText:'Không kết nối'}).waitFor();await page.getByRole('button',{name:'Lưu phần',exact:true}).click();await page.locator('#editor').waitFor({state:'hidden'});await page.unroute('**/api/admin/albums/*/sections');
  assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM album_sections WHERE album_id=? AND title=?',[album,'Phần thử mất kết nối'])).n),1);
 });
 await scenario('Blank section name errors stay inline; correction and keyboard submit preserve focus',async()=>{
  await page.locator(`[data-action=section-rename][data-id="${s3}"]`).click();await page.getByLabel('Tên phần',{exact:true}).fill('   ');await page.getByRole('button',{name:'Lưu phần',exact:true}).click();await page.locator('[data-form=section] .form-error').filter({hasText:'120'}).waitFor();
  assert.equal((await db.get('SELECT title FROM album_sections WHERE id=?',[s3])).title,'Ảnh nhóm');await page.getByLabel('Tên phần',{exact:true}).fill('Ảnh nhóm');await page.getByLabel('Tên phần',{exact:true}).press('Enter');await page.locator('#editor').waitFor({state:'hidden'});
  await page.waitForFunction(key=>document.activeElement?.dataset.id===key,s3);assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'section-rename');
 });
 await scenario('Deleting upload destination preserves queued files and explains uncategorized fallback',async()=>{
  const disposable=await db.get('SELECT id FROM album_sections WHERE album_id=? AND title=?',[album,'Phần thử mất kết nối']);
  await page.locator('[data-form=upload] [name=section_id]').selectOption(disposable.id);await page.locator('[data-form=upload] input[type=file]').setInputFiles(uploadFile);
  await page.locator(`[data-action=section-remove][data-id="${disposable.id}"]`).click();await page.getByRole('button',{name:'Đóng',exact:true}).click();assert.ok(await db.get('SELECT id FROM album_sections WHERE id=?',[disposable.id]));
  await page.locator(`[data-action=section-remove][data-id="${disposable.id}"]`).click();await page.locator('[data-action=section-confirm-remove]').click();await page.locator('#editor').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('[data-form=upload] .form-error')?.textContent.includes('Phần đích đã bị xóa'));
  assert.equal(await page.locator('[data-form=upload] input[type=file]').evaluate(el=>el.files.length),1);assert.equal(await page.locator('[data-form=upload] [name=section_id]').inputValue(),'');
 });
 await goAdmin();
 await scenario('Photo ordering inside one section preserves other sections',async()=>{
  await filter(s2);const before=await db.all('SELECT id,position FROM photos WHERE album_id=? ORDER BY position,id',[album]);const inSection=await db.all('SELECT id FROM photos WHERE section_id=? ORDER BY position,id',[s2]);
  await page.locator(`[data-action=move-photo][data-id="${inSection[0].id}"][data-direction=down]`).click();await page.waitForFunction(key=>document.querySelector('[data-photo-section]')?.dataset.photoSection===key,inSection[1].id);
  const after=await db.all('SELECT id,position FROM photos WHERE album_id=? ORDER BY position,id',[album]);const swapped=new Set(inSection.slice(0,2).map(p=>p.id));assert.deepEqual(after.filter(p=>!swapped.has(p.id)),before.filter(p=>!swapped.has(p.id)));
 });
 const clientContext=await browser.newContext({viewport:{width:390,height:844}});
 const client=await clientContext.newPage();client.setDefaultTimeout(5000);client.on('pageerror',e=>errors.push(e.message));
 await client.goto(base+'/gallery/'+album);await client.getByLabel('Mật khẩu bộ ảnh').fill('gallery-pass');await client.getByRole('button',{name:'Mở bộ ảnh',exact:true}).click();await client.locator('.photo-item').first().waitFor();
 await scenario('Selected-only tab counts match selected results',async()=>{
  await client.locator('.pick').first().click();await client.waitForFunction(()=>document.querySelector('.client-toolbar strong').textContent==='1 ảnh đã lưu');await client.getByRole('button',{name:'Chỉ xem ảnh đã lưu',exact:true}).click();
  assert.equal(Number(await client.locator('[data-action=section-filter][data-section=all] span').textContent()),1);
 });
 await scenario('Keyboard focus returns to the photo after lightbox closes',async()=>{
  await client.locator('.photo-open').first().click();await client.keyboard.press('Escape');assert.equal(await client.evaluate(()=>document.activeElement?.classList.contains('photo-open')),true);
 });
 await scenario('Failed customer pick leaves saved selection and counters unchanged',async()=>{
  if(await client.getByRole('button',{name:'Xem tất cả',exact:true}).count())await client.getByRole('button',{name:'Xem tất cả',exact:true}).click();
  const before=await db.all('SELECT * FROM selections WHERE album_id=?',[album]);const count=await client.locator('.client-toolbar strong').textContent();
  await client.route('**/selection/*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Lỗi lưu thử nghiệm'})}));await client.locator('.pick').first().click();await client.waitForFunction(()=>document.querySelector('#toast').textContent==='Đã đối chiếu lại lựa chọn với máy chủ.');assert.equal(await client.locator('.client-toolbar strong').textContent(),count);assert.deepEqual(await db.all('SELECT * FROM selections WHERE album_id=?',[album]),before);await client.unroute('**/selection/*');
 });
 await scenario('Expired gallery session removes private photos and relocks',async()=>{
  await db.run('DELETE FROM sessions WHERE album_id=?',[album]);await client.locator('.photo-open').first().click();await client.locator('#lightbox-pick').click();await client.getByLabel('Mật khẩu bộ ảnh').waitFor();assert.equal(await client.locator('.photo-item').count(),0);assert.equal(await client.locator('#lightbox').isVisible(),false);
  await client.getByLabel('Mật khẩu bộ ảnh').fill('gallery-pass');await client.getByRole('button',{name:'Mở bộ ảnh',exact:true}).click();await client.locator('.photo-item').first().waitFor();
 });
 await scenario('Long section names, narrow mobile and tablet have no horizontal overflow',async()=>{
  await db.run('UPDATE album_sections SET title=? WHERE id=?',['Tên phần '+ 'rất dài '.repeat(13),s1]);
  for(const width of [320,375,390,768,1024,1440]){
   await page.setViewportSize({width,height:900});await goAdmin();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Admin overflow '+width);
   await client.setViewportSize({width,height:900});await client.reload();await client.locator('.section-tabs').waitFor();assert.ok(await client.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Gallery overflow '+width);
   await client.locator(`[data-action=section-filter][data-section="${s3}"]`).click();
   const visible=await client.locator('.section-tabs').evaluate(el=>{const a=el.querySelector('[aria-pressed=true]').getBoundingClientRect(),b=el.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1;});assert.ok(visible,'Active tab offscreen '+width);
   if([320,768,1440].includes(width)){await page.locator('.section-manager').screenshot({path:path.join(evidence,`admin-sections-${width}.png`)});await page.locator('.manage-photo').first().scrollIntoViewIfNeeded();await page.locator('.manage-photo img').first().evaluate(el=>el.decode());await page.screenshot({path:path.join(evidence,`admin-${width}.png`)});await client.locator('.photo-item').first().scrollIntoViewIfNeeded();await client.locator('.photo-item img').first().evaluate(el=>el.decode());await client.screenshot({path:path.join(evidence,`gallery-${width}.png`)});}
  }
 });
 await scenario('Mobile selectors avoid iOS zoom and section controls have touch-sized targets',async()=>{
  await page.setViewportSize({width:390,height:844});await goAdmin();assert.ok(await page.locator('[data-photo-section]').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16));
  for(const selector of ['[data-action=section-move]','[data-action=section-rename]','[data-action=section-remove]','.section-drag'])assert.ok(await page.locator(selector).first().evaluate(el=>el.getBoundingClientRect().height>=44),selector);
 });
 await scenario('Reduced-motion disables filter animation',async()=>{
  await client.emulateMedia({reducedMotion:'reduce'});await client.locator('[data-action=section-filter][data-section=all]').click();assert.equal(await client.locator('.photo-grid').evaluate(el=>getComputedStyle(el).animationName),'none');
 });
 if(process.env.STUDIO_AXE_MODULE){
  await scenario('Automated accessibility audit of admin, gallery and section dialog',async()=>{
   const {default:AxeBuilder}=await import(process.env.STUDIO_AXE_MODULE);const findings=[];
   await goAdmin();await client.reload();await client.locator('.section-tabs').waitFor();
   for(const [name,target] of [['admin',page],['gallery',client]]){
    const result=await new AxeBuilder({page:target}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();findings.push({name,violations:result.violations,incomplete:result.incomplete});
   }
   await page.getByRole('button',{name:'+ Thêm phần',exact:true}).click();const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();findings.push({name:'section-dialog',violations:result.violations,incomplete:result.incomplete});await page.keyboard.press('Escape');
   await writeFile(path.join(evidence,'accessibility.json'),JSON.stringify(findings,null,2));
   assert.deepEqual(findings.flatMap(r=>r.violations.map(v=>({page:r.name,id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))),[]);
  });
 }
 await scenario('Expired admin save shows login and returns to the album after reauthentication',async()=>{
  await goAdmin();await db.run("DELETE FROM sessions WHERE admin_id='owner'");await page.locator('[data-section-photo]').first().check();await page.getByRole('button',{name:'Chuyển phần',exact:true}).click();await page.getByLabel('Email quản trị').waitFor();assert.equal(await page.locator('.section-manager').count(),0);
  await page.getByLabel('Email quản trị').fill('ux@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('ux-test-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await openManagement();
 });
 await scenario('No browser runtime errors',async()=>assert.deepEqual(errors,[]));
 console.log(JSON.stringify({scenarios,failures},null,2));if(failures.length)process.exitCode=1;
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await db.close();await rm(dir,{recursive:true,force:true});}
