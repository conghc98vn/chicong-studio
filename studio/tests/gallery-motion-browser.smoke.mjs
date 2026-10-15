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
const dir=await mkdtemp(path.join(tmpdir(),'gallery-motion-browser-'));
const evidence=path.resolve(process.env.STUDIO_BROWSER_EVIDENCE_DIR||'output/gallery-motion-review');
const baseline=!!process.env.STUDIO_GALLERY_ASSETS_DIR;
const engine=process.env.STUDIO_BROWSER||'chromium';
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
 browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{channel:'chrome'}:{})});
 results.browser={engine,version:browser.version()};
 for(const viewport of (process.env.STUDIO_MOTION_QUICK?[{width:320,height:568}]:[{width:1440,height:1000},{width:390,height:844},{width:844,height:390},{width:320,height:568}])){
  const context=await browser.newContext({viewport,deviceScaleFactor:viewport.width===1440?1:2,hasTouch:viewport.width!==1440});
  await context.request.post(base+'/api/gallery/'+albumId+'/unlock',{headers:{Origin:base},data:{password:'browser-gallery-password'}});
  const page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',error=>results.errors.push(error.message));
  const metric={...viewport};results.viewports.push(metric);
  await page.addInitScript(()=>{
   window.motionTasks=[];
   if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>{motionTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})));}).observe({type:'longtask',buffered:true});
   window.sampleFrames=async action=>{
    const frames=[],start=performance.now();let last=start;
    await new Promise(resolve=>{const tick=now=>{frames.push(now-last);last=now;if(action==='scroll')window.scrollBy({top:22,behavior:'instant'});if(action==='navigate'&&frames.length%6===0)document.querySelector('[data-action=next-photo]').click();if(now-start<1800)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});
    const sorted=frames.slice(1).sort((a,b)=>a-b);
    return {frames:sorted.length,p95GapMs:sorted[Math.floor(sorted.length*.95)],maxGapMs:Math.max(...sorted),gapsOver50Ms:sorted.filter(x=>x>50).length,longTasks:motionTasks.filter(t=>t.start>=start)};
   };
  });
  let cdp;
  if(engine==='chromium'){
   cdp=await context.newCDPSession(page);
   await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  }
  // Install before lazy grid loading/preloading can populate WebKit's decoded-image cache.
  const brokenPhoto='**/media/'+id(52)+'*';await page.route(brokenPhoto,route=>route.abort('failed'));
  await page.goto(base+'/gallery/'+albumId);await page.locator('.client-toolbar').waitFor();
  await page.evaluate(()=>document.fonts.ready);
  const first=page.locator('.photo-open').first();await first.scrollIntoViewIfNeeded();
  metric.scroll=await page.evaluate(()=>sampleFrames('scroll'));
  await first.click();
  const loaded=()=>page.waitForFunction(()=>{const i=document.querySelector('#lightbox img');return i.complete&&i.naturalWidth>0&&!document.querySelector('#lightbox').classList.contains('image-loading');});
  await loaded();
  metric.scrollAtOpen=await page.evaluate(()=>scrollY);
  const geometry=()=>page.evaluate(()=>{
   const d=document.querySelector('#lightbox'),c=d.querySelector('figcaption'),r=c.getBoundingClientRect();
   const controls=[...d.querySelectorAll('button:not([hidden])')].map(e=>{const b=e.getBoundingClientRect();return {name:e.textContent.trim(),top:b.top,bottom:b.bottom,left:b.left,right:b.right};});
   return {dialog:d.getBoundingClientRect().toJSON(),captionHit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.tagName,controls,overflow:d.scrollWidth>d.clientWidth};
  });
  // Begin sampling before the trusted click so browser scheduling cannot miss the transition.
  await page.evaluate(()=>{window.zoomScales=[];document.querySelector('#lightbox-zoom').addEventListener('click',()=>{
   const image=document.querySelector('#lightbox img');let remaining=18;
   const sample=()=>{zoomScales.push(new DOMMatrix(getComputedStyle(image).transform).a);if(--remaining)requestAnimationFrame(sample);};requestAnimationFrame(sample);
  },{once:true});});
  await page.locator('#lightbox-zoom').click();
  await page.waitForFunction(()=>zoomScales.length===18);
  metric.zoomFrames=await page.evaluate(()=>zoomScales);
  check(`zoom has intermediate animation frames ${viewport.width}`,metric.zoomFrames.some(s=>s>1.01&&s<2.49),metric.zoomFrames);
  metric.zoomGeometry=await geometry();
  check(`zoom does not cover caption ${viewport.width}`,metric.zoomGeometry.captionHit==='FIGCAPTION',metric.zoomGeometry.captionHit);
  check(`controls fit viewport ${viewport.width}x${viewport.height}`,metric.zoomGeometry.controls.every(c=>c.top>=0&&c.bottom<=viewport.height+1&&c.left>=0&&c.right<=viewport.width+1),metric.zoomGeometry.controls);
  check(`dialog has no horizontal overflow ${viewport.width}`,!metric.zoomGeometry.overflow);
  await page.screenshot({path:path.join(evidence,`${engine}-zoom-${viewport.width}.png`)});
  await page.locator('#lightbox figcaption').evaluate(c=>{c.dataset.original=c.textContent;c.textContent='Khoảnh khắc ngày cưới cùng gia đình và những người bạn thân yêu. '.repeat(5).slice(0,300);});
  await page.waitForTimeout(100);
  const longCaption=await geometry();
  check(`long caption keeps controls visible ${viewport.width}`,longCaption.controls.every(c=>c.top>=0&&c.bottom<=viewport.height+1),longCaption.controls);
  const caption=page.locator('#lightbox figcaption');
  await caption.focus();await page.keyboard.press('ArrowDown');await page.waitForTimeout(350);
  const captionScroll=await caption.evaluate(c=>({focused:c===document.activeElement,top:c.scrollTop,height:c.clientHeight,scrollHeight:c.scrollHeight,overflow:getComputedStyle(c).overflowY}));
  check(`long caption can be read with keyboard ${viewport.width}`,captionScroll.scrollHeight<=captionScroll.height||captionScroll.top>0,captionScroll);
  await page.keyboard.press('End');
  check(`keyboard reaches the full caption ${viewport.width}`,await caption.evaluate(c=>Math.abs(c.scrollHeight-c.clientHeight-c.scrollTop)<2));
  await page.keyboard.press('Home');
  check(`keyboard returns to caption start ${viewport.width}`,await caption.evaluate(c=>c.scrollTop===0));
  await caption.dblclick();
  check(`interacting with caption does not toggle zoom ${viewport.width}`,await page.locator('#lightbox.is-zoomed').count()===1);
  if(cdp&&viewport.width<750){
   const r=await caption.boundingBox(),x=r.x+r.width/2,y=r.y+r.height-8;
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(let step=1;step<=6;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*7}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(150);
   check(`touch scrolls long caption without panning photo ${viewport.width}`,await caption.evaluate(c=>c.scrollTop>0)&&await page.locator('#lightbox.is-panning').count()===0);
  }
  if(process.env.STUDIO_AXE_MODULE){
   const {default:AxeBuilder}=await import(process.env.STUDIO_AXE_MODULE);
   const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
   check(`long-caption accessibility ${viewport.width}`,scan.violations.length===0,scan.violations.map(v=>v.id));
  }
  await page.screenshot({path:path.join(evidence,`${engine}-long-caption-${viewport.width}.png`)});
  await page.locator('#lightbox figcaption').evaluate(c=>{c.textContent=c.dataset.original;});
  const imageBox=await page.locator('#lightbox img').evaluate(i=>{const r=i.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  await page.mouse.move(imageBox.x,imageBox.y);await page.mouse.down();
  const panFrames=page.evaluate(()=>sampleFrames());
  await page.mouse.move(imageBox.x+70,imageBox.y+80,{steps:45});await page.mouse.up();
  metric.pan=await panFrames;
  check(`pan remains zoomed and stops dragging ${viewport.width}`,await page.locator('#lightbox').evaluate(d=>d.classList.contains('is-zoomed')&&!d.classList.contains('is-panning')));
  check(`pan keeps caption readable ${viewport.width}`,(await geometry()).captionHit==='FIGCAPTION');
  const scrollBefore=await page.evaluate(()=>scrollY);
  await page.mouse.move(viewport.width/2,Math.min(viewport.height/2,250));await page.mouse.wheel(0,500);await page.waitForTimeout(250);
  const scrollAfter=await page.evaluate(()=>scrollY);
  check(`background stays fixed while viewing ${viewport.width}`,Math.abs(scrollAfter-scrollBefore)<2,{scrollAtOpen:metric.scrollAtOpen,scrollBefore,scrollAfter});
  await page.keyboard.press('Escape');
  for(let i=0;i<12;i++)await page.keyboard.press('ArrowRight');
  await loaded();
  check(`rapid navigation keeps image and caption together ${viewport.width}`,await page.locator('#lightbox img').evaluate((img,photo)=>img.currentSrc.includes(photo)&&img.alt.includes('0013'),id(12)));
  metric.navigation=await page.evaluate(()=>sampleFrames('navigate'));
  await page.keyboard.press('Escape');
  check(`close restores the original photo focus ${viewport.width}`,await first.evaluate(e=>e===document.activeElement));
  check(`closing releases scrolling ${viewport.width}`,await page.evaluate(()=>getComputedStyle(document.body).overflow!=='hidden'));

  // Slow uncached photo: never allow a zoom of the previous image under a new caption.
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const slowPhoto='**/media/'+id(50)+'*';
  await page.route(slowPhoto,async route=>{await gate;await route.continue().catch(()=>{});});
  const deepPhoto=page.locator(`.photo-open[data-photo="${id(49)}"]`);
  await deepPhoto.evaluate(el=>{el.scrollIntoView({block:'center',behavior:'instant'});el.addEventListener('pointerdown',()=>{window.deepScrollBefore=scrollY;},{once:true});});
  await deepPhoto.click();await loaded();await page.waitForTimeout(250);
  metric.deepScroll=await page.evaluate(()=>({before:deepScrollBefore,open:scrollY}));
  await page.keyboard.press('ArrowRight');await page.waitForTimeout(100);
  check(`zoom disabled while next image loads ${viewport.width}`,await page.locator('#lightbox-zoom').isDisabled());
  check(`loading photo has visible feedback ${viewport.width}`,await page.getByRole('status').filter({hasText:'Đang tải ảnh…'}).isVisible());
  check(`previous photo is hidden while loading ${viewport.width}`,await page.locator('#lightbox img').evaluate(i=>getComputedStyle(i).opacity==='0'));
  await page.screenshot({path:path.join(evidence,`${engine}-loading-${viewport.width}.png`)});
  // Leave the delayed image before it finishes; its response must not change the active slide.
  await page.keyboard.press('ArrowRight');release();await loaded();await page.unroute(slowPhoto);
  check(`late image response cannot restore obsolete slide ${viewport.width}`,await page.locator('#lightbox img').evaluate((img,photo)=>img.currentSrc.includes(photo)&&img.alt.includes('0052'),id(51)));
  await page.keyboard.press('ArrowRight');await page.locator('#lightbox-retry').waitFor({state:'visible'});
  check(`failed image disables zoom and removes loading indicator ${viewport.width}`,await page.locator('#lightbox-zoom').isDisabled()&&await page.locator('.lightbox-loading').isHidden());
  await page.unroute(brokenPhoto);await page.locator('#lightbox-retry').click();await loaded();
  check(`retry re-enables zoom on the recovered image ${viewport.width}`,await page.locator('#lightbox-zoom').isEnabled());
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#lightbox-zoom').click();
  check(`reduced motion disables image transitions ${viewport.width}`,await page.locator('#lightbox img').evaluate(i=>getComputedStyle(i).transitionDuration.split(',').every(d=>parseFloat(d)===0)));
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await page.waitForTimeout(100);metric.deepScroll.closed=await page.evaluate(()=>scrollY);
  check(`deep gallery position survives open and close ${viewport.width}`,Math.abs(metric.deepScroll.closed-metric.deepScroll.before)<2,metric.deepScroll);
  check(`reduced motion disables smooth page scrolling ${viewport.width}`,await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior==='auto'));
  await page.emulateMedia({reducedMotion:'no-preference'});
  await first.click();await loaded();await page.locator('#lightbox-zoom').click();
  await page.setViewportSize({width:viewport.height,height:viewport.width});
  await page.waitForTimeout(300);
  check(`rotation resets zoom and keeps navigation usable ${viewport.width}`,await page.locator('#lightbox.is-zoomed').count()===0&&await page.locator('[data-action=next-photo]').isVisible());
  if(process.env.STUDIO_AXE_MODULE){
   const {default:AxeBuilder}=await import(process.env.STUDIO_AXE_MODULE);
   const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
   check(`lightbox accessibility ${viewport.width}`,scan.violations.length===0,scan.violations.map(v=>v.id));
  }
  await cdp?.detach();await context.close();
 }
 check('no browser runtime errors',results.errors.length===0,results.errors);
 results.passed=results.checks.every(c=>c.passed);
 await writeFile(path.join(evidence,'motion-summary.json'),JSON.stringify(results,null,2));
 if(!baseline)assert.equal(results.passed,true,'Motion checks failed; see motion-summary.json');
}finally{
 await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await instance.db.close();await rm(dir,{recursive:true,force:true});
}
