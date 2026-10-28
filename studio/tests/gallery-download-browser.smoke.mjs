// Explicitly isolated: never loads .env, never uses the real gallery database.
// STUDIO_DOWNLOAD_SAMPLE_FILES may contain a JSON array of two Lightroom exports.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';

const pw=await import(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright');
const dir=await mkdtemp(path.join(tmpdir(),'gallery-download-browser-'));
const instance=await createApp({dataDir:dir,env:{},production:false});
const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base='http://127.0.0.1:'+server.address().port,evidence=path.resolve(process.env.STUDIO_BROWSER_EVIDENCE_DIR||'output/gallery-download-review');
await mkdir(evidence,{recursive:true});let browser,adminCookie='';
const newId=()=>randomBytes(16).toString('hex');
const request=(route,body,method=body===undefined?'GET':'POST')=>fetch(base+route,{method,headers:{Origin:base,Cookie:adminCookie,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
function zipEntries(buffer){
 let end=buffer.length-22;while(end>=Math.max(0,buffer.length-65557)&&buffer.readUInt32LE(end)!==0x06054b50)end--;
 assert.ok(end>=0,'ZIP central directory exists');const entries=[],count=buffer.readUInt16LE(end+10);let offset=buffer.readUInt32LE(end+16);
 for(let index=0;index<count;index++){
  assert.equal(buffer.readUInt32LE(offset),0x02014b50);const method=buffer.readUInt16LE(offset+10),size=buffer.readUInt32LE(offset+20),plainSize=buffer.readUInt32LE(offset+24),nameLength=buffer.readUInt16LE(offset+28),extra=buffer.readUInt16LE(offset+30),comment=buffer.readUInt16LE(offset+32),local=buffer.readUInt32LE(offset+42);
  const name=buffer.subarray(offset+46,offset+46+nameLength).toString('utf8');assert.equal(buffer.readUInt32LE(local),0x04034b50);
  const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28),compressed=buffer.subarray(start,start+size);assert.ok(method===0||method===8);
  const data=method===0?compressed:inflateRawSync(compressed);assert.equal(data.length,plainSize);entries.push({name,data});offset+=46+nameLength+extra+comment;
 }
 assert.equal(offset,buffer.readUInt32LE(end+16)+buffer.readUInt32LE(end+12));return entries;
}

try{
 const setup=await request('/api/admin/setup',{email:'download-browser@example.com',password:'download-browser-password'});assert.equal(setup.status,201);adminCookie=setup.headers.get('set-cookie').split(';')[0];
 const created=await request('/api/admin/albums',{title:'Như & Cường — Ảnh đã chọn',category:'wedding',status:'private',password:'gallery-browser-password'});assert.equal(created.status,201);const album=(await created.json()).id;
 const sections=[newId(),newId()];for(const [index,id] of sections.entries())await instance.db.run('INSERT INTO album_sections(id,album_id,title,position) VALUES(?,?,?,?)',[id,album,index?'Chân dung':'Trang trí',index]);
 const samples=process.env.STUDIO_DOWNLOAD_SAMPLE_FILES?await Promise.all(JSON.parse(process.env.STUDIO_DOWNLOAD_SAMPLE_FILES).map(async file=>({name:path.basename(file),buffer:await readFile(file)}))):await Promise.all(['#b88a6d','#7b996f'].map(async(color,index)=>({name:'sample-'+index+'.jpg',buffer:await sharp({create:{width:index?2000:3000,height:index?3000:2000,channels:3,background:color}}).jpeg().toBuffer()})));
 assert.equal(samples.length,2);samples.push({name:'not-selected.jpg',buffer:await sharp({create:{width:800,height:600,channels:3,background:'#806f91'}}).jpeg().toBuffer()});
 const body=new FormData();for(const sample of samples)body.append('photos',new Blob([sample.buffer],{type:'image/jpeg'}),sample.name);
 const uploaded=await request('/api/admin/albums/'+album+'/photos',body);assert.equal(uploaded.status,201);const result=await uploaded.json();assert.equal(result.results.filter(photo=>photo.success).length,3);
 const photos=[];for(const resultPhoto of result.results)photos.push(await instance.db.get('SELECT * FROM photos WHERE id=?',[resultPhoto.id]));
 for(const [index,photo] of photos.entries())await instance.db.run('UPDATE photos SET section_id=? WHERE id=?',[sections[index===1?1:0],photo.id]);
 await instance.db.run('UPDATE photos SET download_bytes=NULL WHERE id=?',[photos[1].id]);// Simulate a legacy object set directly in this disposable local fixture.
 await rm(path.join(dir,'uploads',photos[1].filename+'-download.jpg'));
 const storedJpeg=await instance.storage.get(photos[0].filename+'-download.jpg');
 const browserName=process.env.STUDIO_BROWSER||'chromium';
 browser=await (pw[browserName]||pw.default[browserName]).launch({...(browserName==='chromium'?{channel:'chrome'}:{}),headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage();page.setDefaultTimeout(20000);
 // WebKit can resolve setViewportSize before the resize event/ResizeObserver
 // updates masonry positions. Check overflow after that layout has painted.
 const resize=async width=>{await page.setViewportSize({width,height:1000});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
 const errors=[],downloadPayloads=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().endsWith('/download')&&request.method()==='POST')downloadPayloads.push(request.postDataJSON());});
 const unlock=async()=>{await page.getByLabel('Mật khẩu bộ ảnh').fill('gallery-browser-password');await page.getByRole('button',{name:'Mở bộ ảnh',exact:true}).click();await page.locator('.client-toolbar').waitFor();};
 const open=async()=>{await page.locator('[data-action=download-selected]').click();await page.locator('#gallery-download').waitFor({state:'visible'});};
 const close=async()=>{await page.locator('[data-download-close]').click();await page.locator('#gallery-download').waitFor({state:'hidden'});};
 const download=async(part=0)=>{
  const event=page.waitForEvent('download');await page.locator(`[data-download-part="${part}"]`).click();let file;
  try{file=await event;}catch(error){console.log('Download failed UI:',await page.locator('#gallery-download').textContent());await page.screenshot({path:path.join(evidence,'download-failure.png')});throw error;}
  assert.equal(await file.failure(),null);
  const buffer=await readFile(await file.path());await page.locator('.download-status').filter({hasText:'Đã chuyển tệp cho trình duyệt'}).waitFor();return {buffer,name:file.suggestedFilename()};
 };
 await page.goto(base+'/gallery/'+album);await unlock();assert.equal(await page.locator('[data-action=download-selected]').isDisabled(),true);
 for(const photo of photos.slice(0,2)){await page.locator(`.pick[data-photo="${photo.id}"]`).click();await page.waitForFunction(id=>document.querySelector(`.pick[data-photo="${id}"]`)?.getAttribute('aria-pressed')==='true',photo.id);}
 assert.equal(await page.locator('[data-action=download-selected]').isEnabled(),true);
 assert.equal(await page.locator('[data-action=submit-picks]').count(),0);
 await page.locator('[data-action=selected-only]').click();await page.locator(`[data-action=section-filter][data-section="${sections[0]}"]`).click();assert.equal(await page.locator('.photo-item').count(),1);
 const initialSelections=await instance.db.all('SELECT * FROM selections WHERE album_id=? ORDER BY photo_id',[album]);
 await open();assert.match(await page.locator('#gallery-download-description').textContent(),/tất cả các phần/);
 await page.route('**/api/gallery/'+album+'/download',route=>route.fulfill({status:413,contentType:'application/json',body:JSON.stringify({error:'Tệp quá lớn'})}));
 await page.locator('[data-download-part="0"]').click();await page.locator('[data-download-smaller]').waitFor({state:'visible'});await page.unroute('**/api/gallery/'+album+'/download');await page.locator('[data-download-smaller]').click();assert.equal(await page.locator('[data-download-part]').count(),2);const smallerFile=await download(0);assert.match(smallerFile.name,/\.jpg$/);assert.deepEqual(await instance.db.all('SELECT * FROM selections WHERE album_id=? ORDER BY photo_id',[album]),initialSelections);await close();await open();
 const zipped=await download();assert.match(zipped.name,/\.zip$/);const entries=zipEntries(zipped.buffer);assert.equal(entries.length,2);
 assert.deepEqual(entries[0].data,storedJpeg);for(const entry of entries){const info=await sharp(entry.data).metadata();assert.equal(info.format,'jpeg');assert.equal(Math.max(info.width,info.height),2400);}
 assert.deepEqual(new Set(downloadPayloads.at(-1).photos),new Set(photos.slice(0,2).map(photo=>photo.id)));
 assert.equal((await instance.db.get('SELECT selection_status FROM albums WHERE id=?',[album])).selection_status,'draft');assert.deepEqual(await instance.db.all('SELECT * FROM selections WHERE album_id=? ORDER BY photo_id',[album]),initialSelections);
 await writeFile(path.join(evidence,'selected-photos.zip'),zipped.buffer);
 console.log('PASS: Private unlock, zero-selection disabling, pick synchronization, selected-only + section filtering includes all selected photos, actual ZIP/JPEG payloads and unchanged automatically saved selection');

 const accessibility=[];
 for(const width of [320,390,768,1440]){
  await resize(width);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page overflow at '+width);
  assert.ok(await page.locator('#gallery-download').evaluate(element=>element.scrollWidth<=element.clientWidth),'Dialog overflow at '+width);
  await page.screenshot({path:path.join(evidence,`download-dialog-${width}.png`)});
  if(process.env.STUDIO_AXE_MODULE){
   const {default:AxeBuilder}=await import(process.env.STUDIO_AXE_MODULE);
   const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
   accessibility.push({width,violations:scan.violations,incomplete:scan.incomplete});
   await writeFile(path.join(evidence,'accessibility.json'),JSON.stringify(accessibility,null,2));
   assert.deepEqual(scan.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
  }
 }
 await writeFile(path.join(evidence,'accessibility.json'),JSON.stringify(accessibility,null,2));
 await page.keyboard.press('Escape');await page.locator('#gallery-download').waitFor({state:'hidden'});
 // The browser queues the dialog close event; hidden does not mean focus has been restored yet.
 await page.waitForFunction(()=>document.querySelector('[data-action=download-selected]')===document.activeElement);
 for(const width of [320,390,768,1440]){await resize(width);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Gallery overflow at '+width);await page.locator('.client-toolbar').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,`gallery-toolbar-${width}.png`)});}
 console.log('PASS: Dialog and gallery at 320/390/768/1440, accessibility, Escape and restored focus');

 const endpoint='**/api/gallery/'+album+'/download';
 await open();await page.route(endpoint,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Chưa chuẩn bị được ảnh để tải xuống. Vui lòng thử lại sau ít phút.'})}));
 await page.locator('[data-download-part="0"]').click();await page.locator('#gallery-download .form-error').filter({hasText:'Chưa chuẩn bị được ảnh'}).waitFor();assert.equal(await page.locator('[data-download-part="0"]').isEnabled(),true);await page.unroute(endpoint);await download();await close();
 const pauseNextStorageRead=()=>{
  let markStarted,markAborted;const started=new Promise(resolve=>{markStarted=resolve;}),aborted=new Promise(resolve=>{markAborted=resolve;}),originalGet=instance.storage.get.bind(instance.storage);
  instance.storage.get=async(name,{signal}={})=>{instance.storage.get=originalGet;markStarted();return new Promise((resolve,reject)=>{const abort=()=>{markAborted();reject(signal.reason||Error('Cancelled'));};if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});};
  return {started,aborted};
 };
 await open();const paused=pauseNextStorageRead();await page.locator('[data-download-part="0"]').click();await paused.started;await page.locator('[data-download-cancel]').click();await page.locator('.download-status').filter({hasText:'Đã hủy tải'}).waitFor();await paused.aborted;
 assert.equal(await page.locator('[data-download-part="0"]').evaluate(el=>el===document.activeElement),true);await download();await close();
 await open();const pausedEscape=pauseNextStorageRead();await page.locator('[data-download-part="0"]').click();await pausedEscape.started;await page.keyboard.press('Escape');await page.locator('#gallery-download').waitFor({state:'hidden'});await pausedEscape.aborted;assert.equal(await page.locator('[data-action=download-selected]').evaluate(el=>el===document.activeElement),true);
 console.log('PASS: Visible server failure and retry, cancellation and retry, Escape during active download, keyboard focus');

 await open();await instance.db.run('DELETE FROM selections WHERE album_id=? AND photo_id=?',[album,photos[1].id]);await page.locator('[data-download-part="0"]').click();await page.locator('[data-download-refresh]').waitFor({state:'visible'});assert.equal(await page.locator('[data-download-part="0"]').isDisabled(),true);
 await page.locator('[data-download-refresh]').click();await page.locator('#gallery-download').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('.client-toolbar strong')?.textContent==='1 ảnh đã lưu');
 await open();const single=await download();assert.match(single.name,/\.jpg$/);assert.deepEqual(single.buffer,storedJpeg);await writeFile(path.join(evidence,'selected-single.jpg'),single.buffer);await close();
 await open();await context.clearCookies();await page.locator('[data-download-part="0"]').click();await page.getByLabel('Mật khẩu bộ ảnh').waitFor();assert.equal(await page.locator('#gallery-download').isVisible(),false);await unlock();
 console.log('PASS: Stale selection refresh, exact stored single JPEG, expired gallery session relocks');

 await instance.db.run('INSERT INTO selections(album_id,photo_id,updated) VALUES(?,?,?)',[album,photos[1].id,new Date().toISOString()]);
 for(let index=0;index<49;index++){
  const id=newId();await instance.db.run('INSERT INTO photos(id,album_id,filename,original,caption,width,height,position,section_id,download_bytes) VALUES(?,?,?,?,?,?,?,?,?,?)',[id,album,photos[0].filename,`extra-${index+1}.jpg`,`Ảnh ${index+1}`,photos[0].width,photos[0].height,index+10,sections[0],storedJpeg.length]);
  await instance.db.run('INSERT INTO selections(album_id,photo_id,updated) VALUES(?,?,?)',[album,id,new Date().toISOString()]);
 }
 await page.reload();await page.locator('.client-toolbar').waitFor();await open();assert.equal(await page.locator('[data-download-part]').count(),2);assert.match(await page.locator('#gallery-download').textContent(),/Ảnh 1–50/);assert.match(await page.locator('#gallery-download').textContent(),/Ảnh 51–51/);
 let downloadCount=0;page.on('download',()=>downloadCount++);const second=await download(1);assert.match(second.name,/\.jpg$/);assert.equal(downloadPayloads.at(-1).photos.length,1);assert.equal((await sharp(second.buffer).metadata()).format,'jpeg');assert.equal(downloadCount,1);
 const first=await download(0);assert.equal(zipEntries(first.buffer).length,50);assert.equal(downloadPayloads.at(-1).photos.length,50);assert.equal(downloadCount,2);
 await resize(320);assert.ok(await page.locator('#gallery-download').evaluate(el=>el.scrollWidth<=el.clientWidth));await page.screenshot({path:path.join(evidence,'download-packages-320.png')});
 assert.deepEqual(errors,[]);console.log('PASS: 51 selected photos split into manual 50-photo ZIP and one-photo JPG packages; no accidental additional downloads and no runtime errors');
 await writeFile(path.join(evidence,'browser-summary.json'),JSON.stringify({passed:true,sampleNames:samples.map(sample=>sample.name),zipBytes:zipped.buffer.length,singleJpegBytes:single.buffer.length,packages:[50,1],viewports:[320,390,768,1440],axeEnabled:!!process.env.STUDIO_AXE_MODULE,axeScans:accessibility.length,axeViolations:accessibility.reduce((n,r)=>n+r.violations.length,0),browserErrors:errors},null,2));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await instance.db.close();await rm(dir,{recursive:true,force:true});}
