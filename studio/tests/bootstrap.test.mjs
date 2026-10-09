import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../web/bootstrap.js',import.meta.url),'utf8');
function start(loadApp){
 const root={hidden:true},spinner={hidden:false};
 const message={textContent:''},retry={hidden:true,addEventListener(type,fn){this.click=fn;}};
 const status={removed:false,querySelector:s=>s==='.loader'?spinner:s.includes('message')?message:retry,remove(){this.removed=true;}};
 const state={root,spinner,status,message,retry,errors:[],cleared:false,reloaded:false};
 vm.runInNewContext(source.replace("import('./main.js')",'loadApp()'),{
  document:{getElementById:id=>id==='root'?root:status},loadApp,
  setTimeout:fn=>{state.timeout=fn;return 1;},clearTimeout:()=>{state.cleared=true;},
  console:{error:(...args)=>state.errors.push(args)},location:{reload:()=>{state.reloaded=true;}}
 });
 return state;
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('Startup waits for route rendering and recovers from slow initialization',async()=>{
 let finish;const ready=new Promise(resolve=>{finish=resolve;});
 const state=start(()=>Promise.resolve({ready}));await flush();
 assert.equal(state.status.removed,false);assert.equal(state.root.hidden,true);
 state.timeout();assert.equal(state.retry.hidden,false);assert.match(state.message.textContent,/lâu hơn/);
 finish();await flush();assert.equal(state.status.removed,true);assert.equal(state.root.hidden,false);assert.equal(state.cleared,true);
});
test('A failed module download leaves a visible error and a working retry',async()=>{
 const state=start(()=>Promise.reject(new Error('Failed to fetch dynamically imported module')));await flush();
 assert.equal(state.status.removed,false);assert.equal(state.retry.hidden,false);
 assert.equal(state.root.hidden,true);assert.equal(state.spinner.hidden,true);
 assert.match(state.message.textContent,/Chưa tải được/);assert.equal(state.cleared,true);
 assert.equal(state.errors.length,1);state.retry.click();assert.equal(state.reloaded,true);
});
test('Unexpected startup render failures also expose recovery',async()=>{
 const state=start(()=>Promise.resolve({ready:Promise.reject(new Error('render failed'))}));await flush();
 assert.equal(state.retry.hidden,false);assert.equal(state.status.removed,false);assert.equal(state.cleared,true);
});
