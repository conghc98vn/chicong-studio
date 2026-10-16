// Opt-in cloud rehearsal. Use a dedicated staging bucket and explicit env file.
// Synthetic SQLite/app only: never opens DATABASE_URL or the normal data directory.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';
import {openDatabase} from '../server/db.mjs';
import {createR2Storage,mediaType} from '../server/r2-storage.mjs';
import {createStorage} from '../server/storage.mjs';
import {photoDeletion} from '../server/photo-deletion.mjs';
import {optimizePhoto} from '../server/image-optimizer.mjs';
import {encodePreparedPhoto} from '../server/prepared-photo.mjs';
import {createBackup,verifyBackup,exportBackup,restoreBackup,copyToStorage,sha256} from '../tools/media-backup.mjs';

const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!['--bucket','--output'].includes(args[i])||!args[i+1])throw Error('Use --bucket STAGING_BUCKET --output NEW_DIRECTORY');options[args[i].slice(2)]=args[i+1];}
if(!options.bucket||!options.output||options.bucket!==process.env.R2_BUCKET||!/(^|-)staging($|-)/.test(options.bucket))throw Error('Explicit --bucket must match a dedicated staging R2_BUCKET');
const root=path.resolve(options.output),repository=path.join(root,'backup'),offline=path.join(root,'offline');
await mkdir(root,{mode:0o700});
const report={startedAt:new Date().toISOString(),bucket:options.bucket,database:'isolated SQLite',syntheticOnly:true,steps:[],operations:{},attemptedKeys:[],success:false};
const save=()=>writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
const step=async(name,fn)=>{const start=performance.now();try{const value=await fn();report.steps.push({name,success:true,ms:Math.round(performance.now()-start)});await save();return value;}catch(error){report.steps.push({name,success:false,ms:Math.round(performance.now()-start)});throw error;}};
const cloud=createR2Storage(process.env),raw={...cloud};
for(const method of ['init','put','get','stat','list','remove'])raw[method]=async(...values)=>{
 report.operations[method]=(report.operations[method]||0)+1;
 if(method==='put'){report.attemptedKeys.push(values[0]);await save();}
 return cloud[method](...values);
};
let db,instance,cleanup,server,base,adminCookie='',galleryCookie='',album,manifest;
const request=(route,{body,method='GET',cookie=adminCookie,headers={}}={})=>fetch(base+route,{method,signal:AbortSignal.timeout(60000),headers:{Origin:'http://localhost',Cookie:cookie,...(body!==undefined&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
const json=async(route,body,method='POST',headers={})=>{const res=await request(route,{body,method,headers});assert.ok(res.ok,`${method} ${route} returned ${res.status}`);return res.json();};
const upload=async(bytes,name,key=randomUUID(),policy='skip')=>{const body=new FormData();body.append('photos',new Blob([bytes]),name);return (await json(`/api/admin/albums/${album}/photos`,body,'POST',{'X-Upload-Keys':JSON.stringify([key]),'X-Duplicate-Policy':policy})).results[0];};
try{
 await step('SDK HeadBucket and inventory',async()=>{await raw.init();report.preexistingObjects=(await raw.list()).length;});
 db=await openDatabase(path.join(root,'database'),{url:null});
 instance=await createApp({db,dataDir:path.join(root,'database'),production:false,origin:'http://localhost',env:{MEDIA_CLEANUP_ENABLED:'false'},storage:raw,uploadLogger:()=>{}});
 cleanup=photoDeletion({db,storage:instance.storage,mediaControl:instance.mediaControl});
 server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
 await step('Create isolated admin and private gallery',async()=>{
  const setup=await request('/api/admin/setup',{method:'POST',body:{email:'staging@example.test',password:'synthetic-'+randomUUID()}});assert.equal(setup.status,201);adminCookie=setup.headers.get('set-cookie').split(';')[0];
  album=(await json('/api/admin/albums',{title:'Synthetic R2 staging rehearsal',category:'wedding',status:'private',password:'synthetic-gallery-password'})).id;
 });
 // A generated texture exercises real encoding and multi-packet S3 bodies.
 const width=2400,height=1600,pixels=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*3;pixels[i]=(x+y)%256;pixels[i+1]=(x*3+y*2)%256;pixels[i+2]=((x>>3)^(y>>3))*7%256;}
 const source=await sharp(pixels,{raw:{width,height,channels:3}}).jpeg({quality:90}).toBuffer();
 const prepared=await optimizePhoto(source),bundle=encodePreparedPhoto({originalName:'prepared.jpg',sourceHash:sha256(source),...prepared});
 const firstKey=randomUUID();let ordinary,packed;
 await step('Upload JPEG and prepared package through HTTP to real R2',async()=>{
  ordinary=await upload(source,'ordinary.jpg',firstKey);packed=await upload(bundle,'prepared.jpg.ccphoto');assert.ok(ordinary.success&&packed.success);
  for(const [suffix,bytes] of [['.webp',prepared.data],['-thumb.webp',prepared.thumbnail],['-download.jpg',prepared.download]]){
   const key=packed.id+suffix,stored=await raw.get(key),meta=await raw.stat(key);assert.equal(sha256(stored),sha256(bytes));assert.equal(meta.bytes,bytes.length);assert.equal(meta.contentType,mediaType(key));assert.equal(meta.sha256,sha256(bytes));
  }
  report.sourceBytes=source.length;report.preparedBytes=bundle.length;
 });
 await step('Retry receipts and overwrite preserve photo identity and selection',async()=>{
  const puts=report.operations.put;assert.equal((await upload(source,'ordinary.jpg',firstKey)).id,ordinary.id);assert.equal(report.operations.put,puts);
  await db.run('INSERT INTO selections(album_id,photo_id,updated) VALUES(?,?,?)',[album,ordinary.id,new Date().toISOString()]);
  const replacement=await sharp(source).modulate({brightness:0.8}).jpeg().toBuffer(),saved=await upload(replacement,'ordinary.jpg',randomUUID(),'overwrite');assert.equal(saved.id,ordinary.id);assert.equal(saved.replaced,true);
  assert.notEqual((await db.get('SELECT filename FROM photos WHERE id=?',[ordinary.id])).filename,ordinary.id);assert.ok(await db.get('SELECT photo_id FROM selections WHERE photo_id=?',[ordinary.id]));
  await cleanup.cleanup(true);await assert.rejects(raw.get(ordinary.id+'.webp'),{code:'STORAGE_NOT_FOUND'});
 });
 const legacy=randomBytes(16).toString('hex');
 await step('Portrait and legacy two-WebP fixtures',async()=>{
  const body=new FormData();body.append('portrait',new Blob([source],{type:'image/jpeg'}),'portrait.jpg');await json('/api/admin/portrait',body);
  await instance.mediaControl.run('synthetic-legacy-fixture',async()=>{
   await instance.storage.put(legacy+'.webp',prepared.data);await instance.storage.put(legacy+'-thumb.webp',prepared.thumbnail);
   await db.run('INSERT INTO photos(id,album_id,filename,original,width,height) VALUES(?,?,?,?,?,?)',[legacy,album,legacy,'legacy.jpg',width,height]);
  });
 });
 await step('Private reads, HEAD and JPEG downloads',async()=>{
  assert.equal((await request('/media/'+packed.id,{cookie:''})).status,404);
  const unlock=await request(`/api/gallery/${album}/unlock`,{cookie:'',method:'POST',body:{password:'synthetic-gallery-password'}});assert.equal(unlock.status,200);galleryCookie=unlock.headers.get('set-cookie').split(';')[0];
  const gets=report.operations.get;assert.equal((await request('/media/'+packed.id,{cookie:galleryCookie,method:'HEAD'})).status,200);assert.equal(report.operations.get,gets);
  const media=await request('/media/'+packed.id,{cookie:galleryCookie});assert.equal(media.status,200);assert.equal(sha256(Buffer.from(await media.arrayBuffer())),sha256(prepared.data));
  for(const id of [packed.id,legacy]){const download=await request(`/api/gallery/${album}/photos/${id}/download`,{cookie:galleryCookie});assert.equal(download.status,200);const bytes=Buffer.from(await download.arrayBuffer());assert.equal((await sharp(bytes).metadata()).format,'jpeg');if(id===packed.id)assert.equal(sha256(bytes),sha256(prepared.download));}
  const anonymous=await fetch(process.env.R2_ENDPOINT+'/'+options.bucket+'/'+packed.id+'.webp',{signal:AbortSignal.timeout(15000)});assert.ok([400,401,403,404].includes(anonymous.status));await anonymous.body?.cancel();report.unsignedS3Status=anonymous.status;
 });
 await step('Locked consistent backup and media write rejection',async()=>{
  const lease=await instance.mediaControl.acquire('r2-staging-backup');
  assert.equal((await request('/api/admin/photos/'+packed.id,{method:'PATCH',body:{caption:'must be blocked'}})).status,503);
  manifest=await createBackup({db,storage:raw,control:instance.mediaControl,cleanup:cleanup.cleanup,root:repository,appRevision:'uncommitted-r2-staging',existingLease:lease});
  assert.equal(manifest.objects.length,9);await verifyBackup(repository,manifest);assert.equal((await instance.mediaControl.status()).control.owner,lease.owner);await instance.mediaControl.release(lease);
  report.backupObjects=manifest.objects.length;report.backupBytes=manifest.objects.reduce((total,o)=>total+o.bytes,0);
  const gets=report.operations.get;await createBackup({db,storage:raw,control:instance.mediaControl,cleanup:cleanup.cleanup,root:repository});assert.equal(report.operations.get,gets);
  await exportBackup(repository,offline,manifest.runId);
 });
 await step('Delete only this run through application cleanup',async()=>{
  for(const photo of await db.all('SELECT id FROM photos WHERE album_id=?',[album]))await json('/api/admin/photos/'+photo.id,{},'DELETE');
  await json('/api/admin/settings',{portrait:''},'PATCH');await cleanup.cleanup(true);
  const remaining=new Set((await raw.list()).map(item=>item.key));assert.ok(report.attemptedKeys.every(key=>!remaining.has(key)));report.remainingObjects=remaining.size;
  for(const item of manifest.objects)await assert.rejects(raw.get(item.key),{code:'STORAGE_NOT_FOUND'});
 });
 await step('Offline restore and verified copy after source objects were removed',async()=>{
  const restored=path.join(root,'restored');await restoreBackup(offline,restored,manifest.runId);
  for(const item of manifest.objects){const bytes=await readFile(path.join(restored,'uploads',item.key));assert.equal(sha256(bytes),item.sha256);assert.equal((await stat(path.join(restored,'uploads',item.key))).size,item.bytes);}
  const restoredDb=await openDatabase(restored,{url:null,initialize:false});try{assert.equal((await restoredDb.all('SELECT id FROM photos')).length,3);assert.equal((await restoredDb.all('SELECT * FROM sessions')).length,0);assert.equal((await restoredDb.all('SELECT * FROM selections')).length,1);}finally{await restoredDb.close();}
  const target=createStorage(path.join(root,'copy'),{MEDIA_STORAGE_PROVIDER:'local'});assert.equal((await copyToStorage(offline,target,{runId:manifest.runId,reportFile:path.join(root,'copy.json')})).state,'verified');
 });
 report.success=true;
}catch(error){report.failureCode=error.code||error.name;report.failureMessage=String(error.message).replaceAll(process.env.R2_ACCESS_KEY_ID||'__unset_access__','[redacted]').replaceAll(process.env.R2_SECRET_ACCESS_KEY||'__unset_secret__','[redacted]');process.exitCode=1;}
finally{
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 await cleanup?.close();
 if(instance){await instance.photoCleanup.close();await instance.mediaControl.close();}
 if(db)await db.close();cloud.close();report.finishedAt=new Date().toISOString();await save();
 console.log(JSON.stringify({success:report.success,steps:report.steps,operations:report.operations,report:path.join(root,'report.json'),failureCode:report.failureCode},null,2));
}
