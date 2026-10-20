#!/usr/bin/env node
// Local UAT only. Never load .env, reuse cloud settings or alter live-test evidence.
import {backup, DatabaseSync} from 'node:sqlite';
import {copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const outputRoot = path.join(repository, 'output');
const markerName = 'local-preview.json';
const fail = code => Object.assign(new Error(code), {code});
const check = (condition, code) => { if (!condition) throw fail(code); };
const usage = 'node studio/tools/drive-local-preview.mjs [--source output/drive-live-2026-10-16-r7] [--output output/drive-local-preview] [--port 4175] [--service-account-file /absolute/key.json] [--prepare-only]';

export function parsePreviewArguments(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    check(['--source', '--output', '--port', '--service-account-file', '--prepare-only'].includes(flag) && !Object.hasOwn(flags, flag), 'preview_invalid_arguments');
    if (flag === '--prepare-only') flags[flag] = true;
    else {
      check(argv[i + 1] && !argv[i + 1].startsWith('--'), 'preview_invalid_arguments');
      flags[flag] = argv[++i];
    }
  }
  const port = Number(flags['--port'] || 4175);
  check(Number.isInteger(port) && port >= 1024 && port <= 65535, 'preview_invalid_port');
  const source = path.resolve(repository, flags['--source'] || 'output/drive-live-2026-10-16-r7');
  const output = path.resolve(repository, flags['--output'] || 'output/drive-local-preview');
  for (const directory of [source, output]) {
    check(path.dirname(directory) === outputRoot && /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(path.basename(directory)), 'preview_directory_must_be_child_of_output');
  }
  check(source !== output, 'preview_source_must_be_preserved');
  const credential = flags['--service-account-file'];
  check(!credential || path.isAbsolute(credential), 'preview_absolute_credential_path_required');
  return {source, output, port, credential, prepareOnly: !!flags['--prepare-only']};
}

async function realDirectory(directory) {
  const info = await lstat(directory);
  check(info.isDirectory() && !info.isSymbolicLink() && await realpath(directory) === directory, 'preview_unsafe_directory');
}

async function regularFile(filename) {
  const info = await lstat(filename);
  check(info.isFile() && !info.isSymbolicLink(), 'preview_unsafe_file');
  return info;
}

export function previewEnvironment(options) {
  // This allowlist is passed to every application component; inherited cloud,
  // email, calendar, setup-token and scheduler variables have no effect.
  return {
    NODE_ENV: 'development', DATABASE_URL: null, DATA_DIR: options.output,
    MEDIA_STORAGE_PROVIDER: 'local', MEDIA_CLEANUP_ENABLED: 'true',
    SITE_URL: `http://127.0.0.1:${options.port}`, SITE_INDEXING: 'false', TRUST_PROXY: 'false',
    DRIVE_SYNC_ENABLED: options.credential ? 'true' : 'false',
    DRIVE_SYNC_SERVICE_ACCOUNT_FILE: options.credential,
    DRIVE_SYNC_SCHEDULER_ENABLED: 'false', DRIVE_SYNC_BATCH_SIZE: '5',
    DRIVE_SYNC_POLL_MS: '1000', DRIVE_SYNC_REQUEST_TIMEOUT_MS: '120000',
    DRIVE_SYNC_TEMP_DIR: path.join(options.output, 'source-temp')
  };
}

