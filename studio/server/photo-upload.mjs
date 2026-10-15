import {createHash} from 'node:crypto';
import {id} from './db.mjs';
import {optimizePhoto,photoOptimization} from './image-optimizer.mjs';
import {decodePreparedPhoto,isPreparedPhoto} from './prepared-photo.mjs';
import {validateSection} from './album-sections.mjs';
// Browser multipart headers carry UTF-8 bytes; Multer decodes legacy parameters as Latin-1.
const multipartName=value=>{if([...value].some(c=>c.codePointAt(0)>255))return value;try{return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(value,'latin1'));}catch{return value;}};
const nameKey=value=>multipartName(value).normalize('NFC').toLowerCase();
const issue=(message,code='UPLOAD_CONFLICT')=>Object.assign(Error(message),{code,retryable:false});
// Stage immutable files first; publish them only after all renditions are durable.
// Album locking serializes duplicate decisions with other uploads and selections.
export async function uploadPhoto({db,storage,albumId,file,uploadKey,policy,sectionId,trace,onCleanup=()=>{}}){
 const key=id(),hash=createHash('sha256').update(file.buffer).digest('hex');
 let published=false,staged=false,publishing=false;
 const previous=async tx=>{
  if(!uploadKey)return;
  const receipt=await tx.get('SELECT file_hash,result FROM photo_upload_receipts WHERE album_id=? AND upload_key=?',[albumId,uploadKey]);
  if(receipt){if(receipt.file_hash!==hash)throw issue('Lượt tải này đã lưu một tệp khác. Hãy chọn lại ảnh.');return {...JSON.parse(receipt.result),reused:true};}
  const old=await tx.get('SELECT * FROM photos WHERE album_id=? AND upload_key=?',[albumId,uploadKey]);
  if(old){if(old.upload_hash!==hash)throw issue('Lượt tải này đã lưu một tệp khác. Hãy chọn lại ảnh.');return {success:true,id:old.id,reused:true,optimization:photoOptimization(old)};}
 };
 const remember=async(tx,result)=>{if(uploadKey)await tx.run('INSERT INTO photo_upload_receipts(album_id,upload_key,file_hash,result) VALUES(?,?,?,?)',[albumId,uploadKey,hash,JSON.stringify(result)]);return result;};
 try{
  const old=await trace.run('deduplicate',()=>previous(db));if(old)return old;
  const prepared=/\.ccphoto$/i.test(file.originalname)||isPreparedPhoto(file.buffer);
  const decoded=prepared?await trace.run('prepared_validate',()=>decodePreparedPhoto(file.buffer)):await optimizePhoto(file.buffer,{runStage:(name,fn)=>trace.run('optimize_'+name,fn)});
  const original=(decoded.originalName||multipartName(file.originalname)).trim().normalize('NFC').slice(0,180);
  const {data,thumbnail,download,optimization:o}=decoded;
  // Even skips validate the image; a corrupt file is not reported as a successful upload.
  if(policy==='skip'){
   const skipped=await db.transaction(async tx=>{
    if(!await tx.get('SELECT id FROM albums WHERE id=?'+(tx.cloud?' FOR UPDATE':''),[albumId]))throw issue('Bộ ảnh không còn tồn tại.','ALBUM_REMOVED');
    const replay=await previous(tx);if(replay)return replay;
    const match=(await tx.all('SELECT id,original FROM photos WHERE album_id=? ORDER BY position,id',[albumId])).find(p=>nameKey(p.original)===nameKey(original));
    return match?remember(tx,{success:true,id:match.id,skipped:true,reused:false}):null;
   });
   if(skipped)return skipped;
  }
  staged=true;
  await trace.run('store_webp',()=>storage.put(key+'.webp',data));await trace.run('store_thumbnail',()=>storage.put(key+'-thumb.webp',thumbnail));await trace.run('store_jpeg',()=>storage.put(key+'-download.jpg',download));
  publishing=true;
  const result=await db.transaction(async tx=>{
   if(!await tx.get('SELECT id FROM albums WHERE id=?'+(tx.cloud?' FOR UPDATE':''),[albumId]))throw issue('Bộ ảnh không còn tồn tại.','ALBUM_REMOVED');
   const replay=await previous(tx);if(replay)return replay;
   const matches=(await tx.all('SELECT * FROM photos WHERE album_id=? ORDER BY position,id',[albumId])).filter(p=>nameKey(p.original)===nameKey(original));
   if(matches.length&&policy==='skip')return remember(tx,{success:true,id:matches[0].id,skipped:true,reused:false});
   if(matches.length>1)throw issue('Có nhiều ảnh cùng tên trong bộ ảnh. Hãy xử lý ảnh trùng trước khi ghi đè.','AMBIGUOUS_FILENAME');
   const target=matches[0];
   const section=target?target.section_id:await validateSection(tx,albumId,sectionId);
   trace.mark('database_insert');
   if(target){
    // Keep identity, customer selections, cover, caption, section and position.
    await tx.run('UPDATE photos SET filename=?,width=?,height=?,source_bytes=?,image_bytes=?,thumb_bytes=?,download_bytes=? WHERE id=?',[key,o.width,o.height,o.source_bytes,o.image_bytes,o.thumb_bytes,o.download_bytes,target.id]);
    await tx.run('INSERT INTO photo_cleanup(photo_id,filename,has_download) VALUES(?,?,?) ON CONFLICT(photo_id) DO NOTHING',[id(),target.filename,target.download_bytes==null?0:1]);
   }else{
    await tx.run('INSERT INTO photos(id,album_id,filename,original,caption,width,height,position,upload_key,upload_hash,section_id,source_bytes,image_bytes,thumb_bytes,download_bytes) SELECT ?,?,?,?,?,?,?,COALESCE(MAX(position),-1)+1,?,?,?,?,?,?,? FROM photos WHERE album_id=?',[key,albumId,key,original,original.replace(/\.[^.]+$/,''),o.width,o.height,uploadKey,hash,section,o.source_bytes,o.image_bytes,o.thumb_bytes,o.download_bytes,albumId]);
    await tx.run('UPDATE albums SET cover_id=? WHERE id=? AND cover_id IS NULL',[key,albumId]);
   }
   return remember(tx,{success:true,id:target?.id||key,reused:false,replaced:!!target,optimization:o});
  });
  published=!result.reused&&!result.skipped;trace.mark('saved');return result;
 }finally{
  if(staged&&!published){
   // A lost COMMIT acknowledgement does not mean the transaction rolled back.
   // Wait for its album lock before checking references. Preserve files when the
   // database cannot establish the outcome; retry receipts recover the upload.
   const unused=!publishing||await db.transaction(async tx=>{
    await tx.get('SELECT id FROM albums WHERE id=?'+(tx.cloud?' FOR UPDATE':''),[albumId]);
    return !await tx.get('SELECT id FROM photos WHERE filename=?',[key]);
   }).catch(()=>false);
   if(unused){
    trace.mark('rollback');
    // Keep failed staging cleanup durable when storage is unavailable too.
    // The reference check above must precede queuing any destructive work.
    let queued=false;
    try{await db.run('INSERT INTO photo_cleanup(photo_id,filename,has_download) VALUES(?,?,1) ON CONFLICT(photo_id) DO NOTHING',[key,key]);queued=true;}catch{trace.mark('cleanup_queue_failed');}
    const removed=await Promise.allSettled(['.webp','-thumb.webp','-download.jpg'].map(s=>storage.remove(key+s)));
    if(queued&&removed.every(r=>r.status==='fulfilled'))await db.run('DELETE FROM photo_cleanup WHERE photo_id=?',[key]).catch(()=>{});
    else if(queued)onCleanup();
   }else if(publishing)onCleanup();
  }
 }
}
