// Opt-in real Drive check. Run with Node 24; never load an application .env file.
// Output must be a NEW direct child of the repository's ignored output/ folder.
import assert from 'node:assert/strict';
import {mkdir, lstat, realpath, readdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const outputRoot = path.join(repository, 'output');
const usage = 'DRIVE_SYNC_SERVICE_ACCOUNT_FILE=/absolute/key.json node studio/tests/drive-sync-live.smoke.mjs --folder ID --output output/NEW_DIR --max-files N';
const fail = code => Object.assign(new Error(code), {code});
const check = (condition, code) => {
  if (!condition) throw fail(code);
};

function argumentsForRun(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    check(['--folder', '--output', '--max-files'].includes(flag), 'live_invalid_arguments');
    check(!Object.hasOwn(options, flag) && argv[index + 1] && !argv[index + 1].startsWith('--'), 'live_invalid_arguments');
    options[flag] = argv[index + 1];
  }
  check(/^[A-Za-z0-9_-]{3,200}$/.test(options['--folder'] || ''), 'live_folder_required');
  check(/^[1-9]\d*$/.test(options['--max-files'] || ''), 'live_max_files_required');
  const maxFiles = Number(options['--max-files']);
  check(Number.isSafeInteger(maxFiles) && maxFiles <= 5000, 'live_max_files_out_of_range');
  check(!!options['--output'], 'live_output_required');
  const output = path.resolve(options['--output']);
  check(path.dirname(output) === outputRoot && /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(path.basename(output)), 'live_output_must_be_new_child_of_output');
  return {folder: options['--folder'], output, maxFiles};
}