function migrateCopy(database, output) {
  const db = new DatabaseSync(database);
  try {
    db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;');
    // Triggers are restored in this same transaction. The original database is
    // never opened for writes; its deliberately synthetic album ID stays intact.
    const triggers = db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger'").all();
    const quote = name => '"' + name.replaceAll('"', '""') + '"';
    for (const trigger of triggers) db.exec('DROP TRIGGER ' + quote(trigger.name));
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    const albums = db.prepare('SELECT id FROM albums').all();
    for (const album of albums) {
      const replacement = /^[a-f0-9]{32}$/.test(album.id) ? album.id : randomBytes(16).toString('hex');
      if (replacement !== album.id) {
        db.prepare('UPDATE albums SET id=? WHERE id=?').run(replacement, album.id);
        for (const table of tables) {
          if (db.prepare('PRAGMA table_info(' + quote(table.name) + ')').all().some(column => column.name === 'album_id')) {
            db.prepare('UPDATE ' + quote(table.name) + ' SET album_id=? WHERE album_id=?').run(replacement, album.id);
          }
        }
        for (const job of db.prepare('SELECT id,payload_json FROM drive_sync_jobs').all()) {
          const payload = JSON.parse(job.payload_json);
          if (payload.albumId === album.id) {
            payload.albumId = replacement;
            db.prepare('UPDATE drive_sync_jobs SET payload_json=? WHERE id=?').run(JSON.stringify(payload), job.id);
          }
        }
      }
      db.prepare("UPDATE albums SET status='private',password=NULL,title='Google Drive — thử nghiệm trên máy',created=CASE WHEN created='' THEN ? ELSE created END WHERE id=?").run(new Date().toISOString(), replacement);
    }
    const identity = 'local:' + path.join(output, 'uploads');
    db.prepare('UPDATE media_control SET storage=?,owner=NULL,deadline=0').run(identity);
    db.prepare('UPDATE media_writes SET storage=?').run(identity);
    db.prepare('UPDATE photo_ingest_attempts SET storage_identity=?').run(identity);
    db.exec('DELETE FROM drive_worker_heartbeats; DELETE FROM sessions; DELETE FROM rate_limits; UPDATE drive_album_links SET next_run_at=NULL;');
    // Previous approvals described the validation snapshot, not this editable copy.
    db.prepare('UPDATE drive_sync_approvals SET invalidated_at=? WHERE invalidated_at IS NULL').run(Date.now());
    db.exec("UPDATE drive_sync_jobs SET status='canceled' WHERE status='awaiting_review';");
    for (const trigger of triggers) db.exec(trigger.sql);
    check(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'preview_foreign_key_check_failed');
    db.exec('COMMIT;');
    return albums.length;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  } finally { db.close(); }
}

