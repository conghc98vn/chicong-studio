import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {driveFixture} from './drive-test-fixture.mjs';
import {migrateDriveSchema, driveTables} from '../server/drive-schema.mjs';
import {openDatabase} from '../server/db.mjs';
import {createDriveJobs} from '../server/drive-jobs.mjs';
import {atomicFile, databaseSnapshot, jsonBytes, legacyTables, mappingHash, mediaReferences,
  putBlob, restoreBackup, sha256, validateDatabaseSnapshot, verifyBackup} from '../tools/media-backup.mjs';

async function saveSnapshot(root, snapshot) {
  const database = jsonBytes(snapshot);
  const databaseSha256 = sha256(database);
  await putBlob(root, databaseSha256, database);
  const objects = [];
  for (const reference of mediaReferences(snapshot)) {
    const bytes = Buffer.from('image-fixture');
    const digest = sha256(bytes);
    await putBlob(root, digest, bytes);
    objects.push({...reference, bytes: bytes.length, sha256: digest});
  }
  const manifest = {version: 1, state: 'complete', runId: 'drive-test', capturedAt: snapshot.capturedAt,
    appRevision: 'test', storage: 'fixture', databaseSha256, mappingHash: mappingHash(snapshot), objects};
  await atomicFile(path.join(root, 'snapshots', 'drive-test.json'), jsonBytes(manifest));
  return manifest;
}

test('Additive migration preserves legacy manual photos, sticky submitted hold and repeats safely', async () => {
  const fixture = await driveFixture({legacy: true});
  try {
    const before = await fixture.db.get("SELECT * FROM albums WHERE id = 'legacy'");
    assert.equal(before.drive_review_required, 1);
    assert.equal(before.submission_generation, 0);
    assert.equal((await fixture.db.get("SELECT * FROM photos WHERE id = 'legacy-photo'")).source, 'manual');
    await migrateDriveSchema(fixture.db);
    assert.deepEqual(await fixture.db.get("SELECT * FROM albums WHERE id = 'legacy'"), before);
    if (fixture.db.cloud) {
      const protectedTables = await fixture.db.all("SELECT relname FROM pg_class WHERE relnamespace = current_schema()::regnamespace AND relrowsecurity = true");
      for (const table of driveTables) assert.ok(protectedTables.some(entry => entry.relname === table));
    }
  } finally {
    await fixture.close();
  }
});

test('Database revisions track every display and selection writer without self-invalidating counter writes', async () => {
  const fixture = await driveFixture();
  try {
    const album = () => fixture.db.get("SELECT * FROM albums WHERE id = 'album'");
    await fixture.db.run("INSERT INTO photos(id,album_id,filename,width,height) VALUES('photo','album','file',100,100)");
    assert.equal((await album()).catalog_revision, 1);
    await fixture.db.run("INSERT INTO gallery_submissions(id,album_id,request_key,catalog_revision,selection_revision,submission_generation,selected_photos) VALUES('submission','album','key',1,0,1,'[]')");
    await fixture.db.run("UPDATE photos SET caption = 'New caption' WHERE id = 'photo'");
    assert.equal((await album()).catalog_revision, 2);
    assert.equal((await fixture.db.get("SELECT stale FROM gallery_submissions WHERE id = 'submission'")).stale, 1);
    await fixture.db.run("UPDATE photos SET caption = 'New caption' WHERE id = 'photo'");
    assert.equal((await album()).catalog_revision, 2);
    await fixture.db.run("INSERT INTO selections(album_id,photo_id,updated) VALUES('album','photo','today')");
    assert.equal((await album()).selection_revision, 1);
    await fixture.db.run("UPDATE selections SET updated = 'tomorrow' WHERE album_id = 'album'");
    assert.equal((await album()).selection_revision, 1);
    await fixture.db.run("UPDATE albums SET selection_status = 'submitted', submission_generation = submission_generation + 1 WHERE id = 'album'");
    await fixture.db.run("UPDATE albums SET selection_status = 'draft' WHERE id = 'album'");
    assert.equal((await album()).drive_review_required, 1);
    assert.equal((await album()).submission_generation, 1);
    assert.equal((await album()).catalog_revision, 2);
    await fixture.db.run("INSERT INTO album_sections(id,album_id,title) VALUES('section','album','Section')");
    assert.equal((await album()).catalog_revision, 3);
    await fixture.db.run("UPDATE album_sections SET title = 'Renamed' WHERE id = 'section'");
    await fixture.db.run("UPDATE photos SET section_id = 'section' WHERE id = 'photo'");
    await fixture.db.run("UPDATE albums SET cover_id = 'photo' WHERE id = 'album'");
    assert.equal((await album()).catalog_revision, 6);
    await fixture.db.run("UPDATE photos SET filename = 'new-file', source = 'google_drive' WHERE id = 'photo'");
    assert.equal((await album()).catalog_revision, 7);
    await fixture.db.run("DELETE FROM selections WHERE album_id = 'album'");
    assert.equal((await album()).selection_revision, 2);
    await fixture.db.run("DELETE FROM photos WHERE id = 'photo'");
    assert.equal((await album()).catalog_revision, 8);
  } finally {
    await fixture.close();
  }
});

