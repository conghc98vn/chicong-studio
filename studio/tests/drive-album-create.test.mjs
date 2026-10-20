import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {openDatabase} from '../server/db.mjs';
import {reserveAlbumSlug} from '../server/album-slugs.mjs';
import {createDriveJobs} from '../server/drive-jobs.mjs';
import {createDriveSync} from '../server/drive-sync.mjs';
import {DRIVE_FOLDER} from '../server/drive-client.mjs';
import {createAlbumFromDriveCheck, DRIVE_ALBUM_CHECK_TTL_MS} from '../server/drive-album-create.mjs';

const env = {DRIVE_SYNC_ENABLED: 'true'};
const normalBody = {title: 'Đám cưới Đà Lạt', category: 'wedding', status: 'private',
  password: 'private-password', require_password: true, description: 'An album',
  client_name: 'Client', event_date: '2026-10-17'};

async function fixture(postgres) {
  const dir = await mkdtemp(path.join(tmpdir(), 'drive-create-'));
  let pool;
  let schema;
  let url = null;
  if (postgres) {
    pool = new pg.Pool({connectionString: process.env.STUDIO_TEST_POSTGRES_URL});
    schema = 'drive_create_' + randomUUID().replaceAll('-', '');
    await pool.query('CREATE SCHEMA ' + schema);
    const target = new URL(process.env.STUDIO_TEST_POSTGRES_URL);
    target.searchParams.set('options', '-c search_path=' + schema);
    url = target.href;
  }
  const db = await openDatabase(dir, {url});
  await db.run("INSERT INTO drive_connections(id,service_account_email,root_folder_id,status) VALUES('studio','sync@test.iam.gserviceaccount.com','rootfolder','active')");
  let time = Date.now();
  const now = () => time;
  const jobs = createDriveJobs(db, {now});
  const files = new Map([
    ['rootfolder', {id: 'rootfolder', name: 'Root', mimeType: DRIVE_FOLDER, parents: []}],
    ['albumfolder', {id: 'albumfolder', name: normalBody.title, mimeType: DRIVE_FOLDER, parents: ['rootfolder']}],
    ['otherfolder', {id: 'otherfolder', name: 'Other', mimeType: DRIVE_FOLDER, parents: ['rootfolder']}],
  ]);
  const drive = {serviceAccountEmail: 'sync@test.iam.gserviceaccount.com',
    async getFile(id) { assert.ok(files.has(id)); return structuredClone(files.get(id)); }};
  const sync = createDriveSync({db, drive, jobs, control: {processId: 'test'}, storage: {}, env});
  async function check(folderId = 'albumfolder', {real = false, root = true} = {}) {
    const job = await jobs.enqueue({connectionId: 'studio', kind: 'check', requestKey: randomUUID(),
      payload: {operation: 'inspect-folder', folderId, ...(root ? {rootFolderId: 'rootfolder'} : {})}});
    const lease = await jobs.claim('test-worker');
    assert.equal(lease.id, job.id);
    if (real) await sync.run(lease);
    else await jobs.finish(lease, {progress: {checked: true, linked: false, folder: {id: folderId, name: normalBody.title}}});
    return {...normalBody, request_key: randomUUID(), drive_check_job_id: job.id, drive_folder_id: folderId};
  }
  let callbacks = 0;
  async function create(tx, body = normalBody) {
    callbacks++;
    const id = randomUUID().replaceAll('-', '');
    const slug = await reserveAlbumSlug(tx, body.slug || body.title, id);
    await tx.run('INSERT INTO albums(id,slug,title,category,status,password,description,client_name,event_date) VALUES(?,?,?,?,?,?,?,?,?)',
      [id, slug, body.title, body.category, body.status, 'route-prepared-password-hash', body.description, body.client_name, body.event_date]);
    return {id, slug};
  }
  const save = (body, callback = create, options = {}) => createAlbumFromDriveCheck(db, body, callback, {env, now, ...options});
  const counts = async () => ({
    albums: Number((await db.get('SELECT COUNT(*) AS n FROM albums')).n),
    slugs: Number((await db.get('SELECT COUNT(*) AS n FROM album_slugs')).n),
    links: Number((await db.get('SELECT COUNT(*) AS n FROM drive_album_links')).n),
    receipts: Number((await db.get("SELECT COUNT(*) AS n FROM drive_job_requests WHERE request_key LIKE 'album-create:%'")).n),
  });
  return {db, jobs, sync, check, create, save, counts, now, files, callbacks: () => callbacks,
    advance: milliseconds => { time += milliseconds; },
    async close() {
      await db.close();
      if (pool) { await pool.query('DROP SCHEMA ' + schema + ' CASCADE'); await pool.end(); }
      await rm(dir, {recursive: true, force: true});
    }};
}

