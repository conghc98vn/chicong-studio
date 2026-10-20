import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {openDatabase} from '../server/db.mjs';

export async function driveFixture({legacy = false} = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'drive-db-'));
  let pool;
  let schema;
  let url = null;
  if (process.env.STUDIO_TEST_POSTGRES_URL) {
    pool = new pg.Pool({connectionString: process.env.STUDIO_TEST_POSTGRES_URL});
    schema = 'drive_' + randomUUID().replaceAll('-', '');
    await pool.query('CREATE SCHEMA ' + schema);
    const target = new URL(process.env.STUDIO_TEST_POSTGRES_URL);
    target.searchParams.set('options', '-c search_path=' + schema);
    url = target.href;
  }
  if (legacy) {
    const old = await openDatabase(dir, {url, initialize: false});
    await old.exec(`CREATE TABLE albums(id TEXT PRIMARY KEY,title TEXT NOT NULL,category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'draft',password TEXT,cover_id TEXT,
      client_name TEXT NOT NULL DEFAULT '',event_date TEXT NOT NULL DEFAULT '',selection_status TEXT NOT NULL DEFAULT 'draft',created TEXT NOT NULL DEFAULT '');
      CREATE TABLE photos(id TEXT PRIMARY KEY,album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,original TEXT NOT NULL DEFAULT '',caption TEXT NOT NULL DEFAULT '',width INTEGER NOT NULL,
      height INTEGER NOT NULL,position INTEGER NOT NULL DEFAULT 0);`);
    await old.run("INSERT INTO albums(id,title,category,selection_status) VALUES('legacy','Legacy','wedding','submitted')");
    await old.run("INSERT INTO photos(id,album_id,filename,width,height) VALUES('legacy-photo','legacy','legacy-file',10,10)");
    await old.close();
  }
  const db = await openDatabase(dir, {url});
  await db.run("INSERT INTO albums(id,title,category,status,slug) VALUES('album','Fixture','wedding','draft','fixture')");
  await db.run("INSERT INTO drive_connections(id,service_account_email,root_folder_id,status) VALUES('connection','test@example.invalid','root','active')");
  await db.run("INSERT INTO drive_album_links(id,connection_id,album_id,folder_id) VALUES('mapping','connection','album','folder')");
  return {
    db, dir, url,
    close: async () => {
      await db.close();
      if (pool) {
        await pool.query('DROP SCHEMA ' + schema + ' CASCADE');
        await pool.end();
      }
      await rm(dir, {recursive: true, force: true});
    },
  };
}
