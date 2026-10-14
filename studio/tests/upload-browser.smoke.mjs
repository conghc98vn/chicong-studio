// Optional STUDIO_UPLOAD_SAMPLE_FILES is a JSON array of local Lightroom exports.
// The application, database, uploads and browser sessions are disposable.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {maxUploadBytes} from '../web/upload-policy.mjs';
import {largeJpeg} from './fixtures/large-photo.mjs';
import {createApp} from '../server/app.mjs';
const pw=await import(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright');
const dir=await mkdtemp(path.join(tmpdir(),'upload-browser-')),app=await createApp({dataDir:dir,env:{}});
let responseFault=null;
// Faults happen after the real server has received and saved the multipart body.
// WebKit route.fetch omits file payloads, so it cannot simulate this reliably.
const server=createServer((req,res)=>{
 const fault=responseFault;if(fault&&req.method==='POST'&&req.url.endsWith(fault.path)){responseFault=null;const end=res.end.bind(res);res.end=(...args)=>{fault.status=res.statusCode;if(fault.mode==='drop'){res.flushHeaders();res.write(' ');setTimeout(()=>res.destroy(),10);}else if(fault.mode==='incomplete'){res.removeHeader('Content-Length');end(JSON.stringify({uploaded:1,results:[]}));}else setTimeout(()=>end(...args),13000);return res;};}
 app.app(req,res);
}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const evidence=path.resolve('output/upload-review');await mkdir(evidence,{recursive:true});let browser;
try{
 const samples=process.env.STUDIO_UPLOAD_SAMPLE_FILES?await Promise.all(JSON.parse(process.env.STUDIO_UPLOAD_SAMPLE_FILES).map(async file=>({name:path.basename(file),mimeType:'image/jpeg',buffer:await readFile(file)}))):[{name:'test.jpg',mimeType:'image/jpeg',buffer:await sharp({create:{width:3000,height:2000,channels:3,background:'#687b69'}}).jpeg().toBuffer()}];
 const browserName=process.env.STUDIO_BROWSER||'chromium';browser=await (pw[browserName]||pw.default[browserName]).launch({headless:true,...(browserName==='chromium'?{channel:'chrome'}:{})});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/admin');await page.getByLabel('Email quản trị').fill('upload-browser@example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('upload-browser-password');await page.getByRole('button',{name:'Tạo tài khoản quản trị',exact:true}).click();
 await page.getByRole('button',{name:'Tạo bộ ảnh',exact:true}).click();await page.locator('[data-form=album] [name=title]').fill('Kiểm tra ảnh Lightroom');await page.locator('[data-form=album] [name=status]').selectOption('published');await page.locator('[data-form=album]').getByRole('button',{name:'Tạo bộ ảnh',exact:true}).click();await page.locator('[data-form=upload]').waitFor();
 const album=new URL(page.url()).hash.slice('#album/'.length),upload=page.locator('[data-form=upload]');
 await upload.locator('input[type=file]').setInputFiles([...samples,{name:'broken <img>.jpg',mimeType:'image/jpeg',buffer:Buffer.from('bad')}]);
 await page.getByRole('button',{name:'Tải ảnh lên',exact:true}).click();await page.locator('.form-error').filter({hasText:`Đã lưu ${samples.length}/${samples.length+1}`}).waitFor();
 assert.equal(await page.locator('.manage-photo').count(),samples.length);assert.equal(await page.locator('[data-form=upload] button').isEnabled(),false);assert.equal(await page.locator('.upload-file-error img').count(),0);assert.match(await page.locator('.upload-report').textContent(),/Không đọc được ảnh/);
 const rows=await app.db.all('SELECT * FROM photos WHERE album_id=? ORDER BY position,id',[album]);for(let i=0;i<rows.length;i++){assert.equal(rows[i].source_bytes,samples[i].buffer.length);assert.ok(rows[i].image_bytes>0&&rows[i].thumb_bytes>0);assert.ok(Math.max(rows[i].width,rows[i].height)<=2400);}
 console.log('PASS: Real inputs, partial success, per-file errors and persistent byte measurements');
 // Lost acknowledgement: server stores first, browser sees failure, retry reuses id + metrics.
 const lostFault={path:'/photos',mode:'drop'};responseFault=lostFault;
 await upload.locator('input[type=file]').setInputFiles(samples[0]);await page.getByRole('button',{name:'Tải ảnh lên',exact:true}).click();await page.locator('.form-error').filter({hasText:'Mã kiểm tra'}).waitFor();
 assert.equal(lostFault.status,201);const before=await app.db.all('SELECT id FROM photos WHERE album_id=?',[album]);await page.getByRole('button',{name:'Tải lại các ảnh còn lại',exact:true}).click();await page.locator('.upload-summary').filter({hasText:'Đã lưu 1/1'}).waitFor();
 assert.equal((await app.db.all('SELECT id FROM photos WHERE album_id=?',[album])).length,before.length);assert.match(await page.locator('.upload-report').textContent(),/Bản web/);
 console.log('PASS: Lost response retry keeps one photo and its size report');
 // Even valid 2xx JSON must identify the acknowledged file; otherwise retain the
 // selection/key and stop before uploading the next file in the chosen batch.
 const incompleteFault={path:'/photos',mode:'incomplete'};responseFault=incompleteFault;
 const beforeIncomplete=(await app.db.all('SELECT id FROM photos WHERE album_id=?',[album])).length;
 await upload.locator('input[type=file]').setInputFiles([samples[0],{...samples[0],name:'next-after-ack.jpg'}]);await page.getByRole('button',{name:'Tải ảnh lên',exact:true}).click();
 await upload.locator('.form-error').filter({hasText:'chưa xác nhận đầy đủ'}).waitFor();assert.equal(incompleteFault.status,201);assert.equal((await app.db.all('SELECT id FROM photos WHERE album_id=?',[album])).length,beforeIncomplete+1);assert.match(await page.locator('.upload-file-error').textContent(),/chưa xác nhận đầy đủ/);assert.match(await page.locator('.upload-summary').textContent(),/Đã lưu 0\/2/);
 await page.getByRole('button',{name:'Tải lại các ảnh còn lại',exact:true}).click();await page.locator('.upload-summary').filter({hasText:'Đã lưu 2/2'}).waitFor();assert.equal((await app.db.all('SELECT id FROM photos WHERE album_id=?',[album])).length,beforeIncomplete+2);
 console.log('PASS: Incomplete 2xx acknowledgement stops the queue and retry retains both file identities without duplication');
 // Slow hosting: a saved upload can take longer than the normal 12-second API budget.
 const delayedFault={path:'/photos',mode:'delay'};responseFault=delayedFault;
 await upload.locator('input[type=file]').setInputFiles(samples[0]);await page.getByRole('button',{name:'Tải ảnh lên',exact:true}).click();
 await page.locator('.upload-summary').filter({hasText:'Đã lưu 1/1'}).waitFor({timeout:30000});assert.equal(delayedFault.status,201);assert.equal(await page.locator('[data-form=upload] .form-error').textContent(),'');
 console.log('PASS: Slow upload response beyond 12 seconds is acknowledged without false network error');
 // A real JPEG larger than 10 MiB must pass browser validation and server processing.
 const large=await largeJpeg();await upload.locator('input[type=file]').setInputFiles({name:'large-lightroom.jpg',mimeType:'image/jpeg',buffer:large});await page.getByRole('button',{name:'Tải ảnh lên',exact:true}).click();await page.locator('.upload-progress').filter({hasText:'đang chờ máy chủ'}).waitFor();await page.locator('.upload-progress').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,'upload-processing-progress.png')});await page.locator('.upload-summary').filter({hasText:'Đã lưu 1/1'}).waitFor({timeout:60000});assert.equal((await app.db.get('SELECT source_bytes FROM photos WHERE album_id=? AND original=?',[album,'large-lightroom.jpg'])).source_bytes,large.length);
 console.log('PASS: Real JPEG above 10 MiB uploads, optimizes and reports stored sizes');
 // A too-large file must never block a valid file or leave the user with a generic failure.
 const count=(await app.db.all('SELECT id FROM photos WHERE album_id=?',[album])).length;await page.locator('[data-form=upload] input[type=file]').setInputFiles([{name:'too-large.jpg',mimeType:'image/jpeg',buffer:Buffer.alloc(maxUploadBytes+1)},samples[0]]);await page.getByRole('button',{name:'Tải ảnh lên',exact:true}).click();await page.locator('.form-error').filter({hasText:'Đã lưu 1/2'}).waitFor();assert.match(await page.locator('.upload-file-error').textContent(),/20 MB/);assert.equal((await app.db.all('SELECT id FROM photos WHERE album_id=?',[album])).length,count+1);
 console.log('PASS: Oversized file is skipped while valid input uploads');
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Overflow at '+width);await page.locator('.upload-report').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,`upload-result-${width}.png`)});}
 if(process.env.STUDIO_AXE_MODULE){const {default:AxeBuilder}=await import(process.env.STUDIO_AXE_MODULE);const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();await writeFile(path.join(evidence,'accessibility.json'),JSON.stringify({violations:result.violations,incomplete:result.incomplete},null,2));assert.deepEqual(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);}
 await page.reload();await page.locator('.manage-photo').first().waitFor();assert.equal(await page.locator('.photo-size').count(),count+1);
 await page.goto(base+'/album/'+album);await page.locator('.photo-open').first().click();const lightbox=page.locator('#lightbox img');await lightbox.waitFor({state:'visible'});await lightbox.evaluate(el=>el.decode());assert.ok(await lightbox.evaluate(el=>el.naturalWidth>0));await page.screenshot({path:path.join(evidence,'lightbox-real-photo.png')});
 // Settings must accept the same large file and use the upload timeout too.
 await page.goto(base+'/admin#settings');const portraitForm=page.locator('[data-form=portrait]');await portraitForm.waitFor();assert.match(await portraitForm.textContent(),/20 MB/);
 responseFault={path:'/portrait',mode:'delay'};
 await portraitForm.locator('input[type=file]').setInputFiles({name:'large-portrait.jpg',mimeType:'image/jpeg',buffer:large});await portraitForm.getByRole('button',{name:'Tải ảnh chân dung lên',exact:true}).click();
 await page.locator('.portrait-preview').waitFor({timeout:40000});await page.locator('.portrait-preview').evaluate(el=>el.decode());assert.equal(await page.locator('[data-form=portrait] .form-error').textContent(),'');
 console.log('PASS: Settings accepts JPEG above 10 MiB with delayed acknowledgement and a decoded portrait preview');
 assert.deepEqual(errors,[]);console.log('PASS: 320/390/768/1440 responsive results, accessibility, metrics after reload, lightbox and no runtime errors');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await app.db.close();await rm(dir,{recursive:true,force:true});}