export async function preparePreview(options) {
  await realDirectory(outputRoot);
  await realDirectory(options.source);
  try {
    await realDirectory(options.output);
    await regularFile(path.join(options.output, markerName));
    await regularFile(path.join(options.output, 'studio.sqlite'));
    await realDirectory(path.join(options.output, 'uploads'));
    const marker = JSON.parse(await readFile(path.join(options.output, markerName), 'utf8'));
    check(marker.version === 1 && marker.source === options.source, 'preview_existing_output_not_owned');
    return {...marker, reused: true};
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // An incomplete or unrelated output directory must never be overwritten.
    try { await lstat(options.output); throw fail('preview_output_incomplete_use_new_directory'); }
    catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
  }
  await regularFile(path.join(options.source, 'report.json'));
  const report = JSON.parse(await readFile(path.join(options.source, 'report.json'), 'utf8'));
  check(report.passed === true && report.originals_retained === 0, 'preview_source_validation_not_passed');
  await regularFile(path.join(options.source, 'studio.sqlite'));
  await realDirectory(path.join(options.source, 'renditions'));
  const source = new DatabaseSync(path.join(options.source, 'studio.sqlite'), {readOnly: true});
  try {
    const count = table => Number(source.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n);
    check(count('admins') === 0 && count('media_writers') === 0 && count('photo_cleanup') === 0, 'preview_source_not_isolated_idle');
    check(!source.prepare("SELECT id FROM drive_sync_jobs WHERE status IN ('queued','running','retry_wait') LIMIT 1").get(), 'preview_source_jobs_not_idle');
    const binding = source.prepare('SELECT storage,owner FROM media_control WHERE id=1').get();
    check(binding?.storage === 'local:' + path.join(options.source, 'renditions') && !binding.owner, 'preview_source_storage_invalid');
    const photos = count('photos');
    check(photos > 0 && photos === report.renditions?.photos && report.renditions.decoded === photos * 3, 'preview_source_count_mismatch');
    const files = await readdir(path.join(options.source, 'renditions'));
    check(files.length === photos * 3, 'preview_source_files_mismatch');
    for (const file of files) {
      check(/^[a-zA-Z0-9_-]+(?:\.webp|-download\.jpg)$/.test(file), 'preview_invalid_rendition_name');
      await regularFile(path.join(options.source, 'renditions', file));
    }
    await mkdir(options.output, {mode: 0o700});
    await mkdir(path.join(options.output, 'uploads'), {mode: 0o700});
    await backup(source, path.join(options.output, 'studio.sqlite'));
    for (const file of files) await copyFile(path.join(options.source, 'renditions', file), path.join(options.output, 'uploads', file));
    const albums = migrateCopy(path.join(options.output, 'studio.sqlite'), options.output);
    const marker = {version: 1, source: options.source, created_at: new Date().toISOString(), initial_photos: photos, albums};
    await writeFile(path.join(options.output, markerName), JSON.stringify(marker, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    return {...marker, reused: false};
  } finally { source.close(); }
}

export async function startPreview(options) {
  const env = previewEnvironment(options);
  if (options.credential) {
    const info = await regularFile(options.credential);
    check((info.mode & 0o077) === 0, 'preview_credential_requires_private_permissions');
  }
  await mkdir(path.join(options.output, 'encoder-temp'), {recursive: true, mode: 0o700});
  process.env.TMPDIR = path.join(options.output, 'encoder-temp');
  const {openDatabase} = await import('../server/db.mjs');
  const {createApp} = await import('../server/app.mjs');
  const db = await openDatabase(options.output, {url: null});
  let application, server, worker, work;
  const close = async () => {
    worker?.stop();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
    await work;
    await application?.photoCleanup.close();
    await application?.mediaControl.close();
    application?.storage.close?.();
    await db.close();
  };
  try {
    application = await createApp({db, dataDir: options.output, env, production: false});
    server = await new Promise((resolve, reject) => {
      const listening = application.app.listen(options.port, '127.0.0.1', () => resolve(listening));
      listening.once('error', reject);
    });
    if (options.credential) {
      const {createDriveWorker} = await import('../server/drive-worker.mjs');
      worker = createDriveWorker({db, storage: application.storage, control: application.mediaControl, env});
      work = worker.start();
    }
    const albums = await db.all('SELECT id FROM albums ORDER BY created,id');
    return {server, db, close, albums};
  } catch (error) { await close(); throw error; }
}

async function main() {
  if (process.argv.slice(2).includes('--help')) { console.info(usage); return; }
  process.umask(0o077);
  const options = parsePreviewArguments(process.argv.slice(2));
  const prepared = await preparePreview(options);
  console.info(`Bản thử riêng trên máy: ${options.output} (${prepared.initial_photos} ảnh lúc tạo).`);
  if (options.prepareOnly) return;
  const preview = await startPreview(options);
  const origin = `http://127.0.0.1:${options.port}`;
  console.info(`Quản trị: ${origin}/admin — lần đầu tự tạo email và mật khẩu từ 12 ký tự.`);
  for (const album of preview.albums) console.info(`Gallery thử: ${origin}/gallery/${album.id}`);
  console.info(options.credential ? 'Worker Drive đang bật để chạy thao tác thủ công; lịch tự động tắt.' : 'Đang xem và chỉnh bản sao ảnh; thêm --service-account-file để thử đồng bộ Drive.');
  console.info('Nhấn Ctrl+C để dừng. Chạy lại cùng lệnh sẽ giữ tài khoản và thay đổi thử nghiệm.');
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try { await preview.close(); } catch { process.exitCode = 1; }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.code === 'EADDRINUSE' ? 'Cổng đang được dùng; chọn --port 4173 hoặc cổng khác.' : /^preview_[a-z_]+$/.test(error.code || '') ? error.code : 'preview_start_failed');
    process.exitCode = 1;
  });
}
