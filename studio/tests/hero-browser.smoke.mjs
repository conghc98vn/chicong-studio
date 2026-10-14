// Read-only smoke test against a local preview with at least two curated slides.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
const {chromium,webkit}=await import(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.STUDIO_PREVIEW_URL||'http://127.0.0.1:4173';
const evidence=process.env.STUDIO_BROWSER_EVIDENCE_DIR||'output/home-swipe-review';
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
const count=()=>page.locator('.highlight-count').textContent();
const ready=async()=>{
 // A viewport change can cancel decode while <picture> switches its source.
 await page.locator('.highlight-slide.is-active img').evaluate(async image=>{
  for(let attempt=0;attempt<3;attempt++){
   try{await image.decode();return;}catch(error){if(attempt===2)throw error;await new Promise(resolve=>requestAnimationFrame(resolve));}
  }
 });
 await page.evaluate(()=>document.fonts.ready);
};
const expectSlide=async n=>page.waitForFunction(n=>document.querySelector('.highlight-count').textContent.startsWith(String(n).padStart(2,'0')+' /'),n);
const client=await context.newCDPSession(page);
async function swipe(dx,dy=0){
 const box=await page.locator('.highlight-images').boundingBox(),x=box.x+box.width*.6,y=box.y+box.height*.55;
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let i=1;i<=8;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/8,y:y+dy*i/8}]});
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}
try{
 await page.clock.install();await page.goto(base);await ready();
 const total=await page.locator('.highlight-slide').count();assert.ok(total>=2);
 const initial=await count();await page.clock.fastForward(12000);assert.equal(await count(),initial,'No autoplay');
 await swipe(-120);await expectSlide(2);assert.equal(await page.locator('.highlight-album svg').count(),1);assert.ok(!(await page.locator('.highlight-album').innerText()).includes('↗'));
 assert.equal(await page.locator('.highlight-album').getAttribute('href'),await page.locator('.highlight-slide.is-active').getAttribute('data-href'));
 await page.clock.fastForward(12000);assert.equal((await count()).slice(0,2),'02','Manual action cannot resume autoplay');
 await swipe(120);await expectSlide(1);await swipe(120);await expectSlide(total);await swipe(-120);await expectSlide(1);
 await swipe(-20);assert.equal(await count(),initial,'Short gesture is ignored');
 await swipe(0,-140);assert.equal(await count(),initial,'Vertical gesture is ignored');assert.ok(await page.evaluate(()=>scrollY)>20,'Page still scrolls vertically');
 await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
 for(const width of [320,360,390,430,750,768,1440]){
  await page.setViewportSize({width,height:width>750?1000:844});await ready();await page.clock.fastForward(1500);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow at '+width);
  const boxes=await page.locator('.highlight-controls button').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));assert.ok(boxes.every(b=>b.width>=44&&b.height>=44));
  if(width<=750){const [stage,bar,copy]=await Promise.all(['.highlight-stage','.highlight-bar','.highlight-copy'].map(s=>page.locator(s).boundingBox()));assert.ok(bar.y>=stage.y+stage.height-1);assert.ok(copy.y>=bar.y+bar.height-1);}
  if([390,1440].includes(width)){await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:path.join(evidence,'home-'+width+'.png')});}
 }
 await page.locator('.highlight-images').focus();await page.keyboard.press('ArrowRight');await expectSlide(2);await page.keyboard.press('ArrowLeft');await expectSlide(1);
 const box=await page.locator('.highlight-images').boundingBox();await page.mouse.move(box.x+box.width*.6,box.y+100);await page.mouse.down();await page.mouse.move(box.x+box.width*.6-150,box.y+100,{steps:8});await page.mouse.up();await expectSlide(2);
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.highlight-slide').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
 await page.getByRole('button',{name:'Ảnh tiếp theo',exact:true}).click();await expectSlide(total>2?3:1);
 await page.setViewportSize({width:320,height:844});await page.locator('.highlight-album-title').evaluate(e=>e.textContent='A Very Long Wedding Album Title — Ngày cưới của Minh và An');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.setViewportSize({width:390,height:844});await page.reload();await ready();await page.clock.fastForward(1500);
 await page.locator('.mobile-menu').click();assert.equal(await page.locator('.mobile-menu').getAttribute('aria-expanded'),'true');await page.locator('.mobile-menu').click();
 await page.locator('.highlight-album').click();await page.locator('.album-title').waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS Chromium: real touch swipes both directions and wrap, vertical scrolling, no autoplay after 24s simulated time, caption SVG and link, tap threshold, mouse drag, keyboard, buttons, reduced motion, mobile menu, album navigation, 320–1440px layouts and long title.');
}finally{await browser.close();}
// WebKit coverage is optional when its browser binary is available locally.
let safari;
try{safari=await webkit.launch({headless:true});}catch(error){console.log('WebKit unavailable: '+error.message.split('\n')[0]);}
if(safari){
 try{
  const page=await safari.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await page.goto(base);await page.locator('.highlight-slide.is-active img').evaluate(i=>i.decode());await page.locator('[data-slide=next]').click();await page.waitForFunction(()=>document.querySelector('.highlight-count').textContent.startsWith('02'));
  assert.equal(await page.locator('.highlight-album svg').count(),1);assert.equal(await page.locator('.highlight-images').evaluate(e=>getComputedStyle(e).touchAction),'pan-y pinch-zoom');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(evidence,'home-webkit-390.png')});console.log('PASS WebKit: mobile layout, manual navigation, SVG icon and touch-action.');
 }finally{await safari.close();}
}
