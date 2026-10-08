import test from 'node:test';
import assert from 'node:assert/strict';
import {initHeroSlideshow} from '../web/hero-slideshow.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(decoders){
 const saved=new Map(['matchMedia','document','IntersectionObserver','setTimeout','clearTimeout'].map(k=>[k,globalThis[k]]));
 const timers=new Map();let serial=0;
 globalThis.setTimeout=callback=>{timers.set(++serial,callback);return serial;};
 globalThis.clearTimeout=id=>timers.delete(id);
 const preference=new EventTarget();preference.matches=false;
 globalThis.matchMedia=()=>preference;
 globalThis.document=new EventTarget();document.hidden=false;
 globalThis.IntersectionObserver=class{observe(){}disconnect(){}};
 const slides=decoders.map((decode,i)=>({dataset:{title:'Album '+i,href:'/album/'+i},querySelector:()=>({decode}),classList:{add(){},remove(){}},setAttribute(){}}));
 const root=new EventTarget(),button={textContent:'',setAttribute(){}},count={textContent:'01 / 04'},link={};
 root.querySelectorAll=()=>slides;
 root.querySelector=selector=>selector==='[data-slide=pause]'?button:selector==='.highlight-count'?count:link;
 root.contains=()=>false;
 return {root,count,timers,click(action){const event=new Event('click');Object.defineProperty(event,'target',{value:{closest:()=>({dataset:{slide:action}})}});root.dispatchEvent(event);},restore(){initHeroSlideshow(null);for(const [key,value]of saved){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}};
}
test('A slow first image gets its viewing interval after decoding, not during loading',async()=>{
 const first=deferred(),f=fixture([()=>first.promise,()=>Promise.resolve()]);
 try{initHeroSlideshow(f.root);assert.equal(f.timers.size,0);first.resolve();await flush();assert.equal(f.timers.size,1);}finally{f.restore();}
});
test('Going backwards skips failed images in the same direction and finds the remaining valid image',async()=>{
 const f=fixture([()=>Promise.resolve(),()=>Promise.resolve(),()=>Promise.reject(Error('offline')),()=>Promise.reject(Error('offline'))]);
 try{initHeroSlideshow(f.root);await flush();f.click('prev');await flush();assert.equal(f.count.textContent,'02 / 04');assert.equal(f.timers.size,0);}finally{f.restore();}
});
test('A failed first image falls back to a working slide',async()=>{
 const f=fixture([()=>Promise.reject(Error('offline')),()=>Promise.resolve()]);
 try{initHeroSlideshow(f.root);await flush();assert.equal(f.count.textContent,'02 / 02');assert.equal(f.timers.size,1);}finally{f.restore();}
});
test('Leaving the page while the first image loads cannot restart its slideshow',async()=>{
 const first=deferred(),f=fixture([()=>first.promise,()=>Promise.resolve()]);
 try{initHeroSlideshow(f.root);initHeroSlideshow(null);first.resolve();await flush();assert.equal(f.timers.size,0);}finally{f.restore();}
});