test('Paused mappings reserve their slot, unlinked history remains and deleted photos preserve tombstones', async () => {
  const fixture = await driveFixture();
  try {
    await assert.rejects(fixture.db.run("UPDATE drive_album_links SET folder_id = 'changed-folder' WHERE id = 'mapping'"), /immutable/);
    await fixture.db.run("UPDATE drive_album_links SET state = 'paused' WHERE id = 'mapping'");
    await assert.rejects(fixture.db.run("INSERT INTO drive_album_links(id,connection_id,album_id,folder_id) VALUES('duplicate','connection','album','other-folder')"));
    await fixture.db.run("UPDATE drive_album_links SET state = 'unlinked' WHERE id = 'mapping'");
    await fixture.db.run("INSERT INTO drive_album_links(id,connection_id,album_id,folder_id) VALUES('new-link','connection','album','other-folder')");
    await fixture.db.run("INSERT INTO photos(id,album_id,filename,width,height,source) VALUES('photo','album','file',10,10,'google_drive')");
    await fixture.db.run(`INSERT INTO drive_source_files(id,connection_id,drive_file_id,mapping_id,photo_id,state,
      source_generation,imported_generation,observed_version,imported_version)
      VALUES('source','connection','drive-file','mapping','photo','suppressed',2,1,'18446744073709551615','18446744073709551614')`);
    await fixture.db.run("DELETE FROM photos WHERE id = 'photo'");
    const source = await fixture.db.get("SELECT * FROM drive_source_files WHERE id = 'source'");
    assert.equal(source.photo_id, null);
    assert.equal(source.state, 'suppressed');
    assert.equal(source.source_generation, 2);
    assert.equal(source.imported_version, '18446744073709551614');
    await assert.rejects(fixture.db.run("INSERT INTO drive_source_files(id,connection_id,drive_file_id,mapping_id) VALUES('other-source','connection','drive-file','new-link')"));
    assert.equal((await fixture.db.all('SELECT * FROM drive_album_links')).length, 2);
  } finally {
    await fixture.close();
  }
});

