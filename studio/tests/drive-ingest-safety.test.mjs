import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdtemp, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {id, openDatabase} from '../server/db.mjs';
import {createStorage} from '../server/storage.mjs';
import {createMediaControl, trackedStorage} from '../server/media-control.mjs';
import {reconcileMedia} from '../server/media-recovery.mjs';
import {optimizePhoto} from '../server/image-optimizer.mjs';
import {driveImagePolicy, encodeDrivePhoto} from '../server/drive-image-encoder.mjs';
import {ingestPhoto} from '../server/photo-ingest.mjs';
import {uploadPhoto} from '../server/photo-upload.mjs';
import {photoDeletion, drainPhotoCleanup} from '../server/photo-deletion.mjs';

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'drive-ingest-test-'));
  const db = await openDatabase(directory, {url: null});
  const albumId = id();
  await db.run('INSERT INTO albums(id,title,category) VALUES(?,?,?)', [albumId, 'Fixture', 'wedding']);
  const raw = createStorage(path.join(directory, 'uploads'), {MEDIA_STORAGE_PROVIDER: 'local'});
  const control = await createMediaControl(db, raw.identity);
  const storage = trackedStorage(db, raw, control);
  const cleanup = photoDeletion({db, storage, mediaControl: control});
  const bytes = await sharp({create: {width: 120, height: 80, channels: 3, background: '#99aa33'}}).jpeg().toBuffer();
  const decoded = await optimizePhoto(bytes);
  return {directory, db, albumId, raw, control, storage, cleanup, bytes, decoded, async close() {
    await cleanup.close();
    await control.close();
    await db.close();
    await rm(directory, {recursive: true, force: true});
  }};
}

const ingest = (fixture, options = {}) => ingestPhoto({db: fixture.db, storage: fixture.storage, mediaControl: fixture.control, albumId: fixture.albumId, sourceName: 'é-Ảnh.jpg', decoded: fixture.decoded, ...options});

test('Drive ingest journals before PUT, preserves Unicode and replays durable publication without downloading', async () => {
  const fixtureData = await fixture();
  try {
    const put = fixtureData.storage.put;
    let writes = 0;
    fixtureData.storage.put = async (...args) => {
      const attempt = await fixtureData.db.get('SELECT * FROM photo_ingest_attempts WHERE candidate_prefix=?', [args[0].slice(0, 32)]);
      assert.equal(attempt.state, 'prepared');
      assert.equal(attempt.process_id, fixtureData.control.processId);
      assert.ok(attempt.writer_token);
      writes++;
      return put(...args);
    };
    let published = 0;
    const result = await ingest(fixtureData, {operationId: 'version-1', publish: async () => { published++; }});
    assert.equal((await fixtureData.db.get('SELECT original FROM photos WHERE id=?', [result.id])).original, 'é-Ảnh.jpg');
    assert.equal((await ingest(fixtureData, {operationId: 'version-1'})).id, result.id);
    assert.equal(writes, 3);
    assert.equal(published, 1);
    assert.equal((await fixtureData.control.status()).writers.length, 0);
  } finally { await fixtureData.close(); }
});

test('Guard failures never publish and source-aware manual duplicate decisions cannot replace Drive media', async () => {
  const fixtureData = await fixture();
  try {
    await assert.rejects(ingest(fixtureData, {guard: async () => { throw Error('source epoch changed'); }}), /epoch/);
    assert.equal((await fixtureData.db.all('SELECT id FROM photos')).length, 0);
    assert.equal((await fixtureData.db.get('SELECT state FROM photo_ingest_attempts')).state, 'abandoned');
    const drive = await ingest(fixtureData, {sourceName: 'same.jpg'});
    const upload = options => uploadPhoto({db: fixtureData.db, storage: fixtureData.storage, mediaControl: fixtureData.control, albumId: fixtureData.albumId, file: {buffer: fixtureData.bytes, originalname: 'same.jpg'}, policy: 'overwrite', uploadKey: randomUUID(), ...options});
    const manual = await upload();
    assert.notEqual(manual.id, drive.id);
    const revision = (await fixtureData.db.get('SELECT catalog_revision FROM albums')).catalog_revision;
    await assert.rejects(upload({targetId: drive.id, expectedRevision: revision}), {code: 'SOURCE_CONFLICT'});
    await assert.rejects(upload({targetId: manual.id, expectedRevision: revision - 1}), {code: 'CATALOG_CHANGED'});
    const replaced = await upload({targetId: manual.id, expectedRevision: revision});
    assert.equal(replaced.id, manual.id);
    assert.equal((await fixtureData.db.all('SELECT id FROM photos')).length, 2);
  } finally { await fixtureData.close(); }
});

