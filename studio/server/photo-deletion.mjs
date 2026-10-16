// The database is the visibility boundary. Persist cleanup work in the same
// transaction as deletion so a storage outage cannot leave a broken live photo.
export function photoDeletion({db,storage,mediaControl,enabled=true}){
 let cleaning,pending=true,nextProbe=0,timer,closed=!enabled;
 const schedule=(delay=0)=>{
  pending=true;if(closed||timer||cleaning)return;
  timer=setTimeout(()=>{timer=null;void cleanup(true).catch(()=>{});},delay);timer.unref?.();
 };
 const initialize=async()=>{pending=!!await db.get('SELECT photo_id FROM photo_cleanup LIMIT 1');nextProbe=Date.now()+60000;if(pending)schedule();};
 const cleanup=(force=false,{owner}={})=>{
  if(closed)return Promise.resolve();
  if(force)pending=true;
  if(cleaning)return force?cleaning.then(()=>cleanup(true,{owner})):cleaning;
  if(!pending&&Date.now()<nextProbe)return Promise.resolve();
  if(timer){clearTimeout(timer);timer=null;}
  return cleaning??=(async()=>{
   const perform=async()=>{
   pending=false;let cursor='';
   // Keyset scanning drains all batches without a failed object starving later jobs.
   for(;;){
    const jobs=await db.all('SELECT * FROM photo_cleanup WHERE photo_id>? ORDER BY photo_id LIMIT 24',[cursor]);
    for(const job of jobs){
     if(closed)break;
     cursor=job.photo_id;
     try{
      for(const suffix of ['.webp','-thumb.webp',...(job.has_download?['-download.jpg']:[])])await storage.remove(job.filename+suffix);
      await db.run('DELETE FROM photo_cleanup WHERE photo_id=?',[job.photo_id]);
     }catch{pending=true;}
    }
    if(closed||jobs.length<24)break;
   }
   nextProbe=Date.now()+60000;
   };
   return mediaControl?mediaControl.run('cleanup',perform,{owner,independent:true}):perform();
  })().catch(error=>{pending=true;throw error;}).finally(()=>{cleaning=null;if(pending)schedule(30000);});
 };
 const close=async()=>{closed=true;clearTimeout(timer);await cleaning?.catch(()=>{});};
 const remove=async(photoId,{background=false}={})=>{
  // Read the album first, then lock it before touching photos/selections. All
  // selection writers use this same lock order on PostgreSQL.
  const existing=await db.get('SELECT album_id FROM photos WHERE id=?',[photoId]);
  if(!existing){if(await db.get('SELECT photo_id FROM photo_cleanup WHERE photo_id=?',[photoId])){if(background)schedule();else await cleanup();return;}throw Object.assign(Error('Không tìm thấy ảnh.'),{status:404});}
  await db.transaction(async tx=>{
   await tx.get('SELECT id FROM albums WHERE id=?'+(tx.cloud?' FOR UPDATE':''),[existing.album_id]);
   const p=await tx.get('SELECT * FROM photos WHERE id=?',[photoId]);if(!p)return;
   const selected=await tx.get('SELECT photo_id FROM selections WHERE album_id=? AND photo_id=?',[p.album_id,p.id]);
   await tx.run('INSERT INTO photo_cleanup(photo_id,filename,has_download) VALUES(?,?,?) ON CONFLICT(photo_id) DO NOTHING',[p.id,p.filename,p.download_bytes==null?0:1]);
   await tx.run('DELETE FROM photos WHERE id=?',[p.id]);
   const cover=await tx.get('SELECT id FROM photos WHERE album_id=? ORDER BY position,id LIMIT 1',[p.album_id]);
   await tx.run('UPDATE albums SET cover_id=? WHERE id=? AND cover_id=?',[cover?.id||null,p.album_id,p.id]);
   if(selected)await tx.run("UPDATE albums SET selection_status='draft' WHERE id=?",[p.album_id]);
  });
  pending=true;if(background)schedule();else await cleanup();
 };
 const removeMany=async(albumId,ids)=>{
  const fail=(status,message)=>Object.assign(Error(message),{status});
  if(!Array.isArray(ids)||!ids.length||ids.length>1000||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id)))throw fail(422,'Chọn từ 1 đến 1.000 ảnh để xóa.');
  const count=await db.transaction(async tx=>{
   const a=await tx.get('SELECT id,cover_id FROM albums WHERE id=?'+(tx.cloud?' FOR UPDATE':''),[albumId]);if(!a)throw fail(404,'Không tìm thấy bộ ảnh.');
   const marks=ids.map(()=>'?').join(',');
   const photos=await tx.all('SELECT * FROM photos WHERE id IN ('+marks+')',ids);
   if(photos.some(p=>p.album_id!==albumId))throw fail(422,'Danh sách chứa ảnh thuộc bộ ảnh khác.');
   const picked=await tx.get('SELECT photo_id FROM selections WHERE album_id=? AND photo_id IN ('+marks+') LIMIT 1',[albumId,...ids]);
   for(const p of photos)await tx.run('INSERT INTO photo_cleanup(photo_id,filename,has_download) VALUES(?,?,?) ON CONFLICT(photo_id) DO NOTHING',[p.id,p.filename,p.download_bytes==null?0:1]);
   await tx.run('DELETE FROM photos WHERE album_id=? AND id IN ('+marks+')',[albumId,...ids]);
   if(ids.includes(a.cover_id)){const cover=await tx.get('SELECT id FROM photos WHERE album_id=? ORDER BY position,id LIMIT 1',[albumId]);await tx.run('UPDATE albums SET cover_id=? WHERE id=?',[cover?.id||null,albumId]);}
   if(picked)await tx.run("UPDATE albums SET selection_status='draft' WHERE id=?",[albumId]);
   return photos.length;
  });
  schedule();return count;
 };
 return {remove,removeMany,cleanup,initialize,schedule,close};
}