for (const postgres of [false, true]) {
  const database = postgres ? 'PostgreSQL' : 'SQLite';
  const options = {skip: postgres && !process.env.STUDIO_TEST_POSTGRES_URL};
  test(database + ': shared folder check permits outside album and binds mode to connection generation', options, async () => {
    const f = await fixture(postgres);
    try {
      f.files.set('outside', {id:'outside',name:'Outside',mimeType:DRIVE_FOLDER,parents:[]});
      await f.db.run("UPDATE drive_connections SET folder_scope='shared',generation=generation+1");
      const body = await f.check('outside',{real:true});
      const check = await f.jobs.get(body.drive_check_job_id);
      assert.equal(JSON.parse(check.progress_json).scope,'shared');
      await f.db.run("UPDATE drive_connections SET folder_scope='root',generation=generation+1");
      await assert.rejects(f.save(body),{code:'drive_folder_check_stale'});
      assert.equal((await f.counts()).albums,0);
      await f.db.run("UPDATE drive_connections SET folder_scope='shared',generation=generation+1");
      const fresh = await f.check('outside',{real:true});
      const created = await f.save(fresh);
      assert.equal(created.drive_linked,true);
      assert.equal((await f.db.get('SELECT folder_id FROM drive_album_links WHERE id=?',[created.mapping_id])).folder_id,'outside');
    } finally { await f.close(); }
  });
  test(database + ': completed real folder check creates one empty album with an unapproved mapping', options, async () => {
    const f = await fixture(postgres);
    try {
      const body = await f.check('albumfolder', {real: true, root: false});
      const created = await f.save(body);
      assert.equal(created.slug, 'dam-cuoi-da-lat');
      assert.equal(created.drive_check_job_id, body.drive_check_job_id);
      assert.equal(created.drive_linked, true);
      const album = await f.db.get('SELECT * FROM albums WHERE id=?', [created.id]);
      assert.equal(album.password, 'route-prepared-password-hash');
      const receipt=await f.db.get("SELECT fingerprint FROM drive_job_requests WHERE request_key LIKE 'album-create:%'");
      assert.match(receipt.fingerprint,/^scrypt:v1:[a-f0-9]{32}:[a-f0-9]{128}$/,'Receipt must not provide a fast gallery-password verifier');
      assert.equal(receipt.fingerprint.includes(body.password),false);
      assert.equal(album.status, 'private');
      assert.equal(album.client_name, normalBody.client_name);
      const link = await f.db.get('SELECT * FROM drive_album_links WHERE id=?', [created.mapping_id]);
      assert.equal(link.album_id, created.id);
      assert.equal(link.folder_id, body.drive_folder_id);
      assert.equal(link.state, 'attached');
      assert.equal(link.enabled, 1);
      assert.equal(link.baseline_preview_id, null);
      assert.equal(link.next_run_at, null);
      assert.equal((await f.db.all('SELECT * FROM photos')).length, 0);
      assert.deepEqual((await f.db.all('SELECT kind,status FROM drive_sync_jobs')).map(row => ({...row})), [{kind: 'check', status: 'completed'}]);
      assert.equal((await f.db.all('SELECT * FROM drive_sync_approvals')).length, 0);
      const job = await f.jobs.get(body.drive_check_job_id);
      assert.equal(job.progress.folder.name, normalBody.title);
      assert.equal(job.progress.album_creation.album_id, created.id);
      assert.ok(!JSON.stringify(job.progress).includes(normalBody.password));
      assert.deepEqual(await f.counts(), {albums: 1, slugs: 1, links: 1, receipts: 1});
    } finally { await f.close(); }
  });

  test(database + ': concurrent and expired exact retries return the original receipt once', options, async () => {
    const f = await fixture(postgres);
    try {
      const body = await f.check();
      const results = await Promise.all(Array.from({length: 12}, () => f.save({...body})));
      for (const row of results) assert.deepEqual(row, results[0]);
      assert.equal(f.callbacks(), 1);
      f.advance(DRIVE_ALBUM_CHECK_TTL_MS + 1);
      await f.db.run("UPDATE drive_connections SET generation=generation+1,root_folder_id='changed-root',status='disabled' WHERE id='studio'");
      assert.deepEqual(await f.save(body), results[0]);
      assert.equal(f.callbacks(), 1);
      assert.deepEqual(await f.counts(), {albums: 1, slugs: 1, links: 1, receipts: 1});
    } finally { await f.close(); }
  });

  test(database + ': request key conflicts and consumed checks cannot create another album', options, async () => {
    const f = await fixture(postgres);
    try {
      const body = await f.check();
      const other = await f.check('otherfolder');
      const saved = await f.save(body);
      for (const changed of [
        {title: 'Changed'}, {slug: 'changed'}, {category: 'family'}, {status: 'draft'},
        {password: 'changed-password'}, {require_password: false}, {description: 'Changed'},
        {client_name: 'Other'}, {event_date: '2026-11-01'},
        {drive_folder_id: 'otherfolder'}, {drive_check_job_id: other.drive_check_job_id},
      ]) await assert.rejects(f.save({...body, ...changed}), {code: 'drive_request_conflict'});
      await assert.rejects(f.save({...other, request_key: body.request_key}), {code: 'drive_request_conflict'});
      await f.db.run("UPDATE drive_album_links SET state='unlinked' WHERE id=?", [saved.mapping_id]);
      await assert.rejects(f.save({...body, request_key: randomUUID()}), {code: 'drive_request_conflict'});
      assert.deepEqual(await f.save(body), saved);
      assert.equal((await f.db.get('SELECT state FROM drive_album_links WHERE id=?', [saved.mapping_id])).state, 'unlinked');
      assert.deepEqual(await f.counts(), {albums: 1, slugs: 1, links: 1, receipts: 1});
    } finally { await f.close(); }
  });

  test(database + ': stale, forged, unfinished, and expired checks make no album or slug', options, async () => {
    const f = await fixture(postgres);
    try {
      const cases = [
        {sql: "UPDATE drive_sync_jobs SET kind='preview' WHERE id=?", code: 'drive_folder_check_invalid'},
        {sql: "UPDATE drive_sync_jobs SET status='queued' WHERE id=?", code: 'drive_folder_check_invalid'},
        {sql: "UPDATE drive_sync_jobs SET status='completed_with_errors' WHERE id=?", code: 'drive_folder_check_invalid'},
        {sql: 'UPDATE drive_sync_jobs SET cancel_requested=1 WHERE id=?', code: 'drive_folder_check_invalid'},
        {sql: "UPDATE drive_sync_jobs SET error_code='drive_permission_denied' WHERE id=?", code: 'drive_folder_check_invalid'},
        {sql: 'UPDATE drive_sync_jobs SET connection_generation=0 WHERE id=?', code: 'drive_folder_check_stale'},
        {sql: 'UPDATE drive_sync_jobs SET finished_at=NULL WHERE id=?', code: 'drive_folder_check_expired'},
        {sql: 'UPDATE drive_sync_jobs SET finished_at=? WHERE id=?', args: [f.now() - DRIVE_ALBUM_CHECK_TTL_MS - 1], code: 'drive_folder_check_expired'},
        {sql: 'UPDATE drive_sync_jobs SET finished_at=? WHERE id=?', args: [f.now() + 1], code: 'drive_folder_check_expired'},
        {sql: "UPDATE drive_sync_jobs SET payload_json='broken' WHERE id=?", code: 'drive_folder_check_invalid'},
        {sql: "UPDATE drive_sync_jobs SET progress_json='null' WHERE id=?", code: 'drive_folder_check_invalid'},
        {payload: {operation: 'link', folderId: 'albumfolder'}, code: 'drive_folder_check_invalid'},
        {payload: {operation: 'inspect-folder', folderId: 'otherfolder'}, code: 'drive_folder_check_invalid'},
        {payload: {operation: 'inspect-folder', folderId: 'albumfolder', rootFolderId: 'different-root'}, code: 'drive_folder_check_stale'},
        {progress: {checked: false, folder: {id: 'albumfolder', name: 'Album'}}, code: 'drive_folder_check_invalid'},
        {progress: {checked: true, folder: {id: 'otherfolder', name: 'Album'}}, code: 'drive_folder_check_invalid'},
        {progress: {checked: true, linked: true, folder: {id: 'albumfolder', name: 'Album'}}, code: 'drive_folder_check_invalid'},
        {progress: {checked: true, rootFolderId: 'different-root', folder: {id: 'albumfolder', name: 'Album'}}, code: 'drive_folder_check_stale'},
      ];
      for (const entry of cases) {
        const body = await f.check();
        if (entry.sql) await f.db.run(entry.sql, [...(entry.args || []), body.drive_check_job_id]);
        if (entry.payload) await f.db.run('UPDATE drive_sync_jobs SET payload_json=? WHERE id=?', [JSON.stringify(entry.payload), body.drive_check_job_id]);
        if (entry.progress) await f.db.run('UPDATE drive_sync_jobs SET progress_json=? WHERE id=?', [JSON.stringify(entry.progress), body.drive_check_job_id]);
        await assert.rejects(f.save(body), {code: entry.code});
        // A deliberately queued case must not interfere with the next check claim.
        await f.db.run("UPDATE drive_sync_jobs SET status='failed' WHERE id=?", [body.drive_check_job_id]);
      }
      assert.equal(f.callbacks(), 0);
      assert.deepEqual(await f.counts(), {albums: 0, slugs: 0, links: 0, receipts: 0});
    } finally { await f.close(); }
  });

  test(database + ': connection identity, availability and feature flag are enforced', options, async () => {
    const f = await fixture(postgres);
    try {
      const body = await f.check();
      await assert.rejects(f.save(body, f.create, {env: {}}), {code: 'drive_feature_disabled', status: 503});
      await assert.rejects(f.save({...body, request_key: ''}), {code: 'drive_invalid_request_key', status: 422});
      await assert.rejects(f.save({...body, drive_check_job_id: undefined}), {code: 'drive_invalid_id', status: 422});
      await assert.rejects(f.save({...body, drive_check_job_id: 'missing-check'}), {code: 'drive_folder_check_invalid'});
      await assert.rejects(f.save({...body, drive_folder_id: 'otherfolder'}), {code: 'drive_folder_check_invalid'});
      for (const status of ['disabled', 'pending']) {
        await f.db.run('UPDATE drive_connections SET status=? WHERE id=?', [status, 'studio']);
        await assert.rejects(f.save(body), {code: 'drive_connection_not_ready'});
      }
      await f.db.run("UPDATE drive_connections SET status='active',root_folder_id='changed-root',generation=generation+1 WHERE id='studio'");
      await assert.rejects(f.save(body), {code: 'drive_folder_check_stale'});
      await f.db.run("INSERT INTO drive_connections(id,status) VALUES('other-connection','disabled')");
      await f.db.run("UPDATE drive_sync_jobs SET connection_id='other-connection' WHERE id=?", [body.drive_check_job_id]);
      await assert.rejects(f.save(body), {code: 'drive_folder_check_invalid'});
      await f.db.run("DELETE FROM drive_connections WHERE id='studio'");
      await assert.rejects(f.save(body), {code: 'drive_not_configured'});
      assert.equal(f.callbacks(), 0);
      assert.deepEqual(await f.counts(), {albums: 0, slugs: 0, links: 0, receipts: 0});
    } finally { await f.close(); }
  });

  test(database + ': callback and mapping failures roll back album, slug, and receipt', options, async () => {
    const f = await fixture(postgres);
    try {
      const body = await f.check();
      await assert.rejects(f.save(body, async tx => {
        await f.create(tx);
        throw new Error('creation failed');
      }), {message: 'creation failed'});
      assert.deepEqual(await f.counts(), {albums: 0, slugs: 0, links: 0, receipts: 0});
      await assert.rejects(f.save(body, async tx => {
        const created = await f.create(tx);
        await tx.run("INSERT INTO drive_album_links(id,connection_id,album_id,folder_id) VALUES('collision','studio',?,'albumfolder')", [created.id]);
        return created;
      }));
      assert.deepEqual(await f.counts(), {albums: 0, slugs: 0, links: 0, receipts: 0});
      const job = await f.jobs.get(body.drive_check_job_id);
      assert.equal(job.progress.album_creation, undefined);
      await f.save(body);
      assert.deepEqual(await f.counts(), {albums: 1, slugs: 1, links: 1, receipts: 1});
    } finally { await f.close(); }
  });

  test(database + ': concurrent checks for one folder cannot leave an orphan album', options, async () => {
    const f = await fixture(postgres);
    try {
      const first = await f.check();
      const second = await f.check();
      const results = await Promise.allSettled([f.save(first), f.save(second)]);
      assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
      assert.equal(results.find(row => row.status === 'rejected').reason.code, 'drive_folder_already_linked');
      assert.equal(f.callbacks(), 1);
      assert.deepEqual(await f.counts(), {albums: 1, slugs: 1, links: 1, receipts: 1});
      const winner = results[0].status === 'fulfilled' ? first : second;
      const saved = results.find(row => row.status === 'fulfilled').value;
      await f.db.run("UPDATE drive_album_links SET state='paused' WHERE id=?", [saved.mapping_id]);
      await assert.rejects(f.save(winner === first ? second : first), {code: 'drive_folder_already_linked'});
    } finally { await f.close(); }
  });

  test(database + ': different folders reserve distinct slugs atomically', options, async () => {
    const f = await fixture(postgres);
    try {
      const first = await f.check();
      const second = await f.check('otherfolder');
      const results = await Promise.all([f.save(first), f.save(second)]);
      assert.deepEqual(results.map(row => row.slug).sort(), ['dam-cuoi-da-lat', 'dam-cuoi-da-lat-2']);
      assert.deepEqual(await f.counts(), {albums: 2, slugs: 2, links: 2, receipts: 2});
    } finally { await f.close(); }
  });

  test(database + ': existing link worker and album creation share the folder ownership lock', options, async () => {
    const f = await fixture(postgres);
    try {
      const body = await f.check();
      const existing = await f.db.transaction(tx => f.create(tx));
      const job = await f.jobs.enqueue({connectionId: 'studio', kind: 'check', requestKey: randomUUID(),
        payload: {operation: 'link', albumId: existing.id, folderId: 'albumfolder'}});
      const lease = await f.jobs.claim('link-worker');
      assert.equal(lease.id, job.id);
      const [link, creation] = await Promise.allSettled([f.sync.run(lease), f.save(body)]);
      assert.equal([link, creation].filter(row => row.status === 'fulfilled').length, 1);
      assert.equal([link, creation].find(row => row.status === 'rejected').reason.code, 'drive_folder_already_linked');
      const expected = creation.status === 'fulfilled' ? 2 : 1;
      const counts = await f.counts();
      assert.equal(counts.albums, expected);
      assert.equal(counts.slugs, expected);
      assert.equal(counts.links, 1);
      assert.equal(counts.receipts, creation.status === 'fulfilled' ? 1 : 0);
    } finally { await f.close(); }
  });
}
