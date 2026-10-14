// Read-only public preview checks. Form submissions are intercepted, never delivered.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
const {chromium,webkit}=await import(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.STUDIO_PREVIEW_URL||'http://127.0.0.1:4173';
const evidence=process.env.STUDIO_BROWSER_EVIDENCE_DIR||'output/final-ui-audit/public';await mkdir(evidence,{recursive:true});
const albums=await(await fetch(base+'/api/portfolio')).json();assert.ok(albums.length,'Use a preview with published albums');
const albumRoute='/album/'+(albums[0].slug||albums[0].id);
const routes=['/','/portfolio',albumRoute,'/about','/contact'];
for(const [name,engine]of [['chromium',chromium],['webkit',webkit]]){
 const browser=await engine.launch({headless:true,...(name==='chromium'?{channel:'chrome'}:{})});
 const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:900});let invitation;
   for(const route of routes){
    await page.goto(base+route);await page.locator('#root').waitFor({state:'visible'});await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].filter(image=>image.getAttribute('src')&&image.getBoundingClientRect().top<innerHeight&&image.getBoundingClientRect().bottom>0).map(image=>image.decode()));});
    assert.equal(await page.locator('h1').count(),1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' '+route+' overflow '+width);
    if(route==='/contact')assert.equal(await page.locator('.footer-invitation').count(),0);
    else{const html=await page.locator('.footer-invitation').innerHTML();if(invitation)assert.equal(html,invitation);else invitation=html;assert.equal(await page.locator('.footer-invitation a').getAttribute('href'),'/contact');}
    if(route==='/'){assert.equal(await page.locator('.medium-note').count(),0);assert.equal(await page.locator('.note-section').count(),1);}
    if(route===albumRoute)assert.equal(await page.locator('.album-title .album-line,.album-title a,.album-consult,.editorial-photos .section-tabs button span').count(),0);
    if([390,1440].includes(width))await page.screenshot({path:path.join(evidence,`${name}-${route==='/'?'home':route.startsWith('/album/')?'album':route.slice(1)}-${width}.png`)});
   }
  }
  for(const route of ['/about/','/contact/']){await page.goto(base+route);await page.locator('#root').waitFor({state:'visible'});assert.equal(await page.locator('#nav-links [aria-current=page]').getAttribute('href'),route.slice(0,-1));if(route==='/contact/')assert.equal(await page.locator('.footer-invitation').count(),0);}
  await page.setViewportSize({width:390,height:844});await page.goto(base+'/');await page.locator('.mobile-menu').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.mobile-menu').getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');assert.equal(await page.locator('.mobile-menu').getAttribute('aria-expanded'),'false');assert.ok(await page.locator('.mobile-menu').evaluate(e=>e===document.activeElement));
  await page.goto(base+albumRoute);await page.locator('.photo-open').first().focus();await page.keyboard.press('Enter');await page.locator('#lightbox[open]').waitFor();const first=await page.locator('#lightbox img').getAttribute('src');await page.keyboard.press('ArrowRight');assert.notEqual(await page.locator('#lightbox img').getAttribute('src'),first);await page.keyboard.press('Escape');await page.locator('#lightbox').waitFor({state:'hidden'});assert.ok(await page.locator('.photo-open').first().evaluate(e=>e===document.activeElement));
  for(const album of albums){
   const description=album.description||'',at=description.search(/Photographed for|Photography by|Wedding photography by|Ảnh: Chí Công/);if(at<0)continue;
   await page.goto(base+'/album/'+(album.slug||album.id));await page.locator('.album-credit').waitFor();assert.equal((await page.locator('.album-credit').innerText()).trim(),description.slice(at).trim());
  }
  // Availability must not block the form or discard a draft when it fails/retries.
  let release;const gate=new Promise(r=>release=r);
  await page.route('**/api/availability',async route=>{await gate;await route.fulfill({status:503,contentType:'application/json',body:'{"error":"calendar offline"}'});});
  try{
   await page.goto(base+'/contact',{waitUntil:'domcontentloaded'});await page.locator('#booking-form').waitFor({state:'visible',timeout:5000});await page.locator('[name=name]').fill('Khách kiểm thử');assert.match(await page.locator('#booking-calendar').innerText(),/Đang tải lịch/);
  }finally{release();}
  await page.locator('[data-action=retry-calendar]').waitFor();assert.equal(await page.locator('[name=name]').inputValue(),'Khách kiểm thử');await page.unroute('**/api/availability');await page.locator('[data-action=retry-calendar]').click();await page.locator('.calendar-heading').waitFor();assert.equal(await page.locator('[name=name]').inputValue(),'Khách kiểm thử');
  await page.locator('[name=message]').fill('Mình muốn trao đổi về ngày cưới.');await page.locator('#booking-form [type=submit]').click();await page.locator('[name=email][aria-invalid=true]').waitFor();
  await page.locator('[name=phone]').fill('123');await page.locator('#booking-form [type=submit]').click();await page.locator('[name=phone][aria-invalid=true]').waitFor();await page.locator('[name=phone]').fill('0900000000');await page.locator('[name=service]').selectOption({label:'Film'});
  const payloads=[];let attempts=0;
  await page.route('**/api/inquiries',async route=>{payloads.push(route.request().postDataJSON());attempts++;await route.fulfill({status:attempts===1?503:201,contentType:'application/json',body:JSON.stringify(attempts===1?{error:'Chưa gửi được lời nhắn. Vui lòng thử lại.'}:{reference:'LOCAL-TEST'})});});
  await page.locator('#booking-form [type=submit]').click();await page.locator('.form-error').filter({hasText:'Chưa gửi được'}).waitFor();assert.equal(await page.locator('[name=message]').inputValue(),'Mình muốn trao đổi về ngày cưới.');
  await page.locator('#booking-form [type=submit]').click();await page.locator('.booking-success').waitFor();assert.match(await page.locator('.booking-success').innerText(),/Mình đã nhận lời nhắn/);assert.ok(await page.locator('.booking-success').evaluate(e=>e===document.activeElement));
  assert.equal(payloads[0].requestKey,payloads[1].requestKey);assert.equal(payloads[1].service,'Chụp ảnh cưới bằng film');assert.equal(payloads[1].date,'');assert.equal(payloads[1].budget,'');assert.deepEqual(errors,[]);
  console.log('PASS '+name+': 320–1440px, shared invitation, menu + lightbox keyboard/focus, all album credits, calendar loading/failure/retry without blocking form, contact validation/retry/success and stable API values.');
 }finally{await browser.close();}
}
