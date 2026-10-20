import {createHash} from 'node:crypto';
import {driveError} from './drive-client.mjs';
import {driveLock,parseDriveJson} from './drive-inventory.mjs';

export const driveItemActions = ['add','replace','rename','missing','skip','conflict','unchanged'];
export const driveItemStatuses = ['pending','applied','skipped','failed'];

export async function driveAlbumSummaries(db) {
  // A single grouped query, independent of the number of albums and photos.
  const rows = await db.all(`WITH ranked AS (
    SELECT id,mapping_id,kind,status,progress_json,error_code,created_at,updated_at,
      ROW_NUMBER() OVER (PARTITION BY mapping_id ORDER BY
        CASE WHEN status IN ('queued','running','retry_wait') THEN 0 ELSE 1 END,
        created_at DESC,id DESC) AS rank
    FROM drive_sync_jobs WHERE mapping_id IS NOT NULL AND kind IN ('preview','apply')
  ) SELECT mapping.album_id,CASE WHEN mapping.enabled=0 THEN 'paused' ELSE mapping.state END AS mapping_state,mapping.last_success_at,
      job.id,job.kind,job.status,job.progress_json,job.error_code,job.created_at,job.updated_at
    FROM drive_album_links mapping LEFT JOIN ranked job ON job.mapping_id=mapping.id AND job.rank=1
    WHERE mapping.state<>'unlinked' ORDER BY mapping.album_id`);
  return rows.map(row => ({album_id:row.album_id,mapping_state:row.mapping_state,last_success_at:row.last_success_at,
    job:row.id ? {id:row.id,kind:row.kind,status:row.status,progress:parseDriveJson(row.progress_json),error_code:row.error_code,created_at:row.created_at,updated_at:row.updated_at} : null}));
}

export async function driveJobDetails(db,job,{offset=0,limit=100,action,status}={}) {
  if (action !== undefined && !driveItemActions.includes(action)) throw driveError('drive_invalid_action_filter',422);
  if (status !== undefined && !driveItemStatuses.includes(status)) throw driveError('drive_invalid_status_filter',422);
  const conditions = ['item.job_id=?'];
  const args = [job.id];
  if (action) { conditions.push('item.action=?'); args.push(action); }
  if (status) { conditions.push('item.status=?'); args.push(status); }
  const where = conditions.join(' AND ');
  const rows = await db.all(`SELECT item.*,photo.id AS current_photo_id,photo.original AS current_photo_original,
      photo.filename AS current_photo_filename,photo.width AS current_photo_width,photo.height AS current_photo_height
    FROM drive_sync_job_items item
    LEFT JOIN drive_source_files source ON source.connection_id=? AND source.drive_file_id=item.file_id AND source.mapping_id=?
    LEFT JOIN drive_album_links mapping ON mapping.id=source.mapping_id
    LEFT JOIN photos photo ON photo.id=source.photo_id AND photo.album_id=mapping.album_id
    WHERE ${where} ORDER BY item.file_id LIMIT ? OFFSET ?`,[job.connection_id,job.mapping_id,...args,limit,offset]);
  const counts = {actions:Object.fromEntries(driveItemActions.map(value => [value,0])),statuses:Object.fromEntries(driveItemStatuses.map(value => [value,0]))};
  let total = 0;
  for (const row of await db.all('SELECT action,status,COUNT(*) AS count FROM drive_sync_job_items WHERE job_id=? GROUP BY action,status',[job.id])) {
    const count = Number(row.count);
    counts.actions[row.action] = (counts.actions[row.action] || 0)+count;
    counts.statuses[row.status] = (counts.statuses[row.status] || 0)+count;
    if ((!action || row.action === action) && (!status || row.status === status)) total += count;
  }
  const items = rows.map(row => {
    const {current_photo_id:id,current_photo_filename:filename,current_photo_original:original,current_photo_width:width,current_photo_height:height,...item} = row;
    const version = filename && filename !== id ? createHash('sha256').update(filename).digest('hex').slice(0,16) : '';
    return {...item,current_photo:id ? {id,original,width,height,src:'/media/'+encodeURIComponent(id)+(version ? '?v='+version : ''),thumb:'/media/'+encodeURIComponent(id)+'?size=thumb'+(version ? '&v='+version : '')} : null};
  });
  return {items,total,counts,offset,limit};
}

