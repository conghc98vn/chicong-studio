import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {openDatabase} from '../server/db.mjs';

test('PostgreSQL reconnects after its idle backend is terminated without crashing the application', {
  skip: !process.env.STUDIO_TEST_POSTGRES_URL,
  timeout: 10000
}, async () => {
  // No application tables or production connections: terminate only the PID
  // acquired by this test's new pool in the explicitly supplied test database.
  const url = process.env.STUDIO_TEST_POSTGRES_URL;
  const db = await openDatabase(null, {url, initialize: false});
  const control = new pg.Client({connectionString: url});
  try {
    await control.connect();
    const {pid} = await db.get('SELECT pg_backend_pid() AS pid');
    await control.query('SELECT pg_terminate_backend($1)', [pid]);
    await new Promise(resolve => setTimeout(resolve, 100));
    const current = await db.get('SELECT pg_backend_pid() AS pid, 42 AS value');
    assert.notEqual(current.pid, pid);
    assert.equal(current.value, 42);
  } finally {
    await control.end();
    await db.close();
  }
});

test('A disconnected transaction between queries cannot crash, commit, or replay its writes', {
  skip: !process.env.STUDIO_TEST_POSTGRES_URL,
  timeout: 10000
}, async () => {
  const url = process.env.STUDIO_TEST_POSTGRES_URL;
  const db = await openDatabase(null, {url, initialize: false});
  const control = new pg.Client({connectionString: url});
  const table = 'recovery_' + randomUUID().replaceAll('-', '');
  let calls = 0;
  try {
    await control.connect();
    await control.query(`CREATE TABLE ${table} (value INTEGER NOT NULL)`);
    await assert.rejects(db.transaction(async tx => {
      calls++;
      const {pid} = await tx.get('SELECT pg_backend_pid() AS pid');
      await tx.run(`INSERT INTO ${table} (value) VALUES (?)`, [7]);
      await control.query('SELECT pg_terminate_backend($1)', [pid]);
      // Model the callback awaiting non-DB I/O while the server disconnects.
      await new Promise(resolve => setTimeout(resolve, 100));
      return 'must not report a successful commit';
    }), error => error.code === '57P01');
    assert.equal(calls, 1, 'an uncertain transaction is never automatically replayed');
    assert.equal((await control.query(`SELECT COUNT(*) AS count FROM ${table}`)).rows[0].count, '0');
    assert.equal((await db.transaction(tx => tx.get('SELECT 42 AS value'))).value, 42);
  } finally {
    await control.query(`DROP TABLE IF EXISTS ${table}`).catch(() => {});
    await control.end();
    await db.close();
  }
});

test('A disconnect during an active query rejects the transaction and leaves the pool usable', {
  skip: !process.env.STUDIO_TEST_POSTGRES_URL,
  timeout: 10000
}, async () => {
  const url = process.env.STUDIO_TEST_POSTGRES_URL;
  const db = await openDatabase(null, {url, initialize: false});
  const control = new pg.Client({connectionString: url});
  let identify;
  const identified = new Promise(resolve => { identify = resolve; });
  try {
    await control.connect();
    const operation = db.transaction(async tx => {
      const {pid} = await tx.get('SELECT pg_backend_pid() AS pid');
      identify(pid);
      await tx.get('SELECT pg_sleep(3)');
    });
    const rejected = assert.rejects(operation, error => error.code === '57P01');
    const pid = await identified;
    let active = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await control.query('SELECT state, query FROM pg_stat_activity WHERE pid=$1', [pid]);
      active = state.rows[0]?.state === 'active' && state.rows[0]?.query === 'SELECT pg_sleep(3)';
      if (active) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await control.query('SELECT pg_terminate_backend($1)', [pid]);
    await rejected;
    assert.ok(active, 'terminate only after the query is actually executing');
    assert.equal((await db.get('SELECT 42 AS value')).value, 42);
  } finally {
    await control.end();
    await db.close();
  }
});

test('A failed rollback preserves the callback error instead of replacing it with a connection error', {
  skip: !process.env.STUDIO_TEST_POSTGRES_URL,
  timeout: 10000
}, async () => {
  const url = process.env.STUDIO_TEST_POSTGRES_URL;
  const db = await openDatabase(null, {url, initialize: false});
  const control = new pg.Client({connectionString: url});
  const original = Object.assign(Error('The operation was cancelled'), {code: 'TEST_CANCELLED'});
  try {
    await control.connect();
    await assert.rejects(db.transaction(async tx => {
      const {pid} = await tx.get('SELECT pg_backend_pid() AS pid');
      await control.query('SELECT pg_terminate_backend($1)', [pid]);
      await new Promise(resolve => setTimeout(resolve, 100));
      throw original;
    }), error => error === original);
    assert.equal((await db.get('SELECT 42 AS value')).value, 42);
  } finally {
    await control.end();
    await db.close();
  }
});
