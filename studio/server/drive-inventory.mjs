import {assertConnectionFolder} from './drive-folder-scope.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {driveError} from './drive-client.mjs';

export const parseDriveJson = (value,fallback={}) => {
  try { return JSON.parse(value || '{}'); } catch { return fallback; }
};
export const driveLock = tx => tx.cloud ? ' FOR UPDATE' : '';
// Drive omits or expands `parents` differently between files.list and
// files.get. Membership is checked separately at every safety boundary, so it
// must not be part of the content/version fingerprint.
export const metadataSignature = file => JSON.stringify([file.id,file.version,file.md5Checksum || null,file.name,file.mimeType,String(file.size ?? ''),!!file.trashed,file.capabilities?.canDownload !== false]);
export const supportedDriveImage = file => ['image/jpeg','image/png','image/webp'].includes(file.mimeType);

export function createDriveContext({db,jobs}) {
  return async function context(tx,lease,{mutation=false,sourceId,sourceGeneration,intentId}={}) {
    const hint = await tx.get('SELECT album_id FROM drive_album_links WHERE id=?',[lease.mapping_id]);
    if (!hint) throw driveError('drive_mapping_stale');
    const album = await tx.get('SELECT * FROM albums WHERE id=?'+driveLock(tx),[hint.album_id]);
    const connection = await tx.get('SELECT * FROM drive_connections WHERE id=?'+driveLock(tx),[lease.connection_id]);
    const mapping = await tx.get('SELECT * FROM drive_album_links WHERE id=?'+driveLock(tx),[lease.mapping_id]);
    const job = await jobs.assertLease(tx,lease);
    if (!album || album.status === 'archived' || connection?.status !== 'active' || mapping?.state !== 'attached' || !mapping.enabled || Number(connection.generation) !== Number(job.connection_generation) || Number(mapping.generation) !== Number(job.mapping_generation)) throw driveError('drive_mapping_stale');
    if (mutation && (album.drive_review_required || job.approval_id || job.preview_id)) {
      const approval = job.approval_id ? await tx.get('SELECT * FROM drive_sync_approvals WHERE id=?',[job.approval_id]) : null;
      if (album.drive_review_required && (!approval || approval.invalidated_at || approval.job_id !== job.id)) throw driveError('drive_review_required');
      if (approval && (approval.invalidated_at || Number(approval.connection_generation) !== Number(connection.generation) || Number(approval.mapping_generation) !== Number(mapping.generation))) throw driveError('drive_preview_stale');
      if (Number(job.expected_catalog_revision) !== Number(album.catalog_revision) || Number(job.expected_selection_revision) !== Number(album.selection_revision) || Number(job.expected_submission_generation) !== Number(album.submission_generation)) throw driveError('drive_preview_stale',409,{stage:'revision'});
    }
    let source;
    if (sourceId) {
      source = await tx.get('SELECT * FROM drive_source_files WHERE id=?'+driveLock(tx),[sourceId]);
      if (!source || source.mapping_id !== mapping.id || Number(source.source_generation) !== Number(sourceGeneration)) throw driveError('drive_source_stale');
      if (mutation && ['detached','suppressed'].includes(source.state)) {
        const intent = intentId && await tx.get('SELECT * FROM drive_reimport_intents WHERE id=?',[intentId]);
        if (!intent || source.reimport_intent_id !== intent.id || intent.status !== 'pending' || Number(intent.source_generation) !== Number(source.source_generation)) throw driveError('drive_source_suppressed');
      }
    }
    return {album,connection,mapping,job,source};
  };
}

