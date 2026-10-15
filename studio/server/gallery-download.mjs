import {mkdtemp,writeFile,rm,stat} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import yazl from 'yazl';
import {encodeDownloadJpeg} from './image-optimizer.mjs';
import {findAlbum} from './album-slugs.mjs';

export const downloadPolicy=Object.freeze({maxPhotos:50,maxBytes:100*1024*1024,maxConcurrent:2});
const fail=(status,message)=>Object.assign(new Error(message),{status});
export const safeName=value=>{
 const base=String(value||'anh').toWellFormed().normalize('NFC').split(/[\\/]/).at(-1)
  .replace(/\.[^.]*$/,'').replace(/[\x00-\x1f\x7f<>:"|?*\u202a-\u202e\u2066-\u2069]/g,'')
  .replace(/^[.\s]+|[.\s]+$/g,'');
 let name='',bytes=0;
 // Keep Unicode code points intact and filenames below common filesystem byte limits.
 for(const character of Array.from(base).slice(0,100)){
  bytes+=Buffer.byteLength(character);if(bytes>180)break;name+=character;
 }
 return name||'anh';
};

async function makeZip(entries,destination,signal){
 const zip=new yazl.ZipFile(),readers=new Set();
 const stop=()=>{for(const reader of readers)reader.destroy(signal.reason);zip.outputStream.destroy(signal.reason);};
 signal.addEventListener('abort',stop,{once:true});
 zip.on('error',error=>zip.outputStream.destroy(error));
 try{
  for(const entry of entries)zip.addReadStreamLazy(entry.name,{compress:false,size:entry.bytes,mode:0o100600},callback=>{
   if(signal.aborted)return callback(signal.reason);
   const reader=createReadStream(entry.path);readers.add(reader);reader.once('close',()=>readers.delete(reader));callback(null,reader);
  });
  zip.end();
  await pipeline(zip.outputStream,createWriteStream(destination,{mode:0o600}),{signal});
 }finally{signal.removeEventListener('abort',stop);for(const reader of readers)reader.destroy();}
}

export function registerGalleryDownloads(app,{db,storage,allowed}){
 const active=new Set();
 const reserve=(albumId,res)=>{
  active.add(albumId);let released=false;
  // A file stream may close after the completed response. Release promptly,
  // and never let the old request release a newer request's slot in finally.
  const release=()=>{if(!released){released=true;active.delete(albumId);}};
  res.once('finish',release);
  return ()=>{res.removeListener('finish',release);release();};
 };
 app.post('/api/gallery/:id/download',(req,res,next)=>{
  const run=async()=>{
   res.set('Cache-Control','private,no-store');
   const ids=req.body.photos;
   // Authenticate before looking up individual photo IDs or exposing selections.
   const authorize=async()=>{
    const album=await db.get("SELECT * FROM albums WHERE id=? AND status='private'",[req.params.id]);
    if(!album)throw fail(404,'Bộ ảnh riêng không còn khả dụng.');
    if(!await allowed(req,album))throw fail(401,'Vui lòng nhập lại mật khẩu để tải ảnh.');
    return album;
   };
   const album=await authorize();
   if(!Array.isArray(ids)||!ids.length||ids.length>downloadPolicy.maxPhotos||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||! /^[a-f0-9]{32}$/.test(id)))throw fail(422,'Hãy chọn từ 1 đến 50 ảnh cho mỗi tệp tải xuống.');
   const selected=async()=>{
    const photos=await db.all(`SELECT p.* FROM photos p JOIN selections s ON s.photo_id=p.id AND s.album_id=p.album_id LEFT JOIN album_sections section ON section.id=p.section_id WHERE p.album_id=? AND p.id IN (${ids.map(()=>'?').join(',')}) ORDER BY CASE WHEN section.id IS NULL THEN 1 ELSE 0 END,section.position,section.id,p.position,p.id`,[album.id,...ids]);
    if(photos.length!==ids.length)throw fail(409,'Danh sách ảnh đã chọn đã thay đổi. Hãy cập nhật danh sách rồi tải lại.');
    return photos;
   };
   const photos=await selected();
   // The client can disconnect while authentication/selection queries are pending.
   // In that case the close event has already fired: do not reserve a worker slot.
   if(req.aborted||res.destroyed)return;
   if(active.has(album.id)||active.size>=downloadPolicy.maxConcurrent){res.set('Retry-After','5');throw fail(429,'Đang chuẩn bị lượt tải khác. Vui lòng thử lại sau ít giây.');}
   const releaseSlot=reserve(album.id,res);
   const controller=new AbortController(),signal=controller.signal;
   const disconnected=()=>controller.abort();
   res.once('close',disconnected);
   if(res.destroyed||req.aborted)controller.abort();
   const timeout=setTimeout(()=>controller.abort(),180000);timeout.unref();
   let directory;
   try{
    signal.throwIfAborted();
    directory=await mkdtemp(path.join(tmpdir(),'chicong-download-'));
    const entries=[];let total=0;
    for(const [index,photo] of photos.entries()){
     signal.throwIfAborted();
     // Older albums only have a full WebP. Never use their small thumbnail.
     const data=photo.download_bytes!=null?await storage.get(photo.filename+'-download.jpg',{signal}):await encodeDownloadJpeg(await storage.get(photo.filename+'.webp',{signal}),{onDemand:true});
     signal.throwIfAborted();total+=data.length;
     if(total>downloadPolicy.maxBytes-65536)throw fail(413,'Tệp tải xuống quá lớn. Hãy chọn ít ảnh hơn rồi tải lại.');
     const file=path.join(directory,index+'.jpg');
     await writeFile(file,data,{mode:0o600,signal});
     entries.push({path:file,bytes:data.length,name:String(index+1).padStart(3,'0')+'-'+safeName(photo.original||photo.caption)+'.jpg'});
    }
    const single=entries.length===1,file=single?entries[0].path:path.join(directory,'photos.zip');
    if(!single)await makeZip(entries,file,signal);
    signal.throwIfAborted();
    // A password change, closed album or new selection can invalidate a long preparation.
    await authorize();await selected();signal.throwIfAborted();
    const size=(await stat(file)).size;
    if(size>downloadPolicy.maxBytes)throw fail(413,'Tệp tải xuống quá lớn. Hãy chọn ít ảnh hơn rồi tải lại.');
    res.attachment(single?entries[0].name:safeName(album.title)+'-'+entries.length+'-anh.zip');
    res.set({'Content-Type':single?'image/jpeg':'application/zip','Content-Length':String(size),'X-Photo-Count':String(entries.length)});
    await pipeline(createReadStream(file),res,{signal});
   }catch(error){
    if(res.destroyed)return;
    if(error.status)throw error;
    throw fail(503,'Chưa chuẩn bị được ảnh để tải xuống. Vui lòng thử lại sau ít phút.');
   }finally{
    clearTimeout(timeout);res.removeListener('close',disconnected);releaseSlot();
    if(directory)await rm(directory,{recursive:true,force:true});
   }
  };
  run().catch(next);
 });
 // Direct links use the same capacity budget as selected archives. In particular,
 // legacy WebP conversion must not create unlimited sharp jobs on repeated clicks.
 const singlePhoto=(privateGallery)=>(req,res,next)=>{
  const run=async()=>{
   res.set('Cache-Control','private,no-store');
   const authorize=async()=>{
    const album=privateGallery?await db.get("SELECT * FROM albums WHERE id=? AND status='private'",[req.params.id]):await findAlbum(db,req.params.key);
    if(!album)throw fail(404,'Không tìm thấy bộ ảnh.');
    if(!await allowed(req,album))throw fail(privateGallery?401:404,privateGallery?'Vui lòng nhập lại mật khẩu để tải ảnh.':'Không tìm thấy bộ ảnh.');
    const photo=await db.get('SELECT * FROM photos WHERE id=? AND album_id=?',[req.params.photoId,album.id]);
    if(!photo)throw fail(404,'Không tìm thấy ảnh.');
    return {album,photo};
   };
   const {album,photo}=await authorize();
   if(req.aborted||res.destroyed)return;
   if(Number(photo.download_bytes)>downloadPolicy.maxBytes)throw fail(413,'Tệp ảnh quá lớn để tải xuống. Vui lòng liên hệ nhiếp ảnh gia.');
   const filename=safeName(photo.original||photo.caption)+'.jpg';
   if(req.method==='HEAD'){
    res.attachment(filename).type('jpeg');
    if(photo.download_bytes!=null)res.set('Content-Length',String(photo.download_bytes));
    return res.end();
   }
   if(active.has(album.id)||active.size>=downloadPolicy.maxConcurrent){res.set('Retry-After','5');throw fail(429,'Đang chuẩn bị lượt tải khác. Vui lòng thử lại sau ít giây.');}
   const releaseSlot=reserve(album.id,res);
   const controller=new AbortController(),signal=controller.signal;
   const disconnected=()=>controller.abort();
   res.once('close',disconnected);
   const timeout=setTimeout(()=>controller.abort(),180000);timeout.unref();
   try{
    signal.throwIfAborted();
    const data=photo.download_bytes!=null?await storage.get(photo.filename+'-download.jpg',{signal}):await encodeDownloadJpeg(await storage.get(photo.filename+'.webp',{signal}),{onDemand:true});
    signal.throwIfAborted();
    if(data.length>downloadPolicy.maxBytes)throw fail(413,'Tệp ảnh quá lớn để tải xuống. Vui lòng liên hệ nhiếp ảnh gia.');
    // Storage or conversion can take time; access may have been revoked meanwhile.
    await authorize();signal.throwIfAborted();
    res.attachment(filename);
    res.set({'Content-Type':'image/jpeg','Content-Length':String(data.length)});
    // Keep the slot until the response finishes, rather than only until res.send().
    await pipeline(Readable.from([data]),res,{signal});
   }catch(error){
    if(res.destroyed)return;
    if(error.status)throw error;
    throw fail(503,'Chưa chuẩn bị được ảnh để tải xuống. Vui lòng thử lại sau ít phút.');
   }finally{
    clearTimeout(timeout);res.removeListener('close',disconnected);releaseSlot();
   }
  };
  run().catch(next);
 };
 app.get('/api/gallery/:id/photos/:photoId/download',singlePhoto(true));
 app.get('/api/albums/:key/photos/:photoId/download',singlePhoto(false));
}