test('Version 2 restore preserves ownership and submissions but disables every resumable Drive path', async () => {
  const fixture = await driveFixture();
  try {
    const jobs = createDriveJobs(fixture.db);
    const preview = await jobs.enqueue({mappingId: 'mapping', kind: 'preview', requestKey: 'preview'});
    await jobs.finish(await jobs.claim('worker'), {status: 'awaiting_review', manifest: {version: '9'}});
    await fixture.db.run(`INSERT INTO drive_sync_approvals(id,preview_id,album_id,mapping_id,connection_generation,mapping_generation,
      catalog_revision,selection_revision,submission_generation,manifest_json) VALUES('approval',?,'album','mapping',1,1,0,0,0,'{}')`, [preview.id]);
    const apply = await jobs.enqueue({mappingId: 'mapping', kind: 'apply', requestKey: 'approved', approvalId: 'approval', previewId: preview.id});
    const running = await jobs.claim('worker');
    await jobs.putItems(running, [{fileId: 'file', action: 'add', version: '9', sourceGeneration: 2}]);
    await fixture.db.run("INSERT INTO drive_source_files(id,connection_id,drive_file_id,mapping_id,state,source_generation,imported_generation,reimport_intent_id) VALUES('source','connection','file','mapping','detached',2,1,'intent')");
    await fixture.db.run("INSERT INTO drive_reimport_intents(id,source_file_id,request_key,source_generation,preview_id) VALUES('intent','source','reimport',2,?)", [preview.id]);
    await fixture.db.run("INSERT INTO photo_ingest_attempts(id,operation_id,album_id,candidate_prefix,storage_identity,state,process_id,writer_token) VALUES('attempt','operation','album',?,'test','prepared','worker','token')", ['a'.repeat(32)]);
    await fixture.db.run("INSERT INTO drive_worker_heartbeats(id,process_id,heartbeat_at,started_at,state,storage_identity) VALUES('worker','worker',1,1,'running','test')");
    await fixture.db.run("UPDATE albums SET selection_status = 'submitted', submission_generation = 3, catalog_revision = 12, selection_revision = 4");
    await fixture.db.run("INSERT INTO gallery_submissions(id,album_id,request_key,catalog_revision,selection_revision,submission_generation,selected_photos) VALUES('submission','album','submitted',12,4,3,'[]')");
    const snapshot = await databaseSnapshot(fixture.db);
    assert.equal(snapshot.schemaVersion, 3);
    snapshot.tables.drive_sync_jobs.reverse();
    const repository = path.join(fixture.dir, 'repository');
    const manifest = await saveSnapshot(repository, snapshot);
    assert.equal((await verifyBackup(repository, manifest)).schemaVersion, 3);
    const destination = path.join(fixture.dir, 'restored');
    await restoreBackup(repository, destination);
    const restored = await openDatabase(destination, {url: null});
    try {
      assert.equal((await restored.get("SELECT status FROM drive_connections WHERE id = 'connection'")).status, 'disabled');
      const mapping = await restored.get("SELECT * FROM drive_album_links WHERE id = 'mapping'");
      assert.equal(mapping.enabled, 0);
      assert.equal(mapping.generation, 2);
      assert.equal(mapping.baseline_preview_id, null);
      for (const job of await restored.all('SELECT * FROM drive_sync_jobs')) {
        assert.equal(job.status, 'canceled');
        assert.equal(job.lease_owner, null);
      }
      assert.equal((await restored.get('SELECT * FROM drive_sync_jobs WHERE id = ?', [apply.id])).fence, running.fence + 1);
      assert.ok((await restored.get("SELECT invalidated_at FROM drive_sync_approvals WHERE id = 'approval'")).invalidated_at);
      assert.equal((await restored.get("SELECT state FROM drive_source_files WHERE id = 'source'")).state, 'detached');
      assert.equal((await restored.get("SELECT reimport_intent_id FROM drive_source_files WHERE id = 'source'")).reimport_intent_id, null);
      assert.equal((await restored.get("SELECT status FROM drive_reimport_intents WHERE id = 'intent'")).status, 'canceled');
      assert.equal((await restored.get("SELECT state FROM photo_ingest_attempts WHERE id = 'attempt'")).state, 'retired');
      assert.equal((await restored.all('SELECT * FROM drive_worker_heartbeats')).length, 0);
      const album = await restored.get("SELECT * FROM albums WHERE id = 'album'");
      assert.equal(album.catalog_revision, 12);
      assert.equal(album.selection_revision, 4);
      assert.equal(album.submission_generation, 3);
      assert.equal(album.drive_review_required, 1);
      assert.equal((await restored.get("SELECT stale FROM gallery_submissions WHERE id = 'submission'")).stale, 0);
    } finally {
      await restored.close();
    }
  } finally {
    await fixture.close();
  }
});

