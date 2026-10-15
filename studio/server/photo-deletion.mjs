// The database is the visibility boundary. Persist cleanup work in the same
// transaction as deletion so a storage outage cannot leave a broken live photo.
export function photoDeletion({db,storage}){
 let cleaning,pending=true,nextProbe=0;
 const initialize=async()=>{pending=!!await db.get('SELECT photo_id FROM photo_cleanup LIMIT 1');nextProbe=Date.now()+60000;};
 const cleanup=()=>{
  if(!pending&&Date.now()<nextProbe)return Promise.resolve();
  return cleaning??=(async()=>{
  const jobs=await db.all('SELECT * FROM photo_cleanup ORDER BY photo_id LIMIT 24');
  pending=jobs.length>=24;nextProbe=Date.now()+60000;
  for(const job of jobs){
   try{
    for(const suffix of ['.webp','-thumb.webp',...(job.has_download?['-download.jpg']:[])])await storage.remove(job.filename+suffix);
    await db.run('DELETE FROM photo_cleanup WHERE photo_id=?',[job.photo_id]);
   }catch{pending=true; /* Retry on the next admin visit or deletion. */ }
  }
  })().finally(()=>{cleaning=null;});
 };
 const remove=async photoId=>{
  // Read the album first, then lock it before touching photos/selections. All
  // selection writers use this same lock order on PostgreSQL.
  const existing=await db.get('SELECT album_id FROM photos WHERE id=?',[photoId]);
  if(!existing){if(await db.get('SELECT photo_id FROM photo_cleanup WHERE photo_id=?',[photoId])){await cleanup();return;}throw Object.assign(Error('Không tìm thấy ảnh.'),{status:404});}
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
  pending=true;await cleanup();
 };
 return {remove,cleanup,initialize};
}