async function ensureNewOutput(output) {
  try {
    await lstat(output);
    throw fail('live_output_already_exists');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    const info = await lstat(outputRoot);
    check(info.isDirectory() && !info.isSymbolicLink(), 'live_output_parent_invalid');
    check(await realpath(outputRoot) === path.join(await realpath(repository), 'output'), 'live_output_parent_invalid');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function inventory(drive, folder, report, policy) {
  const {assertDriveFolder} = await import('../server/drive-client.mjs');
  const {supportedDriveImage, metadataSignature} = await import('../server/drive-inventory.mjs');
  await assertDriveFolder(drive, folder, folder);
  const seen = new Map();
  const tokens = new Set();
  const sizes = [];
  const stats = {
    scope: 'Direct folder children; subfolders are not recursively imported',
    complete: false,
    pages: 0,
    children: 0,
    supported: 0,
    unsupported: 0,
    restricted: 0,
    oversized: 0,
    unknown_size: 0,
    supported_bytes: 0,
    mime_counts: {}
  };
  report.inventory = stats;
  const started = Date.now();
  let pageToken;
  do {
    check(Date.now() - started < 600000, 'live_inventory_timeout');
    const page = await drive.listFiles(folder, {pageToken});
    check(!page.incompleteSearch && Array.isArray(page.files), 'live_inventory_incomplete');
    check(page.files.length <= 1000 && seen.size + page.files.length <= 100000, 'live_inventory_metadata_bound');
    stats.pages++;
    for (const file of page.files) {
      check(file && typeof file.id === 'string' && typeof file.name === 'string', 'live_invalid_metadata');
      const signature = metadataSignature(file);
      if (seen.has(file.id)) {
        check(seen.get(file.id) === signature, 'live_inventory_changed');
        continue;
      }
      seen.set(file.id, signature);
      check(!file.trashed && file.parents?.includes(folder), 'live_inventory_membership_changed');
      stats.children++;
      const supported = supportedDriveImage(file);
      const type = supported ? file.mimeType : 'other';
      stats.mime_counts[type] = (stats.mime_counts[type] || 0) + 1;
      if (!supported) {
        stats.unsupported++;
        continue;
      }
      stats.supported++;
      if (file.capabilities?.canDownload === false) stats.restricted++;
      const bytes = Number(file.size);
      if (!Number.isSafeInteger(bytes) || bytes <= 0) stats.unknown_size++;
      else {
        sizes.push(bytes);
        stats.supported_bytes += bytes;
        const limit = file.mimeType === 'image/jpeg' ? policy.maxBytes : 20 * 1024 * 1024;
        if (bytes > limit) stats.oversized++;
      }
    }
    pageToken = page.nextPageToken;
    check(!pageToken || !tokens.has(pageToken), 'live_inventory_pagination_cycle');
    if (pageToken) tokens.add(pageToken);
  } while (pageToken);
  sizes.sort((left, right) => left - right);
  stats.source_bytes_min = sizes[0] || 0;
  stats.source_bytes_max = sizes.at(-1) || 0;
  stats.source_bytes_p50 = sizes[Math.max(0, Math.ceil(sizes.length * 0.5) - 1)] || 0;
  stats.source_bytes_p95 = sizes[Math.max(0, Math.ceil(sizes.length * 0.95) - 1)] || 0;
  stats.complete = true;
  stats.elapsed_ms = Date.now() - started;
  console.info(JSON.stringify({event: 'metadata_inventory', ...stats}));
  return stats;
}

async function run(options, report) {
  // Explicit environment only. DATABASE_URL, DATA_DIR and cloud storage settings
  // are never read or forwarded. Originals and encoder scratch stay isolated.
  const env = {
    DRIVE_SYNC_ENABLED: 'true',
    DRIVE_SYNC_SERVICE_ACCOUNT_FILE: process.env.DRIVE_SYNC_SERVICE_ACCOUNT_FILE,
    DRIVE_SYNC_BATCH_SIZE: '1',
    DRIVE_SYNC_MAX_INVENTORY_FILES: '100000',
    DRIVE_SYNC_TEMP_DIR: path.join(options.output, 'source-temp'),
    DRIVE_SYNC_SCHEDULER_ENABLED: 'false',
    DRIVE_SYNC_REQUEST_TIMEOUT_MS: '120000',
    MEDIA_STORAGE_PROVIDER: 'local',
    NODE_ENV: 'test'
  };
  const encoderTemp = path.join(options.output, 'encoder-temp');
  await mkdir(encoderTemp, {mode: 0o700});
  process.env.TMPDIR = encoderTemp;
  const {createDriveClient, safeDriveError} = await import('../server/drive-client.mjs');
  const {driveImagePolicy} = await import('../server/drive-image-encoder.mjs');
  const policy = driveImagePolicy(env);
  report.bounds = {max_files: options.maxFiles, batch_size: 1, max_inventory_children: 100000, ...policy};
  report.drive_requests = {methods: {}, metadata: 0, media: 0, status_codes: {}};
  let downloadsAllowed = false;
  const observer = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    check(method === 'GET' && parsed.origin === 'https://www.googleapis.com' && parsed.pathname.startsWith('/drive/v3/'), 'live_drive_request_not_readonly');
    const kind = parsed.searchParams.get('alt') === 'media' ? 'media' : 'metadata';
    check(kind !== 'media' || downloadsAllowed, 'live_download_before_approval');
    report.drive_requests.methods[method] = (report.drive_requests.methods[method] || 0) + 1;
    report.drive_requests[kind]++;
    const response = await fetch(url, init);
    report.drive_requests.status_codes[response.status] = (report.drive_requests.status_codes[response.status] || 0) + 1;
    return response;
  };
  const rawDrive = await createDriveClient(env, {fetchImpl: observer});
  const stats = await inventory(rawDrive, options.folder, report, policy);
  check(stats.supported <= options.maxFiles, 'live_supported_count_exceeds_max_files');
  check(stats.supported > 0, 'live_no_supported_images');
  check(!stats.oversized && !stats.restricted && !stats.unknown_size, 'live_source_preflight_failed');
  const drive = {
    ...rawDrive,
    async download(...args) {
      check(downloadsAllowed && report.downloads < options.maxFiles, 'live_download_bound');
      report.downloads++;
      const result = await rawDrive.download(...args);
      report.downloaded_bytes += result.bytes;
      return result;
    }
  };
  const {openDatabase} = await import('../server/db.mjs');
  const {createStorage} = await import('../server/storage.mjs');
  const {createMediaControl, trackedStorage} = await import('../server/media-control.mjs');
  const {createDriveJobs} = await import('../server/drive-jobs.mjs');
  const {createDriveWorker} = await import('../server/drive-worker.mjs');
  const {registerDriveRoutes} = await import('../server/drive-routes.mjs');
  const {default: express} = await import('express');
  const {default: sharp} = await import('sharp');
  const db = await openDatabase(options.output, {url: null});
  let control;
  let worker;
  let server;
  try {
    const rawStorage = createStorage(path.join(options.output, 'renditions'), env);
    control = await createMediaControl(db, rawStorage.identity);
    const storage = trackedStorage(db, {
      ...rawStorage,
      async put(...args) {
        report.storage_puts++;
        return rawStorage.put(...args);
      }
    }, control);
    const jobs = createDriveJobs(db);
    const recordRevision = async label => {
      const album = await db.get("SELECT catalog_revision,selection_revision,submission_generation FROM albums WHERE id='live-album'");
      report.revisions.push({label, ...album});
    };
    const newWorker = () => createDriveWorker({db, storage, control, drive, jobs, env, logger: entry => {
      report.worker_events.push({event: entry.event, code: entry.code || null, stage: entry.stage || null, status: entry.status || null});
    }});
    worker = newWorker();
    await db.run("INSERT INTO albums(id,title,category,status) VALUES('live-album','Isolated Drive validation','wedding','draft')");
    const app = express();
    app.use(express.json({limit: '8kb'}));
    app.use((request, response, next) => {
      request.admin = 'isolated-live-harness';
      next();
    });
    registerDriveRoutes(app, {db, control, env});
    app.use((error, request, response, next) => {
      response.status(error.status || 500).json({error: safeDriveError(error)});
    });
    server = await new Promise((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      listening.once('error', reject);
    });
    const api = async (method, route, body) => {
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/admin' + route, {
        method,
        headers: {'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000)
      });
      const data = await response.json();
      check(response.ok, data.error || 'live_api_failed');
      return data;
    };
    const drain = async (jobId, label) => {
      const started = Date.now();
      let lastProgress = started;
      let batches = 0;
      let resumes = 0;
      while (batches < stats.children + 10) {
        const job = await jobs.get(jobId);
        if (!['queued', 'running', 'retry_wait'].includes(job.status)) {
          const result = {label, status: job.status, batches, resumes, elapsed_ms: Date.now() - started, progress: job.progress};
          if (job.error_code) result.error_code = safeDriveError({code: job.error_code});
          report.jobs.push(result);
          console.info(JSON.stringify({event: 'job_finished', ...result}));
          return job;
        }
        check(job.status !== 'retry_wait', job.error_code || 'live_retry_requires_new_run');
        check(Date.now() - started < 4 * 60 * 60 * 1000, 'live_job_time_bound');
        await sleep(5);
        await worker.runOnce();
        batches++;
        const after = await jobs.get(jobId);
        if (Date.now() - lastProgress >= 30000) {
          console.info(JSON.stringify({event: 'job_progress', label, status: after.status, batches, elapsed_ms: Date.now() - started, progress: after.progress}));
          lastProgress = Date.now();
        }
        if (after.status === 'queued') {
          // The next instance must acquire and continue the durable job lease.
          worker.stop();
          worker = newWorker();
          resumes++;
          report.worker_recreations++;
        }
      }
      throw fail('live_job_batch_bound');
    };
    await api('PUT', '/drive/connection', {
      service_account_email: drive.serviceAccountEmail,
      root_folder_id: options.folder
    });
    const checked = await api('POST', '/drive/check', {});
    check((await drain(checked.job_id, 'connection_check')).status === 'completed', 'live_connection_check_failed');
    await recordRevision('after_connection_check');
    const linked = await api('PUT', '/albums/live-album/drive', {folder_id: options.folder});
    check((await drain(linked.job_id, 'link')).status === 'completed', 'live_link_failed');
    await recordRevision('after_link');
    const previewRequest = await api('POST', '/albums/live-album/drive/preview', {});
    const preview = await drain(previewRequest.job_id, 'preview');
    check(preview.status === 'awaiting_review', 'live_preview_failed');
    await recordRevision('after_preview');
    const actions = await db.all('SELECT action,COUNT(*) AS count FROM drive_sync_job_items WHERE job_id=? GROUP BY action', [preview.id]);
    report.preview_actions = Object.fromEntries(actions.map(row => [row.action, Number(row.count)]));
    check(report.preview_actions.add === stats.supported, 'live_preflight_preview_count_changed');
    check(report.downloads === 0 && report.drive_requests.media === 0, 'live_preview_downloaded_originals');
    const approved = await api('POST', '/albums/live-album/drive/approve', {preview_id: preview.id});
    await recordRevision('after_approval');
    downloadsAllowed = true;
    const imported = await drain(approved.job_id, 'approved_import');
    check(imported.status === 'completed', imported.error_code || 'live_import_failed');
    check(report.downloads === stats.supported, 'live_download_count_mismatch');
    check(report.storage_puts === stats.supported * 3, 'live_rendition_count_mismatch');
    const photos = await db.all('SELECT * FROM photos ORDER BY id');
    check(photos.length === stats.supported, 'live_photo_count_mismatch');
    check(photos.every(photo => photo.source === 'google_drive'), 'live_photo_source_mismatch');
    const sources = await db.all('SELECT photo_id,state FROM drive_source_files');
    check(sources.length === photos.length && sources.every(source => source.state === 'active' && photos.some(photo => photo.id === source.photo_id)), 'live_source_link_mismatch');
    const expectedKeys = [];
    const fingerprints = new Map();
    report.renditions = {photos: photos.length, decoded: 0, bytes: 0, max_image_edge: 0, max_thumb_edge: 0, max_download_edge: 0};
    for (const photo of photos) {
      for (const rendition of [
        {suffix: '.webp', format: 'webp', edge: 2400, kind: 'image'},
        {suffix: '-thumb.webp', format: 'webp', edge: 900, kind: 'thumb'},
        {suffix: '-download.jpg', format: 'jpeg', edge: 2400, kind: 'download'}
      ]) {
        const key = photo.filename + rendition.suffix;
        expectedKeys.push(key);
        const bytes = await rawStorage.get(key);
        const metadata = await sharp(bytes, {failOn: 'error'}).metadata();
        check(metadata.format === rendition.format, 'live_rendition_format_mismatch');
        const longest = Math.max(metadata.width, metadata.height);
        check(longest > 0 && longest <= rendition.edge, 'live_rendition_dimension_bound');
        // Force a full pixel decode, not merely a header/metadata parse.
        await sharp(bytes, {failOn: 'error'}).raw().toBuffer();
        check(bytes.length === Number(photo[rendition.kind + '_bytes']), 'live_rendition_byte_count_mismatch');
        report.renditions['max_' + rendition.kind + '_edge'] = Math.max(report.renditions['max_' + rendition.kind + '_edge'], longest);
        report.renditions.bytes += bytes.length;
        report.renditions.decoded++;
        fingerprints.set(key, createHash('sha256').update(bytes).digest('hex'));
      }
    }
    const objects = await rawStorage.list();
    assert.deepEqual(objects.map(object => object.key).sort(), expectedKeys.sort());
    check((await db.get("SELECT status FROM albums WHERE id='live-album'")).status === 'draft', 'live_album_not_draft');
    const firstPhotos = photos.map(photo => ({id: photo.id, filename: photo.filename, source: photo.source}));
    const firstPuts = report.storage_puts;
    const firstDownloads = report.downloads;
    const firstMediaRequests = report.drive_requests.media;
    // A media request during the second pass is rejected before it reaches Drive.
    downloadsAllowed = false;
    const secondRequest = await api('POST', '/albums/live-album/drive/sync', {});
    const second = await drain(secondRequest.job_id, 'second_sync');
    check(second.status === 'completed', second.error_code || 'live_second_sync_failed');
    check(report.downloads === firstDownloads && report.drive_requests.media === firstMediaRequests, 'live_second_sync_downloaded');
    check(report.storage_puts === firstPuts, 'live_second_sync_wrote_objects');
    const secondPhotos = await db.all('SELECT id,filename,source FROM photos ORDER BY id');
    assert.deepEqual(secondPhotos.map(photo => ({...photo})), firstPhotos);
    assert.deepEqual((await rawStorage.list()).sort((left, right) => left.key.localeCompare(right.key)), objects.sort((left, right) => left.key.localeCompare(right.key)));
    for (const [key, digest] of fingerprints) {
      check(createHash('sha256').update(await rawStorage.get(key)).digest('hex') === digest, 'live_second_sync_changed_bytes');
    }
    const secondActions = await db.all('SELECT action,COUNT(*) AS count FROM drive_sync_job_items WHERE job_id=? GROUP BY action', [second.id]);
    report.second_sync = {
      unchanged_photos: photos.length,
      new_downloads: report.downloads - firstDownloads,
      new_storage_puts: report.storage_puts - firstPuts,
      new_photos: secondPhotos.length - photos.length,
      identical_object_hashes: fingerprints.size,
      actions: Object.fromEntries(secondActions.map(row => [row.action, Number(row.count)]))
    };
    check(report.second_sync.actions.unchanged === photos.length, 'live_second_sync_not_unchanged');
    if (stats.children > 1) check(report.worker_recreations > 0, 'live_resume_not_exercised');
    report.resume_scope = stats.children > 1 ? 'Worker recreated between durable batches in one Node process' : 'Single item; no multi-batch continuation available';
    check((await readdir(env.DRIVE_SYNC_TEMP_DIR)).length === 0, 'live_original_temp_not_empty');
    check((await readdir(encoderTemp)).length === 0, 'live_encoder_temp_not_empty');
    check((await db.get('SELECT COUNT(*) AS count FROM media_writers')).count === 0, 'live_writers_not_drained');
    check((await db.get("SELECT COUNT(*) AS count FROM media_writes WHERE state<>'stored'")).count === 0, 'live_uncertain_objects');
    report.originals_retained = 0;
    report.passed = true;
  } finally {
    worker?.stop();
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await control?.close();
    await db.close();
  }
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.info(usage);
    return;
  }
  let options;
  try {
    options = argumentsForRun(process.argv.slice(2));
    await ensureNewOutput(options.output);
    check(typeof process.env.DRIVE_SYNC_SERVICE_ACCOUNT_FILE === 'string' && path.isAbsolute(process.env.DRIVE_SYNC_SERVICE_ACCOUNT_FILE), 'live_explicit_absolute_credential_path_required');
  } catch (error) {
    console.error(JSON.stringify({passed: false, error: /^live_[a-z_]+$/.test(error.code || '') ? error.code : 'live_setup_failed'}));
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  process.umask(0o077);
  await mkdir(outputRoot, {recursive: true, mode: 0o700});
  await mkdir(options.output, {mode: 0o700});
  const started = Date.now();
  const report = {
    version: 1,
    started_at: new Date(started).toISOString(),
    passed: false,
    database: 'Isolated SQLite; no production database or data directory read',
    credentials: 'Explicit service-account file; never copied to output',
    requests_scope: 'Drive API fetch observer only; OAuth token exchange is outside this observer',
    downloads: 0,
    downloaded_bytes: 0,
    storage_puts: 0,
    worker_recreations: 0,
    worker_events: [],
    jobs: [],
    revisions: [],
    memory: {scope: 'Node parent process RSS only; excludes encoder subprocess RSS', samples: 0, peak_rss_bytes: 0}
  };
  const sample = () => {
    report.memory.samples++;
    report.memory.peak_rss_bytes = Math.max(report.memory.peak_rss_bytes, process.memoryUsage().rss);
  };
  sample();
  const sampler = setInterval(sample, 100);
  sampler.unref();
  try {
    await run(options, report);
  } catch (error) {
    // No exception messages, request URLs, filenames, credentials or stacks.
    report.error = /^(live_|drive_|media_|image_|ingest_|storage_|encoder_|file_)[a-z0-9_]+$/i.test(error.code || '') ? error.code.toLowerCase() : error.code === 'ERR_ASSERTION' ? 'live_assertion_failed' : 'live_operation_failed';
    report.passed = false;
    process.exitCode = 1;
  } finally {
    clearInterval(sampler);
    sample();
    report.elapsed_ms = Date.now() - started;
    report.finished_at = new Date().toISOString();
    await writeFile(path.join(options.output, 'report.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    console.info(JSON.stringify({event: 'live_validation_finished', passed: report.passed, error: report.error, elapsed_ms: report.elapsed_ms, report: path.join(options.output, 'report.json')}));
  }
}

await main();
