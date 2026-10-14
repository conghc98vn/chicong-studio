import test from 'node:test';
import assert from 'node:assert/strict';
import {initHeroSlideshow} from '../web/hero-slideshow.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(decoders){
 const saved=new Map(['setTimeout','clearTimeout'].map(k=>[k,globalThis[k]]));
 const timers=new Map();let serial=0;
 globalThis.setTimeout=callback=>{timers.set(++serial,callback);return serial;};
 globalThis.clearTimeout=id=>timers.delete(id);
 function node(){const element=new EventTarget(),classes=new Set(),attributes={};return Object.assign(element,{attributes,classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},setAttribute:(k,v)=>attributes[k]=v});}
 const photos=decoders.map((decode,i)=>({decode,dataset:i?{src:`/photo/${i}`,srcset:`/photo/${i} 1200w`}:{}}));
 const sources=decoders.map((_,i)=>({dataset:i?{srcset:`/portrait/${i} 600w`}:{}}));
 const slides=decoders.map((_,i)=>Object.assign(node(),{dataset:{title:'Album '+i,href:'/album/'+i},querySelector:()=>photos[i],querySelectorAll:()=>[sources[i]]}));
 slides[0]?.classList.add('is-active');
 const root=node(),images=node(),count={textContent:`01 / ${String(slides.length).padStart(2,'0')}`},title={textContent:'Album 0'},link={href:'/album/0',querySelector:()=>title};
 const captured=new Set();images.setPointerCapture=id=>captured.add(id);images.hasPointerCapture=id=>captured.has(id);images.releasePointerCapture=id=>captured.delete(id);
 root.querySelectorAll=()=>slides;
 root.querySelector=selector=>({'.highlight-count':count,'.highlight-album':link,'.highlight-images':images}[selector]);
 function dispatch(target,type,properties){const event=new Event(type,{cancelable:true});for(const [key,value]of Object.entries(properties))Object.defineProperty(event,key,{value});target.dispatchEvent(event);return event;}
 const pointer=(type,x,y,extra={})=>dispatch(images,type,{pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y,...extra});
 return {root,images,count,title,link,timers,slides,photos,sources,pointer,
  swipe(dx,dy=0){pointer('pointerdown',200,200);pointer('pointermove',200+dx,200+dy);pointer('pointerup',200+dx,200+dy);},
  key(key){return dispatch(images,'keydown',{key});},
  click(action){dispatch(root,'click',{target:{closest:()=>({dataset:{slide:action}})}});},
  restore(){initHeroSlideshow(null);for(const [key,value]of saved){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
 };
}
test('Slow initial loading and manual navigation never schedule autoplay',async()=>{
 const first=deferred(),f=fixture([()=>first.promise,()=>Promise.resolve()]);
 try{initHeroSlideshow(f.root);assert.equal(f.timers.size,0);first.resolve();await flush();f.click('next');await flush();assert.equal(f.count.textContent,'02 / 02');assert.equal(f.timers.size,0);}finally{f.restore();}
});
test('Swipe both directions, wrap around, hydrate deferred photos, and preserve the link markup',async()=>{
 const f=fixture([()=>Promise.resolve(),()=>Promise.resolve(),()=>Promise.resolve()]);
 try{
  initHeroSlideshow(f.root);await flush();assert.equal(f.photos[1].src,undefined);
  f.swipe(-100);await flush();assert.equal(f.count.textContent,'02 / 03');assert.equal(f.title.textContent,'Album 1');assert.equal(f.link.href,'/album/1');assert.equal(f.link.textContent,undefined);
  assert.equal(f.photos[1].src,'/photo/1');assert.equal(f.sources[1].srcset,'/portrait/1 600w');assert.equal(f.photos[2].src,undefined);
  f.swipe(100);await flush();assert.equal(f.count.textContent,'01 / 03');f.swipe(100);await flush();assert.equal(f.count.textContent,'03 / 03');
  assert.equal(f.slides[2].attributes['aria-hidden'],'false');assert.equal(f.slides[0].attributes['aria-hidden'],'true');assert.equal(f.timers.size,0);
 }finally{f.restore();}
});
test('Taps, small drags, vertical scrolls, cancellation, and secondary pointers do not navigate',async()=>{
 const f=fixture([()=>Promise.resolve(),()=>Promise.resolve()]);
 try{
  initHeroSlideshow(f.root);await flush();
  for(const [dx,dy]of [[0,0],[-30,0],[-100,160],[-60,55]]){f.swipe(dx,dy);await flush();assert.equal(f.count.textContent,'01 / 02');}
  for(const type of ['pointercancel','lostpointercapture']){f.pointer('pointerdown',200,200);f.pointer('pointermove',100,200);f.pointer(type,100,200);f.pointer('pointerup',50,200);await flush();assert.equal(f.count.textContent,'01 / 02');}
  f.pointer('pointerdown',200,200);f.pointer('pointerdown',100,200,{pointerId:2,isPrimary:false});f.pointer('pointerup',50,200);await flush();assert.equal(f.count.textContent,'01 / 02');
  assert.equal(f.images.classList.contains('is-dragging'),false);
 }finally{f.restore();}
});
test('Buttons and keyboard skip broken images in the requested direction',async()=>{
 const f=fixture([()=>Promise.resolve(),()=>Promise.resolve(),()=>Promise.reject(Error('offline')),()=>Promise.reject(Error('offline'))]);
 try{initHeroSlideshow(f.root);await flush();f.click('prev');await flush();assert.equal(f.count.textContent,'02 / 04');assert.equal(f.key('ArrowLeft').defaultPrevented,true);await flush();assert.equal(f.count.textContent,'01 / 04');assert.equal(f.key('ArrowDown').defaultPrevented,false);}finally{f.restore();}
});
test('A failed first image falls back, without overriding a pending manual request',async()=>{
 const first=deferred(),second=deferred(),f=fixture([()=>first.promise,()=>second.promise]);
 try{initHeroSlideshow(f.root);f.click('next');first.reject(Error('offline'));await flush();second.resolve();await flush();assert.equal(f.count.textContent,'02 / 02');assert.equal(f.timers.size,0);}finally{f.restore();}
 const g=fixture([()=>Promise.reject(Error('offline')),()=>Promise.resolve()]);
 try{initHeroSlideshow(g.root);await flush();assert.equal(g.count.textContent,'02 / 02');}finally{g.restore();}
});
test('A newer request wins over a slow decode and cleanup prevents stale updates',async()=>{
 const slow=deferred(),f=fixture([()=>Promise.resolve(),()=>slow.promise,()=>Promise.resolve()]);
 try{
  initHeroSlideshow(f.root);f.click('next');f.click('prev');await flush();assert.equal(f.count.textContent,'03 / 03');slow.resolve();await flush();assert.equal(f.count.textContent,'03 / 03');
 }finally{f.restore();}
 const pending=deferred(),g=fixture([()=>Promise.resolve(),()=>pending.promise]);
 try{initHeroSlideshow(g.root);g.swipe(-100);initHeroSlideshow(null);pending.resolve();await flush();assert.equal(g.count.textContent,'01 / 02');g.click('next');await flush();assert.equal(g.count.textContent,'01 / 02');}finally{g.restore();}
});
test('All alternatives failing retain the current image and allow retry',async()=>{
 let broken=true;const f=fixture([()=>Promise.resolve(),()=>broken?Promise.reject(Error('offline')):Promise.resolve()]);
 try{initHeroSlideshow(f.root);f.swipe(-100);await flush();assert.equal(f.count.textContent,'01 / 02');assert.equal(f.images.attributes['aria-busy'],'false');broken=false;f.swipe(-100);await flush();assert.equal(f.count.textContent,'02 / 02');}finally{f.restore();}
});
test('No photographs or a single photograph need no interaction',()=>{
 for(const decoders of [[],[()=>Promise.resolve()]]){const f=fixture(decoders);try{initHeroSlideshow(f.root);f.swipe(-100);assert.equal(f.timers.size,0);}finally{f.restore();}}
});
