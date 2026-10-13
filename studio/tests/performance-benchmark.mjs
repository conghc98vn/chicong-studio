const {chromium}=await import(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright');
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const repo=process.cwd(),label=process.argv[2]||'after';
if(!/^[a-z0-9-]+$/.test(label))throw Error('Use a simple lowercase result label.');
const source=process.env.STUDIO_PERF_SOURCE?path.resolve(process.env.STUDIO_PERF_SOURCE):repo;
const dataDir=path.resolve(process.env.STUDIO_PERF_DATA_DIR||'data/live');
await mkdir(path.join(repo,'output'),{recursive:true});
const {createApp}=await import(pathToFileURL(path.join(source,'studio/server/app.mjs')));
const {openDatabase}=await import(pathToFileURL(path.join(source,'studio/server/db.mjs')));
const dir=await mkdtemp(path.join(tmpdir(),'studio-perf-'));
let browser,server,db;
try{
 db=await openDatabase(dir,{url:null});
 const original=new DatabaseSync(path.join(dataDir,'studio.sqlite'),{readOnly:true});
 const albums=original.prepare("SELECT id,slug,title,category,description,status,cover_id,created FROM albums WHERE status='published' ORDER BY created DESC").all();
 const photos=original.prepare("SELECT p.* FROM photos p JOIN albums a ON a.id=p.album_id WHERE a.status='published'").all();
 const settings=original.prepare('SELECT * FROM settings').all();original.close();
 for(const a of albums){const keys=Object.keys(a);await db.run('INSERT INTO albums('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')',Object.values(a));}
 for(const p of photos){const keys=Object.keys(p);await db.run('INSERT INTO photos('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')',Object.values(p));}
 for(const s of settings)await db.run('UPDATE settings SET value=? WHERE key=?',[s.value,s.key]);
 let queries=0,reads=0;const storage={get:async name=>{reads++;return readFile(path.join(dataDir,'uploads',name));}};
 // Deterministic simulated DB round-trip: measurements are lab data, not production RUM.
 for(const key of ['get','all']){const fn=db[key];db[key]=async(...args)=>{queries++;await new Promise(r=>setTimeout(r,20));return fn(...args);};}
 process.chdir(source);
 const {app}=await createApp({db,storage,dataDir:dir,env:{},mailer:{notifyNewInquiry:async()=>({skipped:true})}});
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true});
 if(!albums.length)throw Error('The read-only source must contain published albums with photos.');
 const cases=[{name:'home-mobile',route:'/',width:390,dpr:2},{name:'home-desktop',route:'/',width:1440,dpr:1},{name:'album-desktop',route:'/album/'+albums[0].slug,width:1440,dpr:1}];
 const results=[];
 for(const c of cases){
  for(let run=1;run<=Number(process.env.PERF_RUNS||1);run++){
   const context=await browser.newContext({viewport:{width:c.width,height:900},deviceScaleFactor:c.dpr,reducedMotion:'reduce'});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
   await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:200000,uploadThroughput:100000});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
   await page.addInitScript(()=>{window.lab={lcp:0,cls:0};new PerformanceObserver(list=>{for(const e of list.getEntries())window.lab.lcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.lab.cls+=e.value;}).observe({type:'layout-shift',buffered:true});});
   queries=0;reads=0;
   await page.goto(base+c.route,{waitUntil:'domcontentloaded',timeout:60000});
   await page.waitForFunction(()=>!document.querySelector('#root').hidden&&[...document.querySelectorAll('.highlight-slide.is-active img,.photo-item img')].slice(0,1).every(i=>i.complete&&i.naturalWidth>0),{},{timeout:60000});
   const ready=await page.evaluate(()=>performance.now());await page.waitForTimeout(1000);
   const data=await page.evaluate(()=>({nav:performance.getEntriesByType('navigation')[0].toJSON(),...window.lab,resources:performance.getEntriesByType('resource').map(r=>({name:new URL(r.name).pathname+new URL(r.name).search,type:r.initiatorType,start:r.startTime,duration:r.duration,bytes:r.transferSize})),images:[...document.querySelectorAll('.highlight-slide img,.photo-item img')].slice(0,8).map(i=>({src:i.currentSrc||i.src?new URL(i.currentSrc||i.src).pathname+new URL(i.currentSrc||i.src).search:null,displayWidth:i.getBoundingClientRect().width,width:i.naturalWidth,loaded:i.complete})),overflow:document.documentElement.scrollWidth>innerWidth}));
   const result={case:c.name,run,readyMs:ready,queries,storageReads:reads,errors,...data};results.push(result);
   console.log(JSON.stringify({case:c.name,run,readyMs:Math.round(ready),lcpMs:data.lcp,ttfbMs:data.nav.responseStart,requests:data.resources.length,bytes:data.nav.transferSize+data.resources.reduce((n,r)=>n+r.bytes,0),queries,storageReads:reads,images:data.images,errors,overflow:data.overflow}));
   if(run===1)await page.screenshot({path:path.join(repo,'output/perf-'+label+'-'+c.name+'.png')});
   await context.close();
  }
 }
 await writeFile(path.join(repo,'output/perf-'+label+'.json'),JSON.stringify({conditions:{browser:browser.version(),cache:'disabled',reducedMotion:true,assetCompression:false,latencyMs:100,downloadBytesPerSecond:200000,cpuSlowdown:4,dbDelayMs:20,albums:albums.length,photos:photos.length},results},null,2));
}finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await db?.close();await rm(dir,{recursive:true,force:true});process.chdir(repo);}