test('Published retirement starts after observation, survives restart and cannot be forced through maintenance', async () => {
  const fixtureData = await fixture();
  try {
    const first = await ingest(fixtureData);
    const next = await ingest(fixtureData, {targetPhotoId: first.id, expectedFilename: first.filename});
    await fixtureData.cleanup.cleanup(true);
    const retired = await fixtureData.db.get("SELECT * FROM photo_cleanup WHERE kind='retired'");
    assert.equal(Number(retired.not_before) - Number(retired.retention_started_at), 300000);
    assert.ok((await fixtureData.raw.get(first.filename + '.webp')).length);
    await assert.rejects(fixtureData.storage.remove(first.filename + '.webp'), /retention/);
    const lease = await fixtureData.control.acquire('retention-test');
    await assert.rejects(drainPhotoCleanup({db: fixtureData.db, control: fixtureData.control, cleanup: fixtureData.cleanup.cleanup, lease, timeoutMs: 20, pollMs: 5}), /retention/);
    assert.ok((await fixtureData.raw.get(first.filename + '.webp')).length);
    await fixtureData.db.run('UPDATE photo_cleanup SET not_before=0');
    await drainPhotoCleanup({db: fixtureData.db, control: fixtureData.control, cleanup: fixtureData.cleanup.cleanup, lease});
    await assert.rejects(fixtureData.raw.get(first.filename + '.webp'));
    assert.ok((await fixtureData.raw.get(next.filename + '.webp')).length);
    await fixtureData.control.release(lease);
  } finally { await fixtureData.close(); }
});

test('Deleting a Drive photo persists suppression and increments its source epoch', async () => {
  const fixtureData = await fixture();
  try {
    const photo = await ingest(fixtureData);
    await fixtureData.db.run("INSERT INTO drive_connections(id) VALUES('connection')");
    await fixtureData.db.run("INSERT INTO drive_album_links(id,connection_id,album_id,folder_id) VALUES('mapping','connection',?,'folder')", [fixtureData.albumId]);
    await fixtureData.db.run("INSERT INTO drive_source_files(id,connection_id,mapping_id,drive_file_id,photo_id) VALUES('source','connection','mapping','file',?)", [photo.id]);
    await fixtureData.cleanup.remove(photo.id);
    const source = await fixtureData.db.get("SELECT * FROM drive_source_files WHERE id='source'");
    assert.equal(source.state, 'suppressed');
    assert.equal(source.source_generation, 2);
    assert.equal(source.photo_id, null);
    assert.ok((await fixtureData.raw.get(photo.filename + '.webp')).length);
  } finally { await fixtureData.close(); }
});

test('Killed process with three stored unpublished renditions recovers only its writers and candidates', async () => {
  const fixtureData = await fixture();
  let child;
  try {
    child = fork(fileURLToPath(new URL('./fixtures/ingest-crash-child.mjs', import.meta.url)), [fixtureData.directory, fixtureData.albumId], {execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc']});
    const closed = new Promise(resolve => child.once('close', resolve));
    const message = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Crash child did not stage')), 10000);
      child.once('message', value => { clearTimeout(timeout); resolve(value); });
      child.once('error', reject);
    });
    assert.equal(message.staged, true);
    child.kill('SIGKILL');
    await closed;
    const attempt = await fixtureData.db.get("SELECT * FROM photo_ingest_attempts WHERE operation_id='crash-operation'");
    assert.equal(attempt.state, 'stored');
    assert.equal((await fixtureData.db.all('SELECT id FROM photos')).length, 0);
    await fixtureData.db.run("INSERT INTO media_writers(id,process_id,kind,started) VALUES('healthy','healthy-process','fixture',0)");
    const lease = await fixtureData.control.acquire('recover-test');
    await assert.rejects(fixtureData.control.retireStoppedWriters(lease, {processIds: [message.processId]}), /Explicit/);
    const retired = await fixtureData.control.retireStoppedWriters(lease, {processIds: [message.processId], writersStopped: true});
    assert.equal(retired.retired, 1);
    assert.equal((await fixtureData.control.status()).writers.length, 1);
    await assert.rejects(reconcileMedia({db: fixtureData.db, raw: fixtureData.raw, control: fixtureData.control, lease, providerSettled: true}), /active writers/);
    await fixtureData.db.run("DELETE FROM media_writers WHERE id='healthy'");
    await assert.rejects(fixtureData.control.assertDrained(lease), /ingest attempts/);
    const reconciled = await reconcileMedia({db: fixtureData.db, raw: fixtureData.raw, control: fixtureData.control, lease, providerSettled: true});
    assert.equal(reconciled.reconciledAttempts, 1);
    await fixtureData.cleanup.cleanup(true, {owner: lease.owner});
    await fixtureData.control.assertDrained(lease, {queue: true});
    await assert.rejects(fixtureData.raw.get(attempt.candidate_prefix + '.webp'));
    await fixtureData.control.release(lease);
  } finally {
    child?.kill('SIGKILL');
    await fixtureData.close();
  }
});