// Explicit retries preserve committed receipts, immutable approvals and the
// cumulative automatic retry budget. They never authorize a new inventory.
export async function retryDriveJob(db,jobId,requestKey,{now=Date.now,maxAttempts=5}={}) {
  return db.transaction(async tx => {
    const hint = await tx.get('SELECT * FROM drive_sync_jobs WHERE id=?',[jobId]);
    if (!hint) throw driveError('drive_job_missing',404);
    const identity = hint.mapping_id && await tx.get('SELECT album_id FROM drive_album_links WHERE id=?',[hint.mapping_id]);
    const album = identity && await tx.get('SELECT * FROM albums WHERE id=?'+driveLock(tx),[identity.album_id]);
    const connection = await tx.get('SELECT * FROM drive_connections WHERE id=?'+driveLock(tx),[hint.connection_id]);
    const mapping = hint.mapping_id && await tx.get('SELECT * FROM drive_album_links WHERE id=?'+driveLock(tx),[hint.mapping_id]);
    const job = await tx.get('SELECT * FROM drive_sync_jobs WHERE id=?'+driveLock(tx),[jobId]);
    const fingerprint = JSON.stringify(['retry-failed',jobId]);
    const receipt = await tx.get('SELECT * FROM drive_job_requests WHERE request_key=?',[requestKey]);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint || receipt.job_id !== jobId) throw driveError('drive_request_conflict');
      return job;
    }
    if (job.kind !== 'apply' || job.cancel_requested || !['completed_with_errors','failed'].includes(job.status)) throw driveError('drive_retry_unavailable');
    if (!album || album.status === 'archived' || !mapping || mapping.state !== 'attached' || !mapping.enabled || connection?.status !== 'active' || Number(connection.generation) !== Number(job.connection_generation) || Number(mapping.generation) !== Number(job.mapping_generation)) throw driveError('drive_preview_stale');
    const manifest = parseDriveJson(job.manifest_json);
    if (!manifest.complete || Number(job.expected_catalog_revision) !== Number(album.catalog_revision) || Number(job.expected_selection_revision) !== Number(album.selection_revision) || Number(job.expected_submission_generation) !== Number(album.submission_generation)) throw driveError('drive_preview_stale');
    if (job.approval_id || album.drive_review_required) {
      const approval = job.approval_id && await tx.get('SELECT * FROM drive_sync_approvals WHERE id=?'+driveLock(tx),[job.approval_id]);
      if (!approval || approval.invalidated_at != null || approval.job_id !== job.id || approval.mapping_id !== mapping.id || approval.album_id !== album.id || approval.preview_id !== job.preview_id || Number(approval.connection_generation) !== Number(connection.generation) || Number(approval.mapping_generation) !== Number(mapping.generation) || Number(approval.selection_revision) !== Number(album.selection_revision) || Number(approval.submission_generation) !== Number(album.submission_generation)) throw driveError('drive_preview_stale');
      const approvedManifest = parseDriveJson(approval.manifest_json);
      if (!approvedManifest.complete || approvedManifest.hash !== manifest.hash || Number(approval.catalog_revision) !== Number(manifest.catalogRevision)) throw driveError('drive_preview_stale');
    }
    if (Number(job.attempt) >= maxAttempts) throw driveError('drive_retry_exhausted');
    const active = await tx.get("SELECT id FROM drive_sync_jobs WHERE mapping_id=? AND id<>? AND status IN ('queued','running','retry_wait') LIMIT 1",[mapping.id,job.id]);
    if (active) throw driveError('drive_job_active');
    // A job interrupted at a global fence needs a fresh preview, not a hidden
    // resumption of its unprocessed files behind the 'retry failed' action.
    const pending = await tx.get("SELECT COUNT(*) AS count FROM drive_sync_job_items WHERE job_id=? AND status='pending'",[job.id]);
    if (Number(pending.count)) throw driveError('drive_preview_stale');
    const failed = await tx.all("SELECT * FROM drive_sync_job_items WHERE job_id=? AND status='failed' AND action IN ('add','replace','rename','unchanged') ORDER BY file_id",[job.id]);
    if (!failed.length) throw driveError('drive_retry_unavailable');
    // Guard source detach/delete/reimport actions which do not necessarily
    // advance the album revision. Lock sources in stable order, as inventory.
    const sourceIds = [...new Set(failed.map(item => parseDriveJson(item.source_json).sourceId))].filter(Boolean).sort();
    const sources = new Map();
    for (let offset=0;offset<sourceIds.length;offset+=500) {
      const ids = sourceIds.slice(offset,offset+500);
      for (const source of await tx.all('SELECT * FROM drive_source_files WHERE id IN ('+ids.map(() => '?').join(',')+') ORDER BY id'+driveLock(tx),ids)) sources.set(source.id,source);
    }
    for (const item of failed) {
      const descriptor = parseDriveJson(item.source_json);
      const source = sources.get(descriptor.sourceId);
      if (!source || source.mapping_id !== mapping.id || source.connection_id !== connection.id || source.drive_file_id !== item.file_id || Number(source.source_generation) !== Number(item.source_generation)) throw driveError('drive_preview_stale');
      if (['suppressed','detached'].includes(source.state)) {
        const intent = descriptor.reimportIntentId && await tx.get('SELECT * FROM drive_reimport_intents WHERE id=?',[descriptor.reimportIntentId]);
        if (!intent || intent.status !== 'pending' || intent.id !== source.reimport_intent_id || Number(intent.source_generation) !== Number(source.source_generation)) throw driveError('drive_preview_stale');
      }
    }
    const timestamp = now();
    await tx.run("UPDATE drive_sync_job_items SET status='pending',error_code=NULL,result_json=NULL,updated_at=? WHERE job_id=? AND status='failed' AND action IN ('add','replace','rename','unchanged')",[timestamp,job.id]);
    const progress = Object.fromEntries((await tx.all('SELECT status,COUNT(*) AS count FROM drive_sync_job_items WHERE job_id=? GROUP BY status',[job.id])).map(row => [row.status,Number(row.count)]));
    progress.total = manifest.count;
    await tx.run("UPDATE drive_sync_jobs SET status='queued',fence=fence+1,lease_owner=NULL,lease_until=NULL,available_at=?,finished_at=NULL,error_code=NULL,progress_json=?,updated_at=? WHERE id=?",[timestamp,JSON.stringify(progress),timestamp,job.id]);
    await tx.run('INSERT INTO drive_job_requests(request_key,job_id,fingerprint,created_at) VALUES(?,?,?,?)',[requestKey,job.id,fingerprint,timestamp]);
    return tx.get('SELECT * FROM drive_sync_jobs WHERE id=?',[job.id]);
  });
}
