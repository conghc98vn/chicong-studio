import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';

const pw=await import(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright');
const dir=await mkdtemp(path.join(tmpdir(),'gallery-password-flow-'));
const instance=await createApp({dataDir:dir,env:{},production:false});
const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base='http://127.0.0.1:'+server.address().port;
let browser;

try{
 browser=await pw.chromium.launch({channel:'chrome',headless:true});

 // 1. Setup Admin Account
 const adminContext=await browser.newContext({viewport:{width:1440,height:900}});
 const adminPage=await adminContext.newPage();
 await adminPage.goto(base+'/admin');
 await adminPage.getByLabel('Email quản trị').fill('admin@chicong.test');
 await adminPage.getByLabel('Mật khẩu',{exact:true}).fill('AdminPass12345!');
 await adminPage.getByRole('button',{name:'Tạo tài khoản quản trị',exact:true}).click();
 await adminPage.locator('.admin-layout').waitFor();

 // 2. Create Album WITHOUT password (uncheck require_password)
 await adminPage.getByRole('button',{name:'Tạo bộ ảnh',exact:true}).click();
 const form=adminPage.locator('[data-form=album]');
 await form.locator('[name=title]').fill('Bộ ảnh cưới Hoàng & Mai');
 await form.locator('[name=status]').selectOption('private');
 
 const requirePwCheck=form.locator('[name=require_password]');
 assert.equal(await requirePwCheck.isChecked(),true);
 // Uncheck password requirement
 await requirePwCheck.uncheck();
 assert.equal(await form.locator('.password-field').isHidden(),true);
 await form.getByRole('button',{name:'Tạo bộ ảnh',exact:true}).click();

 // Verify Album Detail shows "Không cần mật khẩu" and "Xem trên web"
 await adminPage.locator('.album-detail-top').waitFor();
 assert.match(await adminPage.locator('.badge.no-password').textContent(),/Không cần mật khẩu/);
 const webLink=adminPage.locator('.album-detail-top a.underlink[href^="/gallery/"]');
 assert.equal(await webLink.count(),1);
 const albumUrl=await webLink.getAttribute('href');
 const albumId=albumUrl.split('/')[2];

 // 3. Upload a sample photo
 const imgBuffer=await sharp({create:{width:1200,height:800,channels:3,background:{r:200,g:120,b:80}}}).jpeg().toBuffer();
 await adminPage.locator('[data-form=upload] input[type=file]').setInputFiles([
  {name:'wedding-01.jpg',mimeType:'image/jpeg',buffer:imgBuffer}
 ]);
 await adminPage.getByRole('button',{name:'Tải ảnh lên',exact:true}).click();
 await adminPage.locator('.manage-photo').waitFor();
 assert.equal(await adminPage.locator('.manage-photo').count(),1);

 // Test Copy Link toast
 await adminPage.locator('[data-action=copy-link]').click();
 await adminPage.locator('#toast').filter({hasText:'Đã sao chép đường dẫn bộ ảnh cho khách.'}).waitFor();
 console.log('PASS: Admin album creation without password & copy link toast verified');

 // 4. Client visits gallery directly in a clean incognito context
 const clientContext1=await browser.newContext({viewport:{width:1280,height:800},acceptDownloads:true});
 const clientPage1=await clientContext1.newPage();
 await clientPage1.goto(base+albumUrl);

 // Verify gallery is unlocked immediately (no password prompt)
 await clientPage1.locator('.client-toolbar').waitFor();
 assert.equal(await clientPage1.locator('[data-form=unlock]').count(),0);
 assert.equal(await clientPage1.locator('[data-action=lock-gallery]').count(),0);
 assert.equal(await clientPage1.locator('.photo-item').count(),1);
 console.log('PASS: Client directly accesses password-free gallery without lock screen');

 // 5. Client picks photo, downloads single photo, and submits selection
 const photoItem=clientPage1.locator('.photo-item').first();
 const pickBtn=photoItem.locator('.pick');
 await pickBtn.click();
 await clientPage1.waitForFunction(()=>document.querySelector('.pick')?.getAttribute('aria-pressed')==='true');

 // Open lightbox
 await photoItem.locator('.photo-open').click();
 await clientPage1.locator('#lightbox[open]').waitFor();

 // Single download
 const dlPromise=clientPage1.waitForEvent('download');
 await clientPage1.locator('#lightbox-download').click();
 const downloadedFile=await dlPromise;
 assert.match(downloadedFile.suggestedFilename(),/\.jpg$/i);

 // Close lightbox
 await clientPage1.keyboard.press('Escape');
 await clientPage1.locator('#lightbox').waitFor({state:'hidden'});

 // Submit picks with confirmation dialog
 await clientPage1.locator('[data-action=submit-picks]').click();
 await clientPage1.locator('#editor[open]').waitFor();
 await clientPage1.locator('[data-action=confirm-submit-picks]').click();
 await clientPage1.locator('.success-note').waitFor();
 console.log('PASS: Client pick, lightbox, single download, and submit picks work on password-free gallery');

 // 6. Admin updates album to REQUIRE password
 await adminPage.locator('[data-action=album-settings]').click();
 await adminPage.locator('#editor[open]').waitFor();
 const editForm=adminPage.locator('[data-form=album]');
 const editPwCheck=editForm.locator('[name=require_password]');
 assert.equal(await editPwCheck.isChecked(),false);
 await editPwCheck.check();
 await editForm.locator('[name=password]').fill('Secr3tPassword!');
 await editForm.getByRole('button',{name:'Lưu thay đổi',exact:true}).click();
 await adminPage.locator('#editor').waitFor({state:'hidden'});

 // Verify admin view shows "Có mật khẩu" badge
 await adminPage.locator('.badge.has-password').waitFor();
 assert.match(await adminPage.locator('.badge.has-password').textContent(),/Có mật khẩu/);
 console.log('PASS: Admin successfully updated album to require password');

 // 7. Client visits in a fresh context -> must be locked
 const clientContext2=await browser.newContext({viewport:{width:1280,height:800}});
 const clientPage2=await clientContext2.newPage();
 await clientPage2.goto(base+albumUrl);
 await clientPage2.locator('[data-form=unlock]').waitFor();

 // Enter wrong password
 await clientPage2.getByLabel('Mật khẩu bộ ảnh').fill('WrongPassword!');
 await clientPage2.getByRole('button',{name:'Mở bộ ảnh',exact:true}).click();
 await clientPage2.locator('.form-error').filter({hasText:'Mật khẩu chưa đúng'}).waitFor();

 // Enter correct password
 await clientPage2.getByLabel('Mật khẩu bộ ảnh').fill('Secr3tPassword!');
 await clientPage2.getByRole('button',{name:'Mở bộ ảnh',exact:true}).click();
 await clientPage2.locator('.client-toolbar').waitFor();
 assert.equal(await clientPage2.locator('.photo-item').count(),1);

 // Verify lock button exists and works
 const lockBtn=clientPage2.locator('[data-action=lock-gallery]');
 assert.equal(await lockBtn.count(),1);
 await lockBtn.click();
 await clientPage2.locator('[data-form=unlock]').waitFor();
 console.log('PASS: Password protection, invalid rejection, correct unlock, and relocking verified');

 // 8. Admin removes password again
 await adminPage.locator('[data-action=album-settings]').click();
 await adminPage.locator('#editor[open]').waitFor();
 const editForm2=adminPage.locator('[data-form=album]');
 await editForm2.locator('[name=require_password]').uncheck();
 await editForm2.getByRole('button',{name:'Lưu thay đổi',exact:true}).click();
 await adminPage.locator('#editor').waitFor({state:'hidden'});
 await adminPage.locator('.badge.no-password').waitFor();

 // Client opens in new context -> opens directly without password again!
 const clientContext3=await browser.newContext({viewport:{width:1280,height:800}});
 const clientPage3=await clientContext3.newPage();
 await clientPage3.goto(base+albumUrl);
 await clientPage3.locator('.client-toolbar').waitFor();
 assert.equal(await clientPage3.locator('[data-form=unlock]').count(),0);
 console.log('PASS: Removing password restores immediate direct access for clients');

}finally{
 if(browser)await browser.close();
 await server.close();
 await rm(dir,{recursive:true,force:true});
}
