// All state is disposable. Never loads .env or writes to Lightroom originals.
// STUDIO_PREPARED_SAMPLE_FILES optionally supplies two read-only local exports.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';
import {optimizePhoto} from '../server/image-optimizer.mjs';
import {encodePreparedPhoto} from '../server/prepared-photo.mjs';

const pw=await import(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright');
const directory=await mkdtemp(path.join(tmpdir(),'prepared-upload-browser-'));
const instance=await createApp({dataDir:directory,env:{},production:false});
let dropNextUpload=false,droppedStatus;
// A genuine lost response after saving retains WebKit's real multipart payload.
const server=createServer((req,res)=>{
 if(dropNextUpload&&req.method==='POST'&&/\/photos$/.test(req.url)){
  dropNextUpload=false;res.end=()=>{droppedStatus=res.statusCode;res.flushHeaders();res.write(' ');setTimeout(()=>res.destroy(),10);return res;};
 }
 instance.app(req,res);
}).listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browserName=process.env.STUDIO_BROWSER||'chromium';
const evidence=process.env.STUDIO_BROWSER_EVIDENCE_DIR
 ?path.resolve(process.env.STUDIO_BROWSER_EVIDENCE_DIR,'prepared-upload',browserName)
 :path.resolve('output/prepared-upload-review',browserName);
await mkdir(evidence,{recursive:true});
let browser;
try{
 const provided=process.env.STUDIO_PREPARED_SAMPLE_FILES?JSON.parse(process.env.STUDIO_PREPARED_SAMPLE_FILES):null;
 const samples=provided?await Promise.all(provided.map(file=>readFile(file))):await Promise.all([
  sharp({create:{width:3000,height:2000,channels:3,background:'#75907d'}}).jpeg().toBuffer(),
  sharp({create:{width:1800,height:2700,channels:3,background:'#b78c74'}}).jpeg().toBuffer()
 ]);
 assert.equal(samples.length,2,'Supply exactly two local samples');
 const originalName='CC - 0546.jpg';
 const optimized=await optimizePhoto(samples[0]);
 const bundle=encodePreparedPhoto({originalName,sourceHash:createHash('sha256').update(samples[0]).digest('hex'),...optimized});
 const prepared={name:'renamed-package.ccphoto',mimeType:'application/x-chicong-photo',buffer:bundle};
 const original={name:'direct-lightroom.jpg',mimeType:'image/jpeg',buffer:samples[1]};
 browser=await (pw[browserName]||pw.default[browserName]).launch({headless:true,...(browserName==='chromium'?{channel:'chrome'}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/admin');await page.getByLabel('Email quản trị').fill('prepared-browser@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('prepared-browser-password');await page.getByRole('button',{name:'Tạo tài khoản quản trị',exact:true}).click();
 await page.getByRole('button',{name:'Tạo bộ ảnh',exact:true}).click();
 const albumForm=page.locator('[data-form=album]');await albumForm.locator('[name=title]').fill('Ảnh tối ưu trên Mac');await albumForm.locator('[name=status]').selectOption('private');await albumForm.locator('[name=password]').fill('prepared-gallery-password');await albumForm.getByRole('button',{name:'Tạo bộ ảnh',exact:true}).click();await page.locator('[data-form=upload]').waitFor();await page.locator('[data-album-tool=sections]>summary').click();
 const albumId=new URL(page.url()).hash.slice('#album/'.length);
 for(const title of ['Chi tiết trang trí','Chân dung']){
  await page.getByRole('button',{name:'+ Thêm phần',exact:true}).click();await page.locator('[data-form=section] [name=title]').fill(title);await page.getByRole('button',{name:'Lưu phần',exact:true}).click();await page.locator('#editor').waitFor({state:'hidden'});await page.locator('.section-title strong').filter({hasText:title}).waitFor();
 }
 const sections=await instance.db.all('SELECT * FROM album_sections WHERE album_id=? ORDER BY position,id',[albumId]);
 const upload=page.locator('[data-form=upload]');assert.match(await upload.locator('[type=file]').getAttribute('accept'),/\.ccphoto/);
 await upload.locator('[name=section_id]').selectOption(sections[0].id);await upload.locator('[type=file]').setInputFiles([prepared,original]);
 assert.doesNotMatch(await upload.locator('.upload-selection').textContent(),/trước tối ưu/);
 await upload.getByRole('button',{name:'Tải ảnh lên',exact:true}).click();await page.locator('.upload-summary').filter({hasText:'Đã lưu 2/2'}).waitFor();
 const rows=await instance.db.all('SELECT * FROM photos WHERE album_id=? ORDER BY position,id',[albumId]);assert.equal(rows.length,2);const photo=rows.find(row=>row.original===originalName);assert.ok(photo,'Original filename comes from bundle, not renamed outer file');
 assert.equal(photo.source_bytes,samples[0].length);assert.equal(photo.width,optimized.optimization.width);assert.equal(photo.height,optimized.optimization.height);assert.ok(rows.every(row=>row.section_id===sections[0].id));
 assert.deepEqual(await instance.storage.get(photo.filename+'.webp'),optimized.data);assert.deepEqual(await instance.storage.get(photo.filename+'-thumb.webp'),optimized.thumbnail);assert.deepEqual(await instance.storage.get(photo.filename+'-download.jpg'),optimized.download);
 assert.equal(await page.locator('.manage-photo p').filter({hasText:originalName}).count(),1);assert.match(await page.locator('.upload-report').textContent(),/JPG tải về/);assert.equal(await upload.locator('.form-error').textContent(),'');
 console.log('PASS: Mixed prepared/original uploads, custom MIME, original filename, selected section, original byte report and byte-exact stored renditions');

 // The same prepared package can be safely resumed in its chosen destination.
 dropNextUpload=true;await upload.locator('[name=section_id]').selectOption(sections[1].id);await upload.locator('[type=file]').setInputFiles({...prepared,name:'retry.ccphoto',mimeType:'',buffer:encodePreparedPhoto({originalName:'retry-new.jpg',sourceHash:'c'.repeat(64),...optimized})});
 await upload.getByRole('button',{name:'Tải ảnh lên',exact:true}).click();await upload.locator('.form-error').filter({hasText:'Mã kiểm tra'}).waitFor();assert.equal(droppedStatus,201);assert.equal(await upload.locator('[name=section_id]').isDisabled(),true);
 const beforeRetry=await instance.db.all('SELECT id,section_id FROM photos WHERE album_id=? ORDER BY position,id',[albumId]);assert.equal(beforeRetry.length,3);assert.equal(beforeRetry[2].section_id,sections[1].id);
 await upload.getByRole('button',{name:'Tải lại các ảnh còn lại',exact:true}).click();await page.locator('.upload-summary').filter({hasText:'Đã lưu 1/1'}).waitFor();assert.deepEqual(await instance.db.all('SELECT id,section_id FROM photos WHERE album_id=? ORDER BY position,id',[albumId]),beforeRetry);assert.equal(await upload.locator('[name=section_id]').isDisabled(),false);
 console.log('PASS: Empty-MIME package, lost acknowledgement, destination lock and retry without duplicate');

 // Corrupt package errors remain per-file; a normal image in the same selection proceeds.
 await upload.locator('[name=section_id]').selectOption(sections[0].id);await upload.locator('[type=file]').setInputFiles([{name:'broken <img>.ccphoto',mimeType:'',buffer:Buffer.from('not a prepared photo')},{...original,name:'after-invalid.jpg'}]);
 await upload.getByRole('button',{name:'Tải ảnh lên',exact:true}).click();await upload.locator('.form-error').filter({hasText:'Đã lưu 1/2'}).waitFor();assert.equal(await page.locator('.upload-file-error').count(),1);assert.equal(await page.locator('.upload-file-error img').count(),0);assert.equal(await upload.locator('button').isDisabled(),true);assert.equal((await instance.db.all('SELECT id FROM photos WHERE album_id=?',[albumId])).length,4);
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Admin overflow at '+width);await page.locator('.upload-report').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,`upload-${width}.png`)});}
 if(process.env.STUDIO_AXE_MODULE){
  const {default:AxeBuilder}=await import(process.env.STUDIO_AXE_MODULE);
  const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  await writeFile(path.join(evidence,'accessibility.json'),JSON.stringify({enabled:true,scans:1,viewport:page.viewportSize(),violations:scan.violations,incomplete:scan.incomplete},null,2));
  assert.deepEqual(scan.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)})),[]);
 }else{
  await writeFile(path.join(evidence,'accessibility.json'),JSON.stringify({enabled:false,scans:0},null,2));
 }
 console.log('PASS: Corrupt package does not block original upload, escaped filename, retry state, responsive layout and optional accessibility scan');

 const customer=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true}),gallery=await customer.newPage();gallery.setDefaultTimeout(30000);gallery.on('pageerror',error=>errors.push(error.message));
 await gallery.goto(base+'/gallery/'+albumId);await gallery.getByLabel('Mật khẩu bộ ảnh').fill('prepared-gallery-password');await gallery.getByRole('button',{name:'Mở bộ ảnh',exact:true}).click();await gallery.locator('.client-toolbar').waitFor();
 await gallery.locator(`.pick[data-photo="${photo.id}"]`).click();await gallery.waitForFunction(id=>document.querySelector(`.pick[data-photo="${id}"]`)?.getAttribute('aria-pressed')==='true',photo.id);
 await gallery.getByRole('button',{name:'Tải ảnh đã lưu',exact:true}).click();await gallery.locator('#gallery-download').waitFor({state:'visible'});const event=gallery.waitForEvent('download');await gallery.locator('[data-download-part="0"]').click();const download=await event;assert.equal(await download.failure(),null);assert.match(download.suggestedFilename(),/CC - 0546\.jpg$/);assert.deepEqual(await readFile(await download.path()),optimized.download);
 const jpeg=await sharp(await readFile(await download.path())).metadata();assert.equal(jpeg.format,'jpeg');assert.equal(jpeg.width,optimized.optimization.width);assert.equal(jpeg.height,optimized.optimization.height);assert.deepEqual(errors,[]);
 console.log('PASS: Customer unlock, selection, real browser JPEG download with original filename and byte-exact local quality; no runtime errors');
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await instance.db.close();await rm(directory,{recursive:true,force:true});}
