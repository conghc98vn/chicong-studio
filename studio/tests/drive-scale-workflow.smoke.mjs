// Isolated synthetic workflow check. Never loads .env or contacts Google/storage APIs.
// Node 24: node studio/tests/drive-scale-workflow.smoke.mjs [--count 5000] [--postgres]
// --postgres requires STUDIO_TEST_POSTGRES_URL pointing to a disposable loopback DB.
// Tiny renditions are encoded ONCE, then injected into the real ingestPhoto path.
// This measures database/filesystem/workflow behavior, not full-resolution encoding.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir, platform, arch, release} from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {driveFixture} from './drive-test-fixture.mjs';
import {openDatabase} from '../server/db.mjs';
import {DRIVE_FOLDER} from '../server/drive-client.mjs';
import {createDriveJobs} from '../server/drive-jobs.mjs';
import {createDriveWorker} from '../server/drive-worker.mjs';
import {createMediaControl, trackedStorage} from '../server/media-control.mjs';
import {createStorage} from '../server/storage.mjs';
import {ingestPhoto} from '../server/photo-ingest.mjs';
import {optimizePhoto} from '../server/image-optimizer.mjs';
import {photoDeletion} from '../server/photo-deletion.mjs';
import {createBackup, exportBackup, restoreBackup, verifyBackup, tables as backupTables} from '../tools/media-backup.mjs';

const args = process.argv.slice(2);
let count = 5000;
let postgres = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--count') count = Number(args[++i]);
  else if (args[i] === '--postgres') postgres = true;
  else throw Error('Unknown argument: ' + args[i]);
}
assert.ok(Number.isSafeInteger(count) && count >= 30 && count <= 10000);
const batchSize = 25;
const restartAfter = Math.min(1007, Math.floor(count / 2) - (Math.floor(count / 2) % batchSize) + 7);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const label = new Date().toISOString().replace(/[:.]/g, '-') + '-' + (postgres ? 'postgres' : 'sqlite') + '-' + count;
const output = path.join(root, 'output', 'drive-scale-workflow-' + label);
await mkdir(output, {recursive: true, mode: 0o700});
const scratch = await mkdtemp(path.join(tmpdir(), 'drive-scale-workflow-'));
const oldTemporary = process.env.TMPDIR;
const oldPostgres = process.env.STUDIO_TEST_POSTGRES_URL;
// The real worker performs encoder-temp housekeeping. Confine that to this fixture.
process.env.TMPDIR = scratch;
if (postgres) {
  assert.ok(oldPostgres, '--postgres requires STUDIO_TEST_POSTGRES_URL');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(oldPostgres).hostname), 'Only disposable loopback PostgreSQL is allowed');
} else delete process.env.STUDIO_TEST_POSTGRES_URL;
const oldFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error('Synthetic workflow forbids HTTP/network fetch'); };

