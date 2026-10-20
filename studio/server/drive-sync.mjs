import {collectFolderOverview,emptyFolderSummary} from './drive-folder-overview.mjs';
import {initializeFolderPreviews,collectFolderPreviews,saveFolderPreviews} from './drive-folder-preview.mjs';
import {assertConnectionFolder,driveFolderScope,browseConnectionFolders} from './drive-folder-scope.mjs';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {createDriveJobs} from './drive-jobs.mjs';
import {ingestPhoto} from './photo-ingest.mjs';
import {driveImagePolicy} from './drive-image-encoder.mjs';
import {findDriveChild,driveError,safeDriveError} from './drive-client.mjs';
import {createDriveContext,inventoryDrive,parseDriveJson,driveLock,metadataSignature} from './drive-inventory.mjs';
import {createDriveTemporary} from './drive-temporary.mjs';
import {runDriveComparison} from './drive-comparisons.mjs';

export function createDriveSync({db,storage,control,drive,jobs=createDriveJobs(db),env=process.env,ingest=ingestPhoto,browseTimeoutMs=15000}) {
  if(!Number.isSafeInteger(browseTimeoutMs) || browseTimeoutMs<1 || browseTimeoutMs>15000) throw driveError('drive_invalid_limits',422);
  const context = createDriveContext({db,jobs});
  const policy = driveImagePolicy(env);
  const temporaryRoot = env.DRIVE_SYNC_TEMP_DIR || path.join(os.tmpdir(),'chicong-drive-sync');
  const maxFiles = Number(env.DRIVE_SYNC_MAX_INVENTORY_FILES || 20000);
  const batchSize = Number(env.DRIVE_SYNC_BATCH_SIZE || 5);
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 100000 || !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 25) throw driveError('drive_invalid_limits',422);
  const temporary = createDriveTemporary({root:temporaryRoot,maxBytes:policy.maxBytes,processId:control.processId});
  const filenameOrder = new Intl.Collator('en',{numeric:true});
  let pendingOrder;
  async function nextItems(lease,manifest) {
    // Keep only one bounded queue of IDs. Job rows and all publication fences
    // are read fresh; a worker restart simply reconstructs the same order.
    if (pendingOrder?.jobId !== lease.id || pendingOrder.hash !== manifest.hash) {
      const rows = await db.all("SELECT id,file_id,source_json FROM drive_sync_job_items WHERE job_id=? AND status='pending'",[lease.id]);
      const ordered = rows.map(item => ({id:item.id,fileId:item.file_id,name:String(parseDriveJson(item.source_json).file?.name || '')}));
      ordered.sort((left,right) => filenameOrder.compare(left.name,right.name) || left.fileId.localeCompare(right.fileId));
      pendingOrder = {jobId:lease.id,hash:manifest.hash,ids:ordered.map(item => item.id)};
    }
    while (pendingOrder.ids.length) {
      const ids = pendingOrder.ids.slice(0,batchSize);
      const rows = await db.all("SELECT * FROM drive_sync_job_items WHERE job_id=? AND status='pending' AND id IN ("+ids.map(() => '?').join(',')+')',[lease.id,...ids]);
      if (rows.length) {
        const order = new Map(ids.map((id,index) => [id,index]));
        return rows.sort((left,right) => order.get(left.id)-order.get(right.id));
      }
      pendingOrder.ids.splice(0,ids.length);
    }
    return [];
  }
  async function check(lease,signal) {
    const connection = await db.get('SELECT * FROM drive_connections WHERE id=?',[lease.connection_id]);
    if (!connection || connection.status === 'disabled' || Number(connection.generation) !== Number(lease.connection_generation)) throw driveError('drive_connection_stale');
    if (drive.serviceAccountEmail !== connection.service_account_email) throw driveError('drive_identity_mismatch',503);
    const payload = parseDriveJson(lease.payload_json);
    if (payload.operation === 'browse-folders') {
      const page = await browseConnectionFolders(drive,payload.folderId,connection,{pageToken:payload.pageToken,signal});
      // Every publication merges under the same connection/job locks. Counts
      // and thumbnails may finish in either order without losing each other.
      const publish = (patch,{preview,finish=false,verificationSignal=signal}={}) => db.transaction(async tx => {
        signal?.throwIfAborted();
        const current = await tx.get('SELECT * FROM drive_connections WHERE id=?'+driveLock(tx),[connection.id]);
        const row = await jobs.assertLease(tx,lease);
        verificationSignal?.throwIfAborted();
        if (current?.status !== 'active' || Number(current.generation) !== Number(lease.connection_generation)) throw driveError('drive_connection_stale');
        const progress = {...parseDriveJson(row.progress_json),...patch};
        if (preview) progress.preview = await saveFolderPreviews(tx,lease,payload.folderId,preview);
        verificationSignal?.throwIfAborted();
        if (finish) return jobs.finish(lease,{progress},tx);
        await tx.run('UPDATE drive_sync_jobs SET progress_json=?,updated_at=? WHERE id=?',[JSON.stringify(progress),Date.now(),lease.id]);
      });
      // Navigation is usable before optional overview/thumbnail work begins.
      await publish({...page,ready:true,...(!payload.pageToken ? {summary:emptyFolderSummary(),preview:{images:[],unavailable:false,pending:true}} : {})});
      if (!payload.pageToken) {
        // Include the final permission checks in the deadline, including SDKs
        // or auth providers that ignore AbortSignal. Late results cannot publish.
        const deadline=new AbortController();
        const timer=setTimeout(()=>deadline.abort(driveError('drive_browse_timeout',503)),browseTimeoutMs);
        const verificationSignal=signal ? AbortSignal.any([signal,deadline.signal]) : deadline.signal;
        let onAbort;
        try {
          verificationSignal.throwIfAborted();
          const aborted=new Promise((_,reject)=>{onAbort=()=>reject(verificationSignal.reason);verificationSignal.addEventListener('abort',onAbort,{once:true});});
          const work=Promise.all([
            (async()=>{
              const summary = await collectFolderOverview(drive,payload.folderId,{signal:verificationSignal});
              await assertConnectionFolder(drive,payload.folderId,connection,{signal:verificationSignal});
              await publish({summary},{verificationSignal});
            })(),
            (async()=>{
              await initializeFolderPreviews(db);
              const preview = await collectFolderPreviews(drive,payload.folderId,{signal:verificationSignal});
              await assertConnectionFolder(drive,payload.folderId,connection,{signal:verificationSignal});
              await publish({},{preview,verificationSignal});
            })(),
          ]);
          await Promise.race([work,aborted]);
        } finally {
          clearTimeout(timer);verificationSignal.removeEventListener('abort',onAbort);
          deadline.abort(driveError('drive_browse_stale'));
        }
      }
      return publish({},{finish:true});
    }
    if (payload.operation === 'compare-preview') return runDriveComparison({db,jobs,lease,drive,temporary,policy,signal,maxFiles});
    await assertConnectionFolder(drive,payload.folderId || connection.root_folder_id,connection,{signal});
    const inspected = payload.operation === 'inspect-folder' ? await drive.getFile(payload.folderId || connection.root_folder_id,{signal}) : null;
    if (inspected) await assertConnectionFolder(drive,inspected.id,connection,{signal});
    if (payload.testFileId) {
      const file = await drive.getFile(payload.testFileId,{signal});
      if (file.trashed || file.parents?.length !== 1 || !['image/jpeg','image/png','image/webp'].includes(file.mimeType) || file.capabilities?.canDownload === false) throw driveError('drive_test_file_unavailable');
      await assertConnectionFolder(drive,file.parents[0],connection,{signal});
      await temporary(destination => drive.download(file.id,destination,{signal,maxBytes:file.mimeType === 'image/jpeg' ? policy.maxBytes : 20*1024*1024,checksum:file.md5Checksum}));
    }
    await db.transaction(async tx => {
      let album;
      if (payload.operation === 'link') {
        album = await tx.get('SELECT * FROM albums WHERE id=?'+driveLock(tx),[payload.albumId]);
        if (!album || album.status === 'archived') throw driveError('drive_album_unavailable');
      }
      const current = await tx.get('SELECT * FROM drive_connections WHERE id=?'+driveLock(tx),[connection.id]);
      await jobs.assertLease(tx,lease);
      if (!current || current.status === 'disabled' || Number(current.generation) !== Number(lease.connection_generation)) throw driveError('drive_connection_stale');
      if (album) {
        const occupied = await tx.get("SELECT * FROM drive_album_links WHERE state<>'unlinked' AND (album_id=? OR (connection_id=? AND folder_id=?))",[album.id,current.id,payload.folderId]);
        if (occupied && (occupied.album_id !== album.id || occupied.folder_id !== payload.folderId)) throw driveError('drive_folder_already_linked');
        let existing = occupied || await tx.get('SELECT * FROM drive_album_links WHERE album_id=? AND connection_id=? AND folder_id=? ORDER BY created_at DESC LIMIT 1',[album.id,current.id,payload.folderId]);
        if (existing) {
          await tx.run("UPDATE drive_album_links SET state='attached',enabled=1,generation=generation+1,baseline_preview_id=NULL,updated_at=? WHERE id=?",[Date.now(),existing.id]);
        } else {
          await tx.run('INSERT INTO drive_album_links(id,connection_id,album_id,folder_id,created_at,updated_at) VALUES(?,?,?,?,?,?)',[randomUUID(),current.id,album.id,payload.folderId,Date.now(),Date.now()]);
        }
        if (album.selection_status === 'submitted') await tx.run('UPDATE albums SET drive_review_required=1 WHERE id=?',[album.id]);
      }
      await tx.run("UPDATE drive_connections SET status='active',last_checked_at=?,last_error_code=NULL,updated_at=? WHERE id=?",[Date.now(),Date.now(),current.id]);
      await jobs.finish(lease,{progress:{checked:true,scope:driveFolderScope(connection),linked:payload.operation === 'link',...(inspected ? {folder:{id:inspected.id,name:inspected.name}} : {})}},tx);
    });
  }
  async function observeMissing(lease) {
    await db.transaction(async tx => {
      await context(tx,lease);
      const items = await tx.all("SELECT * FROM drive_sync_job_items WHERE job_id=? AND action='missing'",[lease.id]);
      for (const item of items) {
        const descriptor = parseDriveJson(item.source_json);
        await tx.run("UPDATE drive_source_files SET state='missing_in_drive',updated_at=? WHERE id=? AND source_generation=? AND state IN ('active','missing_in_drive')",[Date.now(),descriptor.sourceId,item.source_generation]);
      }
    });
  }
  async function setItem(tx,lease,item,status,errorCode=null,result={}) {
    await tx.run('UPDATE drive_sync_job_items SET status=?,error_code=?,result_json=?,updated_at=? WHERE id=? AND job_id=?',[status,errorCode,JSON.stringify(result),Date.now(),item.id,lease.id]);
  }
  async function recordPublication(tx,lease,item,descriptor,result) {
    const file = descriptor.file;
    await tx.run("UPDATE drive_source_files SET photo_id=?,state='active',imported_generation=source_generation,imported_version=?,observed_version=?,source_name=?,mime=?,size=?,checksum=?,modified_time=?,error_code=NULL,reimport_intent_id=NULL,updated_at=? WHERE id=?",[result.photoId,String(file.version),String(file.version),file.name,file.mimeType,file.size == null ? null : Number(file.size),file.md5Checksum || null,file.modifiedTime || null,Date.now(),descriptor.sourceId]);
    if (descriptor.reimportIntentId) await tx.run("UPDATE drive_reimport_intents SET status='completed',updated_at=? WHERE id=?",[Date.now(),descriptor.reimportIntentId]);
    await setItem(tx,lease,item,'applied',null,{photoId:result.photoId,filename:result.filename});
    const current = await tx.get('SELECT catalog_revision FROM albums WHERE id=(SELECT album_id FROM drive_album_links WHERE id=?)',[lease.mapping_id]);
    await tx.run('UPDATE drive_sync_jobs SET expected_catalog_revision=? WHERE id=?',[current.catalog_revision,lease.id]);
  }
  async function acknowledgeUnchanged(lease,signal) {
    // An unchanged item records the completed inventory's observation; it does
    // not publish media or advance imported_version/checksum. There is no new
    // content to authorize with N additional remote requests. Mutating actions
    // below retain their fresh root, membership and version checks.
    await db.transaction(async tx => {
      signal?.throwIfAborted();
      const current = await context(tx,lease,{mutation:true});
      const candidates = await tx.all(`SELECT item.id,item.source_json,item.source_generation,
        source.id AS source_id,source.imported_version,source.checksum,photo.original
        FROM drive_sync_job_items item
        JOIN drive_source_files source ON source.connection_id=? AND source.drive_file_id=item.file_id
        JOIN photos photo ON photo.id=source.photo_id
        WHERE item.job_id=? AND item.status='pending' AND item.action='unchanged'
          AND source.mapping_id=? AND source.source_generation=item.source_generation
          AND source.imported_generation=source.source_generation AND source.state='active'
          AND photo.source='google_drive' AND photo.album_id=?
        ORDER BY source.id${tx.cloud ? ' FOR UPDATE OF source' : ''}`,
      [current.connection.id,lease.id,current.mapping.id,current.album.id]);
      const valid = candidates.filter(item => {
        const descriptor = parseDriveJson(item.source_json);
        const file = descriptor.file;
        return file && descriptor.sourceId === item.source_id &&
          (item.imported_version === String(file.version) || file.md5Checksum && item.checksum === file.md5Checksum) &&
          item.original === file.name.trim().normalize('NFC').slice(0,180);
      });
      for (let offset=0; offset<valid.length; offset+=500) {
        signal?.throwIfAborted();
        const ids = valid.slice(offset,offset+500).map(item => item.id);
        await tx.run("UPDATE drive_sync_job_items SET status='applied',error_code=NULL,result_json=?,updated_at=? WHERE job_id=? AND id IN ("+ids.map(() => '?').join(',')+')',[JSON.stringify({unchanged:true,inventoryObservation:true}),Date.now(),lease.id,...ids]);
      }
      // Lease expiry/cancellation must roll back acknowledgements as well.
      await context(tx,lease,{mutation:true});
    });
  }
  async function applyItem(lease,item,signal) {
    const descriptor = parseDriveJson(item.source_json);
    const file = descriptor.file;
    if (['skip','conflict','missing'].includes(item.action)) {
      return db.transaction(async tx => {
        await context(tx,lease);
        await setItem(tx,lease,item,item.action === 'conflict' ? 'failed' : 'skipped',item.error_code);
      });
    }
    const preflight = await db.transaction(tx => context(tx,lease,{mutation:true,sourceId:descriptor.sourceId,sourceGeneration:item.source_generation,intentId:descriptor.reimportIntentId}));
    const source = preflight.source;
    if (drive.serviceAccountEmail !== preflight.connection.service_account_email) throw driveError('drive_identity_mismatch');
    async function verifySource() {
      signal?.throwIfAborted();
      try {
        await assertConnectionFolder(drive,preflight.mapping.folder_id,preflight.connection,{signal});
      } catch (error) {
        if (error.retryable || signal?.aborted) throw error;
        throw driveError('drive_root_unavailable');
      }
      let current;
      try {
        current = await drive.getFile(file.id,{signal});
      } catch (error) {
        if (error.code !== 'drive_source_unavailable') throw error;
        throw driveError('drive_preview_stale',409,{stage:'source_missing'});
      }
      if (!current || metadataSignature(current) !== metadataSignature(file) || current.trashed || current.capabilities?.canDownload === false) throw driveError('drive_preview_stale',409,{stage:'source_changed'});
      // An inventory persists across batches and restarts. Recheck membership
      // here as well, including after download and immediately before publish.
      // Omitted parents are not evidence that a file is still in this folder.
      if (current.parents?.length) {
        if (!current.parents.includes(preflight.mapping.folder_id)) throw driveError('drive_preview_stale',409,{stage:'source_membership'});
      } else {
        const member = await findDriveChild(drive,preflight.mapping.folder_id,file,{signal,maxFiles});
        if (!member || metadataSignature(member) !== metadataSignature(file) || member.trashed || member.parents?.length && !member.parents.includes(preflight.mapping.folder_id)) throw driveError('drive_preview_stale',409,{stage:'source_membership'});
      }
    }
    await verifySource();
    const guard = tx => context(tx,lease,{mutation:true,sourceId:descriptor.sourceId,sourceGeneration:item.source_generation,intentId:descriptor.reimportIntentId});
    if (['rename','unchanged'].includes(item.action)) {
      return db.transaction(async tx => {
        const current = await guard(tx);
        const photo = await tx.get("SELECT * FROM photos WHERE id=? AND source='google_drive' AND album_id=?",[current.source.photo_id,current.album.id]);
        if (!photo || Number(current.source.imported_generation) !== Number(current.source.source_generation)) throw driveError('drive_source_stale');
        if (item.action === 'rename') await tx.run('UPDATE photos SET original=? WHERE id=?',[file.name.trim().normalize('NFC').slice(0,180),photo.id]);
        await recordPublication(tx,lease,item,descriptor,{photoId:photo.id,filename:photo.filename});
      });
    }
    const operationId = createHash('sha256').update(JSON.stringify([lease.connection_id,file.id,String(file.version),lease.connection_generation,lease.mapping_generation,item.source_generation])).digest('hex');
    await db.transaction(async tx => {
      await guard(tx);
      await tx.run('UPDATE drive_sync_job_items SET ingest_operation_id=? WHERE id=?',[operationId,item.id]);
    });
    await temporary(async destination => {
      const maxBytes = file.mimeType === 'image/jpeg' ? policy.maxBytes : 20*1024*1024;
      if (file.size && Number(file.size) > maxBytes) throw driveError('drive_file_too_large',422);
      await drive.download(file.id,destination,{signal,maxBytes,checksum:file.md5Checksum});
      await verifySource();
      const replacing = item.action === 'replace' && !['detached','suppressed'].includes(source.state);
      const photo = replacing && await db.get('SELECT filename FROM photos WHERE id=?',[source.photo_id]);
      await ingest({db,storage,mediaControl:control,albumId:preflight.album.id,source:'google_drive',sourceName:file.name,inputPath:destination,inputPolicy:policy,signal,operationId,sourceId:source.id,sourceGeneration:item.source_generation,jobId:lease.id,jobItemId:item.id,fence:lease.fence,targetPhotoId:replacing ? source.photo_id : undefined,expectedFilename:photo?.filename,guard,beforePublish:verifySource,publish:(tx,result) => recordPublication(tx,lease,item,descriptor,result)});
    });
  }
  async function run(lease,{signal}={}) {
    if (env.DRIVE_SYNC_ENABLED !== 'true') throw driveError('drive_feature_disabled',503);
    if (lease.kind === 'check') return check(lease,signal);
    let current = await db.transaction(tx => context(tx,lease));
    if (drive.serviceAccountEmail !== current.connection.service_account_email) throw driveError('drive_identity_mismatch');
    let manifest = parseDriveJson(current.job.manifest_json);
    if (!manifest.complete) {
      const preview = lease.preview_id && await jobs.get(lease.preview_id);
      if (lease.preview_id && (!preview || preview.mapping_id !== lease.mapping_id || !['completed','awaiting_review'].includes(preview.status))) throw driveError('drive_preview_unavailable');
      const previewManifest = parseDriveJson(preview?.manifest_json);
      const payload = parseDriveJson(lease.payload_json);
      manifest = await inventoryDrive({db,drive,jobs,context,lease,signal,maxFiles,reimportIntentId:previewManifest.reimportIntentId || payload.reimportIntentId});
      if (preview && (!previewManifest.complete || manifest.hash !== previewManifest.hash || manifest.catalogRevision !== previewManifest.catalogRevision || manifest.selectionRevision !== previewManifest.selectionRevision || manifest.submissionGeneration !== previewManifest.submissionGeneration)) throw driveError('drive_preview_stale',409,{stage:'manifest'});
      await observeMissing(lease);
      await db.transaction(async tx => {
        await context(tx,lease);
        await tx.run('UPDATE drive_sync_jobs SET expected_catalog_revision=?,expected_selection_revision=?,expected_submission_generation=? WHERE id=?',[manifest.catalogRevision,manifest.selectionRevision,manifest.submissionGeneration,lease.id]);
      });
    }
    current = await db.transaction(tx => context(tx,lease));
    if (lease.kind === 'preview' || !current.mapping.baseline_preview_id && !lease.preview_id || current.album.drive_review_required && !lease.approval_id) {
      return jobs.finish(lease,{status:'awaiting_review',manifest,progress:{total:manifest.count,awaiting_review:true}});
    }
    await acknowledgeUnchanged(lease,signal);
    const pending = await nextItems(lease,manifest);
    for (const item of pending) {
      signal?.throwIfAborted();
      if ((await control.status()).control?.owner) throw driveError('drive_maintenance_active',503,{retryable:true});
      try {
        await applyItem(lease,item,signal);
      } catch (error) {
        const code = safeDriveError(error);
        if (error.retryable || signal?.aborted || ['drive_preview_stale','drive_review_required','drive_mapping_stale','drive_identity_mismatch','drive_root_unavailable','drive_lease_lost','drive_canceled'].includes(code)) throw error;
        await db.transaction(async tx => {
          await context(tx,lease);
          await setItem(tx,lease,item,'failed',code);
          const descriptor = parseDriveJson(item.source_json);
          if (descriptor.sourceId) await tx.run('UPDATE drive_source_files SET error_code=?,updated_at=? WHERE id=?',[code,Date.now(),descriptor.sourceId]);
        });
      }
    }
    pendingOrder.ids.splice(0,batchSize);
    const counts = await db.all('SELECT status,COUNT(*) AS count FROM drive_sync_job_items WHERE job_id=? GROUP BY status',[lease.id]);
    const progress = Object.fromEntries(counts.map(row => [row.status,Number(row.count)]));
    progress.total = manifest.count;
    if (progress.pending) {
      if (!pendingOrder.ids.length) pendingOrder = null;
      return jobs.release(lease,{progress});
    }
    pendingOrder = null;
    await db.transaction(async tx => {
      const final = await context(tx,lease);
      if (!progress.failed) await tx.run('UPDATE drive_album_links SET last_success_at=?,baseline_preview_id=COALESCE(baseline_preview_id,?),updated_at=? WHERE id=?',[Date.now(),lease.preview_id,Date.now(),final.mapping.id]);
    });
    await jobs.finish(lease,{status:progress.failed ? 'completed_with_errors' : 'completed',progress,manifest});
  }
  return {run,context};
}