export async function inventoryDrive({db,drive,jobs,context,lease,signal,maxFiles=20000,maxMs=600000,reimportIntentId}) {
  const initial = await db.transaction(tx => context(tx,lease));
  await assertConnectionFolder(drive,initial.mapping.folder_id,initial.connection,{signal});
  await db.transaction(async tx => {
    await context(tx,lease);
    await tx.run('DELETE FROM drive_sync_job_items WHERE job_id=?',[lease.id]);
  });
  let pageToken;
  const tokens = new Set();
  const seen = new Map();
  const started = Date.now();
  do {
    signal?.throwIfAborted();
    if (Date.now()-started > maxMs) throw driveError('drive_inventory_time_limit',422);
    const page = await drive.listFiles(initial.mapping.folder_id,{pageToken,signal});
    if (page.incompleteSearch || !Array.isArray(page.files)) throw driveError('drive_inventory_incomplete',503);
    if (page.files.length > 1000 || seen.size+page.files.length > maxFiles) throw driveError('drive_inventory_file_limit',422);
    const items = [];
    await db.transaction(async tx => {
      const current = await context(tx,lease);
      const pageIds = page.files.map(file => file?.id).filter(id => typeof id === 'string');
      const sources = new Map();
      const photos = new Map();
      for (let offset=0; offset<pageIds.length; offset+=500) {
        const ids = pageIds.slice(offset,offset+500);
        for (const source of await tx.all('SELECT * FROM drive_source_files WHERE connection_id=? AND drive_file_id IN ('+ids.map(() => '?').join(',')+') ORDER BY id'+driveLock(tx),[current.connection.id,...ids])) sources.set(source.drive_file_id,source);
      }
      const photoIds = [...sources.values()].map(source => source.photo_id).filter(Boolean);
      for (let offset=0; offset<photoIds.length; offset+=500) {
        const ids = photoIds.slice(offset,offset+500);
        for (const photo of await tx.all('SELECT * FROM photos WHERE id IN ('+ids.map(() => '?').join(',')+')',ids)) photos.set(photo.id,photo);
      }
      const observations = [];
      for (const file of page.files) {
        if (!file || typeof file.id !== 'string' || typeof file.name !== 'string' || file.name.length > 2048 || !/^\d+$/.test(String(file.version || ''))) throw driveError('drive_metadata_invalid',422);
        const signature = metadataSignature(file);
        if (seen.has(file.id) && seen.get(file.id) !== signature) throw driveError('drive_inventory_changed',409,{retryable:true});
        if (seen.has(file.id)) continue;
        seen.set(file.id,signature);
        let source = sources.get(file.id);
        let action = 'skip';
        let errorCode = null;
        if (file.trashed || !file.parents?.includes(current.mapping.folder_id)) {
          errorCode = 'drive_membership_changed';
        } else if (!supportedDriveImage(file)) {
          errorCode = 'drive_unsupported_type';
        } else if (file.capabilities?.canDownload === false) {
          errorCode = 'drive_download_restricted';
        } else if (source && source.mapping_id !== current.mapping.id) {
          action = 'conflict';
          errorCode = 'drive_file_other_album';
        } else {
          if (!source) {
            const sourceId = randomUUID();
            await tx.run('INSERT INTO drive_source_files(id,connection_id,drive_file_id,mapping_id,created_at,updated_at) VALUES(?,?,?,?,?,?)',[sourceId,current.connection.id,file.id,current.mapping.id,Date.now(),Date.now()]);
            source = await tx.get('SELECT * FROM drive_source_files WHERE id=?',[sourceId]);
          }
          const intent = reimportIntentId && source.reimport_intent_id === reimportIntentId ? await tx.get("SELECT * FROM drive_reimport_intents WHERE id=? AND status='pending'",[reimportIntentId]) : null;
          const photo = source.photo_id && photos.get(source.photo_id);
          const published = photo?.source === 'google_drive' && photo.album_id === current.mapping.album_id && Number(source.imported_generation) === Number(source.source_generation);
          if (['suppressed','detached'].includes(source.state) && !intent) {
            errorCode = 'drive_source_suppressed';
          } else if (!published) {
            action = 'add';
          } else if (source.imported_version === String(file.version) || file.md5Checksum && source.checksum === file.md5Checksum) {
            action = photo.original !== file.name.trim().normalize('NFC').slice(0,180) ? 'rename' : 'unchanged';
          } else {
            action = 'replace';
          }
          observations.push({id:source.id,version:String(file.version),errorCode});
        }
        items.push({fileId:file.id,action,version:String(file.version),checksum:file.md5Checksum || null,sourceGeneration:source?.source_generation || null,source:{file,sourceId:source?.id || null,reimportIntentId:source?.reimport_intent_id === reimportIntentId ? reimportIntentId : null},errorCode});
      }
      for (let offset=0; offset<observations.length; offset+=150) {
        const batch = observations.slice(offset,offset+150);
        const cases = batch.map(() => 'WHEN ? THEN ?').join(' ');
        await tx.run("UPDATE drive_source_files SET state=CASE WHEN state='missing_in_drive' THEN 'active' ELSE state END,observed_version=CASE id "+cases+' END,last_seen_scan_id=?,error_code=CASE id '+cases+' END,updated_at=? WHERE id IN ('+batch.map(() => '?').join(',')+')',[
          ...batch.flatMap(item => [item.id,item.version]),lease.id,...batch.flatMap(item => [item.id,item.errorCode]),Date.now(),...batch.map(item => item.id),
        ]);
      }
      await jobs.putItems(lease,items,tx);
    });
    pageToken = page.nextPageToken;
    if (pageToken && tokens.has(pageToken)) throw driveError('drive_pagination_cycle',503);
    if (pageToken) tokens.add(pageToken);
  } while (pageToken);
  await assertConnectionFolder(drive,initial.mapping.folder_id,initial.connection,{signal});
  return db.transaction(async tx => {
    const current = await context(tx,lease);
    const sources = await tx.all('SELECT * FROM drive_source_files WHERE mapping_id=?',[current.mapping.id]);
    const missing = sources.filter(source => !seen.has(source.drive_file_id) && ['active','missing_in_drive'].includes(source.state));
    for (let offset=0; offset<missing.length; offset+=1000) {
      await jobs.putItems(lease,missing.slice(offset,offset+1000).map(source => ({fileId:source.drive_file_id,action:'missing',sourceGeneration:source.source_generation,source:{sourceId:source.id}})),tx);
    }
    const items = await tx.all('SELECT file_id,source_generation,source_json FROM drive_sync_job_items WHERE job_id=? ORDER BY file_id',[lease.id]);
    const hash = createHash('sha256');
    for (const item of items) {
      const descriptor = parseDriveJson(item.source_json);
      hash.update(JSON.stringify([item.file_id,item.source_generation,descriptor.file ? metadataSignature(descriptor.file) : 'missing'])+'\n');
    }
    // The inventory may run alongside a just-completed worker transaction. Read
    // the revision again at the same point we persist the manifest so an
    // approval represents the catalog the reviewer actually saw.
    const album = await tx.get('SELECT catalog_revision,selection_revision,submission_generation FROM albums WHERE id=?'+driveLock(tx),[current.album.id]);
    const manifest = {complete:true,hash:hash.digest('hex'),count:items.length,catalogRevision:Number(album.catalog_revision),selectionRevision:Number(album.selection_revision),submissionGeneration:Number(album.submission_generation),reimportIntentId:reimportIntentId || null};
    await tx.run('UPDATE drive_sync_jobs SET manifest_json=? WHERE id=?',[JSON.stringify(manifest),lease.id]);
    await tx.run('UPDATE drive_album_links SET last_inventory_at=?,updated_at=? WHERE id=?',[Date.now(),Date.now(),current.mapping.id]);
    return manifest;
  });
}
