import {cleanupFolderPreviews} from './drive-folder-preview.mjs';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {createDriveClient,safeDriveError,driveError} from './drive-client.mjs';
import {createDriveJobs} from './drive-jobs.mjs';
import {createDriveSync} from './drive-sync.mjs';
import {cleanupEncoderTemps} from './drive-image-encoder.mjs';
import {cleanupDriveComparisons} from './drive-comparisons.mjs';

export function createDriveWorker({db,storage,control,drive,env=process.env,jobs=createDriveJobs(db),logger=entry => console.info(JSON.stringify(entry)),ingest,wait=sleep,browseTimeoutMs,now=Date.now}) {
  const owner = randomUUID();
  const started = now();
  const shutdown = new AbortController();
  let running = false;
  let active;
  let sync;
  let state = 'idle';
  let lastHeartbeatAt;
  let lastHeartbeatState;
  let lastCleanupAt;
  async function heartbeat() {
    const timestamp = now();
    if (state === lastHeartbeatState && timestamp - lastHeartbeatAt >= 0 && timestamp - lastHeartbeatAt < 10000) return;
    await db.run('INSERT INTO drive_worker_heartbeats(id,process_id,heartbeat_at,started_at,state,storage_identity) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at,state=excluded.state',[owner,control.processId,timestamp,started,state,control.identity]);
    lastHeartbeatAt = timestamp;
    lastHeartbeatState = state;
  }
  async function runOnce() {
    if (env.DRIVE_SYNC_ENABLED !== 'true') throw driveError('drive_feature_disabled',503);
    if (running) throw driveError('drive_worker_already_running');
    if (shutdown.signal.aborted) return null;
    running = true;
    let lease;
    let timer;
    let browseTimer;
    let heartbeatPending = false;
    let browseCheckPending = false;
    const abort = new AbortController();
    const signal = AbortSignal.any([shutdown.signal,abort.signal]);
    try {
      await heartbeat();
      // Do not claim a job while backup has fenced media writers.
      const media = await control.status();
      if (media.control?.owner || media.owner) return null;
      // Expiry is also enforced by cache readers. Reclaim storage once per
      // minute instead of issuing two DELETEs on every empty-queue poll.
      if (lastCleanupAt === undefined || now() - lastCleanupAt < 0 || now() - lastCleanupAt >= 60000) {
        await cleanupDriveComparisons(db);
        await cleanupFolderPreviews(db);
        // Failed cleanup stays due and is retried on the next tick.
        lastCleanupAt = now();
      }
      await jobs.schedule({enabled:env.DRIVE_SYNC_SCHEDULER_ENABLED === 'true',intervalMs:Number(env.DRIVE_SYNC_INTERVAL_MS || 900000)});
      lease = await jobs.claim(owner);
      if (!lease) return null;
      active = lease;
      state = 'running';
      await heartbeat();
      if(lease.kind==='check' && lease.payload?.operation==='browse-folders') {
        // Abandoned UI browsing must not occupy the worker until its ordinary
        // ten-second heartbeat. Read only the fence; do not renew on every poll.
        browseTimer=setInterval(async()=>{
          if(browseCheckPending || signal.aborted) return;
          browseCheckPending=true;
          try {
            const row=await db.get('SELECT status,cancel_requested,fence FROM drive_sync_jobs WHERE id=?',[lease.id]);
            if(!row || row.status!=='running' || row.cancel_requested || row.fence!==lease.fence) abort.abort(driveError('drive_browse_stale'));
          } catch(error) {abort.abort(error);}
          finally {browseCheckPending=false;}
        },500);
        browseTimer.unref?.();
      }
      timer = setInterval(async () => {
        if (heartbeatPending) return;
        heartbeatPending = true;
        try {
          await jobs.heartbeat(lease);
          await heartbeat();
        } catch (error) {
          abort.abort(error);
        } finally {
          heartbeatPending = false;
        }
      },10000);
      timer.unref?.();
      if (!sync) {
        await cleanupEncoderTemps();
        drive ||= await createDriveClient(env);
        sync = createDriveSync({db,storage,control,drive,jobs,env,ingest,browseTimeoutMs});
      }
      await control.run('drive-job',() => sync.run(lease,{signal}));
      const result = await jobs.get(lease.id);
      logger({event:'drive_job_batch',job_id:lease.id,status:result?.status});
      return result;
    } catch (error) {
      const code = safeDriveError(error);
      if (!lease) throw error;
      const current = await jobs.get(lease.id);
      if (current?.status === 'running' && current.fence === lease.fence && current.lease_owner === owner) {
        try {
          if (shutdown.signal.aborted) await jobs.release(lease,{delayMs:1000});
          else if (error.retryable || ['media_locked','media_maintenance','media_maintenance_active','drive_maintenance_active'].includes(code)) await jobs.retry(lease,{errorCode:code,delayMs:error.retryAfterMs});
          else await jobs.finish(lease,{status:'failed',errorCode:code});
        } catch {
          // A lost fence is left for its new owner, never forcibly reset.
        }
      }
      if (['drive_identity_mismatch','drive_auth_failed','drive_credentials_invalid','drive_credentials_missing'].includes(code)) {
        await db.run('UPDATE drive_connections SET last_error_code=?,updated_at=? WHERE id=? AND generation=?',[code,now(),lease.connection_id,lease.connection_generation]);
      }
      logger({event:'drive_job_error',job_id:lease.id,code,stage:error.stage || null});
      return jobs.get(lease.id);
    } finally {
      if (timer) clearInterval(timer);
      if (browseTimer) clearInterval(browseTimer);
      active = null;
      state = shutdown.signal.aborted ? 'stopped' : 'idle';
      await heartbeat().catch(() => {});
      running = false;
    }
  }
  async function start() {
    while (!shutdown.signal.aborted) {
      let result;
      try { result = await runOnce(); }
      catch (error) { logger({event:'drive_worker_error',code:safeDriveError(error)}); }
      if (shutdown.signal.aborted) break;
      const pollMs = Number(env.DRIVE_SYNC_POLL_MS || 5000);
      // A cooperative batch yield already sets its next eligible time. Resume
      // then, instead of adding the idle poll interval after every five photos.
      // Retry and empty-queue responses keep the normal polling/backoff path.
      // A finished batch or a preview awaiting review leaves the worker free:
      // immediately try the next job, then back off once the queue is empty.
      const released = ['completed','completed_with_errors','awaiting_review','failed','canceled'].includes(result?.status);
      const delay = released ? 1 : result?.status === 'queued'
        ? Math.min(pollMs,Math.max(1,Number(result.available_at)-now() || 1))
        : pollMs;
      await wait(delay,undefined,{signal:shutdown.signal}).catch(() => {});
    }
  }
  function stop() {
    shutdown.abort(driveError('drive_worker_stopping'));
    return {active_job:active?.id || null};
  }
  return {runOnce,start,stop,owner};
}
