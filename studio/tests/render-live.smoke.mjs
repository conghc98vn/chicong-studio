// Opt-in HTTP check of the named Render staging service. Synthetic data stays for review.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {optimizePhoto} from '../server/image-optimizer.mjs';
import {encodePreparedPhoto} from '../server/prepared-photo.mjs';
import {sha256} from '../tools/media-backup.mjs';
import {createR2Storage} from '../server/r2-storage.mjs';

const base='https://chicong-r2-staging.onrender.com';
const output=process.argv[2];
if(!output||process.env.R2_BUCKET!=='chicong-staging'||!process.env.STAGING_ADMIN_PASSWORD||!process.env.STAGING_GALLERY_PASSWORD)throw Error('Use explicit staging env files and a new output directory');
await mkdir(output,{mode:0o700});
const report={base,startedAt:new Date().toISOString(),syntheticOnly:true,steps:[],success:false};
const save=()=>writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
const step=async(name,fn)=>{const start=performance.now();try{await fn();report.steps.push({name,success:true,ms:Math.round(performance.now()-start)});await save();}catch(error){report.steps.push({name,success:false});throw error;}};
let admin='',gallery='',album,ordinary,packed;
const raw=createR2Storage(process.env);
const request=(route,{method='GET',body,cookie=admin,headers={}}={})=>fetch(base+route,{method,signal:AbortSignal.timeout(120000),headers:{Origin:base,Cookie:cookie,...(body!==undefined&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
const json=async(route,body,method='POST',cookie=admin,headers={})=>{const r=await request(route,{method,body,cookie,headers});assert.ok(r.ok,`${method} ${route}: ${r.status}`);return r.json();};
const upload=async(bytes,name,key=randomUUID(),policy='skip')=>{const form=new FormData();form.append('photos',new Blob([bytes]),name);return (await json(`/api/admin/albums/${album}/photos`,form,'POST',admin,{'X-Upload-Keys':JSON.stringify([key]),'X-Duplicate-Policy':policy})).results[0];};
try{
 await step('Live health, robots and analytics isolation',async()=>{
  const health=await request('/api/health');assert.equal(health.status,200);assert.equal((await health.json()).ok,true);
  const home=await request('/');assert.equal(home.headers.get('x-robots-tag'),'noindex, nofollow');assert.doesNotMatch(await home.text(),/beacon\.min\.js|data-cf-beacon/);
  assert.equal(await (await request('/robots.txt')).text(),'User-agent: *\nDisallow: /');
 });
 await step('Protected setup and persistent cloud configuration',async()=>{
  const credentials={email:process.env.STAGING_ADMIN_EMAIL,password:process.env.STAGING_ADMIN_PASSWORD};
  let response=await request('/api/admin/setup',{method:'POST',body:{...credentials,token:process.env.SETUP_TOKEN}});
  if(response.status===409)response=await request('/api/admin/login',{method:'POST',body:credentials});
  assert.ok(response.ok,`Admin setup/login: ${response.status}`);assert.match(response.headers.get('set-cookie'),/Secure/i);admin=response.headers.get('set-cookie').split(';')[0];
  const dashboard=await json('/api/admin/dashboard',undefined,'GET');assert.equal(dashboard.readiness.cloud,true);assert.equal(dashboard.readiness.production,true);
  assert.equal((await json('/api/admin/google-calendar',undefined,'GET')).configured,false);
  const status=await json('/api/admin/media-status',undefined,'GET');report.initialMediaStatus=status;
  await json('/api/admin/settings',{brand:'ChiCong · Bản thử R2',tagline:'Ảnh tổng hợp phục vụ kiểm thử'},'PATCH');
  album=(await json('/api/admin/albums',{title:'R2 staging · Ảnh kiểm thử',category:'wedding',status:'private',password:process.env.STAGING_GALLERY_PASSWORD})).id;
  report.albumId=album;await save();
 });
 const width=2400,height=1600,pixels=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*3;pixels[i]=(x+y)%256;pixels[i+1]=(x*3+y*2)%256;pixels[i+2]=((x>>3)^(y>>3))*7%256;}
 const source=await sharp(pixels,{raw:{width,height,channels:3}}).jpeg({quality:90}).toBuffer();
 const prepared=await optimizePhoto(source),bundle=encodePreparedPhoto({originalName:'prepared.jpg',sourceHash:sha256(source),...prepared});
 const key=randomUUID();
 await step('Render uploads JPEG and prepared package into private R2',async()=>{
  ordinary=await upload(source,'ordinary.jpg',key);assert.equal(ordinary.success,true);
  packed=await upload(bundle,'prepared.jpg.ccphoto');assert.equal(packed.success,true);
  report.photoIds=[ordinary.id,packed.id];report.sourceBytes=source.length;report.preparedBytes=bundle.length;await save();
  for(const [suffix,bytes] of [['.webp',prepared.data],['-thumb.webp',prepared.thumbnail],['-download.jpg',prepared.download]])assert.equal(sha256(await raw.get(packed.id+suffix)),sha256(bytes));
  assert.equal((await upload(source,'ordinary.jpg',key)).id,ordinary.id);
 });
 await step('Private access, secure gallery session and JPEG download',async()=>{
  assert.equal((await request('/media/'+packed.id,{cookie:''})).status,404);
  const response=await request(`/api/gallery/${album}/unlock`,{method:'POST',cookie:'',body:{password:process.env.STAGING_GALLERY_PASSWORD}});assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Secure/i);gallery=response.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/media/'+packed.id,{cookie:gallery,method:'HEAD'})).status,200);
  const image=await request('/media/'+packed.id,{cookie:gallery});assert.equal(image.status,200);assert.equal(sha256(Buffer.from(await image.arrayBuffer())),sha256(prepared.data));
  const download=await request(`/api/gallery/${album}/photos/${packed.id}/download`,{cookie:gallery});assert.equal(download.status,200);assert.equal(sha256(Buffer.from(await download.arrayBuffer())),sha256(prepared.download));
 });
 await step('Selection survives overwrite and revoked session loses access',async()=>{
  await json(`/api/gallery/${album}/selection/${ordinary.id}`,{selected:true},'PUT',gallery);
  const replacement=await sharp(source).modulate({brightness:0.8}).jpeg().toBuffer();const changed=await upload(replacement,'ordinary.jpg',randomUUID(),'overwrite');assert.equal(changed.id,ordinary.id);assert.equal(changed.replaced,true);
  const detail=await json('/api/admin/albums/'+album,undefined,'GET');assert.equal(detail.photos.find(p=>p.id===ordinary.id).selected,true);
  await json('/api/admin/albums/'+album,{title:'R2 staging · Ảnh kiểm thử',category:'wedding',status:'private',password:process.env.STAGING_GALLERY_PASSWORD+'-rotated'},'PATCH');
  assert.equal((await request('/media/'+packed.id,{cookie:gallery})).status,404);
  await json('/api/admin/albums/'+album,{title:'R2 staging · Ảnh kiểm thử',category:'wedding',status:'private',password:process.env.STAGING_GALLERY_PASSWORD},'PATCH');
 });
 await step('Portrait mapping and deletion revoke routes',async()=>{
  const form=new FormData();form.append('portrait',new Blob([source],{type:'image/jpeg'}),'portrait.jpg');await json('/api/admin/portrait',form);
  const disposable=await upload(source,'delete-me.jpg');assert.equal(disposable.success,true);report.deletedPhotoId=disposable.id;
  await json('/api/admin/photos/'+disposable.id,{},'DELETE');assert.equal((await request('/media/'+disposable.id)).status,404);
  report.finalMediaStatus=await json('/api/admin/media-status',undefined,'GET');
 });
 report.success=true;
}catch(error){report.error=String(error.message);process.exitCode=1;}
finally{raw.close();report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify(report,null,2));}
