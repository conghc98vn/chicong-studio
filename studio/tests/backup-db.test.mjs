import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {gunzipSync} from 'node:zlib';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../../scripts/backup-db.sh', import.meta.url));
const database = 'postgresql://fixture:synthetic-password@127.0.0.1/backup-test';
const sql = "INSERT INTO fixture VALUES ('" + 'BACKUP_FULL_VALUE_Ảnh_'.repeat(300) + "');\n";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'backup-db-'));
  const bin = path.join(root, 'bin'), destination = path.join(root, 'backups');
  const envFile = path.join(root, '.env'), argumentsFile = path.join(root, 'arguments.json');
  await mkdir(bin);
  await mkdir(destination);
  await writeFile(envFile, `  DATABASE_URL = '${database}' # local fixture\n`);
  await writeFile(path.join(root, 'fixture.sql'), sql);
  // The fake pg_dump cannot connect to any database. All filesystem paths and
  // environment values belong to this fixture; the production .env is unread.
  await writeFile(path.join(bin, 'pg_dump'), `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.ARGUMENTS_FILE, JSON.stringify(process.argv.slice(2)));
process.stdout.write(fs.readFileSync(process.env.SQL_FILE));
process.exitCode = Number(process.env.DUMP_EXIT || 0);
`, {mode: 0o700});
  // Force two runs to share a timestamp, independently of machine speed.
  await writeFile(path.join(bin, 'date'), '#!/bin/sh\nprintf "%s\\n" "20261023_120000"\n', {mode: 0o700});
  const env = {
    PATH: [bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
    STUDIO_BACKUP_DIR: destination, STUDIO_ENV_FILE: envFile,
    ARGUMENTS_FILE: argumentsFile, SQL_FILE: path.join(root, 'fixture.sql')
  };
  return {
    destination, envFile, argumentsFile,
    run: overrides => execute('/bin/bash', [script], {env: {...env, ...overrides}}),
    close: () => rm(root, {recursive: true, force: true})
  };
}

test('SQL backup publishes complete private bytes and supports dotenv syntax', async () => {
  const f = await fixture();
  try {
    const result = await f.run();
    assert.match(result.stdout, /Sao lưu thành công/);
    const names = await readdir(f.destination);
    assert.equal(names.length, 1);
    assert.match(names[0], /^db_20261023_120000_[a-zA-Z0-9]+\.sql\.gz$/);
    const backup = path.join(f.destination, names[0]);
    assert.equal(gunzipSync(await readFile(backup)).toString(), sql);
    assert.equal((await stat(backup)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(f.argumentsFile, 'utf8')), [
      '--exclude-table-data=*.drive_comparison_cache',
      '--exclude-table-data=*.drive_folder_preview_cache', database
    ]);
  } finally {await f.close();}
});

test('Failed SQL dump leaves prior backups intact and publishes no partial archive', async () => {
  const f = await fixture();
  try {
    const previous = path.join(f.destination, 'db_previous.sql.gz');
    await writeFile(previous, 'previous backup');
    // Even an expired backup must survive when no replacement was completed.
    const expired = new Date(Date.now() - 17 * 86400000);
    await utimes(previous, expired, expired);
    await assert.rejects(f.run({DUMP_EXIT: '1'}), error => {
      assert.equal(error.code, 1);
      assert.doesNotMatch(error.stdout, /Sao lưu thành công|Đã dọn dẹp/);
      return true;
    });
    assert.deepEqual(await readdir(f.destination), ['db_previous.sql.gz']);
    assert.equal(await readFile(previous, 'utf8'), 'previous backup');
  } finally {await f.close();}
});

test('Concurrent SQL backups in the same second keep separate complete archives', async () => {
  const f = await fixture();
  try {
    await Promise.all([f.run(), f.run()]);
    const names = await readdir(f.destination);
    assert.equal(names.length, 2);
    for (const name of names) assert.equal(gunzipSync(await readFile(path.join(f.destination, name))).toString(), sql);
  } finally {await f.close();}
});
