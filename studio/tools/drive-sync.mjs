#!/usr/bin/env node
// Credentials must be supplied explicitly by the operator; no implicit .env load.
import path from 'node:path';
import {openDatabase} from '../server/db.mjs';
import {createStorage} from '../server/storage.mjs';
import {createMediaControl,trackedStorage} from '../server/media-control.mjs';
import {createDriveWorker} from '../server/drive-worker.mjs';
import {safeDriveError} from '../server/drive-client.mjs';

const command = process.argv[2] || 'help';
if (!['help','once','worker'].includes(command)) throw new Error('Use drive-sync.mjs once|worker|help');
if (command === 'help') {
  console.log('Drive Sync: once processes one bounded job batch; worker polls until SIGTERM. Set DRIVE_SYNC_ENABLED=true, DRIVE_SYNC_SERVICE_ACCOUNT_FILE, DATA_DIR or DATABASE_URL, and MEDIA_STORAGE_PROVIDER explicitly. Scheduler remains off unless DRIVE_SYNC_SCHEDULER_ENABLED=true and an album has a schedule. Configure/link/preview/approve in admin first.');
} else {
  let db;
  let raw;
  let control;
  let worker;
  try {
    if (process.env.DRIVE_SYNC_ENABLED !== 'true' || !process.env.MEDIA_STORAGE_PROVIDER) throw new Error('Explicit DRIVE_SYNC_ENABLED=true and MEDIA_STORAGE_PROVIDER are required');
    const dataDir = path.resolve(process.env.DATA_DIR || 'data/live');
    db = await openDatabase(dataDir,{url:process.env.DATABASE_URL || null});
    raw = createStorage(path.join(dataDir,'uploads'),process.env);
    await raw.init();
    control = await createMediaControl(db,raw.identity);
    const storage = trackedStorage(db,raw,control);
    worker = createDriveWorker({db,storage,control});
    const terminate = () => worker.stop();
    process.once('SIGTERM',terminate);
    process.once('SIGINT',terminate);
    if (command === 'once') {
      const job = await worker.runOnce();
      console.log(JSON.stringify({job_id:job?.id || null,status:job?.status || 'idle'}));
      if (job?.status === 'failed' || job?.status === 'completed_with_errors') process.exitCode = 2;
    } else {
      await worker.start();
    }
    process.removeListener('SIGTERM',terminate);
    process.removeListener('SIGINT',terminate);
  } catch (error) {
    console.error(JSON.stringify({error:safeDriveError(error)}));
    process.exitCode = 1;
  } finally {
    worker?.stop();
    await control?.close();
    raw?.close?.();
    await db?.close();
  }
}
