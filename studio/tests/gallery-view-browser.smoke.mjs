// Explicitly isolated: no .env, no production data, and all fixtures removed on exit.
// Run with STUDIO_PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs when externally installed.
// Optional STUDIO_GALLERY_ASSETS_DIR points to a BEFORE snapshot of studio/web.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import express from 'express';
import {createApp} from '../server/app.mjs';
import {hashPassword} from '../server/db.mjs';

const pw=await import(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright');
const dir=await mkdtemp(path.join(tmpdir(),'gallery-view-browser-'));
const evidence=path.resolve(process.env.STUDIO_BROWSER_EVIDENCE_DIR||'output/gallery-view-review');
const baseline=!!process.env.STUDIO_GALLERY_ASSETS_DIR;
const quick=!!process.env.STUDIO_GALLERY_QUICK;
const slow=!!process.env.STUDIO_GALLERY_SLOW;
const measureOnly=!!process.env.STUDIO_GALLERY_MEASURE_ONLY;
const instance=await createApp({dataDir:dir,env:{},production:false});
const fixtureApp=express();
if(baseline){
 fixtureApp.use('/app',express.static(process.env.STUDIO_GALLERY_ASSETS_DIR,{maxAge:0,index:false}));
 const originalLightbox=(await readFile(path.join(process.env.STUDIO_GALLERY_ASSETS_DIR,'index.html'),'utf8')).match(/<dialog id="lightbox"[\s\S]*?<\/dialog>/)[0];
 fixtureApp.use((req,res,next)=>{if(/^\/(gallery|album)\//.test(req.path)){const send=res.send.bind(res);res.send=body=>send(typeof body==='string'?body.replace(/<dialog id="lightbox"[\s\S]*?<\/dialog>/,originalLightbox):body);}next();});
}
fixtureApp.use(instance.app);
const singleRequests=[];
const server=fixtureApp.listen(0,'127.0.0.1');server.on('request',req=>{if(/\/photos\/.+\/download$/.test(req.originalUrl||req.url))singleRequests.push(req.originalUrl||req.url);});
await new Promise(resolve=>server.once('listening',resolve));
const base='http://127.0.0.1:'+server.address().port;
await mkdir(evidence,{recursive:true});
const albumId='a'.repeat(32),sectionIds=['b'.repeat(32),'c'.repeat(32)],id=index=>(index+1).toString(16).padStart(32,'0');
const results={baseline,fixture:{photos:900,note:'Deterministic synthetic textured images; local HTTP, no cloud/CDN or real device performance claims.'},checks:[],viewports:[],errors:[]};
const check=(name,passed,details)=>{results.checks.push({name,passed:!!passed,...(details===undefined?{}:{details})});console.log(`${passed?'PASS':'FAIL'}: ${name}${details===undefined?'':' '+JSON.stringify(details)}`);};
let browser;

try{
 await instance.db.run('INSERT INTO albums(id,slug,title,category,status,password,description,event_date,created) VALUES(?,?,?,?,?,?,?,?,?)',[albumId,'review-gallery','Minh & An — Ngày chung đôi','wedding','private',hashPassword('browser-gallery-password'),'Bộ ảnh kiểm thử riêng: 900 ảnh ngang, dọc và vuông.','2026-10-15',new Date().toISOString()]);
 for(const [index,section] of sectionIds.entries())await instance.db.run('INSERT INTO album_sections(id,album_id,title,position) VALUES(?,?,?,?)',[section,albumId,index?'Tiệc cưới':'Lễ gia tiên',index]);
 const variants=[];
 for(const [index,[width,height]] of [[1800,1200],[1200,1800],[1600,1600]].entries()){
  // A fixed seed produces repeatable texture and meaningful encoded byte sizes.
  const buffer=Buffer.alloc(width*height*3);let seed=57+index;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=(seed>>>24)/8;
   const offset=(y*width+x)*3;buffer[offset]=Math.min(255,135+x/width*75+noise);buffer[offset+1]=Math.min(255,105+y/height*80+noise);buffer[offset+2]=Math.min(255,90+x/width*40+noise);
  }
  const filename=(index+10000).toString(16).padStart(32,'0');const image=sharp(buffer,{raw:{width,height,channels:3}});
  const [full,thumb,jpeg]=await Promise.all([image.clone().webp({quality:82}).toBuffer(),image.clone().resize({width:900,height:900,fit:'inside'}).webp({quality:76}).toBuffer(),image.clone().jpeg({quality:90}).toBuffer()]);
  await Promise.all([instance.storage.put(filename+'.webp',full),instance.storage.put(filename+'-thumb.webp',thumb),instance.storage.put(filename+'-download.jpg',jpeg)]);
  variants.push({filename,width,height,bytes:full.length,thumbBytes:thumb.length,downloadBytes:jpeg.length});
 }
 results.fixture.variants=variants;
 for(let index=0;index<900;index++){
  const v=variants[index%3];await instance.db.run('INSERT INTO photos(id,album_id,filename,original,caption,width,height,position,section_id,download_bytes) VALUES(?,?,?,?,?,?,?,?,?,?)',[id(index),albumId,v.filename,`photo-${String(index+1).padStart(4,'0')}.jpg`,`Khoảnh khắc ${String(index+1).padStart(4,'0')}`,v.width,v.height,index,sectionIds[index<450?0:1],v.downloadBytes]);
 }
 browser=await pw.chromium.launch({channel:'chrome',headless:true});results.browser=browser.version();
 for(const viewport of (quick?[{width:1440,height:1000,dpr:1}]:[{width:1440,height:1000,dpr:1},{width:390,height:844,dpr:2},{width:320,height:740,dpr:2}])){
  const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},deviceScaleFactor:viewport.dpr,hasTouch:viewport.width<750,acceptDownloads:true});
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>results.errors.push(error.message));
  await page.addInitScript(()=>{
   window.reviewPerf={cls:0,longTasks:[],shifts:[]};
   new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!entry.hadRecentInput){reviewPerf.cls+=entry.value;reviewPerf.shifts.push({value:entry.value,time:entry.startTime,sources:entry.sources.map(source=>({node:source.node?.className||source.node?.nodeName,previous:source.previousRect.toJSON(),current:source.currentRect.toJSON()}))});}}).observe({type:'layout-shift',buffered:true});
   new PerformanceObserver(list=>{for(const entry of list.getEntries())reviewPerf.longTasks.push({duration:entry.duration,time:entry.startTime});}).observe({type:'longtask',buffered:true});
  });
  const unlocked=await context.request.post(base+'/api/gallery/'+albumId+'/unlock',{headers:{Origin:base},data:{password:'browser-gallery-password'}});assert.equal(unlocked.status(),200);
  const requestUrls=[];page.on('request',request=>{if(request.url().includes('/media/'))requestUrls.push(request.url());});
  const start=performance.now();await page.goto(base+'/gallery/'+albumId);await page.locator('.client-toolbar').waitFor();const readyMs=performance.now()-start;
  await page.waitForTimeout(700);
  const initial=await page.evaluate(()=>({
   ...reviewPerf,photoCount:document.querySelectorAll('.photo-item').length,nodeCount:document.querySelectorAll('*').length,
   domOrder:[...document.querySelectorAll('.photo-open')].slice(0,12).map(element=>element.dataset.photo),
   gridImages:[...document.querySelectorAll('.photo-open img')].filter(image=>image.complete&&image.naturalWidth).length,
   mediaResources:performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/media/')).map(entry=>({url:entry.name,bytes:entry.transferSize,duration:entry.duration})),
   overflow:document.documentElement.scrollWidth>innerWidth,
   toolbar:(()=>{const r=document.querySelector('.client-toolbar').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};})()
  }));
  const metric={...viewport,readyMs,initialMediaRequests:requestUrls.length,...initial};results.viewports.push(metric);
  check(`all 900 photos rendered at ${viewport.width}`,initial.photoCount===900);
  check(`chronological DOM and keyboard order at ${viewport.width}`,initial.domOrder.every((photo,index)=>photo===id(index)),initial.domOrder.map(photo=>parseInt(photo,16)));
  check(`bounded initial image requests at ${viewport.width}`,requestUrls.length<60,requestUrls.length);
  if(!baseline)check(`download modules stay off the initial viewing path at ${viewport.width}`,await page.evaluate(()=>!performance.getEntriesByType('resource').some(entry=>/\/(photo|gallery)-download\.mjs/.test(entry.name))));
  check(`no gallery overflow at ${viewport.width}`,!initial.overflow);
  check(`low initial layout shift at ${viewport.width}`,initial.cls<=0.1,initial.cls);
  await page.screenshot({path:path.join(evidence,`gallery-${viewport.width}.png`)});
  if(measureOnly){await context.close();continue;}

  const first=page.locator(`.photo-open[data-photo="${id(0)}"]`);await first.focus();await page.keyboard.press('Tab');await page.keyboard.press('Tab');
  check(`Tab reaches next logical photo at ${viewport.width}`,await page.evaluate(expected=>document.activeElement?.dataset.photo===expected,id(1)));
  await first.click();await page.locator('#lightbox[open]').waitFor();await page.waitForFunction(()=>document.querySelector('#lightbox img').complete);
  check(`lightbox starts on clicked photo at ${viewport.width}`,(await page.locator('#lightbox figcaption').textContent()).includes('0001'));
  await page.waitForTimeout(350);
  await page.keyboard.press('ArrowRight');check(`keyboard next at ${viewport.width}`,(await page.locator('#lightbox figcaption').textContent()).includes('0002'));
  await page.waitForFunction(()=>document.querySelector('#lightbox img').complete&&document.querySelector('#lightbox img').naturalWidth>0);
  await page.locator('#lightbox img').evaluate(el=>el.decode());
  metric.lightboxPortrait=await page.locator('#lightbox img').evaluate(el=>({src:el.currentSrc,naturalWidth:el.naturalWidth,naturalHeight:el.naturalHeight,box:{width:el.clientWidth,height:el.clientHeight},sizes:el.sizes,dialog:document.querySelector('#lightbox').getBoundingClientRect().toJSON(),scrollY,viewport:innerHeight}));
  metric.portraitMediaRequests=requestUrls.filter(url=>url===metric.lightboxPortrait.src).length;
  check(`portrait source is reused rather than downloaded twice at ${viewport.width}`,metric.portraitMediaRequests<=1,metric.portraitMediaRequests);
  check(`portrait lightbox stays inside viewport at ${viewport.width}`,metric.lightboxPortrait.dialog.top>=-1&&metric.lightboxPortrait.dialog.bottom<=viewport.height+1,{top:metric.lightboxPortrait.dialog.top,bottom:metric.lightboxPortrait.dialog.bottom,height:viewport.height});
  await page.screenshot({path:path.join(evidence,`lightbox-portrait-${viewport.width}.png`)});
  await page.keyboard.press('ArrowLeft');check(`keyboard previous at ${viewport.width}`,(await page.locator('#lightbox figcaption').textContent()).includes('0001'));
  const image=await page.locator('#lightbox img').boundingBox();const cx=image.x+image.width/2,cy=image.y+image.height/2;
  // Real touch events exercise browser pointer capture, compatibility clicks and pan cancellation.
  if(viewport.width<750){
   const cdp=await context.newCDPSession(page);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx+55,y:cy}]});
   for(let step=1;step<=6;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx+55-step*110/6,y:cy}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  }else{
   await page.mouse.move(cx+55,cy);await page.mouse.down();await page.mouse.move(cx-55,cy,{steps:6});await page.mouse.up();
  }
  check(`swipe keeps lightbox open at ${viewport.width}`,await page.locator('#lightbox').evaluate(el=>el.open));
  check(`${viewport.width<750?'touch swipe':'mouse drag'} advances one photo at ${viewport.width}`,(await page.locator('#lightbox figcaption').textContent()).includes('0002'));
  if(!await page.locator('#lightbox').evaluate(el=>el.open))await first.click();
  await page.screenshot({path:path.join(evidence,`lightbox-${viewport.width}.png`)});
  const downloadPromise=page.waitForEvent('download'),singleBefore=singleRequests.length;await page.locator('#lightbox-download').click();const downloaded=await downloadPromise;
  check(`single photo JPEG download at ${viewport.width}`,await downloaded.failure()===null&&downloaded.suggestedFilename().endsWith('.jpg')&&(await sharp(await readFile(await downloaded.path())).metadata()).format==='jpeg');
  check(`exactly one single-image GET at ${viewport.width}`,singleRequests.length-singleBefore===1,singleRequests.length-singleBefore);await downloaded.delete();
  if(!baseline&&viewport.width===1440){
   const endpoint='**/api/gallery/'+albumId+'/photos/*/download';
   await page.route(endpoint,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Ảnh đang được chuẩn bị. Vui lòng thử lại.'})}));
   await page.locator('#lightbox-download').click();await page.locator('#lightbox-download-status').filter({hasText:'Ảnh đang được chuẩn bị'}).waitFor();
   check('single-download failure stays inside gallery',new URL(page.url()).pathname==='/gallery/'+albumId&&await page.locator('#lightbox').evaluate(el=>el.open));await page.unroute(endpoint);
   let releaseDownload;const downloadGate=new Promise(resolve=>{releaseDownload=resolve;});
   await page.route(endpoint,async route=>{await downloadGate;await route.abort().catch(()=>{});});
   await page.locator('#lightbox-download').click();await page.getByRole('button',{name:'Hủy tải ảnh',exact:true}).waitFor();await page.getByRole('button',{name:'Hủy tải ảnh',exact:true}).click();
   await page.locator('#lightbox-download-status').filter({hasText:'Đã hủy tải ảnh'}).waitFor();check('single-download cancellation restores retry control',await page.getByRole('button',{name:'Tải ảnh này',exact:true}).isEnabled());
   releaseDownload();await page.unroute(endpoint);
   const retry=page.waitForEvent('download');await page.locator('#lightbox-download').click();const retryFile=await retry;check('single-download succeeds after cancellation',await retryFile.failure()===null);await retryFile.delete();
  }
  await page.keyboard.press('Escape');check(`Escape restores photo focus at ${viewport.width}`,await first.evaluate(el=>el===document.activeElement));
  if(process.env.STUDIO_AXE_MODULE){
   const {default:AxeBuilder}=await import(process.env.STUDIO_AXE_MODULE);
   const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
   metric.accessibility=scan.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(node=>node.target)}));
   check(`automated gallery accessibility at ${viewport.width}`,scan.violations.length===0,metric.accessibility);
  }

  const beforePickRequests=requestUrls.length,pickStart=performance.now();
  const pick=page.locator(`.pick[data-photo="${id(0)}"]`);await pick.click();await page.waitForFunction(photo=>document.querySelector(`.pick[data-photo="${photo}"]`)?.getAttribute('aria-pressed')==='true',id(0));
  metric.pickMs=performance.now()-pickStart;metric.pickImageRequests=requestUrls.length-beforePickRequests;
  await page.locator('[data-action=selected-only]').click();check(`selected-only contains selected photos at ${viewport.width}`,await page.locator('.photo-item').count()===1);
  await page.locator(`.pick[data-photo="${id(0)}"]`).click();await page.waitForFunction(()=>document.querySelectorAll('.photo-item').length===0);
  check(`last unpick keeps usable keyboard focus at ${viewport.width}`,await page.evaluate(()=>document.activeElement!==document.body));
  await page.locator('[data-action=selected-only]').click();const filterStart=performance.now();await page.locator(`[data-action=section-filter][data-section="${sectionIds[1]}"]`).click();
  metric.sectionFilterMs=performance.now()-filterStart;
  check(`section filter at ${viewport.width}`,await page.locator('.photo-item').count()===450);
  await page.locator('[data-action=section-filter][data-section="all"]').click();
  const anchor=page.locator(`.photo-open[data-photo="${id(150)}"]`);await anchor.scrollIntoViewIfNeeded();await anchor.focus();
  const beforeResizeY=await anchor.evaluate(el=>el.getBoundingClientRect().y);await page.setViewportSize({width:viewport.width<750?1000:390,height:viewport.height});await page.waitForTimeout(300);
  const afterResize=await anchor.evaluate(el=>({focused:el===document.activeElement,y:el.getBoundingClientRect().y}));
  check(`resize preserves focused photo at ${viewport.width}`,afterResize.focused,{beforeY:beforeResizeY,afterY:afterResize.y});
  check(`resize keeps focused photo visible at ${viewport.width}`,afterResize.y>=-1&&afterResize.y<viewport.height,{beforeY:beforeResizeY,afterY:afterResize.y});
  metric.resize=afterResize;
  await page.setViewportSize({width:viewport.width,height:viewport.height});await page.waitForTimeout(150);
  const requestsBeforeScroll=requestUrls.length;
  const scrollStart=performance.now();
  for(const index of [300,600,899]){
   await page.locator(`.photo-open[data-photo="${id(index)}"]`).scrollIntoViewIfNeeded();
   await page.waitForTimeout(120);
  }
  metric.scrollSample={elapsedMs:performance.now()-scrollStart,mediaRequests:requestUrls.length-requestsBeforeScroll};
  check(`scrolling keeps image loading bounded at ${viewport.width}`,metric.scrollSample.mediaRequests<200,metric.scrollSample.mediaRequests);
  if(!baseline&&viewport.width===1440){
   for(const index of [0,1,2]){await page.locator(`.pick[data-photo="${id(index)}"]`).click();await page.waitForFunction(photo=>document.querySelector(`.pick[data-photo="${photo}"]`)?.getAttribute('aria-pressed')==='true',id(index));}
   await page.locator('[data-action=selected-only]').click();await page.locator(`.photo-open[data-photo="${id(0)}"]`).click();
   const endpoint=`**/api/gallery/${albumId}/selection/${id(0)}`;let releaseSelection;const selectionGate=new Promise(resolve=>{releaseSelection=resolve;});
   await page.route(endpoint,async route=>{await selectionGate;await route.continue();});
   await page.locator('#lightbox-pick').click();await page.keyboard.press('ArrowRight');releaseSelection();
   await page.waitForFunction(photo=>document.querySelectorAll('.photo-item').length===2&&document.querySelector('#lightbox-pick').dataset.photo===photo&&!document.querySelector('#lightbox-pick').disabled,id(1));
   check('delayed selected-only deselect preserves newly viewed photo',(await page.locator('#lightbox figcaption').textContent()).includes('0002'));await page.unroute(endpoint);
   await page.keyboard.press('Escape');await instance.db.run('DELETE FROM selections WHERE album_id=?',[albumId]);
   const failedPhoto='**/media/'+id(1)+'*';await page.route(failedPhoto,route=>route.abort('failed'));
   await page.reload();await page.locator('.photo-open').first().click();await page.keyboard.press('ArrowRight');
   await page.locator('#lightbox-retry').waitFor({state:'visible'});check('failed image offers an inline retry',await page.locator('#lightbox').evaluate(el=>el.open));
   await page.unroute(failedPhoto);await page.locator('#lightbox-retry').click();
   await page.waitForFunction(()=>{const image=document.querySelector('#lightbox img');return image.complete&&image.naturalWidth>0&&document.querySelector('#lightbox-retry').hidden;});
   check('image retry recovers without leaving the gallery',(await page.locator('#lightbox figcaption').textContent()).includes('0002'));
   await context.clearCookies();await page.locator('#lightbox-download').click();await page.getByLabel('Mật khẩu bộ ảnh').waitFor();
   check('expired single-download session relocks without navigation',new URL(page.url()).pathname==='/gallery/'+albumId&&await page.locator('#lightbox').evaluate(el=>!el.open));
  }
  await context.close();
 }
 if(slow){
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true}),page=await context.newPage();
  await context.request.post(base+'/api/gallery/'+albumId+'/unlock',{headers:{Origin:base},data:{password:'browser-gallery-password'}});
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:187500,uploadThroughput:93750,connectionType:'cellular3g'});
  await page.addInitScript(()=>{window.reviewPerf={cls:0,longTasks:[]};new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!entry.hadRecentInput)reviewPerf.cls+=entry.value;}).observe({type:'layout-shift',buffered:true});new PerformanceObserver(list=>{for(const entry of list.getEntries())reviewPerf.longTasks.push(entry.duration);}).observe({type:'longtask',buffered:true});});
  const requests=[];page.on('request',request=>{if(request.url().includes('/media/'))requests.push(request.url());});const started=performance.now();
  await page.goto(base+'/gallery/'+albumId,{timeout:45000});await page.locator('.client-toolbar').waitFor();const readyMs=performance.now()-started;
  await page.locator('.photo-open img').first().evaluate(el=>el.decode());const firstImageMs=performance.now()-started;await page.waitForTimeout(700);
  results.throttled={profile:{width:390,dpr:2,cpuRate:4,latencyMs:100,downloadMbps:1.5},readyMs,firstImageMs,initialMediaRequests:requests.length,...await page.evaluate(()=>({...reviewPerf,resources:performance.getEntriesByType('resource').map(({name,startTime,responseStart,responseEnd,transferSize})=>({url:new URL(name).pathname+new URL(name).search,startTime,responseStart,responseEnd,transferSize}))}))};
  check('throttled 900-photo gallery loads bounded media',requests.length<60,results.throttled);
  await context.close();
 }
 if(!measureOnly){
 // Public album controls share the lightbox, but intentionally omit private selection.
 await instance.db.run("UPDATE albums SET status='published' WHERE id=?",[albumId]);
 const publicContext=await browser.newContext({viewport:{width:390,height:844}}),publicPage=await publicContext.newPage();
 await publicPage.goto(base+'/album/review-gallery');await publicPage.locator('.photo-open').first().click();
 check('public lightbox exposes single-image download',await publicPage.locator('#lightbox-download').isVisible());
 check('public lightbox hides private selection',await publicPage.locator('#lightbox-pick').isHidden());
 if(!baseline){const before=singleRequests.length,event=publicPage.waitForEvent('download');await publicPage.locator('#lightbox-download').click();const file=await event;check('public single JPEG download makes one GET',await file.failure()===null&&singleRequests.length-before===1&&(await sharp(await readFile(await file.path())).metadata()).format==='jpeg');await file.delete();}
 await publicPage.screenshot({path:path.join(evidence,'public-lightbox-390.png')});await publicContext.close();
 }
 check('no browser runtime errors',results.errors.length===0,results.errors);
 results.passed=results.checks.every(item=>item.passed);
 await writeFile(path.join(evidence,'browser-summary.json'),JSON.stringify(results,null,2));
 console.log('Evidence: '+evidence);
 if(!baseline)assert.equal(results.passed,true,'Gallery regression checks failed; see browser-summary.json');
}finally{
 await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await instance.db.close();await rm(dir,{recursive:true,force:true});
}
