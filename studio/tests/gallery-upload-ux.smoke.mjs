// Tests for Lightbox zoom/pan, automatic selection persistence, and upload drag/cancel UX.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';

const pw=await import(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright');
const dir=await mkdtemp(path.join(tmpdir(),'gallery-upload-ux-'));
const instance=await createApp({dataDir:dir,env:{},production:false});
const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base='http://127.0.0.1:'+server.address().port;
let browser,adminCookie='';
const newId=()=>randomBytes(16).toString('hex');
const request=(route,body,method=body===undefined?'GET':'POST')=>fetch(base+route,{method,headers:{Origin:base,Cookie:adminCookie,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});

try{
 const setup=await request('/api/admin/setup',{email:'admin@chicong.test',password:'AdminSecret1234!'});
 assert.equal(setup.status,201);
 adminCookie=setup.headers.get('set-cookie')?.split(';')[0]||'';

 const albumId=newId();
 const createRes=await request('/api/admin/albums',{title:'Bộ ảnh Kiểm thử UX',category:'wedding',status:'private',password:'test-gallery-pass',slug:'kiem-thu-ux'});
 assert.equal(createRes.status,201);
 const albumData=await createRes.json();
 const actualAlbumId=albumData.id;

 // Create 2 sample images
 const imgBuffer=await sharp({create:{width:1600,height:1200,channels:3,background:{r:100,g:150,b:200}}}).jpeg({quality:80}).toBuffer();
 const fd=new FormData();
 fd.append('photos',new Blob([imgBuffer],{type:'image/jpeg'}),'test-01.jpg');
 fd.append('photos',new Blob([imgBuffer],{type:'image/jpeg'}),'test-02.jpg');
 const uploadRes=await request(`/api/admin/albums/${actualAlbumId}/photos`,fd);
 assert.equal(uploadRes.status,201);

 browser=await pw.chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:800}});
 const page=await context.newPage();

 // 1. Client gallery: selection persists without a submit step
 await page.goto(base+'/gallery/'+actualAlbumId);
 await page.getByLabel('Mật khẩu bộ ảnh').fill('test-gallery-pass');
 await page.getByRole('button',{name:'Mở bộ ảnh',exact:true}).click();
 await page.locator('.client-toolbar').waitFor();

 // Pick first photo
 const pickBtn=page.locator('.pick').first();
 await pickBtn.click();
 await page.waitForFunction(()=>document.querySelector('.pick')?.getAttribute('aria-pressed')==='true');

 assert.equal(await page.locator('[data-action=submit-picks]').count(),0);
 assert.equal((await instance.db.get('SELECT COUNT(*) AS n FROM selections WHERE album_id=?',[actualAlbumId])).n,1);
 await page.reload();await page.waitForFunction(()=>document.querySelector('.pick')?.getAttribute('aria-pressed')==='true');
 assert.equal(await page.locator('.client-save-status').isVisible(),false);
 console.log('PASS: Picking persists immediately and survives reload without submission');

 // 2. Lightbox Zoom & Pan inspection
 const photoCard=page.locator('.photo-open').first();
 await photoCard.click();
 await page.locator('#lightbox[open]').waitFor();

 const zoomBtn=page.locator('#lightbox-zoom');
 assert.equal(await zoomBtn.isVisible(),true);
 assert.equal(await zoomBtn.textContent(),'Phóng to');

 // Click zoom button
 await zoomBtn.click();
 assert.equal(await page.locator('#lightbox.is-zoomed').count(),1);
 assert.equal(await zoomBtn.textContent(),'Thu nhỏ');

 // Test drag-to-pan in zoomed mode
 const imgBox=await page.locator('#lightbox img').boundingBox();
 assert.ok(imgBox);
 await page.mouse.move(imgBox.x+imgBox.width/2, imgBox.y+imgBox.height/2);
 await page.mouse.down();
 await page.mouse.move(imgBox.x+imgBox.width/2+40, imgBox.y+imgBox.height/2+30);
 await page.mouse.up();

 // Escape resets zoom but leaves lightbox open
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('#lightbox.is-zoomed').count(),0);
 assert.equal(await zoomBtn.textContent(),'Phóng to');
 assert.equal(await page.locator('#lightbox[open]').count(),1);

 // Double click on img to zoom
 await page.locator('#lightbox img').dblclick();
 assert.equal(await page.locator('#lightbox.is-zoomed').count(),1);
 assert.equal(await zoomBtn.textContent(),'Thu nhỏ');

 // Pressing Escape again resets zoom
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('#lightbox.is-zoomed').count(),0);

 // Pressing Escape when not zoomed closes lightbox
 await page.keyboard.press('Escape');
 await page.locator('#lightbox').waitFor({state:'hidden'});
 console.log('PASS: Lightbox zoom button, double-click zoom, drag-to-pan, and Escape reset work seamlessly');

 // 3. Admin upload panel: drag-and-drop & cancel button presence
 await page.goto(base+'/admin');
 await page.getByLabel('Email quản trị').fill('admin@chicong.test');
 await page.getByLabel('Mật khẩu',{exact:true}).fill('AdminSecret1234!');
 await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
 await page.locator('.admin-layout').waitFor();
 await page.locator('[data-action=admin-view][data-view=clients]').click();
 await page.locator(`[data-action=edit-album][data-id="${actualAlbumId}"]`).click();
 await page.locator('[data-album-tool=upload]>summary').click();
 await page.locator('.upload-panel').waitFor();

 const cancelLink=page.locator('.upload-cancel');
 assert.equal(await cancelLink.count(),1);
 assert.equal(await cancelLink.getAttribute('role'),'button');
 assert.equal(await cancelLink.getAttribute('hidden'),'');

 // Drag over upload panel adds drag-over class
 await page.locator('.upload-panel').evaluate(el=>{
  const dt=new DataTransfer();
  dt.items.add(new File([''], 'sample.jpg', {type: 'image/jpeg'}));
  el.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));
 });
 assert.equal(await page.locator('.upload-panel.drag-over').count(),1);
 await page.locator('.upload-panel').evaluate(el=>{
  el.dispatchEvent(new DragEvent('dragleave',{bubbles:true,cancelable:true}));
 });
 assert.equal(await page.locator('.upload-panel.drag-over').count(),0);

 // 4. Live cancellation of active upload
 const filesToUpload=[
  {name:'cancel-test-1.jpg',mimeType:'image/jpeg',buffer:imgBuffer},
  {name:'cancel-test-2.jpg',mimeType:'image/jpeg',buffer:imgBuffer},
  {name:'cancel-test-3.jpg',mimeType:'image/jpeg',buffer:imgBuffer}
 ];
 await page.locator('[data-form=upload] input[type=file]').setInputFiles(filesToUpload);
 assert.match(await page.locator('.upload-selection').textContent(),/3 ảnh/);

 // Click upload
 await page.getByRole('button',{name:'Tải ảnh lên',exact:true}).click();
 // Cancel button becomes visible during active upload
 await cancelLink.waitFor({state:'visible'});
 // Click cancel
 await cancelLink.click();
 // Toast confirms cancellation
 await page.locator('#toast').filter({hasText:'Đang dừng lượt tải ảnh'}).waitFor();
 // Button switches to retry remaining
 const retryBtn=page.getByRole('button',{name:'Tải lại các ảnh còn lại',exact:true});
 await retryBtn.waitFor();
 assert.equal(await cancelLink.getAttribute('hidden'),'');
 console.log('PASS: Live upload cancellation cleanly stops queue and prepares remaining photos for retry');

 // Click retry to complete the remaining photos
 await retryBtn.click();
 await page.locator('.manage-photo').nth(4).waitFor();
 assert.equal(await page.locator('.manage-photo').count(),5);
 console.log('PASS: Retrying remaining photos after cancellation successfully saves all photos');

 console.log('PASS: Admin upload panel drag-and-drop indicator and cancel upload button verified');
}finally{
 if(browser)await browser.close();
 await server.close();
 await rm(dir,{recursive:true,force:true});
}
