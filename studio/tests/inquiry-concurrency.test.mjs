import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../server/app.mjs';

const postgresUrl = process.env.STUDIO_TEST_POSTGRES_URL;

async function fixture(t, dialect) {
  const dir = await mkdtemp(path.join(tmpdir(), 'chicong-inquiry-concurrency-'));
  const checking = Promise.withResolvers();
  const proceed = Promise.withResolvers();
  let instance, server, pool, schema;
  t.after(async () => {
    proceed.resolve();
    if (server) await new Promise(resolve => server.close(resolve));
    await instance?.photoCleanup.close();
    await instance?.mediaControl.close();
    await instance?.db.close();
    if (pool) {
      try { await pool.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); }
      finally { await pool.end(); }
    }
    await rm(dir, {recursive: true, force: true});
  });
  const env = {};
  if (dialect === 'PostgreSQL') {
    // Explicit test-only URL; never inherit DATABASE_URL or use public tables.
    schema = 'inquiry_concurrency_' + randomUUID().replaceAll('-', '');
    pool = new pg.Pool({connectionString: postgresUrl});
    await pool.query('CREATE SCHEMA ' + schema);
    const url = new URL(postgresUrl);
    url.searchParams.set('options', '-c search_path=' + schema);
    env.DATABASE_URL = url.href;
  }
  instance = await createApp({dataDir: dir, env, seed: false, origin: 'http://localhost', googleCalendar: {
    read: async () => ({configured: false, blocked: []}),
    assertAvailable: async () => { checking.resolve(); await proceed.promise; }
  }});
  server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let cookie;
  const request = (url, body, method = 'PATCH') => fetch(base + url, {method,
    headers: {Origin: 'http://localhost', 'Content-Type': 'application/json', ...(cookie ? {Cookie: cookie} : {})},
    body: JSON.stringify(body)});
  const setup = await request('/api/admin/setup', {email: 'test@example.com', password: 'test-owner-password'}, 'POST');
  assert.equal(setup.status, 201);
  cookie = setup.headers.get('set-cookie').split(';')[0];
  const inquiryId = 'a'.repeat(32);
  await instance.db.run('INSERT INTO inquiries(id,name,email,date,service,message,status,created,notes) VALUES(?,?,?,?,?,?,?,?,?)',
    [inquiryId, 'Test', 'customer@example.com', '2099-11-20', 'Ngày cưới', 'Test inquiry', 'new', new Date().toISOString(), 'Original notes']);
  return {...instance, request: body => request('/api/admin/inquiries/' + inquiryId, body),
    row: () => instance.db.get('SELECT * FROM inquiries WHERE id=?', [inquiryId]), checking, proceed};
}

for (const dialect of ['SQLite', 'PostgreSQL']) {
const options = {timeout: 10000, skip: dialect === 'PostgreSQL' && !postgresUrl};
test(`${dialect}: Booking confirmation preserves notes saved while the calendar is being checked`, options, async t => {
  const f = await fixture(t, dialect);
  const confirming = f.request({status: 'confirmed'});
  await f.checking.promise;
  try {
    assert.equal((await f.request({notes: 'New private notes from another tab'})).status, 200);
  } finally { f.proceed.resolve(); }
  assert.equal((await confirming).status, 200);
  const row = await f.row();
  assert.equal(row.status, 'confirmed');
  assert.equal(row.notes, 'New private notes from another tab');
});

test(`${dialect}: A delayed booking confirmation cannot overwrite a concurrent cancellation`, options, async t => {
  const f = await fixture(t, dialect);
  const confirming = f.request({status: 'confirmed'});
  await f.checking.promise;
  try {
    assert.equal((await f.request({status: 'cancelled', notes: 'Cancelled by customer'})).status, 200);
  } finally { f.proceed.resolve(); }
  assert.equal((await confirming).status, 409);
  const row = await f.row();
  assert.equal(row.status, 'cancelled');
  assert.equal(row.notes, 'Cancelled by customer');
});

test(`${dialect}: A stale editor cannot overwrite a newer cancellation or private notes`, options, async t => {
  const f = await fixture(t, dialect);
  const original = await f.row();
  const expected = {status: original.status, date: original.date, notes: original.notes};
  assert.equal((await f.request({status: 'cancelled', notes: 'Customer cancelled', expected})).status, 200);
  const stale = await f.request({status: 'contacted', date: original.date, notes: 'My unsaved draft', expected});
  assert.equal(stale.status, 409);
  assert.equal((await f.row()).status, 'cancelled');
  assert.equal((await f.row()).notes, 'Customer cancelled');
  const latest = await f.row();
  assert.equal((await f.request({notes: 'Reviewed cancellation', expected: {
    status: latest.status, date: latest.date, notes: latest.notes
  }})).status, 200);
  assert.equal((await f.row()).notes, 'Reviewed cancellation');
});

test(`${dialect}: A delayed confirmation with explicit notes rejects a concurrent note edit`, options, async t => {
  const f = await fixture(t, dialect);
  const confirming = f.request({status: 'confirmed', notes: 'Original notes'});
  await f.checking.promise;
  try {
    assert.equal((await f.request({notes: 'New notes from another tab'})).status, 200);
  } finally { f.proceed.resolve(); }
  assert.equal((await confirming).status, 409);
  assert.equal((await f.row()).status, 'new');
  assert.equal((await f.row()).notes, 'New notes from another tab');
});

test(`${dialect}: Invalid editor snapshots are rejected without a write`, options, async t => {
  const f = await fixture(t, dialect);
  for (const expected of [null, [], 'invalid', {}, {status: 'new', date: '2099-11-20', notes: 12}]) {
    assert.equal((await f.request({status: 'cancelled', expected})).status, 422);
  }
  assert.equal((await f.row()).status, 'new');
});
}
