import {assertConnectionFolder} from './drive-folder-scope.mjs';
import {randomUUID} from 'node:crypto';
import {driveError,findDriveChild} from './drive-client.mjs';
import {parseDriveJson,metadataSignature,driveLock} from './drive-inventory.mjs';
import {encodeDrivePhoto} from './drive-image-encoder.mjs';
import {createDriveJobs} from './drive-jobs.mjs';

export const COMPARISON_TTL_MS = 15 * 60 * 1000;
export const COMPARISON_MAX_BYTES = 512 * 1024;
const MAX_CACHED = 20;
const initialized = new WeakMap();

// Ephemeral data is separate from job DTOs and permanent catalog storage. TEXT
// works on SQLite and Postgres, including separate worker and web processes.
export async function initializeDriveComparisons(db) {
  if (!initialized.has(db)) initialized.set(db,(async () => {
    try {
      await db.exec(`CREATE TABLE IF NOT EXISTS drive_comparison_cache (
        job_id TEXT PRIMARY KEY REFERENCES drive_sync_jobs(id) ON DELETE CASCADE,
        preview_id TEXT NOT NULL, item_id TEXT NOT NULL, photo_id TEXT NOT NULL,
        filename TEXT NOT NULL, image_base64 TEXT NOT NULL,
        created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL
      );`);
    } catch (error) {
      // Concurrent first boot on Postgres may race in its type catalog.
      if (error.code !== '23505') throw error;
      await db.get('SELECT job_id FROM drive_comparison_cache LIMIT 1');
    }
    if (db.cloud) await db.exec('ALTER TABLE drive_comparison_cache ENABLE ROW LEVEL SECURITY');
  })().catch(error => { initialized.delete(db); throw error; }));
  await initialized.get(db);
}

export async function cleanupDriveComparisons(db) {
  await initializeDriveComparisons(db);
  await db.run('DELETE FROM drive_comparison_cache WHERE expires_at<=?',[Date.now()]);
}

export async function comparisonContext(tx,{previewId,itemId,lease,jobs}) {
  const hint = await tx.get('SELECT mapping_id FROM drive_sync_jobs WHERE id=?',[previewId]);
  const linkHint = hint && await tx.get('SELECT album_id,connection_id FROM drive_album_links WHERE id=?',[hint.mapping_id]);
  if (!linkHint) throw driveError('drive_preview_unavailable',404);
  const album = await tx.get('SELECT * FROM albums WHERE id=?'+driveLock(tx),[linkHint.album_id]);
  const connection = await tx.get('SELECT * FROM drive_connections WHERE id=?'+driveLock(tx),[linkHint.connection_id]);
  const mapping = await tx.get('SELECT * FROM drive_album_links WHERE id=?'+driveLock(tx),[hint.mapping_id]);
  const preview = await tx.get('SELECT * FROM drive_sync_jobs WHERE id=?',[previewId]);
  const manifest = parseDriveJson(preview?.manifest_json);
  if (!preview || !['awaiting_review','completed'].includes(preview.status) || !manifest.complete) throw driveError('drive_preview_unavailable');
  if (!album || album.status === 'archived' || connection?.status !== 'active' || mapping?.state !== 'attached' || !mapping.enabled ||
      Number(preview.connection_generation) !== Number(connection.generation) || Number(preview.mapping_generation) !== Number(mapping.generation) ||
      Number(manifest.catalogRevision) !== Number(album.catalog_revision) || Number(manifest.selectionRevision) !== Number(album.selection_revision) ||
      Number(manifest.submissionGeneration) !== Number(album.submission_generation)) throw driveError('drive_preview_stale');
  const item = await tx.get('SELECT * FROM drive_sync_job_items WHERE id=? AND job_id=?',[itemId,preview.id]);
  if (!item || item.action !== 'replace') throw driveError('drive_comparison_unavailable',404);
  const descriptor = parseDriveJson(item.source_json);
  const source = await tx.get('SELECT * FROM drive_source_files WHERE id=?'+driveLock(tx),[descriptor.sourceId]);
  const photo = source?.photo_id && await tx.get('SELECT * FROM photos WHERE id=?',[source.photo_id]);
  if (!source || source.mapping_id !== mapping.id || !['active','missing_in_drive'].includes(source.state) ||
      Number(source.source_generation) !== Number(item.source_generation) || Number(source.imported_generation) !== Number(source.source_generation) ||
      !photo || photo.album_id !== album.id || photo.source !== 'google_drive' || descriptor.file?.id !== item.file_id) throw driveError('drive_source_stale');
  if (lease) {
    await jobs.assertLease(tx,lease);
    if (lease.connection_id !== connection.id || lease.mapping_id !== mapping.id ||
        Number(lease.connection_generation) !== Number(connection.generation) || Number(lease.mapping_generation) !== Number(mapping.generation)) throw driveError('drive_preview_stale');
  }
  return {album,connection,mapping,preview,item,descriptor,source,photo};
}

