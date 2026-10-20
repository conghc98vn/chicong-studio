import {saveSubmission,selectionRevisions} from './selection-submission.mjs';
import {createHash} from 'node:crypto';
export const photoVersion=photos=>createHash('sha256').update(photos.map(p=>p.id).join(',')).digest('hex');
// Public and admin metadata versions exclude selections and private password material.
export function catalogVersion(album,photos,sections){
 const fields=(row,keys)=>keys.map(key=>row[key]??null);
 return createHash('sha256').update(JSON.stringify([
  fields(album,['id','slug','title','category','description','status','event_date','cover_id','created','client_name']),!!album.password,
  photos.map(p=>fields(p,['id','filename','caption','original','width','height','position','section_id','source_bytes','image_bytes','thumb_bytes','download_bytes'])),
  sections.map(s=>fields(s,['id','title','position']))
 ])).digest('hex');
}
export function galleryVersion(album,photos,sections){
 return createHash('sha256').update(JSON.stringify([
  album.title,album.description,album.event_date,!!album.password,
  photos.map(p=>[p.id,p.filename,p.original,p.caption,p.width,p.height,p.position,p.section_id]),
  sections.map(s=>[s.id,s.title,s.position])
 ])).digest('hex');
}
const fail=(status,message)=>Object.assign(Error(message),{status});
const handler=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);

// Public polling needs only two digests, not another copy of every photo. The
// catalogue triggers cover every photo/section field in galleryVersion. Keep
// admin catalogVersion uncached: its byte counts (and album.created) are not
// covered by those triggers. Transaction handles must not publish a cache entry
// because their writes and revision increments may subsequently roll back.
const galleryVersionsByDatabase=new WeakMap();
const maxCachedGalleries=128;
const galleryAlbumKey=album=>JSON.stringify([album.title,album.description,album.event_date,!!album.password]);
async function publicGalleryVersions(db,albumId,album,revision){
 const cacheable=typeof db.transaction==='function'&&revision!=null;
 let cache=cacheable?galleryVersionsByDatabase.get(db):null;
 if(cacheable&&!cache){cache=new Map();galleryVersionsByDatabase.set(db,cache);}
 const key=JSON.stringify([String(revision),galleryAlbumKey(album)]),cached=cache?.get(albumId);
 if(cached?.key===key){cache.delete(albumId);cache.set(albumId,cached);return cached.versions;}
 const photos=await db.all('SELECT id,filename,caption,original,width,height,position,section_id FROM photos WHERE album_id=? ORDER BY position,id',[albumId]);
 const sections=await db.all('SELECT id,title,position FROM album_sections WHERE album_id=? ORDER BY position,id',[albumId]);
 const versions={photo_version:photoVersion(photos),gallery_version:galleryVersion(album,photos,sections)};
 // A concurrent publication can fall between the two reads above. Never save
 // that mixed snapshot under an earlier revision for subsequent poll requests.
 if(cache){
  const after=await db.get('SELECT catalog_revision FROM albums WHERE id=?',[albumId]);
  if(after&&String(after.catalog_revision)===String(revision)){
   cache.delete(albumId);cache.set(albumId,{key,versions});
   if(cache.size>maxCachedGalleries)cache.delete(cache.keys().next().value);
  }
 }
 return versions;
}

export async function selectionState(db,albumId,{catalogAlbum,galleryAlbum}={}){
 const revisionAlbum=await db.get('SELECT catalog_revision,selection_revision,submission_generation,drive_review_required FROM albums WHERE id=?',[albumId]);
 const submission=await db.get('SELECT stale FROM gallery_submissions WHERE album_id=? ORDER BY submission_generation DESC LIMIT 1',[albumId]);
 const rows=await db.all('SELECT a.selection_status,s.photo_id FROM albums a LEFT JOIN selections s ON s.album_id=a.id WHERE a.id=? ORDER BY s.photo_id',[albumId]);
 let versions;
 if(galleryAlbum&&!catalogAlbum)versions=await publicGalleryVersions(db,albumId,galleryAlbum,revisionAlbum?.catalog_revision);
 else{
  const photos=await db.all('SELECT '+(catalogAlbum?'id,filename,caption,original,width,height,position,section_id,source_bytes,image_bytes,thumb_bytes,download_bytes':'id')+' FROM photos WHERE album_id=? ORDER BY position,id',[albumId]);
  const sections=catalogAlbum?await db.all('SELECT id,title,position FROM album_sections WHERE album_id=? ORDER BY position,id',[albumId]):[];
  versions={photo_version:photoVersion(photos),...(catalogAlbum?{catalog_version:catalogVersion(catalogAlbum,photos,sections)}:{}),...(galleryAlbum?{gallery_version:galleryVersion(galleryAlbum,photos,sections)}:{})};
 }
 return {...selectionRevisions(revisionAlbum||{}),submission_stale:!!submission?.stale,selected:rows.map(row=>row.photo_id).filter(Boolean),selection_status:rows[0]?.selection_status||'draft',...versions};
}

export function registerGallerySelection(app,{db,allowed,requireRevisions=false}){
 const authorize=async(req,connection,lock=false)=>{
  const album=await connection.get("SELECT * FROM albums WHERE id=? AND status='private'"+(lock&&connection.cloud?' FOR UPDATE':''),[req.params.id]);
  if(!album||!await allowed(req,album,connection))throw fail(401,'Vui lòng nhập mật khẩu để mở bộ ảnh riêng.');
  return album;
 };
 app.get('/api/gallery/:id/selection',handler(async(req,res)=>{
  const a=await authorize(req,db);res.set('Cache-Control','private,no-store').json(await selectionState(db,req.params.id,{galleryAlbum:a}));
 }));
 app.put('/api/gallery/:id/selection/:photo',handler(async(req,res)=>{
  if(typeof req.body.selected!=='boolean')throw fail(422,'Chưa lưu được lựa chọn ảnh. Vui lòng tải lại trang rồi thử lại.');
  const state=await db.transaction(async tx=>{
   const a=await authorize(req,tx,true);
   if(!await tx.get('SELECT id FROM photos WHERE id=? AND album_id=?',[req.params.photo,a.id]))throw fail(404,'Không tìm thấy ảnh.');
   const selected=!!await tx.get('SELECT photo_id FROM selections WHERE album_id=? AND photo_id=?',[a.id,req.params.photo]);
   // Replaying an acknowledged or timed-out request must not reopen an unchanged submission.
   if(selected!==req.body.selected){
    if(req.body.selected)await tx.run('INSERT INTO selections(album_id,photo_id,updated) VALUES(?,?,?)',[a.id,req.params.photo,new Date().toISOString()]);
    else await tx.run('DELETE FROM selections WHERE album_id=? AND photo_id=?',[a.id,req.params.photo]);
    await tx.run("UPDATE albums SET selection_status='draft' WHERE id=?",[a.id]);
   }
   return selectionState(tx,a.id);
  });
  res.json({success:true,...state});
 }));
 app.post('/api/gallery/:id/submit',handler(async(req,res)=>{
  const result=await db.transaction(async tx=>{
   const album=await authorize(req,tx,true);
   const state=await selectionState(tx,album.id);
   return saveSubmission(tx,album,req.body,state,{requireRevisions});
  });
  if(result.conflict)return res.status(409).json({...result,error:'Bộ ảnh hoặc lựa chọn đã thay đổi. Hãy cập nhật và xem lại trước khi gửi.'});
  res.json({success:true,...result});
 }));
}
