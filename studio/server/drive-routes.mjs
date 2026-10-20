import {readFolderPreview} from './drive-folder-preview.mjs';
import {randomUUID} from 'node:crypto';
import {createDriveJobs} from './drive-jobs.mjs';
import {driveFolderScope,drivePageToken} from './drive-folder-scope.mjs';
import {driveError,driveId} from './drive-client.mjs';
import {driveAlbumSummaries,driveItemActions,driveItemStatuses,driveJobDetails,retryDriveJob} from './drive-workflow.mjs';

const parse = (value,fallback={}) => {
  try { return JSON.parse(value || '{}'); } catch { return fallback; }
};
const lock = tx => tx.cloud ? ' FOR UPDATE' : '';
const requestKey = request => {
  const key = request.body.request_key || randomUUID();
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw driveError('drive_invalid_request_key',422);
  return key;
};
const page = request => ({offset:Math.max(0,Math.min(100000,Number.parseInt(request.query.offset,10)||0)),limit:Math.max(1,Math.min(200,Number.parseInt(request.query.limit,10)||100))});
const publicJob = job => job ? {...job,payload_json:undefined,manifest_json:undefined,progress_json:undefined,progress:parse(job.progress_json),manifest:parse(job.manifest_json)} : null;

// Register after admin authentication and the application's Origin middleware.
export function registerDriveRoutes(app,{db,control,env=process.env,routeWrapper}={}) {
  const jobs = createDriveJobs(db);
  const enabled = env.DRIVE_SYNC_ENABLED === 'true';
  const route = handler => {
    const wrapped = async (request,response) => {
      response.set('Cache-Control','private,no-store');
      const readOnly = ['GET','HEAD','OPTIONS'].includes(request.method);
      if (!enabled && !readOnly) throw driveError('drive_feature_disabled',503);
      if (!readOnly) {
        const time = Date.now();
        const expires = time+60000;
        const key = 'drive-admin:'+String(request.admin || request.ip);
        const admitted = await db.get('INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires<? THEN 1 ELSE rate_limits.count+1 END,expires=CASE WHEN rate_limits.expires<? THEN ? ELSE rate_limits.expires END WHERE rate_limits.expires<? OR rate_limits.count<120 RETURNING count',[key,expires,time,time,expires,time]);
        if (!admitted) throw driveError('drive_admin_rate_limited',429);
      }
      return handler(request,response);
    };
    return routeWrapper ? routeWrapper(wrapped) : (request,response,next) => Promise.resolve().then(() => control && !['GET','HEAD','OPTIONS'].includes(request.method) ? control.run('drive-admin',() => wrapped(request,response)) : wrapped(request,response)).catch(next);
  };
  const connection = async (connectionDb=db) => {
    const value = await connectionDb.get('SELECT * FROM drive_connections WHERE id=?',['studio']);
    if (!value) throw driveError('drive_not_configured',409);
    return value;
  };
  const mapping = async (albumId,connectionDb=db) => {
    const value = await connectionDb.get("SELECT * FROM drive_album_links WHERE album_id=? AND state<>'unlinked'",[albumId]);
    if (!value) throw driveError('drive_album_not_linked',404);
    return value;
  };
  const enqueue = async (request,response,kind,extra={}) => {
    const link = await mapping(request.params.id);
    const job = await jobs.enqueue({mappingId:link.id,connectionId:link.connection_id,kind,requestKey:requestKey(request),...extra});
    response.status(202).json({job:publicJob(job),job_id:job.id});
  };

  app.get('/api/admin/drive/status',route(async (request,response) => {
    const current = await db.get('SELECT * FROM drive_connections WHERE id=?',['studio']);
    const links = await db.all("SELECT * FROM drive_album_links WHERE state<>'unlinked' ORDER BY created_at");
    const recent = await db.all('SELECT * FROM drive_sync_jobs ORDER BY created_at DESC LIMIT 20');
    const workers = await db.all('SELECT * FROM drive_worker_heartbeats ORDER BY heartbeat_at DESC LIMIT 5');
    response.json({enabled,configured:!!current,connection:current || null,links,jobs:recent.map(publicJob),workers,scheduler_enabled:env.DRIVE_SYNC_SCHEDULER_ENABLED === 'true'});
  }));
  app.get('/api/admin/drive/albums',route(async (request,response) => {
    response.json({albums:await driveAlbumSummaries(db),enabled});
  }));
  app.put('/api/admin/drive/connection',route(async (request,response) => {
    if (request.body.folder_scope !== undefined) driveFolderScope({folder_scope:request.body.folder_scope});
    if (request.body.folder_scope === null) throw driveError('drive_invalid_folder_scope',422);
    const email = request.body.service_account_email;
    const root = driveId(request.body.root_folder_id);
    if (typeof email !== 'string' || !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(email)) throw driveError('drive_invalid_service_account',422);
    if (request.body.enabled !== undefined && typeof request.body.enabled !== 'boolean') throw driveError('drive_invalid_enabled',422);
    const current = await db.transaction(async tx => {
      const previous = await tx.get('SELECT * FROM drive_connections WHERE id=?'+lock(tx),['studio']);
      const scope = request.body.folder_scope ?? driveFolderScope(previous || {});
      const time = Date.now();
      const status = request.body.enabled === false ? 'disabled' : 'pending';
      if (previous) {
        await tx.run('UPDATE drive_connections SET service_account_email=?,root_folder_id=?,folder_scope=?,status=?,generation=generation+1,last_error_code=NULL,updated_at=? WHERE id=?',[email,root,scope,status,time,previous.id]);
      } else {
        await tx.run('INSERT INTO drive_connections(id,service_account_email,root_folder_id,folder_scope,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',['studio',email,root,scope,status,time,time]);
      }
      return connection(tx);
    });
    const obsolete = await db.all("SELECT id FROM drive_sync_jobs WHERE connection_id=? AND connection_generation<>? AND status IN ('queued','running','retry_wait','awaiting_review')",[current.id,current.generation]);
    for (const job of obsolete) await jobs.cancel(job.id);
    response.json({connection:current});
  }));
  app.post('/api/admin/drive/check',route(async (request,response) => {
    const current = await connection();
    if (current.status === 'disabled') throw driveError('drive_connection_disabled');
    const job = await jobs.enqueue({connectionId:current.id,kind:'check',requestKey:requestKey(request),payload:{testFileId:request.body.test_file_id ? driveId(request.body.test_file_id) : null}});
    response.status(202).json({job:publicJob(job),job_id:job.id});
  }));
  app.get('/api/admin/drive/browse/:jobId/images/:fileId',route(async (request,response) => {
    response.set('X-Content-Type-Options','nosniff');
    if (!request.admin) throw driveError('drive_admin_required',401);
    if (!enabled) throw driveError('drive_feature_disabled',503);
    const bytes = await readFolderPreview(db,{jobId:request.params.jobId,fileId:request.params.fileId});
    response.type('webp').send(bytes);
  }));
  app.post('/api/admin/drive/browse',route(async (request,response) => {
    const current = await connection();
    if (current.status !== 'active') throw driveError('drive_connection_not_ready');
    const folderId = driveId(request.body.folder_id);
    const pageToken = drivePageToken(request.body.page_token);
    const job = await jobs.enqueue({connectionId:current.id,kind:'check',requestKey:requestKey(request),payload:{operation:'browse-folders',folderId,...(pageToken ? {pageToken} : {})}});
    response.status(202).json({job:publicJob(job),job_id:job.id});
  }));
  app.post('/api/admin/drive/folder-check',route(async (request,response) => {
    const current = await connection();
    if (current.status !== 'active') throw driveError('drive_connection_not_ready');
    const folderId = driveId(request.body.folder_id);
    const occupied = await db.get("SELECT album_id FROM drive_album_links WHERE connection_id=? AND folder_id=? AND state<>'unlinked'",[current.id,folderId]);
    if (occupied) throw driveError('drive_folder_already_linked');
    const job = await jobs.enqueue({connectionId:current.id,kind:'check',requestKey:requestKey(request),payload:{operation:'inspect-folder',folderId}});
    response.status(202).json({job:publicJob(job),job_id:job.id});
  }));
  app.get('/api/admin/albums/:id/drive',route(async (request,response) => {
    const link = await db.get("SELECT * FROM drive_album_links WHERE album_id=? AND state<>'unlinked'",[request.params.id]);
    if (!link) return response.json({mapping:null,sources:[],jobs:[]});
    const {offset,limit} = page(request);
    const sources = await db.all('SELECT * FROM drive_source_files WHERE mapping_id=? ORDER BY source_name,drive_file_id LIMIT ? OFFSET ?',[link.id,limit,offset]);
    const recent = await db.all('SELECT * FROM drive_sync_jobs WHERE mapping_id=? ORDER BY created_at DESC LIMIT 20',[link.id]);
    response.json({mapping:link,sources,jobs:recent.map(publicJob),offset,limit,total:Number((await db.get('SELECT COUNT(*) AS count FROM drive_source_files WHERE mapping_id=?',[link.id])).count)});
  }));
  app.put('/api/admin/albums/:id/drive',route(async (request,response) => {
    const current = await connection();
    if (current.status !== 'active') throw driveError('drive_connection_not_ready');
    const album = await db.get("SELECT id FROM albums WHERE id=? AND status<>'archived'",[request.params.id]);
    if (!album) throw driveError('drive_album_unavailable',404);
    const job = await jobs.enqueue({connectionId:current.id,kind:'check',requestKey:requestKey(request),payload:{operation:'link',albumId:album.id,folderId:driveId(request.body.folder_id)}});
    response.status(202).json({job:publicJob(job),job_id:job.id});
  }));
  app.post('/api/admin/albums/:id/drive/preview',route((request,response) => enqueue(request,response,'preview')));
  app.post('/api/admin/albums/:id/drive/schedule',route(async (request,response) => {
    if (typeof request.body.enabled !== 'boolean') throw driveError('drive_invalid_schedule',422);
    const interval = Number(env.DRIVE_SYNC_INTERVAL_MS || 900000);
    if (!Number.isSafeInteger(interval) || interval < 60000 || interval > 86400000) throw driveError('drive_invalid_schedule_interval',422);
    const scheduled = await db.transaction(async tx => {
      const album = await tx.get('SELECT * FROM albums WHERE id=?'+lock(tx),[request.params.id]);
      const hint = await mapping(request.params.id,tx);
      const current = await tx.get('SELECT * FROM drive_connections WHERE id=?'+lock(tx),[hint.connection_id]);
      const link = await tx.get('SELECT * FROM drive_album_links WHERE id=?'+lock(tx),[hint.id]);
      if (request.body.enabled && (!album || album.status === 'archived' || current.status !== 'active' || link.state !== 'attached' || !link.enabled)) throw driveError('drive_connection_not_ready');
      if (request.body.enabled && !link.baseline_preview_id) throw driveError('drive_baseline_required');
      const nextRun = request.body.enabled ? Date.now()+interval : null;
      await tx.run('UPDATE drive_album_links SET next_run_at=?,updated_at=? WHERE id=?',[nextRun,Date.now(),link.id]);
      return {...link,next_run_at:nextRun};
    });
    response.json({success:true,mapping:scheduled,scheduler_enabled:env.DRIVE_SYNC_SCHEDULER_ENABLED === 'true'});
  }));
  app.post('/api/admin/albums/:id/drive/sync',route((request,response) => enqueue(request,response,'apply',{previewId:request.body.preview_id || null})));
  app.post('/api/admin/albums/:id/drive/approve',route(async (request,response) => {
    const link = await mapping(request.params.id);
    const previewId = request.body.preview_id;
    const key = requestKey(request);
    const approval = await db.transaction(async tx => {
      const album = await tx.get('SELECT * FROM albums WHERE id=?'+lock(tx),[link.album_id]);
      const current = await tx.get('SELECT * FROM drive_connections WHERE id=?'+lock(tx),[link.connection_id]);
      const lockedLink = await tx.get('SELECT * FROM drive_album_links WHERE id=?'+lock(tx),[link.id]);
      const preview = await tx.get('SELECT * FROM drive_sync_jobs WHERE id=?'+lock(tx),[previewId]);
      const manifest = parse(preview?.manifest_json);
      if (!preview || preview.mapping_id !== link.id || !['awaiting_review','completed'].includes(preview.status) || !manifest.complete || current.status !== 'active' || lockedLink.state !== 'attached' || !lockedLink.enabled) throw driveError('drive_preview_unavailable');
      const existing = await tx.get('SELECT * FROM drive_sync_approvals WHERE preview_id=?',[preview.id]);
      if (existing) {
        if (existing.invalidated_at) throw driveError('drive_preview_stale');
        if (existing.job_id) return existing;
      }
      if (Number(preview.connection_generation) !== Number(current.generation) || Number(preview.mapping_generation) !== Number(lockedLink.generation) || Number(manifest.catalogRevision) !== Number(album.catalog_revision) || Number(manifest.selectionRevision) !== Number(album.selection_revision) || Number(manifest.submissionGeneration) !== Number(album.submission_generation)) throw driveError('drive_preview_stale');
      if (existing) return existing;
      const approvalId = randomUUID();
      await tx.run('INSERT INTO drive_sync_approvals(id,preview_id,album_id,mapping_id,connection_generation,mapping_generation,catalog_revision,selection_revision,submission_generation,manifest_json,approved_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[approvalId,preview.id,album.id,link.id,current.generation,lockedLink.generation,album.catalog_revision,album.selection_revision,album.submission_generation,preview.manifest_json,String(request.admin || 'admin'),Date.now()]);
      return tx.get('SELECT * FROM drive_sync_approvals WHERE id=?',[approvalId]);
    });
    if (approval.job_id) {
      const job = await jobs.get(approval.job_id);
      return response.status(202).json({job:publicJob(job),job_id:job.id});
    }
    const job = await jobs.enqueue({connectionId:link.connection_id,mappingId:link.id,kind:'apply',requestKey:key,previewId,approvalId:approval.id});
    response.status(202).json({job:publicJob(job),job_id:job.id});
  }));
  app.post('/api/admin/albums/:id/drive/pause',route(async (request,response) => {
    if (typeof request.body.paused !== 'boolean') throw driveError('drive_invalid_pause',422);
    await db.transaction(async tx => {
      await tx.get('SELECT id FROM albums WHERE id=?'+lock(tx),[request.params.id]);
      const link = await mapping(request.params.id,tx);
      await tx.run('UPDATE drive_album_links SET state=?,enabled=?,generation=generation+1,updated_at=? WHERE id=?',[request.body.paused ? 'paused' : 'attached',request.body.paused ? 0 : 1,Date.now(),link.id]);
      const active = await tx.all("SELECT id FROM drive_sync_jobs WHERE mapping_id=? AND status IN ('queued','running','retry_wait')",[link.id]);
      for (const job of active) await jobs.cancel(job.id,tx);
    });
    response.json({success:true,paused:request.body.paused});
  }));
  app.delete('/api/admin/albums/:id/drive',route(async (request,response) => {
    await db.transaction(async tx => {
      await tx.get('SELECT id FROM albums WHERE id=?'+lock(tx),[request.params.id]);
      const link = await mapping(request.params.id,tx);
      await tx.run("UPDATE drive_album_links SET state='unlinked',enabled=0,generation=generation+1,updated_at=? WHERE id=?",[Date.now(),link.id]);
      const active = await tx.all("SELECT id FROM drive_sync_jobs WHERE mapping_id=? AND status IN ('queued','running','retry_wait')",[link.id]);
      for (const job of active) await jobs.cancel(job.id,tx);
    });
    response.json({success:true});
  }));
  app.post('/api/admin/photos/:id/drive/detach',route(async (request,response) => {
    const photo = await db.get('SELECT * FROM photos WHERE id=?',[request.params.id]);
    if (!photo) throw driveError('drive_photo_missing',404);
    await db.transaction(async tx => {
      await tx.get('SELECT id FROM albums WHERE id=?'+lock(tx),[photo.album_id]);
      const source = await tx.get('SELECT * FROM drive_source_files WHERE photo_id=?'+lock(tx),[photo.id]);
      if (!source) throw driveError('drive_photo_not_managed');
      await tx.run("UPDATE drive_source_files SET state='detached',source_generation=source_generation+1,reimport_intent_id=NULL,updated_at=? WHERE id=?",[Date.now(),source.id]);
      await tx.run("UPDATE photos SET source='manual' WHERE id=? AND album_id=?",[photo.id,photo.album_id]);
    });
    response.json({success:true});
  }));
  app.post('/api/admin/albums/:id/drive/reimport',route(async (request,response) => {
    const key = requestKey(request);
    const link = await mapping(request.params.id);
    const intent = await db.transaction(async tx => {
      await tx.get('SELECT id FROM albums WHERE id=?'+lock(tx),[link.album_id]);
      const existing = await tx.get('SELECT * FROM drive_reimport_intents WHERE request_key=?',[key]);
      if (existing) {
        const source = await tx.get('SELECT * FROM drive_source_files WHERE id=?',[existing.source_file_id]);
        if (source?.mapping_id !== link.id || source.drive_file_id !== request.body.file_id) throw driveError('drive_request_conflict');
        return existing;
      }
      const source = await tx.get('SELECT * FROM drive_source_files WHERE connection_id=? AND drive_file_id=?'+lock(tx),[link.connection_id,driveId(request.body.file_id)]);
      if (!source || source.mapping_id !== link.id || !['suppressed','detached'].includes(source.state)) throw driveError('drive_reimport_not_available');
      const intentId = randomUUID();
      const generation = Number(source.source_generation)+1;
      await tx.run('INSERT INTO drive_reimport_intents(id,source_file_id,request_key,source_generation,created_at,updated_at) VALUES(?,?,?,?,?,?)',[intentId,source.id,key,generation,Date.now(),Date.now()]);
      await tx.run('UPDATE drive_source_files SET source_generation=?,reimport_intent_id=?,updated_at=? WHERE id=?',[generation,intentId,Date.now(),source.id]);
      return tx.get('SELECT * FROM drive_reimport_intents WHERE id=?',[intentId]);
    });
    const job = await jobs.enqueue({connectionId:link.connection_id,mappingId:link.id,kind:'preview',requestKey:'reimport-'+intent.id,payload:{reimportIntentId:intent.id}});
    response.status(202).json({job:publicJob(job),job_id:job.id});
  }));
  app.get('/api/admin/drive/jobs/:id',route(async (request,response) => {
    const job = await jobs.get(request.params.id);
    if (!job) throw driveError('drive_job_missing',404);
    const pagination = page(request);
    // Folder navigation never creates inventory items. Keep the existing
    // response shape while avoiding two item queries on every picker poll.
    // Filtered requests still use the shared validation/detail path.
    const navigation = job.kind === 'check' && !job.mapping_id && ['browse-folders','inspect-folder'].includes(job.payload?.operation);
    const details = navigation && request.query.action === undefined && request.query.status === undefined
      ? {items:[],total:0,counts:{actions:Object.fromEntries(driveItemActions.map(value => [value,0])),statuses:Object.fromEntries(driveItemStatuses.map(value => [value,0]))},...pagination}
      : await driveJobDetails(db,job,{...pagination,action:request.query.action,status:request.query.status});
    response.json({job:publicJob(job),...details});
  }));
  app.post('/api/admin/drive/jobs/:id/retry',route(async (request,response) => {
    const job = await retryDriveJob(db,request.params.id,requestKey(request));
    response.status(202).json({job:publicJob(job),job_id:job.id});
  }));
  app.post('/api/admin/drive/jobs/:id/cancel',route(async (request,response) => {
    await jobs.cancel(request.params.id);
    response.json({success:true,job:publicJob(await jobs.get(request.params.id))});
  }));
  return {jobs};
}