test('Historical version 1 snapshots restore with manual ownership and reject unknown tables', async () => {
  const fixture = await driveFixture();
  try {
    const filename = 'a'.repeat(32);
    await fixture.db.run("INSERT INTO photos(id,album_id,filename,width,height) VALUES('old-photo','album',?,10,10)", [filename]);
    await fixture.db.run("UPDATE albums SET selection_status = 'submitted' WHERE id = 'album'");
    const current = await databaseSnapshot(fixture.db);
    const legacy = {...current, schemaVersion: 1, tables: Object.fromEntries(legacyTables.map(table => [table, current.tables[table]]))};
    for (const album of legacy.tables.albums) {
      for (const field of ['catalog_revision', 'selection_revision', 'submission_generation', 'drive_review_required']) delete album[field];
    }
    for (const photo of legacy.tables.photos) delete photo.source;
    assert.equal(validateDatabaseSnapshot(legacy), legacy);
    assert.throws(() => validateDatabaseSnapshot({...legacy, tables: {...legacy.tables, surprise: []}}), /Unsupported/);
    const repository = path.join(fixture.dir, 'legacy-repository');
    await saveSnapshot(repository, legacy);
    const destination = path.join(fixture.dir, 'legacy-restored');
    await restoreBackup(repository, destination);
    const restored = await openDatabase(destination, {url: null});
    try {
      assert.equal((await restored.get("SELECT source FROM photos WHERE id = 'old-photo'")).source, 'manual');
      assert.equal((await restored.get("SELECT drive_review_required FROM albums WHERE id = 'album'")).drive_review_required, 1);
      assert.equal((await restored.all('SELECT * FROM drive_connections')).length, 0);
    } finally {
      await restored.close();
    }
  } finally {
    await fixture.close();
  }
});

test('PostgreSQL snapshot cannot mix gallery revisions with a concurrent submission or photo replacement', {
  skip: !process.env.STUDIO_TEST_POSTGRES_URL,
}, async () => {
  const fixture = await driveFixture();
  try {
    await fixture.db.run("INSERT INTO photos(id,album_id,filename,width,height) VALUES('photo','album','old-file',10,10)");
    let intervened = false;
    const interleaved = {
      ...fixture.db,
      transaction: callback => fixture.db.transaction(tx => callback({
        ...tx,
        all: async (sql, parameters) => {
          const rows = await tx.all(sql, parameters);
          if (sql === 'SELECT * FROM albums') {
            await fixture.db.transaction(async writer => {
              await writer.get("SELECT id FROM albums WHERE id = 'album' FOR UPDATE");
              await writer.run("UPDATE photos SET filename = 'new-file' WHERE id = 'photo'");
              await writer.run("INSERT INTO selections(album_id,photo_id,updated) VALUES('album','photo','now')");
              await writer.run("UPDATE albums SET selection_status = 'submitted', submission_generation = 1 WHERE id = 'album'");
              await writer.run(`INSERT INTO gallery_submissions(id,album_id,request_key,catalog_revision,
                selection_revision,submission_generation,selected_photos)
                VALUES('submission','album','concurrent',2,1,1,'[{"id":"photo","filename":"new-file"}]')`);
            });
            intervened = true;
          }
          return rows;
        },
      })),
    };
    const snapshot = await databaseSnapshot(interleaved);
    assert.equal(intervened, true);
    assert.equal(snapshot.tables.photos[0].filename, 'old-file');
    assert.equal(snapshot.tables.albums[0].catalog_revision, 1);
    assert.equal(snapshot.tables.albums[0].selection_revision, 0);
    assert.equal(snapshot.tables.albums[0].drive_review_required, 0);
    assert.equal(snapshot.tables.selections.length, 0);
    assert.equal(snapshot.tables.gallery_submissions.length, 0);
    assert.equal((await fixture.db.get("SELECT filename FROM photos WHERE id = 'photo'")).filename, 'new-file');
    assert.equal((await fixture.db.get("SELECT drive_review_required FROM albums WHERE id = 'album'")).drive_review_required, 1);
    assert.equal((await fixture.db.all('SELECT * FROM gallery_submissions')).length, 1);
  } finally {
    await fixture.close();
  }
});

test('Existing connections migrate to root scope without changing mappings and retain shared on repeat',async () => {
  const f = await driveFixture();
  try {
    const before = await f.db.all('SELECT * FROM drive_album_links');
    await f.db.exec('ALTER TABLE drive_connections DROP COLUMN folder_scope');
    await migrateDriveSchema(f.db);
    assert.equal((await f.db.get("SELECT folder_scope FROM drive_connections WHERE id='connection'")).folder_scope,'root');
    await assert.rejects(f.db.run("UPDATE drive_connections SET folder_scope='all'"));
    await f.db.run("UPDATE drive_connections SET folder_scope='shared'");
    await migrateDriveSchema(f.db);
    assert.equal((await f.db.get("SELECT folder_scope FROM drive_connections WHERE id='connection'")).folder_scope,'shared');
    assert.deepEqual(await f.db.all('SELECT * FROM drive_album_links'),before);
  } finally { await f.close(); }
});
