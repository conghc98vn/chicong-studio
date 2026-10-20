import sharp from 'sharp';
import {driveError,driveId} from './drive-client.mjs';

export const FOLDER_PREVIEW_TTL_MS = 5*60*1000;
export const FOLDER_PREVIEW_MAX_BYTES = 48*1024;
const MAX_ROWS = 60;
const MAX_INPUT = 512*1024;
const initialized = new WeakMap();
const validMime = value => ['image/jpeg','image/png','image/webp'].includes(value);

// Bound even adapters/auth providers which do not honour AbortSignal. The
// underlying fetch is also canceled; late results never enter the cache.
async function bounded(operation,signal) {
  signal.throwIfAborted();
  let abort;
  try {
    return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject) => {
      abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
    })]);
  } finally { signal.removeEventListener('abort',abort); }
}
export function thumbnailUrl(value) {
  let url;
  try { url=new URL(value); } catch { throw driveError('drive_thumbnail_unavailable'); }
  if (typeof value !== 'string' || value.length>4096 || url.protocol!=='https:' || url.username || url.password || url.port || url.hash ||
      !(/^lh[0-9]+\.googleusercontent\.com$/.test(url.hostname) || url.hostname==='drive.google.com' && url.pathname==='/thumbnail')) throw driveError('drive_thumbnail_unavailable');
  return url;
}
export async function fetchDriveThumbnail(value,{signal,fetchImpl=fetch,getHeaders=async()=>({})}={}) {
  const url=thumbnailUrl(value);
  const deadline=AbortSignal.timeout(3000);
  signal=signal ? AbortSignal.any([signal,deadline]) : deadline;
  const headers=await bounded(getHeaders,signal);
  const response=await bounded(()=>fetchImpl(url,{headers,signal,redirect:'error'}),signal);
  if (!response.ok || !validMime((response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()) || Number(response.headers.get('content-length'))>MAX_INPUT) {
    void response.body?.cancel().catch(()=>{});throw driveError('drive_thumbnail_unavailable');
  }
  if (!response.body) throw driveError('drive_thumbnail_unavailable');
  const reader=response.body.getReader();
  let bytes=0;const chunks=[];
  try {
    for (;;) {
      const {done,value:chunk}=await bounded(()=>reader.read(),signal);
      if (done) break;
      bytes+=chunk.length;
      if (bytes>MAX_INPUT) throw driveError('drive_thumbnail_too_large');
      chunks.push(Buffer.from(chunk));
    }
  } finally { void reader.cancel().catch(()=>{}); }
  if (!bytes) throw driveError('drive_thumbnail_unavailable');
  return Buffer.concat(chunks,bytes);
}
export async function initializeFolderPreviews(db) {
  if (!initialized.has(db)) initialized.set(db,(async()=>{
    try {
      await db.exec(`CREATE TABLE IF NOT EXISTS drive_folder_preview_cache (
        job_id TEXT NOT NULL REFERENCES drive_sync_jobs(id) ON DELETE CASCADE,
        file_id TEXT NOT NULL, folder_id TEXT NOT NULL, image_base64 TEXT NOT NULL,
        created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
        PRIMARY KEY(job_id,file_id)
      )`);
    } catch(error) {
      if(error.code!=='23505') throw error;
      await db.get('SELECT job_id FROM drive_folder_preview_cache LIMIT 1');
    }
    if(db.cloud) await db.exec('ALTER TABLE drive_folder_preview_cache ENABLE ROW LEVEL SECURITY');
  })().catch(error=>{initialized.delete(db);throw error;}));
  await initialized.get(db);
}
export async function cleanupFolderPreviews(db) {
  await initializeFolderPreviews(db);
  await db.run('DELETE FROM drive_folder_preview_cache WHERE expires_at<=?',[Date.now()]);
}

// Optional capability: old adapters remain usable for navigation. A single
// six-row metadata request samples the current folder, never its descendants.
export async function collectFolderPreviews(drive,folderId,{signal}={}) {
  if (typeof drive.listPreviewImages!=='function' || typeof drive.thumbnail!=='function') return {images:[],unavailable:true};
  const timeout=AbortSignal.timeout(8000);
  const budget=signal ? AbortSignal.any([signal,timeout]) : timeout;
  const images=[];let unavailable=false;
  try {
    const page=await bounded(()=>drive.listPreviewImages(folderId,{signal:budget}),budget);
    if (page?.incompleteSearch || !Array.isArray(page?.files) || page.files.length>6) throw driveError('drive_thumbnail_unavailable');
    const seen=new Set();
    for(const file of page.files) {
      driveId(file?.id);
      if(seen.has(file.id) || typeof file.name!=='string' || file.name.length>2048 || !validMime(file.mimeType) || file.trashed || file.driveId ||
        file.parents!==undefined && (!Array.isArray(file.parents) || file.parents.length>1 || file.parents.length===1 && file.parents[0]!==folderId)) throw driveError('drive_thumbnail_unavailable');
      seen.add(file.id);
    }
    let index=0;
    await Promise.all([0,1].map(async()=>{
      for(;;) {
        const order=index++;const file=page.files[order];if(!file) break;
        try {
          if(file.capabilities?.canDownload===false || !file.thumbnailLink) throw driveError('drive_thumbnail_unavailable');
          thumbnailUrl(file.thumbnailLink);
          const input=await bounded(()=>drive.thumbnail(file.thumbnailLink,{signal:budget}),budget);
          if(!Buffer.isBuffer(input) || !input.length || input.length>MAX_INPUT) throw driveError('drive_thumbnail_too_large');
          const decoder=sharp(input,{limitInputPixels:4*1024*1024,animated:false,failOn:'warning'});
          const metadata=await bounded(()=>decoder.metadata(),budget);
          if(!['jpeg','png','webp'].includes(metadata.format) || (metadata.pages||1)>1) throw driveError('drive_thumbnail_unavailable');
          const bytes=await bounded(()=>decoder.rotate().resize(240,240,{fit:'inside',withoutEnlargement:true}).webp({quality:65}).toBuffer(),budget);
          if(!bytes.length || bytes.length>FOLDER_PREVIEW_MAX_BYTES) throw driveError('drive_thumbnail_too_large');
          images.push({id:file.id,name:file.name,bytes,order});
        } catch { unavailable=true; }
      }
    }));
  } catch { unavailable=true; }
  signal?.throwIfAborted();
  return {images:images.sort((a,b)=>a.order-b.order),unavailable};
}

// Caller holds the connection lock and the valid job lease, serializing cache
// capacity across workers. At most 60 normalized 48KiB images (4MiB base64).
export async function saveFolderPreviews(tx,lease,folderId,result) {
  const now=Date.now();
  await tx.run('DELETE FROM drive_folder_preview_cache WHERE expires_at<=? OR job_id=?',[now,lease.id]);
  const rows=await tx.all('SELECT job_id,file_id FROM drive_folder_preview_cache ORDER BY created_at DESC,job_id,file_id');
  for(const row of rows.slice(MAX_ROWS-result.images.length)) await tx.run('DELETE FROM drive_folder_preview_cache WHERE job_id=? AND file_id=?',[row.job_id,row.file_id]);
  for(const image of result.images) await tx.run('INSERT INTO drive_folder_preview_cache(job_id,file_id,folder_id,image_base64,created_at,expires_at) VALUES(?,?,?,?,?,?)',
    [lease.id,image.id,folderId,image.bytes.toString('base64'),now,now+FOLDER_PREVIEW_TTL_MS]);
  return {images:result.images.map(image=>({id:image.id,name:image.name,url:'/api/admin/drive/browse/'+lease.id+'/images/'+image.id})),unavailable:result.unavailable};
}
export async function readFolderPreview(db,{jobId,fileId}) {
  driveId(jobId);driveId(fileId);
  // Expiry is enforced by the read itself. Cleanup belongs to the worker and
  // cache writes, so six simultaneous thumbnails do not take six write locks.
  await initializeFolderPreviews(db);
  const row=await db.get(`SELECT cache.image_base64,cache.folder_id,job.payload_json,job.progress_json FROM drive_folder_preview_cache cache
    JOIN drive_sync_jobs job ON job.id=cache.job_id
    JOIN drive_connections connection ON connection.id=job.connection_id
    WHERE cache.job_id=? AND cache.file_id=? AND cache.expires_at>?
      AND (job.status='completed' OR (job.status='running' AND job.lease_until>?)) AND job.cancel_requested=0 AND connection.status='active'
      AND job.connection_generation=connection.generation`,[jobId,fileId,Date.now(),Date.now()]);
  // Verify association without database-specific JSON operators.
  let payload,progress;
  try {payload=JSON.parse(row?.payload_json);progress=JSON.parse(row?.progress_json);} catch {}
  if(!row || payload?.operation!=='browse-folders' || payload.folderId!==row.folder_id || progress?.folder?.id!==row.folder_id ||
    !Array.isArray(progress?.preview?.images) || !progress.preview.images.some(image=>image.id===fileId)) throw driveError('drive_thumbnail_unavailable',404);
  const bytes=Buffer.from(row.image_base64,'base64');
  if(!bytes.length || bytes.length>FOLDER_PREVIEW_MAX_BYTES) throw driveError('drive_thumbnail_unavailable',404);
  return bytes;
}
