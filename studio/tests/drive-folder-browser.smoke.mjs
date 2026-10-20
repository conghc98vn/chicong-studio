import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
const playwright = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const jobs = new Map(), writes = [], polls = new Map(), cancellations = [];
const server = createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost');
  if (['/drive-folder-browser.mjs','/api-request.mjs','/drive-sync.css'].includes(url.pathname)) {
    res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');
    return res.end(await readFile(new URL('../web'+url.pathname,import.meta.url)));
  }
  if (url.pathname === '/') {res.setHeader('Content-Type','text/html');return res.end('<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/drive-sync.css"><button id="open">Open</button><script type="module">import {openDriveFolderBrowser} from "/drive-folder-browser.mjs"; window.selected=[]; document.querySelector("#open").onclick=()=>openDriveFolderBrowser({onSelect:f=>selected.push(f)});</script>');}
  const imageMatch=url.pathname.match(/^\/api\/admin\/drive\/browse\/(job\d+)\/images\/(image\d+|broken)$/);
  if(imageMatch){
    if(imageMatch[2]==='broken'){res.statusCode=404;return res.end();}
    res.setHeader('Content-Type','image/svg+xml');
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="#b6c6bf"/><path d="M0 65 30 24 72 72H0" fill="#526e5f"/><circle cx="53" cy="18" r="8" fill="#f3dfb0"/></svg>');
  }
  res.setHeader('Content-Type','application/json');
  const canceled=url.pathname.match(/^\/api\/admin\/drive\/jobs\/(job\d+)\/cancel$/);
  if(req.method==='POST'&&canceled){assert.ok(jobs.has(canceled[1]));cancellations.push(canceled[1]);return res.end(JSON.stringify({success:true}));}
  if (req.method === 'POST' && url.pathname === '/api/admin/drive/browse') {
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);writes.push({path:url.pathname,...body});const id='job'+jobs.size;
    jobs.set(id,body);const send=()=>res.end(JSON.stringify({job_id:id}));return body.folder_id==='latequeue'?setTimeout(send,200):send();
  }
  const id=url.pathname.split('/').at(-1), body=jobs.get(id);
  if(body){
    if(body.folder_id==='denied')return res.end(JSON.stringify({job:{id,status:'failed',error_code:'drive_permission_denied'}}));
    const poll=(polls.get(id)||0)+1; polls.set(id,poll);
    if(body.folder_id==='enrichmentfail'&&poll>1)return res.end(JSON.stringify({job:{id,status:'failed',error_code:'drive_source_unavailable'}}));
    if(['generationfail','canceledready'].includes(body.folder_id)&&poll>1)return res.end(JSON.stringify({job:{id,status:body.folder_id==='canceledready'?'canceled':'failed',error_code:body.folder_id==='generationfail'?'drive_connection_stale':null}}));
    if(body.folder_id==='pollfailure'&&poll>1){res.statusCode=503;return res.end(JSON.stringify({error:'Mất kết nối thử nghiệm'}));}
    const data={folder:{id:body.folder_id,name:body.folder_id==='leaf33'?'Bộ 33 ảnh':'Thư viện'},folders:[],nextPageToken:null,scope:'shared'};
    if(body.folder_id==='library'&&!body.page_token){data.folders=[{id:'leaf33',name:'<img src=x onerror=alert(1)>'}];data.nextPageToken='opaque-next';}
    const images=Array.from({length:7},(_,index)=>({id:'image'+index,name:index===0?'<img src=x onerror=alert(1)>':'Ảnh '+index,url:`/api/admin/drive/browse/${id}/images/image${index}`}));
    data.preview={images,unavailable:false};
    data.summary={status:'ready',images:body.folder_id==='leaf33'?33:5000,folders:body.folder_id==='manyfolders'?80:body.folder_id==='library'?2:0,otherFiles:0,complete:true,scanned:5002,updatedAt:Date.now()};
    if(body.folder_id==='partial')data.summary={status:'partial',images:1000,folders:20,otherFiles:2,complete:false};
    if(body.folder_id==='unavailable')data.summary={status:'unavailable',images:null,folders:null,complete:false};
    if(body.folder_id==='manyfolders')data.folders=Array.from({length:80},(_,index)=>({id:'folder'+index,name:'Bộ ảnh thử '+index}));
    if(body.folder_id==='enrichmentfail'){data.ready=true;data.summary={status:'loading'};data.preview={pending:true,images:[]};}
    if(['generationfail','canceledready','abandoned','pollfailure'].includes(body.folder_id)){data.ready=true;data.folders=[{id:'leaf33',name:'Bộ 33 ảnh'}];}
    if(body.folder_id==='progressive'){
      data.ready=true;data.folders=[{id:'leaf33',name:'Bộ 33 ảnh'}];
      data.summary=poll<3?{status:'loading',images:null,folders:null,complete:false}:{status:'ready',images:33,folders:1,otherFiles:0,complete:true};
      data.preview=poll===1?{pending:true,images:[]}:{pending:false,images:images.slice(0,2)};
    }
    if(body.folder_id==='leaf33')data.preview.images=[images[0],{id:'broken',name:'Ảnh lỗi',url:`/api/admin/drive/browse/${id}/images/broken`},
      {id:'remote',name:'Remote',url:'https://evil.invalid/steal'}, {id:'script',name:'Script',url:'javascript:alert(1)'},
      {id:'wrongjob',name:'Wrong job',url:'/api/admin/drive/browse/jobOther/images/wrongjob'},
      {id:'image1',name:'Query',url:`/api/admin/drive/browse/${id}/images/image1?redirect=1`},
      {id:'image2',name:'Absolute',url:`http://localhost/api/admin/drive/browse/${id}/images/image2`}];
    if(body.folder_id==='unavailable')data.preview={images:[],unavailable:true};
    if(body.folder_id==='brokenpreview')data.preview={images:[{id:'broken',name:'Ảnh lỗi',url:`/api/admin/drive/browse/${id}/images/broken`}],unavailable:false};
    if(body.page_token)data.folders=[{id:'second',name:'Bộ thứ hai'}];
    const send=()=>res.end(JSON.stringify({job:{id,status:(body.folder_id==='progressive'&&poll<3)||['enrichmentfail','generationfail','canceledready','abandoned','pollfailure'].includes(body.folder_id)?'running':'completed',progress:data}}));
    return body.folder_id==='slowfolder'?setTimeout(send,300):send();
  }
  res.statusCode=404;res.end('{}');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await playwright.chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:320,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const imageRequests=[];page.on('request',request=>{if(request.resourceType()==='image')imageRequests.push(request.url());});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.click('#open');
  const browse=async value=>{await page.locator('.drive-folder-browser input').fill(value);await page.locator('[data-browse-form] button').click();};
  await browse('library');await page.getByRole('button',{name:'Tải thêm folder',exact:true}).waitFor();
  assert.equal(await page.locator('[data-summary]').textContent(),'5.000 ảnh · 2 folder con');
  assert.match(await page.locator('[data-loaded]').textContent(),/Đã hiển thị 1 folder con/);
  assert.equal(await page.locator('.drive-folder-list img').count(),0);
  assert.equal(await page.locator('.drive-folder-preview img').count(),6);
  assert.equal(await page.locator('.drive-folder-preview img').first().getAttribute('alt'),'<img src=x onerror=alert(1)>');
  await page.locator('.drive-folder-preview img').first().evaluate(image=>window.firstImage=image);
  await page.locator('.drive-folder-list button').first().evaluate(button=>window.firstFolder=button);
  const initialImages=await page.locator('.drive-folder-preview img').evaluateAll(images=>images.map(image=>image.getAttribute('src')));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('.drive-folder-preview img').first().evaluate(image=>image.decode());
  const output=new URL('../../output/drive-folder-browser-review-2026-10-20/',import.meta.url);await mkdir(output,{recursive:true});
  await page.screenshot({path:new URL('compact-preview-mobile.png',output).pathname});
  await page.setViewportSize({width:1100,height:820});await page.screenshot({path:new URL('compact-preview-desktop.png',output).pathname});await page.setViewportSize({width:320,height:800});
  await page.getByRole('button',{name:'Tải thêm folder',exact:true}).click();await page.getByRole('button',{name:'Mở folder Bộ thứ hai',exact:true}).waitFor();
  assert.equal(writes.at(-1).page_token,'opaque-next');
  assert.equal(await page.evaluate(()=>window.firstImage===document.querySelector('.drive-folder-preview img')&&window.firstFolder===document.querySelector('.drive-folder-list button')),true);
  assert.equal(imageRequests.filter(url=>initialImages.some(src=>url.endsWith(src))).length,6);
  assert.equal(await page.locator('[data-summary]').textContent(),'5.000 ảnh · 2 folder con');
  assert.deepEqual(await page.locator('.drive-folder-preview img').evaluateAll(images=>images.map(image=>image.getAttribute('src'))),initialImages);
  await page.getByRole('button',{name:'Mở folder <img src=x onerror=alert(1)>',exact:true}).click();
  await page.getByText('Không có folder con.',{exact:false}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.drive-folder-preview img').length===1);
  assert.equal(await page.locator('.drive-folder-preview>p').textContent(),'Xem nhanh · 1 ảnh');
  assert.equal(await page.locator('[data-select]').isEnabled(),true);
  assert.equal(imageRequests.some(url=>!url.startsWith(page.url()+'api/admin/drive/browse/')),false);
  const beforeCache=writes.length;
  await page.locator('[data-breadcrumb] button').first().click();await page.getByRole('button',{name:'Mở folder Bộ thứ hai',exact:true}).waitFor();
  assert.equal(writes.length,beforeCache);
  await page.locator('[data-refresh]').click();await page.getByRole('button',{name:'Tải thêm folder',exact:true}).waitFor();
  assert.equal(writes.length,beforeCache+1);
  await browse('denied');await page.getByText('Hãy chia sẻ folder ở quyền Người xem cho tài khoản dịch vụ.',{exact:true}).waitFor();assert.equal(await page.locator('[data-select]').isDisabled(),true);
  await browse('unavailable');await page.getByRole('heading',{name:'Thư viện'}).waitFor();
  assert.equal(await page.locator('.drive-folder-preview').isVisible(),true);
  assert.match(await page.locator('.drive-folder-preview>p').textContent(),/Chưa tải được ảnh xem nhanh/);
  assert.match(await page.locator('[data-summary]').textContent(),/Chưa lấy được/);assert.equal(await page.locator('[data-select]').isEnabled(),true);
  await browse('brokenpreview');await page.getByText('Chưa tải được ảnh xem nhanh. Bạn vẫn có thể chọn folder.',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-select]').isEnabled(),true);
  await browse('partial');await page.getByText('≥ 1.000 ảnh · ≥ 20 folder con · ≥ 2 tệp khác · Chưa đếm hết',{exact:true}).waitFor();
  await browse('progressive');await page.getByText('Đang đếm ảnh và folder…',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-select]').isEnabled(),true);
  assert.equal(await page.getByRole('button',{name:'Mở folder Bộ 33 ảnh',exact:true}).isEnabled(),true);
  await page.locator('[data-summary]').evaluate(el=>window.summaryTextNode=el.firstChild);
  assert.equal(await page.locator('[data-refresh]').isDisabled(),true);
  const beforeRepeated=writes.length;await page.locator('[data-browse-form] button').click();assert.equal(writes.length,beforeRepeated);
  await page.waitForFunction(()=>document.querySelectorAll('.drive-folder-preview img').length===2);
  assert.equal(await page.locator('[data-summary]').evaluate(el=>el.firstChild===window.summaryTextNode),true,'Unchanged live summary is not recreated during polling');
  await page.locator('.drive-folder-preview img').first().evaluate(image=>window.progressImage=image);
  await page.getByRole('button',{name:'Mở folder Bộ 33 ảnh',exact:true}).focus();
  await page.getByText('33 ảnh · 1 folder con',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.progressImage===document.querySelector('.drive-folder-preview img')),true);
  const progressiveJob=[...jobs].find(([,body])=>body.folder_id==='progressive')[0];
  assert.equal(imageRequests.filter(url=>url.includes('/'+progressiveJob+'/images/')).length,2);
  assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Mở folder Bộ 33 ảnh');
  await browse('enrichmentfail');
  await page.getByText('Không đọc được folder. Hãy kiểm tra link và quyền chia sẻ.',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-select]').isDisabled(),true);
  assert.equal(await page.locator('.drive-folder-preview img').count(),0);
  const beforeRetry=writes.length;await page.locator('[data-browse-form] button').click();
  await page.waitForFunction(()=>document.querySelector('[data-status]').textContent==='Không đọc được folder. Hãy kiểm tra link và quyền chia sẻ.');
  assert.equal(writes.length,beforeRetry+1);
  for(const folder of ['generationfail','canceledready','pollfailure']) {
    await browse(folder);await page.locator('[data-select]:enabled').waitFor();
    await page.locator('[data-status].form-error').waitFor();
    assert.equal(await page.locator('[data-select]').isDisabled(),true);
    assert.equal(await page.locator('.drive-folder-preview img').count(),0);
  }
  await browse('abandoned');await page.getByRole('button',{name:'Mở folder Bộ 33 ảnh',exact:true}).waitFor();
  const abandoned=[...jobs].find(([,body])=>body.folder_id==='abandoned')[0];
  await page.getByRole('button',{name:'Mở folder Bộ 33 ảnh',exact:true}).click();
  await page.getByRole('heading',{name:'Bộ 33 ảnh'}).waitFor();
  assert.ok(cancellations.includes(abandoned),'Navigating cancels only this picker’s abandoned browse job');
  await browse('manyfolders');await page.getByRole('button',{name:'Mở folder Bộ ảnh thử 79',exact:true}).waitFor();
  await page.setViewportSize({width:320,height:568});
  const visibleControls=()=>page.evaluate(()=>['[data-select]','[data-close]'].every(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;}));
  assert.equal(await visibleControls(),true,'Choose and close stay visible above a long list on small mobile');
  await page.screenshot({path:new URL('long-list-mobile.png',output).pathname});
  await page.locator('.drive-folder-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
  assert.equal(await visibleControls(),true,'Choose and close stay visible after scrolling');
  await page.screenshot({path:new URL('long-list-mobile-scrolled.png',output).pathname});
  await page.setViewportSize({width:1100,height:820});
  assert.equal(await visibleControls(),true);
  await page.screenshot({path:new URL('long-list-desktop.png',output).pathname});
  await page.setViewportSize({width:320,height:800});
  await page.locator('.drive-folder-browser input').fill('slowfolder');assert.equal(await page.locator('.drive-folder-preview img').count(),0);
  await browse('slowfolder');await browse('leaf33');await page.getByRole('heading',{name:'Bộ 33 ảnh'}).waitFor();await page.waitForTimeout(400);
  assert.equal(await page.locator('[data-google]').getAttribute('href'),'https://drive.google.com/drive/folders/leaf33');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('[data-select]').click();assert.deepEqual(await page.evaluate(()=>selected),[{id:'leaf33',name:'Bộ 33 ảnh'}]);
  await page.click('#open');await browse('slowfolder');await page.keyboard.press('Escape');await page.waitForTimeout(400);assert.equal(await page.locator('dialog').count(),0);
  await page.click('#open');await browse('latequeue');await page.keyboard.press('Escape');await page.waitForTimeout(400);
  const late=[...jobs].find(([,body])=>body.folder_id==='latequeue')[0];assert.ok(cancellations.includes(late),'A delayed enqueue acknowledgement is canceled after closing');
  assert.equal(writes.every(write=>write.path==='/api/admin/drive/browse'),true);assert.deepEqual(errors,[]);
  console.log('PASS: folder browsing, leaf selection, breadcrumbs, paging, safe names, permissions, stale requests, cancel, early ready, exact and partial totals, cache/refresh, incremental image and button identity, stable focus, failed enrichment retry, refresh coalescing, fixed mobile choose/close controls for 80 folders, compact thumbnails, unsafe URLs rejected, thumbnail errors, paging preview retained and mobile 320px; screenshots saved; no import/config writes.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
