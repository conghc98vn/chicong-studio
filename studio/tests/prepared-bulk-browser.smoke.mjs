// Optional manual regression; every app/database/storage object is disposable.
// Run with STUDIO_PREPARED_SAMPLE_DIR containing exactly 66 real .ccphoto files.
// Source bundles are read only. Metrics describe this local test, never Render.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readdir,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';
import {decodePreparedPhoto} from '../server/prepared-photo.mjs';

assert.ok(process.env.STUDIO_PREPARED_SAMPLE_DIR,'Set STUDIO_PREPARED_SAMPLE_DIR to a folder of 66 prepared photos');
const source=path.resolve(process.env.STUDIO_PREPARED_SAMPLE_DIR);
const names=(await readdir(source)).filter(name=>/\.ccphoto$/i.test(name)).sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
assert.equal(names.length,66,'This bulk regression expects 66 prepared files');
const files=names.map(name=>path.join(source,name));
const before=await Promise.all(files.map(async file=>{const info=await stat(file);return {size:info.size,mtimeMs:info.mtimeMs};}));
const pw=await import(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright');
const browserName=process.env.STUDIO_BROWSER||'chromium';
const evidence=path.resolve('output/prepared-bulk-review',browserName);await mkdir(evidence,{recursive:true});
const directory=await mkdtemp(path.join(tmpdir(),'prepared-bulk-browser-'));
const instance=await createApp({dataDir:directory,env:{},production:false});
const requests=[];let active=0,maxActive=0,releaseFirst,firstHeldAt,firstReleasedAt,droppedStatus;
const firstHeld=new Promise(resolve=>{releaseFirst={notify:resolve,finish:null};});
const server=createServer((req,res)=>{
 if(req.method==='POST'&&/\/api\/admin\/albums\/[^/]+\/photos$/.test(req.url)){
  const index=requests.length+1;requests.push({keys:JSON.parse(req.headers['x-upload-keys']),section:req.headers['x-album-section'],bytes:Number(req.headers['content-length'])});active++;maxActive=Math.max(maxActive,active);
  let settled=false;const settle=()=>{if(!settled){settled=true;active--;}};res.once('close',settle);res.once('finish',settle);
  const end=res.end.bind(res);
  if(index===1)res.end=(...args)=>{firstHeldAt=performance.now();releaseFirst.finish=()=>{if(firstReleasedAt!==undefined)return res;firstReleasedAt=performance.now();return end(...args);};releaseFirst.notify();return res;};
  if(index===11)res.end=()=>{droppedStatus=res.statusCode;res.flushHeaders();res.write(' ');setTimeout(()=>res.destroy(),10);return res;};
 }
 instance.app(req,res);
}).listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const base='http://127.0.0.1:'+server.address().port;
let browser,peakRss=process.memoryUsage().rss;
const sampleMemory=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},50);sampleMemory.unref();
try{
 browser=await (pw[browserName]||pw.default[browserName]).launch({headless:true,...(browserName==='chromium'?{channel:'chrome'}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/admin');await page.getByLabel('Email quản trị').fill('prepared-bulk@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('prepared-bulk-password');await page.getByRole('button',{name:'Tạo tài khoản quản trị',exact:true}).click();
 await page.getByRole('button',{name:'Tạo bộ ảnh',exact:true}).click();const form=page.locator('[data-form=album]');await form.locator('[name=title]').fill('Regression 66 ảnh local');await form.locator('[name=status]').selectOption('private');await form.locator('[name=password]').fill('prepared-bulk-gallery');await form.getByRole('button',{name:'Tạo bộ ảnh',exact:true}).click();await page.locator('[data-form=upload]').waitFor();await page.locator('[data-album-tool=sections]>summary').click();
 const albumId=new URL(page.url()).hash.slice('#album/'.length);
 for(const title of ['Chi tiết trang trí','Phần khác']){await page.getByRole('button',{name:'+ Thêm phần',exact:true}).click();await page.locator('[data-form=section] [name=title]').fill(title);await page.getByRole('button',{name:'Lưu phần',exact:true}).click();await page.locator('#editor').waitFor({state:'hidden'});await page.locator('.section-title strong').filter({hasText:title}).waitFor();}
 const section=await instance.db.get('SELECT id FROM album_sections WHERE album_id=? AND title=?',[albumId,'Chi tiết trang trí']);
 const upload=page.locator('[data-form=upload]');await upload.locator('[name=section_id]').selectOption(section.id);await upload.locator('[type=file]').setInputFiles(files);assert.match(await upload.locator('.upload-selection').textContent(),/66 ảnh/);
 const uploadStarted=performance.now();await upload.getByRole('button',{name:'Tải ảnh lên',exact:true}).click();await firstHeld;
 await upload.locator('.upload-progress').filter({hasText:'kiểm tra và lưu ảnh'}).waitFor();
 assert.equal(await upload.locator('[type=file]').isDisabled(),true);assert.equal(await upload.locator('[name=section_id]').isDisabled(),true);assert.equal(await upload.locator('button').isDisabled(),true);
 assert.match(await page.locator('.upload-summary').textContent(),/Đã lưu 0\/66/);assert.equal((await instance.db.all('SELECT id FROM photos WHERE album_id=?',[albumId])).length,1,'Browser must not acknowledge before response');
 const location=page.url();await page.locator('[data-action=album-back]').click();assert.equal(page.url(),location);await page.locator('#toast').filter({hasText:'Đang tải ảnh lên'}).waitFor();
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});await upload.locator('.upload-progress').scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Progress overflow at '+width);await page.screenshot({path:path.join(evidence,`progress-${width}.png`)});}
 releaseFirst.finish();
 await upload.locator('.form-error').filter({hasText:'Đã lưu 10/66'}).waitFor({timeout:120000});assert.equal(droppedStatus,201);assert.equal(requests.length,11);assert.match(await page.locator('.upload-summary').textContent(),/Đã lưu 10\/66/);
 const interrupted=await instance.db.all('SELECT id,section_id FROM photos WHERE album_id=? ORDER BY position,id',[albumId]);assert.equal(interrupted.length,11);assert.ok(interrupted.every(photo=>photo.section_id===section.id));
 assert.equal(await upload.locator('[name=section_id]').isDisabled(),true);assert.equal(await upload.locator('[type=file]').isDisabled(),false);assert.equal(await upload.locator('[type=file]').evaluate(element=>element.files.length),66);
 await upload.locator('.form-error').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,'interrupted-10-of-66.png')});
 console.log('PASS: 66 real files; active progress/layout/navigation guard; dropped response leaves 10 acknowledged and 11 saved with all files retained');

 const retryStarted=performance.now();await upload.getByRole('button',{name:'Tải lại các ảnh còn lại',exact:true}).click();await page.locator('.upload-summary').filter({hasText:'Đã lưu 66/66'}).waitFor({timeout:180000});const uploadFinished=performance.now();
 assert.equal(await upload.locator('.form-error').textContent(),'');assert.equal(await upload.locator('[type=file]').evaluate(element=>element.files.length),0);assert.equal(await upload.locator('[name=section_id]').isDisabled(),false);assert.equal(requests.length,67);assert.deepEqual(requests[10].keys,requests[11].keys);assert.ok(requests.every(request=>request.section===section.id&&request.keys.length===1));assert.equal(new Set(requests.flatMap(request=>request.keys)).size,66);assert.equal(maxActive,1);
 const rows=await instance.db.all('SELECT * FROM photos WHERE album_id=? ORDER BY position,id',[albumId]);assert.equal(rows.length,66);assert.deepEqual(rows.slice(0,11).map(photo=>photo.id),interrupted.map(photo=>photo.id));assert.ok(rows.every(photo=>photo.section_id===section.id));assert.equal(new Set(rows.map(photo=>photo.id)).size,66);assert.equal(new Set(rows.map(photo=>photo.upload_key)).size,66);
 const uploadPeakRss=peakRss;let originalBytes=0,storedBytes=0;
 for(const [index,file]of files.entries()){
  const bytes=await readFile(file),bundle=await decodePreparedPhoto(bytes),photo=rows[index];assert.equal(photo.original,bundle.originalName,'Filename order at '+index);assert.equal(photo.position,index);assert.equal(photo.width,bundle.optimization.width);assert.equal(photo.height,bundle.optimization.height);
  for(const key of ['source_bytes','image_bytes','thumb_bytes','download_bytes'])assert.equal(photo[key],bundle.optimization[key],key+' at '+index);
  for(const [key,suffix]of [['data','.webp'],['thumbnail','-thumb.webp'],['download','-download.jpg']])assert.deepEqual(await instance.storage.get(photo.filename+suffix),bundle[key],key+' differs at '+index);
  const after=await stat(file);assert.equal(after.size,before[index].size);assert.equal(after.mtimeMs,before[index].mtimeMs);originalBytes+=bundle.optimization.source_bytes;storedBytes+=bundle.optimization.image_bytes+bundle.optimization.thumb_bytes+bundle.optimization.download_bytes;
 }
 assert.equal(await page.locator('.manage-photo').count(),66);await page.reload();await page.locator('.manage-photo').nth(65).waitFor();assert.equal(await page.locator('.manage-photo').count(),66);await page.locator('.manage-photo summary').first().click();await page.locator('.manage-photo [data-action=photo-details]').first().click();await page.locator('#editor[open] .photo-size').waitFor();await page.locator('#editor [data-action=close-editor]').click();
 await page.locator('[data-album-tool=upload]>summary').click();
 for(const width of [390,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Result overflow at '+width);await page.locator('[data-form=upload]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,`complete-${width}.png`)});}
 assert.deepEqual(errors,[]);
 const metrics={environment:'Disposable local app and local storage; not production performance',browser:browserName,photos:66,requests:requests.length,maxConcurrentUploads:maxActive,acknowledgedBeforeRetry:10,persistedBeforeRetry:11,originalBytes,preparedBytes:before.reduce((sum,photo)=>sum+photo.size,0),storedBytes,elapsedSeconds:Number(((uploadFinished-uploadStarted)/1000).toFixed(2)),intentionalInspectionHoldSeconds:Number(((firstReleasedAt-firstHeldAt)/1000).toFixed(2)),elapsedExcludingInspectionSeconds:Number(((uploadFinished-uploadStarted-firstReleasedAt+firstHeldAt)/1000).toFixed(2)),retrySeconds:Number(((uploadFinished-retryStarted)/1000).toFixed(2)),nodePeakRssDuringUploadMiB:Number((uploadPeakRss/1024/1024).toFixed(1)),nodePeakRssIncludingVerificationMiB:Number((peakRss/1024/1024).toFixed(1))};
 await writeFile(path.join(evidence,'metrics.json'),JSON.stringify(metrics,null,2)+'\n');console.log('PASS: Retry uploads only 56 pending requests; final 66 photos preserve order/section/metadata, all 198 stored renditions are byte-exact, reload has 66 cards and no browser errors');console.log(JSON.stringify(metrics));
}finally{clearInterval(sampleMemory);releaseFirst.finish?.();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await instance.db.close();await rm(directory,{recursive:true,force:true});}
