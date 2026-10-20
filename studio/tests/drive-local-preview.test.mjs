import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import sharp from 'sharp';
import {openDatabase} from '../server/db.mjs';
import {parsePreviewArguments, preparePreview, previewEnvironment, startPreview} from '../tools/drive-local-preview.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');

test('local preview refuses evidence overwrite and ignores inherited cloud configuration', () => {
  assert.throws(() => parsePreviewArguments(['--output', 'data/live']), /preview_directory/);
  assert.throws(() => parsePreviewArguments(['--source', 'output/same', '--output', 'output/same']), /preview_source_must_be_preserved/);
  assert.throws(() => parsePreviewArguments(['--service-account-file', '.env.private']), /preview_absolute_credential/);
  assert.throws(() => parsePreviewArguments(['--port', '0']), /preview_invalid_port/);
  const env = previewEnvironment(parsePreviewArguments([]));
  assert.equal(env.DATABASE_URL, null);
  assert.equal(env.MEDIA_STORAGE_PROVIDER, 'local');
  assert.equal(env.DRIVE_SYNC_ENABLED, 'false');
  assert.equal(env.DRIVE_SYNC_SCHEDULER_ENABLED, 'false');
  assert.equal(env.SETUP_TOKEN, undefined);
  assert.equal(env.SMTP_URL, undefined);
});

test('local preview copies evidence, remaps album links and serves the real authenticated application', async () => {
  // The ignored output directory does not exist in a clean checkout.
  await mkdir(path.join(repository, 'output'), {recursive: true});
  const source = await mkdtemp(path.join(repository, 'output', 'drive-preview-test-source-'));
  const output = path.join(repository, 'output', 'drive-preview-test-copy-' + randomBytes(6).toString('hex'));
  const options = {...parsePreviewArguments(['--source', source, '--output', output]), port: 0};
  const imageId = randomBytes(16).toString('hex');
  let sourceDb, preview;
  try {
    await mkdir(path.join(source, 'renditions'), {mode: 0o700});
    const webp = await sharp({create: {width: 12, height: 8, channels: 3, background: '#abcdef'}}).webp().toBuffer();
    const jpeg = await sharp(webp).jpeg().toBuffer();
    for (const [suffix, bytes] of [['.webp', webp], ['-thumb.webp', webp], ['-download.jpg', jpeg]]) {
      await writeFile(path.join(source, 'renditions', imageId + suffix), bytes);
    }
    sourceDb = await openDatabase(source, {url: null});
    await sourceDb.run("INSERT INTO albums(id,title,category,status) VALUES('live-album','Fixture','wedding','draft')");
    await sourceDb.run("INSERT INTO photos(id,album_id,filename,width,height,source) VALUES(?,'live-album',?,12,8,'google_drive')", [imageId, imageId]);
    await sourceDb.run('INSERT INTO media_control(id,storage,owner,deadline,generation) VALUES(1,?,NULL,0,0)', ['local:' + path.join(source, 'renditions')]);
    await sourceDb.run("INSERT INTO drive_connections(id,status) VALUES('studio','active')");
    await sourceDb.run("INSERT INTO drive_album_links(id,connection_id,album_id,folder_id) VALUES('mapping','studio','live-album','folder')");
    await sourceDb.close();
    sourceDb = null;
    await writeFile(path.join(source, 'report.json'), JSON.stringify({passed: true, originals_retained: 0, renditions: {photos: 1, decoded: 3}}));
    const originalHash = digest(await readFile(path.join(source, 'studio.sqlite')));
    const prepared = await preparePreview(options);
    assert.equal(prepared.initial_photos, 1);
    assert.equal(prepared.reused, false);
    assert.equal(digest(await readFile(path.join(source, 'studio.sqlite'))), originalHash);
    const copied = new DatabaseSync(path.join(output, 'studio.sqlite'), {readOnly: true});
    const album = copied.prepare('SELECT * FROM albums').get();
    assert.match(album.id, /^[a-f0-9]{32}$/);
    assert.equal(album.status, 'private');
    assert.equal(copied.prepare('SELECT album_id FROM photos').get().album_id, album.id);
    assert.equal(copied.prepare('SELECT album_id FROM drive_album_links').get().album_id, album.id);
    assert.equal(copied.prepare('SELECT storage FROM media_control').get().storage, 'local:' + path.join(output, 'uploads'));
    assert.equal(copied.prepare('PRAGMA foreign_key_check').all().length, 0);
    copied.close();
    preview = await startPreview(options);
    const origin = 'http://127.0.0.1:' + preview.server.address().port;
    const session = await fetch(origin + '/api/admin/session').then(response => response.json());
    assert.equal(session.needsSetup, true);
    assert.equal((await fetch(origin + '/api/admin/albums')).status, 401);
    const setup = await fetch(origin + '/api/admin/setup', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'http://127.0.0.1:0'}, body: JSON.stringify({email: 'local@example.test', password: randomBytes(24).toString('hex')})});
    assert.equal(setup.status, 201);
    const cookie = setup.headers.get('set-cookie').split(';')[0];
    const admin = await fetch(origin + '/api/admin/albums', {headers: {Cookie: cookie}}).then(response => response.json());
    assert.equal(admin[0].photos.length, 1);
    const gallery = await fetch(origin + '/api/gallery/' + album.id).then(response => response.json());
    assert.equal(gallery.photos.length, 1);
    assert.equal((await fetch(origin + gallery.photos[0].src)).status, 200);
    const mediaResponse = await fetch(origin + gallery.photos[0].src);
    assert.equal(digest(Buffer.from(await mediaResponse.arrayBuffer())), digest(webp));
    assert.equal((await fetch(origin + '/api/admin/drive/status', {headers: {Cookie: cookie}}).then(response => response.json())).enabled, false);
    await preview.close();
    preview = null;
    assert.equal((await preparePreview(options)).reused, true);
    assert.equal(digest(await readFile(path.join(source, 'studio.sqlite'))), originalHash);
  } finally {
    await preview?.close();
    await sourceDb?.close();
    await rm(output, {recursive: true, force: true});
    await rm(source, {recursive: true, force: true});
  }
});