const started = performance.now();
const report = {
  state: 'running', recorded_at: new Date().toISOString(), output,
  environment: {node: process.version, platform: platform(), arch: arch(), os_release: release(), database: postgres ? 'disposable-loopback-postgresql-schema' : 'temporary-sqlite'},
  workload: {count, batch_size: batchSize, page_size: 1000, restart_after: restartAfter, source: 'synthetic 96x64 JPEG repeated under unique Drive file IDs; deliberately reverse-listed unpadded numeric filenames'},
  limitations: [
    'Fake Drive metadata/downloads, without Google credentials, network latency, quotas, throttling or remote failures.',
    'One tiny image is encoded once; ingestPhoto receives precomputed decoded renditions for all files. This is not a full-resolution CPU or network benchmark.',
    'Real temporary filesystem, tracked storage journals, publication transactions and receipts. Local filesystem throughput is not cloud object storage throughput.',
    'Worker objects restart cooperatively mid-batch in one Node process. This is not a SIGKILL, machine-loss or unknown-storage-write recovery test.',
    'The reviewed approval row is seeded in the isolated database; HTTP approval routes and UI behavior are outside this check.',
    'Backup includes 3 objects per photo, but identical tiny rendition content deduplicates to a few unique blobs; this does not test large unique backup byte volume.',
    'Single measured run on this machine; timings and memory observations are not production SLAs.'
  ],
  phases: [], findings: [], assertions: {},
  counters: {folder_gets: 0, file_gets: 0, list_pages: 0, membership_pages: 0, downloads: 0, downloaded_bytes: 0, storage_puts: 0, storage_put_bytes: 0, batches: 0, claims: 0, ingest_calls: 0},
  memory: {sampling_ms: 200, rss_peak_bytes: 0, heap_used_peak_bytes: 0, external_peak_bytes: 0},
};
let phase = 'setup';
let journal = Promise.resolve();
function log(event) {
  const entry = {at: new Date().toISOString(), elapsed_ms: Math.round(performance.now() - started), phase, ...event};
  console.log(JSON.stringify(entry));
  journal = journal.then(() => appendFile(path.join(output, 'events.jsonl'), JSON.stringify(entry) + '\n'));
}
function sampleMemory() {
  const memory = process.memoryUsage();
  report.memory.rss_peak_bytes = Math.max(report.memory.rss_peak_bytes, memory.rss);
  report.memory.heap_used_peak_bytes = Math.max(report.memory.heap_used_peak_bytes, memory.heapUsed);
  report.memory.external_peak_bytes = Math.max(report.memory.external_peak_bytes, memory.external);
  return memory;
}
const sampler = setInterval(sampleMemory, 200);
const heartbeat = setInterval(() => log({event: 'progress', ...report.counters, rss_bytes: sampleMemory().rss}), 30000);
async function measure(name, fn) {
  phase = name;
  const begin = performance.now();
  const cpu = process.cpuUsage();
  const counters = {...report.counters};
  log({event: 'phase_started'});
  const result = await fn();
  const usedCpu = process.cpuUsage(cpu);
  const record = {name, elapsed_ms: Math.round(performance.now() - begin), cpu_user_ms: Math.round(usedCpu.user / 1000), cpu_system_ms: Math.round(usedCpu.system / 1000), counters: Object.fromEntries(Object.entries(report.counters).map(([key, value]) => [key, value - counters[key]])), memory_after: sampleMemory()};
  report.phases.push(record);
  log({event: 'phase_completed', ...record});
  return result;
}
let fixture;
let control;
let cleanup;
let worker;
let stoppedLease;
let restartTriggered = false;
let published = 0;
let backupProgress = 0;
const downloads = new Map();
const workers = [];
const workerErrors = [];
const claims = [];
try {
  log({event: 'started', output, count, database: report.environment.database});
  const bytes = await sharp({create: {width: 96, height: 64, channels: 3, background: '#315a8c'}}).jpeg().toBuffer();
  const decoded = await measure('encode_one_tiny_fixture', () => optimizePhoto(bytes));
  report.workload.source_bytes_per_file = bytes.length;
  report.workload.rendition_bytes_per_photo = decoded.data.length + decoded.thumbnail.length + decoded.download.length;
  const checksum = createHash('md5').update(bytes).digest('hex');
  fixture = await driveFixture();
  const {db, dir} = fixture;
  const uploads = path.join(dir, 'uploads');
  const raw = createStorage(uploads, {MEDIA_STORAGE_PROVIDER: 'local'});
  control = await createMediaControl(db, raw.identity);
  const countedRaw = {...raw, async put(key, value, options) {
    report.counters.storage_puts++;
    report.counters.storage_put_bytes += value.length;
    return raw.put(key, value, options);
  }};
  const storage = trackedStorage(db, countedRaw, control);
  cleanup = photoDeletion({db, storage, mediaControl: control});
  const files = Array.from({length: count}, (_, index) => ({id: 'synthetic-file-' + (count - index), name: 'IMG_' + (count - index) + '.jpg', mimeType: 'image/jpeg', parents: ['folder'], version: '1', size: String(bytes.length), md5Checksum: checksum, modifiedTime: '2026-10-17T00:00:00Z', capabilities: {canDownload: true}}));
  const byId = new Map(files.map(file => [file.id, file]));
  const byName = new Map(files.map(file => [file.name, file]));
  const folders = new Map([
    ['root', {id: 'root', name: 'Synthetic root', mimeType: DRIVE_FOLDER, parents: [], version: '1'}],
    ['folder', {id: 'folder', name: 'Synthetic album', mimeType: DRIVE_FOLDER, parents: ['root'], version: '1'}],
  ]);
  const drive = {
    serviceAccountEmail: 'test@example.invalid',
    async getFile(id, {signal} = {}) {
      signal?.throwIfAborted();
      if (folders.has(id)) { report.counters.folder_gets++; return structuredClone(folders.get(id)); }
      report.counters.file_gets++;
      assert.ok(byId.has(id));
      const file = structuredClone(byId.get(id));
      // Exercise fresh fallback folder-membership checks rather than trust cached parents.
      delete file.parents;
      return file;
    },
    async listFiles(folder, {pageToken, name, signal} = {}) {
      signal?.throwIfAborted();
      assert.equal(folder, 'folder');
      if (name !== undefined) {
        report.counters.membership_pages++;
        return {files: byName.has(name) ? [structuredClone(byName.get(name))] : []};
      }
      report.counters.list_pages++;
      const offset = Number(pageToken || 0);
      return {files: structuredClone(files.slice(offset, offset + 1000)), nextPageToken: offset + 1000 < files.length ? String(offset + 1000) : undefined};
    },
    async download(id, destination, {maxBytes, checksum: expectedChecksum, signal}) {
      signal?.throwIfAborted();
      assert.ok(byId.has(id));
      assert.equal(expectedChecksum, checksum);
      assert.ok(bytes.length <= maxBytes);
      downloads.set(id, (downloads.get(id) || 0) + 1);
      report.counters.downloads++;
      report.counters.downloaded_bytes += bytes.length;
      await writeFile(destination, bytes, {flag: 'wx', mode: 0o600});
      return {bytes: bytes.length, checksum};
    },
  };
  const jobs = createDriveJobs(db, {leaseMs: 120000});
  const observedJobs = {...jobs, async claim(owner) {
    const lease = await jobs.claim(owner);
    if (lease) { claims.push({owner, id: lease.id, fence: lease.fence}); report.counters.claims++; stoppedLease = lease; }
    return lease;
  }};
  const env = {DRIVE_SYNC_ENABLED: 'true', DRIVE_SYNC_SCHEDULER_ENABLED: 'false', DRIVE_SYNC_BATCH_SIZE: String(batchSize), DRIVE_SYNC_TEMP_DIR: path.join(dir, 'source-temp')};
  const newWorker = () => {
    const next = createDriveWorker({db, storage, control, drive, jobs: observedJobs, env,
      logger: entry => { if (entry.event === 'drive_job_error') { workerErrors.push(entry); log(entry); } },
      ingest: async options => {
        report.counters.ingest_calls++;
        const result = await ingestPhoto({...options, decoded});
        published++;
        if (!restartTriggered && published === restartAfter) {
          restartTriggered = true;
          worker.stop();
        }
        return result;
      },
    });
    workers.push(next);
    return next;
  };
  worker = newWorker();
  async function runOne(jobId) {
    const state = await jobs.get(jobId);
    const delay = Math.max(0, Number(state.available_at) - Date.now() + 1);
    if (delay) await sleep(delay);
    report.counters.batches++;
    const result = await worker.runOnce();
    assert.ok(result, 'Worker must claim the isolated queued job');
    return result;
  }
  const preview = await measure('preview_inventory', async () => {
    const queued = await jobs.enqueue({mappingId: 'mapping', kind: 'preview', requestKey: 'scale-preview'});
    const result = await runOne(queued.id);
    assert.equal(result.status, 'awaiting_review');
    assert.equal(result.manifest.count, count);
    assert.equal(report.counters.downloads, 0);
    return result;
  });
  const album = await db.get("SELECT * FROM albums WHERE id='album'");
  // This isolated harness seeds the reviewed approval row; it does not test HTTP/UI approval.
  await db.run(`INSERT INTO drive_sync_approvals(id,preview_id,album_id,mapping_id,connection_generation,mapping_generation,catalog_revision,selection_revision,submission_generation,manifest_json,approved_by,created_at)
    VALUES('synthetic-approval',?,'album','mapping',1,1,?,?,?,?,?,?)`, [preview.id, album.catalog_revision, album.selection_revision, album.submission_generation, preview.manifest_json, 'synthetic-test', Date.now()]);
  const apply = await jobs.enqueue({mappingId: 'mapping', kind: 'apply', requestKey: 'scale-apply', previewId: preview.id, approvalId: 'synthetic-approval'});
  let beforeRestart;
  let prefix;
  await measure('apply_until_mid_batch_restart', async () => {
    while (!restartTriggered) {
      const result = await runOne(apply.id);
      assert.equal(result.status, 'queued', JSON.stringify(result));
    }
    beforeRestart = await db.all('SELECT id,filename,original,position FROM photos ORDER BY position');
    assert.equal(beforeRestart.length, restartAfter);
    prefix = new Map([...downloads]);
    assert.equal(prefix.size, restartAfter);
    assert.ok([...prefix.values()].every(value => value === 1));
    const appliedCount = await db.get("SELECT COUNT(*) AS count FROM drive_sync_job_items WHERE job_id=? AND status='applied'", [apply.id]);
    assert.equal(Number(appliedCount.count), restartAfter);
    const lostLease = stoppedLease;
    const previousOwner = worker.owner;
    worker = newWorker();
    assert.notEqual(worker.owner, previousOwner);
    await assert.rejects(db.transaction(tx => jobs.assertLease(tx, lostLease)), {code: 'DRIVE_LEASE_LOST'});
    report.restart = {published_before_restart: restartAfter, remaining: count - restartAfter, interrupted_batch_offset: restartAfter % batchSize, old_owner: previousOwner, new_owner: worker.owner, last_fence: lostLease.fence, stale_lease_rejected: true, published_prefix_unchanged: null};
    log({event: 'worker_restarted', ...report.restart});
  });
  await measure('resume_and_finish_apply', async () => {
    for (;;) {
      const result = await runOne(apply.id);
      if (result.status === 'queued') continue;
      assert.equal(result.status, 'completed', JSON.stringify(result));
      assert.equal(result.progress.applied, count);
      report.apply = {status: result.status, progress: result.progress, fence: result.fence, attempt: result.attempt};
      break;
    }
    const after = await db.all('SELECT id,filename,original,position FROM photos ORDER BY position LIMIT ?', [restartAfter]);
    assert.deepEqual(after, beforeRestart);
    assert.ok([...prefix.keys()].every(id => downloads.get(id) === 1));
    report.restart.published_prefix_unchanged = true;
    report.restart.completed_files_downloaded_again = 0;
  });
  const rows = await db.all(`SELECT p.id,p.filename,p.original,p.position,p.source,s.id AS source_id,s.drive_file_id,s.photo_id,s.source_generation,s.imported_generation,s.imported_version,s.checksum
    FROM photos p JOIN drive_source_files s ON s.photo_id=p.id ORDER BY p.position`);
  await measure('verify_published_catalog_and_storage', async () => {
    assert.equal(rows.length, count);
    assert.equal(new Set(rows.map(row => row.id)).size, count);
    assert.equal(new Set(rows.map(row => row.filename)).size, count);
    assert.equal(new Set(rows.map(row => row.source_id)).size, count);
    assert.equal(new Set(rows.map(row => row.drive_file_id)).size, count);
    assert.equal(downloads.size, count);
    assert.ok([...downloads.values()].every(value => value === 1));
    assert.equal(report.counters.storage_puts, count * 3);
    for (const [index, row] of rows.entries()) {
      assert.equal(row.position, index);
      assert.equal(row.original, 'IMG_' + (index + 1) + '.jpg');
      assert.equal(row.drive_file_id, 'synthetic-file-' + (index + 1));
      assert.equal(row.photo_id, row.id);
      assert.equal(row.source, 'google_drive');
      assert.equal(row.source_generation, row.imported_generation);
      assert.equal(row.imported_version, '1');
      assert.equal(row.checksum, checksum);
    }
    const attempts = await db.get("SELECT COUNT(*) AS total,COUNT(DISTINCT operation_id) AS operations FROM photo_ingest_attempts WHERE state='published'");
    assert.equal(Number(attempts.total), count);
    assert.equal(Number(attempts.operations), count);
    assert.equal(Number((await db.get('SELECT COUNT(*) AS count FROM photo_ingest_attempts')).count), count);
    const objects = await raw.list();
    assert.equal(objects.length, count * 3);
    assert.equal(objects.reduce((sum, object) => sum + object.bytes, 0), count * report.workload.rendition_bytes_per_photo);
    assert.deepEqual(await readdir(env.DRIVE_SYNC_TEMP_DIR), []);
    assert.equal((await control.status()).writers.length, 0);
    report.assertions.catalog = {photos: count, source_ids: count, unique_drive_ids: count, numeric_filename_order: true, all_sources_google_drive: true, source_versions_and_checksums_match: true, published_receipts: count, unique_operations: count, exact_once_downloads: count, persisted_objects: objects.length, source_temporaries_remaining: 0};
  });
  const receipts = await db.all('SELECT operation_id,photo_id,candidate_prefix,state FROM photo_ingest_attempts ORDER BY operation_id');
  await measure('published_ingest_receipt_replay', async () => {
    const receipt = receipts[0];
    const puts = report.counters.storage_puts;
    const result = await ingestPhoto({db, storage, mediaControl: control, albumId: 'album', operationId: receipt.operation_id, sourceName: 'ignored-replay.jpg', inputPath: path.join(dir, 'does-not-exist')});
    assert.equal(result.reused, true);
    assert.equal(result.id, receipt.photo_id);
    assert.equal(report.counters.storage_puts, puts);
    report.assertions.receipt_replay_without_source_read_or_storage_write = true;
  });
  await measure('repeat_unchanged_sync', async () => {
    const downloadCount = report.counters.downloads;
    const putCount = report.counters.storage_puts;
    worker.stop();
    worker = newWorker();
    const queued = await jobs.enqueue({mappingId: 'mapping', kind: 'apply', requestKey: 'scale-unchanged'});
    const result = await runOne(queued.id);
    assert.equal(result.status, 'completed', JSON.stringify(result));
    assert.equal(result.progress.applied, count);
    assert.equal(report.counters.downloads, downloadCount);
    assert.equal(report.counters.storage_puts, putCount);
    assert.deepEqual((await db.all('SELECT id,filename,original,position FROM photos ORDER BY position')).map(row => ({...row})), rows.map(({id,filename,original,position}) => ({id,filename,original,position})));
    assert.deepEqual(await db.all('SELECT operation_id,photo_id,candidate_prefix,state FROM photo_ingest_attempts ORDER BY operation_id'), receipts);
    report.assertions.repeated_sync = {status: 'completed', downloads: 0, writes: 0, photo_identity_and_positions_unchanged: true, receipt_identity_unchanged: true};
  });
  worker.stop();
  // Seed a due schedule and a still-valid approval so restore safety is verified.
  await db.run("UPDATE drive_album_links SET enabled=1,next_run_at=1 WHERE id='mapping'");
  assert.equal((await db.get("SELECT invalidated_at FROM drive_sync_approvals WHERE id='synthetic-approval'")).invalidated_at, null);
  const repository = path.join(dir, 'backup');
  const backup = () => createBackup({db, storage: {...raw, async get(...args) {
    const result = await raw.get(...args);
    backupProgress++;
    if (backupProgress % 1500 === 0) log({event: 'backup_object_progress', copied: backupProgress, total: count * 3});
    return result;
  }}, control, cleanup: cleanup.cleanup, root: repository, appRevision: 'synthetic-scale-current-worktree'});
  let manifest;
  try {
    manifest = await measure('real_backup_' + (count * 3) + '_small_objects', backup);
  } catch (error) {
    if (error.message !== 'Unrecognized database tables: update the backup schema before proceeding') throw error;
    const actual = await db.all(db.cloud ? 'SELECT tablename AS name FROM pg_tables WHERE schemaname=current_schema()' : "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    const unsupported = actual.filter(row => !backupTables.includes(row.name)).map(row => row.name).sort();
    assert.deepEqual(unsupported, ['drive_comparison_cache']);
    assert.equal(Number((await db.get('SELECT COUNT(*) AS count FROM drive_comparison_cache')).count), 0);
    const finding = {code: 'backup_rejects_worker_created_comparison_cache', message: error.message, tables: unsupported, current_application_backup_passed: false, supplemental_verification: 'Drop only the empty comparison cache table in this disposable fixture, then exercise unchanged backup/export/restore functions. This is a test-only workaround, not an application fix.'};
    report.findings.push(finding);
    log({event: 'application_failure', ...finding});
    await writeFile(path.join(output, 'finding.json'), JSON.stringify(finding, null, 2) + '\n');
    await db.exec('DROP TABLE drive_comparison_cache');
    report.limitations.push(finding.supplemental_verification);
    manifest = await measure('supplemental_backup_after_empty_cache_removal', backup);
  }
  assert.equal(manifest.objects.length, count * 3);
  const offline = path.join(dir, 'offline');
  await measure('export_and_verify_offline_backup', async () => {
    await exportBackup(repository, offline);
    const snapshot = await verifyBackup(offline, manifest);
    assert.equal(snapshot.tables.photos.length, count);
    assert.equal(snapshot.tables.drive_source_files.length, count);
    assert.equal(snapshot.tables.photo_ingest_attempts.filter(row => row.state === 'published').length, count);
  });
  // Physically remove both source media and initial backup; only export remains.
  await rm(uploads, {recursive: true});
  await rm(repository, {recursive: true});
  const restored = path.join(dir, 'restored');
  await measure('restore_without_source_storage', () => restoreBackup(offline, restored));
  await measure('verify_restored_catalog_and_every_object', async () => {
    const restoredDb = await openDatabase(restored, {url: null});
    try {
      const restoredRows = await restoredDb.all(`SELECT p.id,p.filename,p.original,p.position,p.source,s.id AS source_id,s.drive_file_id,s.photo_id,s.source_generation,s.imported_generation,s.imported_version,s.checksum
        FROM photos p JOIN drive_source_files s ON s.photo_id=p.id ORDER BY p.position`);
      assert.deepEqual(restoredRows.map(row => ({...row})), rows.map(row => ({...row})));
      assert.deepEqual((await restoredDb.all('SELECT operation_id,photo_id,candidate_prefix,state FROM photo_ingest_attempts ORDER BY operation_id')).map(row => ({...row})), receipts.map(row => ({...row})));
      assert.equal((await restoredDb.get("SELECT status FROM drive_connections WHERE id='connection'")).status, 'disabled');
      const mapping = await restoredDb.get("SELECT * FROM drive_album_links WHERE id='mapping'");
      assert.equal(mapping.state, 'paused');
      assert.equal(mapping.enabled, 0);
      assert.equal(mapping.next_run_at, null);
      assert.equal(mapping.baseline_preview_id, null);
      assert.ok(Number((await restoredDb.get("SELECT invalidated_at FROM drive_sync_approvals WHERE id='synthetic-approval'")).invalidated_at) > 0);
      assert.equal(Number((await restoredDb.get("SELECT COUNT(*) AS count FROM drive_sync_jobs WHERE status IN ('queued','running','retry_wait','awaiting_review')")).count), 0);
      assert.equal(await createDriveJobs(restoredDb).claim('must-not-resume'), null);
      const restoredRaw = createStorage(path.join(restored, 'uploads'), {MEDIA_STORAGE_PROVIDER: 'local'});
      assert.equal((await restoredRaw.list()).length, count * 3);
      for (const object of manifest.objects) {
        const value = await restoredRaw.get(object.key);
        assert.equal(value.length, object.bytes);
        assert.equal(createHash('sha256').update(value).digest('hex'), object.sha256);
      }
      report.assertions.offline_restore = {photos: count, provenance_rows: count, published_receipts: count, byte_verified_objects: count * 3, source_media_removed_before_restore: true, initial_backup_removed_before_restore: true, exact_photo_and_source_identity_preserved: true, connection_disabled: true, mapping_paused: true, schedules_disabled: true, approvals_invalidated: true, pending_jobs_canceled: true, claim_returns_null: true};
      report.backup = {object_references: manifest.objects.length, unique_media_blobs: new Set(manifest.objects.map(object => object.sha256)).size, referenced_media_bytes: manifest.objects.reduce((sum, object) => sum + object.bytes, 0), database_snapshot_bytes: (await readFile(path.join(offline, 'blobs', manifest.databaseSha256))).length};
    } finally { await restoredDb.close(); }
  });
  assert.equal(workerErrors.length, 1, JSON.stringify(workerErrors));
  assert.equal(workerErrors[0].code, 'drive_worker_stopping');
  assert.ok(claims.filter(claim => claim.id === apply.id).every((claim, index, list) => index === 0 || claim.fence > list[index - 1].fence));
  report.assertions.claim_fences_strictly_increase = true;
  report.worker_errors = workerErrors;
  report.state = report.findings.length ? 'failed_current_backup_schema_supplemental_restore_passed' : 'passed';
  if (report.findings.length) process.exitCode = 1;
} catch (error) {
  report.state = 'failed';
  report.error = {message: error.message, code: error.code, stack: error.stack};
  process.exitCode = 1;
  log({event: 'failed', ...report.error});
} finally {
  phase = 'cleanup';
  for (const instance of workers) instance.stop();
  await cleanup?.close();
  await control?.close();
  await fixture?.close();
  await rm(scratch, {recursive: true, force: true});
  if (oldTemporary === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTemporary;
  if (oldPostgres === undefined) delete process.env.STUDIO_TEST_POSTGRES_URL; else process.env.STUDIO_TEST_POSTGRES_URL = oldPostgres;
  globalThis.fetch = oldFetch;
  clearInterval(sampler);
  clearInterval(heartbeat);
  report.memory.final = sampleMemory();
  report.memory.process_max_rss_bytes = process.resourceUsage().maxRSS * 1024;
  report.total_elapsed_ms = Math.round(performance.now() - started);
  report.cleaned_temporary_database_and_storage = true;
  await journal;
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const lines = ['# Synthetic Drive workflow verification', '', `Result: **${report.state}**. ${count} files; ${report.environment.database}; Node ${process.version}.`, '', 'The source image was 96×64 and encoded once. This run exercises real import/storage/receipt/backup code with synthetic Drive responses; it does not benchmark full-resolution encoding or remote throughput.', '', '| Phase | Elapsed seconds |', '| --- | ---: |', ...report.phases.map(item => `| ${item.name} | ${(item.elapsed_ms / 1000).toFixed(3)} |`), '', `Total: ${(report.total_elapsed_ms / 1000).toFixed(3)} seconds. Peak sampled RSS: ${(report.memory.rss_peak_bytes / 1048576).toFixed(1)} MiB; process high-water RSS: ${(report.memory.process_max_rss_bytes / 1048576).toFixed(1)} MiB.`, '', 'Assertions and counters are in report.json; timestamped progress is in events.jsonl.', '', ...report.limitations.map(item => '- ' + item), '', report.error ? 'Failure: ' + report.error.message : 'All isolated temporary database and media files were removed after verification.', ''];
  await writeFile(path.join(output, 'report.md'), lines.join('\n'));
  log({event: 'finished', state: report.state, report: path.join(output, 'report.json'), elapsed_ms: report.total_elapsed_ms});
  await journal;
}
