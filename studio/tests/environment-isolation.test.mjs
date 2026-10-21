import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../server/db.mjs';
import {createApp} from '../server/app.mjs';

async function withAmbientDatabase(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'environment-isolation-'));
  const previous = {DATABASE_URL: process.env.DATABASE_URL, NODE_ENV: process.env.NODE_ENV};
  let connections = 0;
  // A local TCP trap proves that no ambient database connection is attempted.
  // It never speaks PostgreSQL or exposes an actual database to the fixture.
  const trap = net.createServer(socket => {
    connections++;
    socket.destroy();
  });
  trap.listen(0, '127.0.0.1');
  await new Promise(resolve => trap.once('listening', resolve));
  process.env.DATABASE_URL = `postgresql://test:test@127.0.0.1:${trap.address().port}/must_not_connect`;
  process.env.NODE_ENV = 'development';
  try {
    await run(directory);
    assert.equal(connections, 0, 'explicit local configuration must not contact the ambient database');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise(resolve => trap.close(resolve));
    await rm(directory, {recursive: true, force: true});
  }
}

test('openDatabase defaults to the given local directory even with DATABASE_URL exported', async () => {
  await withAmbientDatabase(async directory => {
    const db = await openDatabase(directory);
    try {
      assert.equal(db.cloud, false);
      assert.ok(await db.get('SELECT key FROM settings LIMIT 1'));
    } finally {
      await db.close();
    }
  });
});

test('createApp uses its explicit environment instead of ambient database and production flags', async () => {
  await withAmbientDatabase(async directory => {
    for (const mode of ['development', 'production']) {
      process.env.NODE_ENV = mode;
      const app = await createApp({dataDir: path.join(directory, mode), env: {}});
      try {
        assert.equal(app.db.cloud, false);
        assert.ok(await app.db.get('SELECT key FROM settings LIMIT 1'));
      } finally {
        await app.photoCleanup.close();
        await app.mediaControl.close();
        app.storage.close?.();
        await app.db.close();
      }
    }
  });
});

test('an explicit production environment still requires a persistent database', async () => {
  await withAmbientDatabase(async directory => {
    await assert.rejects(createApp({
      dataDir: directory,
      env: {NODE_ENV: 'production', SITE_URL: 'https://fixture.example'}
    }), /Production requires persistent DATABASE_URL/);
  });
});