export async function runDriveComparison({db,jobs,lease,drive,temporary,policy,signal,maxFiles,encode=encodeDrivePhoto}) {
  await cleanupDriveComparisons(db);
  const payload = parseDriveJson(lease.payload_json);
  const load = tx => comparisonContext(tx,{previewId:payload.previewId,itemId:payload.itemId,lease,jobs});
  const initial = await db.transaction(load);
  if (drive.serviceAccountEmail !== initial.connection.service_account_email) throw driveError('drive_identity_mismatch');
  const file = initial.descriptor.file;
  async function verify() {
    signal?.throwIfAborted();
    await assertConnectionFolder(drive,initial.mapping.folder_id,initial.connection,{signal});
    const current = await drive.getFile(file.id,{signal});
    if (!current || metadataSignature(current) !== metadataSignature(file) || current.trashed || current.capabilities?.canDownload === false) throw driveError('drive_preview_stale');
    const member = current.parents?.length ? current : await findDriveChild(drive,initial.mapping.folder_id,file,{signal,maxFiles});
    if (!member || metadataSignature(member) !== metadataSignature(file) || member.parents?.length && !member.parents.includes(initial.mapping.folder_id)) throw driveError('drive_preview_stale');
  }
  await verify();
  await temporary(async destination => {
    const maxBytes = file.mimeType === 'image/jpeg' ? policy.maxBytes : 20*1024*1024;
    if (!['image/jpeg','image/png','image/webp'].includes(file.mimeType) || Number(file.size || 0) > maxBytes) throw driveError('drive_file_too_large',422);
    await drive.download(file.id,destination,{signal,maxBytes,checksum:file.md5Checksum});
    await verify();
    const encoded = await encode(destination,{policy,signal});
    const image = encoded.thumbnail;
    if (!Buffer.isBuffer(image) || !image.length || image.length > COMPARISON_MAX_BYTES || image.toString('ascii',0,4) !== 'RIFF' || image.toString('ascii',8,12) !== 'WEBP') throw driveError('drive_comparison_too_large',422);
    await verify();
    signal?.throwIfAborted();
    await db.transaction(async tx => {
      const current = await load(tx);
      if (current.photo.id !== initial.photo.id || current.photo.filename !== initial.photo.filename || current.item.source_json !== initial.item.source_json) throw driveError('drive_preview_stale');
      // The connection row held by load serializes cache capacity changes.
      await tx.run('DELETE FROM drive_comparison_cache WHERE expires_at<=?',[Date.now()]);
      const old = await tx.all('SELECT job_id FROM drive_comparison_cache ORDER BY created_at DESC,job_id');
      for (const row of old.slice(MAX_CACHED-1)) await tx.run('DELETE FROM drive_comparison_cache WHERE job_id=?',[row.job_id]);
      const created = Date.now();
      await tx.run(`INSERT INTO drive_comparison_cache(job_id,preview_id,item_id,photo_id,filename,image_base64,created_at,expires_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET image_base64=excluded.image_base64,created_at=excluded.created_at,expires_at=excluded.expires_at`,
      [lease.id,initial.preview.id,initial.item.id,initial.photo.id,initial.photo.filename,image.toString('base64'),created,created+COMPARISON_TTL_MS]);
      await jobs.finish(lease,{progress:{comparison:true,expires_at:created+COMPARISON_TTL_MS}},tx);
    });
  });
}

