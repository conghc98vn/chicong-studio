import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';
import {openDatabase} from '../server/db.mjs';

for (const postgres of [false, true]) {
  test(`Drive gallery submission and 5000-photo edits on ${postgres ? 'postgres' : 'sqlite'}`, {
    skip: postgres && !process.env.STUDIO_TEST_POSTGRES_URL,
    timeout: 90000
  }, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'drive-gallery-contract-'));
    const schema = 'drive_gallery_' + randomUUID().replaceAll('-', '');
    let pool;
    let app;
    let server;
    try {
      let url;
      if (postgres) {
        pool = new pg.Pool({connectionString: process.env.STUDIO_TEST_POSTGRES_URL});
        await pool.query('CREATE SCHEMA ' + schema);
        const parsed = new URL(process.env.STUDIO_TEST_POSTGRES_URL);
        parsed.searchParams.set('options', '-c search_path=' + schema);
        url = parsed.href;
      }
      const db = await openDatabase(directory, {url});
      app = await createApp({db, dataDir: directory, seed: false, env: {DRIVE_SYNC_ENABLED: 'true'}});
      server = app.app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const base = 'http://127.0.0.1:' + server.address().port;
      const album = 'a'.repeat(32);
      const photo = value => value.toString(16).padStart(32, '0');
      let cookie = '';
      const request = (route, data, method = 'POST', admin = false, headers = {}) => fetch(base + route, {
        method,
        headers: {Origin: base, ...(data instanceof FormData ? {} : {'Content-Type': 'application/json'}), ...(admin ? {Cookie: cookie} : {}), ...headers},
        body: data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data)
      });
      const setup = await request('/api/admin/setup', {email: 'contract@example.com', password: 'contract-password-123'});
      assert.equal(setup.status, 201);
      cookie = setup.headers.get('set-cookie').split(';')[0];
      await db.run('INSERT INTO albums(id,title,category,status) VALUES(?,?,?,?)', [album, '5000 photos', 'wedding', 'private']);
      for (let offset = 0; offset < 5000; offset += 100) {
        const rows = Array.from({length: 100}, (_, index) => [photo(offset + index + 1), album, photo(offset + index + 1), `CC-${offset + index + 1}.jpg`, 2400, 1600, offset + index]);
        await db.run('INSERT INTO photos(id,album_id,filename,original,width,height,position) VALUES ' + rows.map(() => '(?,?,?,?,?,?,?)').join(','), rows.flat());
      }
      const galleryPath = '/api/gallery/' + album;
      const state = async () => (await request(galleryPath + '/selection', undefined, 'GET')).json();
      await request(galleryPath + '/selection/' + photo(1), {selected: true}, 'PUT');
      let current = await state();
      assert.equal((await request(galleryPath + '/submit', {})).status, 409);
      const payload = {catalog_revision: current.catalog_revision, selection_revision: current.selection_revision, request_key: randomUUID()};
      await request('/api/admin/photos/' + photo(2), {caption: 'Changed while viewing'}, 'PATCH', true);
      assert.equal((await request(galleryPath + '/submit', payload)).status, 409);
      current = await state();
      Object.assign(payload, {catalog_revision: current.catalog_revision, selection_revision: current.selection_revision});
      const first = await request(galleryPath + '/submit', payload);
      assert.equal(first.status, 200);
      const receipt = await first.json();
      assert.equal(receipt.submission_generation, 1);
      assert.equal((await (await request(galleryPath + '/submit', payload)).json()).submission_id, receipt.submission_id);
      assert.equal(Number((await db.get('SELECT COUNT(*) AS count FROM gallery_submissions')).count), 1);
      // Reuse with a different revision or selected list must never change its meaning.
      assert.equal((await request(galleryPath + '/submit', {...payload, selection_revision: current.selection_revision + 1})).status, 409);
      assert.equal((await request(galleryPath + '/submit', {...payload, photos: [photo(2)]})).status, 409);
      await request(galleryPath + '/selection/' + photo(1), {selected: false}, 'PUT');
      assert.equal((await state()).selection_status, 'draft');
      assert.equal((await db.get('SELECT drive_review_required FROM albums WHERE id=?', [album])).drive_review_required, 1);
      await request('/api/admin/photos/' + photo(1), {caption: 'Edited after submission'}, 'PATCH', true);
      assert.equal((await state()).submission_stale, true);
      current = await state();
      const move = {photo_id: photo(4999), neighbor_id: photo(5000), catalog_revision: current.catalog_revision};
      assert.equal((await request('/api/admin/albums/' + album + '/move', move, 'POST', true)).status, 200);
      assert.equal((await db.get('SELECT position FROM photos WHERE id=?', [photo(4999)])).position, 4999);
      assert.equal((await request('/api/admin/albums/' + album + '/move', move, 'POST', true)).status, 409);
      current = await state();
      assert.equal((await request('/api/admin/albums/' + album + '/move', {...move, photo_id: photo(1), catalog_revision: current.catalog_revision}, 'POST', true)).status, 409);
      // Replacement is bound to the selected photo, even with a colliding filename.
      const jpeg = await sharp({create: {width: 50, height: 40, channels: 3, background: '#336699'}}).jpeg().toBuffer();
      const replacement = () => {
        const form = new FormData();
        form.append('photo', new Blob([jpeg], {type: 'image/jpeg'}), 'CC-2.jpg');
        return form;
      };
      const headers = {'X-Catalog-Revision': String(current.catalog_revision), 'X-Upload-Key': randomUUID()};
      const replaced = await request('/api/admin/photos/' + photo(1) + '/replace', replacement(), 'POST', true, headers);
      assert.equal(replaced.status, 200, await replaced.text());
      assert.equal(Number((await db.get('SELECT COUNT(*) AS count FROM photos')).count), 5000);
      assert.equal((await db.get('SELECT filename FROM photos WHERE id=?', [photo(2)])).filename, photo(2));
      assert.equal((await request('/api/admin/photos/' + photo(1) + '/replace', replacement(), 'POST', true, headers)).status, 200);
      await db.run("UPDATE photos SET source='google_drive' WHERE id=?", [photo(3)]);
      current = await state();
      const forbidden = await request('/api/admin/photos/' + photo(3) + '/replace', replacement(), 'POST', true, {
        'X-Catalog-Revision': String(current.catalog_revision), 'X-Upload-Key': randomUUID()
      });
      assert.ok([409, 422].includes(forbidden.status));
      const publicData = await (await request(galleryPath, undefined, 'GET')).text();
      assert.doesNotMatch(publicData, /drive_file_id|root_folder_id|service_account|google_drive|upload_hash/);
    } finally {
      await new Promise(resolve => server ? server.close(resolve) : resolve());
      await app?.mediaControl.close();
      await app?.db.close();
      if (pool) {
        await pool.query('DROP SCHEMA ' + schema + ' CASCADE');
        await pool.end();
      }
      await rm(directory, {recursive: true, force: true});
    }
  });
}