test('Large JPEG source exceeds both old limits; isolated encoding produces only bounded renditions and watchdog kills work', {timeout: 120000}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'drive-large-'));
  try {
    const inputPath = path.join(directory, 'large.jpg');
    await sharp(randomBytes(6500 * 6500 * 3), {raw: {width: 6500, height: 6500, channels: 3}}).jpeg({quality: 80, chromaSubsampling: '4:4:4'}).toFile(inputPath);
    const bytes = (await stat(inputPath)).size;
    assert.ok(bytes > 20 * 1024 * 1024);
    const result = await encodeDrivePhoto(inputPath);
    assert.equal(result.optimization.source_bytes, bytes);
    assert.equal(result.optimization.width, 2400);
    assert.equal(result.optimization.height, 2400);
    assert.equal((await sharp(result.download).metadata()).format, 'jpeg');
    await assert.rejects(encodeDrivePhoto(inputPath, {policy: {...driveImagePolicy({}), maxBytes: 20 * 1024 * 1024}}), {code: 'FILE_TOO_LARGE'});
    await assert.rejects(encodeDrivePhoto(inputPath, {policy: {...driveImagePolicy({}), maxPixels: 40000000}}), {code: 'PIXEL_LIMIT'});
    const started = Date.now();
    await assert.rejects(encodeDrivePhoto(inputPath, {policy: {...driveImagePolicy({}), timeoutMs: 1}}), {code: 'ENCODER_TIMEOUT'});
    assert.ok(Date.now() - started < 5000);
    const small = path.join(directory, 'not-jpeg.png');
    await sharp({create: {width: 6500, height: 6500, channels: 3, background: '#118899'}}).png().toFile(small);
    await assert.rejects(encodeDrivePhoto(small), {code: 'PIXEL_LIMIT'});
    await writeFile(small, 'not an image');
    await assert.rejects(encodeDrivePhoto(small), {code: 'INVALID_IMAGE'});
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('Manual receipts bind a retry key to its exact replacement target and duplicate policy', async () => {
  const fixtureData = await fixture();
  try {
    const first = await ingest(fixtureData, {source: 'manual', sourceName: 'first.jpg'});
    const second = await ingest(fixtureData, {source: 'manual', sourceName: 'second.jpg'});
    const uploadKey = randomUUID();
    const expectedRevision = (await fixtureData.db.get('SELECT catalog_revision FROM albums')).catalog_revision;
    const replace = options => uploadPhoto({db: fixtureData.db, storage: fixtureData.storage, mediaControl: fixtureData.control, albumId: fixtureData.albumId, file: {buffer: fixtureData.bytes, originalname: 'replacement.jpg'}, policy: 'overwrite', uploadKey, expectedRevision, ...options});
    assert.equal((await replace({targetId: first.id})).id, first.id);
    assert.equal((await replace({targetId: first.id})).reused, true);
    await assert.rejects(replace({targetId: second.id}), {code: 'UPLOAD_CONFLICT'});
    await assert.rejects(replace({targetId: first.id, policy: 'skip'}), {code: 'UPLOAD_CONFLICT'});
  } finally { await fixtureData.close(); }
});