export function registerDriveComparisonRoutes(app,{db,storage,control,env=process.env,routeWrapper,jobs=createDriveJobs(db)}) {
  const route = handler => {
    const wrapped = async (request,response) => {
      response.set({'Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff'});
      if (!request.admin) throw driveError('drive_admin_required',401);
      if (env.DRIVE_SYNC_ENABLED !== 'true') throw driveError('drive_feature_disabled',503);
      await cleanupDriveComparisons(db);
      return handler(request,response);
    };
    return routeWrapper ? routeWrapper(wrapped) : (request,response,next) => Promise.resolve().then(() => control && request.method === 'POST' ? control.run('drive-admin',() => wrapped(request,response)) : wrapped(request,response)).catch(next);
  };
  app.post('/api/admin/drive/jobs/:id/items/:itemId/comparison',route(async (request,response) => {
    const key = request.body?.request_key || randomUUID();
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw driveError('drive_invalid_request_key',422);
    const timestamp = Date.now();
    const rateKey = 'drive-comparison:'+String(request.admin);
    const admitted = await db.get(`INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN rate_limits.expires<? THEN 1 ELSE rate_limits.count+1 END,
      expires=CASE WHEN rate_limits.expires<? THEN ? ELSE rate_limits.expires END
      WHERE rate_limits.expires<? OR rate_limits.count<12 RETURNING count`,[rateKey,timestamp+60000,timestamp,timestamp,timestamp+60000,timestamp]);
    if (!admitted) throw driveError('drive_admin_rate_limited',429);
    const job = await db.transaction(async tx => {
      const current = await comparisonContext(tx,{previewId:request.params.id,itemId:request.params.itemId});
      const pending = await tx.get("SELECT COUNT(*) AS count FROM drive_sync_jobs WHERE kind='check' AND mapping_id IS NOT NULL AND status IN ('queued','running','retry_wait')");
      if (Number(pending.count) >= MAX_CACHED) throw driveError('drive_comparison_busy',429);
      return jobs.enqueue({connectionId:current.connection.id,mappingId:current.mapping.id,kind:'check',requestKey:key,payload:{operation:'compare-preview',previewId:current.preview.id,itemId:current.item.id}},tx);
    });
    response.status(202).json({job_id:job.id});
  }));
  async function load(jobId,{image=false}={}) {
    const job = await jobs.get(jobId);
    const payload = parseDriveJson(job?.payload_json);
    if (!job || payload.operation !== 'compare-preview') throw driveError('drive_comparison_unavailable',404);
    const current = await db.transaction(tx => comparisonContext(tx,{previewId:payload.previewId,itemId:payload.itemId}));
    // Metadata reads never fetch the large private thumbnail column.
    const cache = await db.get('SELECT job_id,photo_id,filename,expires_at'+(image?',image_base64':'')+' FROM drive_comparison_cache WHERE job_id=?',[job.id]);
    if (cache && (cache.photo_id !== current.photo.id || cache.filename !== current.photo.filename || Number(cache.expires_at) <= Date.now())) throw driveError('drive_preview_stale');
    return {job,current,cache};
  }
  app.get('/api/admin/drive/comparisons/:id',route(async (request,response) => {
    const {job,current,cache} = await load(request.params.id);
    const available = job.status === 'completed' && !!cache;
    response.json({job_id:job.id,status:job.status,error_code:job.status === 'completed' && !cache ? 'drive_comparison_expired' : job.error_code,
      file_name:current.descriptor.file.name,expires_at:cache?.expires_at || null,
      current:{photo_id:current.photo.id,url:'/api/admin/drive/comparisons/'+job.id+'/image?side=current'},
      incoming:available ? {url:'/api/admin/drive/comparisons/'+job.id+'/image'} : null});
  }));
  app.get('/api/admin/drive/comparisons/:id/image',route(async (request,response) => {
    const currentSide = request.query.side === 'current';
    const {job,cache} = await load(request.params.id,{image:!currentSide});
    if (job.status !== 'completed' || !cache) throw driveError('drive_comparison_expired',410);
    const bytes = currentSide ? await storage.get(cache.filename+'-thumb.webp') : Buffer.from(cache.image_base64,'base64');
    if (!bytes?.length || bytes.length > (currentSide ? 4*1024*1024 : COMPARISON_MAX_BYTES)) throw driveError('drive_comparison_unavailable');
    await load(request.params.id);
    response.type('webp').send(bytes);
  }));
}
