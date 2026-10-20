import {installDriveRevisionTriggers} from './drive-revisions.mjs';

export const driveTables = [
  'drive_connections', 'drive_album_links', 'drive_source_files',
  'drive_sync_jobs', 'drive_job_requests', 'drive_sync_job_items', 'drive_sync_approvals',
  'drive_reimport_intents', 'photo_ingest_attempts', 'gallery_submissions',
  'drive_worker_heartbeats',
];

async function addColumns(db, table, definitions) {
  const existing = db.cloud ? [] : await db.all(`PRAGMA table_info(${table})`);
  for (const [name, definition] of Object.entries(definitions)) {
    if (db.cloud) {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} ${definition}`);
    } else if (!existing.some(column => column.name === name)) {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }
}

// Additive and repeatable on both supported databases. Credentials never enter DB.
export async function migrateDriveSchema(db) {
  await addColumns(db, 'photos', {
    source: "TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','google_drive'))",
  });
  await addColumns(db, 'albums', {
    catalog_revision: 'INTEGER NOT NULL DEFAULT 0',
    selection_revision: 'INTEGER NOT NULL DEFAULT 0',
    submission_generation: 'INTEGER NOT NULL DEFAULT 0',
    drive_review_required: 'INTEGER NOT NULL DEFAULT 0',
  });
  await addColumns(db, 'photo_cleanup', {
    not_before: 'BIGINT',
    retention_started_at: 'BIGINT',
    kind: "TEXT NOT NULL DEFAULT 'retired'",
  });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS drive_connections (
      id TEXT PRIMARY KEY,
      service_account_email TEXT NOT NULL DEFAULT '',
      root_folder_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'disabled',
      generation INTEGER NOT NULL DEFAULT 1,
      last_checked_at BIGINT,
      last_error_code TEXT,
      created_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS drive_one_active_connection
      ON drive_connections((1)) WHERE status = 'active';
    CREATE TABLE IF NOT EXISTS drive_album_links (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES drive_connections(id),
      album_id TEXT NOT NULL REFERENCES albums(id),
      folder_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'attached' CHECK(state IN ('attached','paused','unlinked')),
      enabled INTEGER NOT NULL DEFAULT 1,
      generation INTEGER NOT NULL DEFAULT 1,
      next_run_at BIGINT,
      last_inventory_at BIGINT,
      last_success_at BIGINT,
      baseline_preview_id TEXT,
      created_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS drive_link_current_album
      ON drive_album_links(album_id) WHERE state <> 'unlinked';
    CREATE UNIQUE INDEX IF NOT EXISTS drive_link_current_folder
      ON drive_album_links(connection_id,folder_id) WHERE state <> 'unlinked';
    CREATE INDEX IF NOT EXISTS drive_link_schedule
      ON drive_album_links(enabled,state,next_run_at);
    CREATE TABLE IF NOT EXISTS drive_source_files (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES drive_connections(id),
      drive_file_id TEXT NOT NULL,
      mapping_id TEXT NOT NULL REFERENCES drive_album_links(id),
      photo_id TEXT UNIQUE REFERENCES photos(id) ON DELETE SET NULL,
      source_generation INTEGER NOT NULL DEFAULT 1,
      imported_generation INTEGER NOT NULL DEFAULT 0,
      reimport_intent_id TEXT,
      state TEXT NOT NULL DEFAULT 'active'
        CHECK(state IN ('active','missing_in_drive','detached','suppressed')),
      source_name TEXT NOT NULL DEFAULT '',
      mime TEXT NOT NULL DEFAULT '',
      size BIGINT,
      observed_version TEXT,
      imported_version TEXT,
      checksum TEXT,
      modified_time TEXT,
      last_seen_scan_id TEXT,
      error_code TEXT,
      created_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0,
      UNIQUE(connection_id,drive_file_id)
    );
    CREATE INDEX IF NOT EXISTS drive_source_mapping ON drive_source_files(mapping_id,state);
    CREATE TABLE IF NOT EXISTS drive_sync_jobs (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES drive_connections(id),
      mapping_id TEXT REFERENCES drive_album_links(id),
      kind TEXT NOT NULL CHECK(kind IN ('check','preview','apply')),
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN
        ('queued','running','awaiting_review','completed','completed_with_errors','retry_wait','canceled','failed')),
      request_key TEXT NOT NULL UNIQUE,
      attempt INTEGER NOT NULL DEFAULT 0,
      lease_owner TEXT,
      lease_until BIGINT,
      fence INTEGER NOT NULL DEFAULT 0,
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      connection_generation INTEGER NOT NULL,
      mapping_generation INTEGER,
      preview_id TEXT REFERENCES drive_sync_jobs(id),
      approval_id TEXT,
      expected_catalog_revision INTEGER,
      expected_selection_revision INTEGER,
      expected_submission_generation INTEGER,
      payload_json TEXT NOT NULL DEFAULT '{}',
      manifest_json TEXT,
      progress_json TEXT NOT NULL DEFAULT '{}',
      error_code TEXT,
      available_at BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0,
      finished_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS drive_job_claim ON drive_sync_jobs(status,available_at,lease_until,created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS drive_one_live_apply ON drive_sync_jobs(mapping_id)
      WHERE kind = 'apply' AND status IN ('queued','running','retry_wait');
    CREATE UNIQUE INDEX IF NOT EXISTS drive_one_running_mapping ON drive_sync_jobs(mapping_id)
      WHERE status = 'running';
    CREATE TABLE IF NOT EXISTS drive_job_requests (
      request_key TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES drive_sync_jobs(id),
      fingerprint TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS drive_sync_job_items (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES drive_sync_jobs(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL,
      action TEXT NOT NULL,
      version TEXT,
      checksum TEXT,
      source_generation INTEGER,
      ingest_operation_id TEXT,
      source_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error_code TEXT,
      created_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0,
      UNIQUE(job_id,file_id)
    );
    CREATE INDEX IF NOT EXISTS drive_items_status ON drive_sync_job_items(job_id,status,file_id);
    CREATE TABLE IF NOT EXISTS drive_sync_approvals (
      id TEXT PRIMARY KEY,
      preview_id TEXT NOT NULL UNIQUE REFERENCES drive_sync_jobs(id),
      job_id TEXT REFERENCES drive_sync_jobs(id),
      album_id TEXT NOT NULL REFERENCES albums(id),
      mapping_id TEXT NOT NULL REFERENCES drive_album_links(id),
      connection_generation INTEGER NOT NULL,
      mapping_generation INTEGER NOT NULL,
      catalog_revision INTEGER NOT NULL,
      selection_revision INTEGER NOT NULL,
      submission_generation INTEGER NOT NULL,
      manifest_json TEXT NOT NULL,
      approved_by TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL DEFAULT 0,
      invalidated_at BIGINT
    );
    CREATE TABLE IF NOT EXISTS drive_reimport_intents (
      id TEXT PRIMARY KEY,
      source_file_id TEXT NOT NULL REFERENCES drive_source_files(id),
      request_key TEXT NOT NULL UNIQUE,
      source_generation INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      preview_id TEXT REFERENCES drive_sync_jobs(id),
      created_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS photo_ingest_attempts (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      album_id TEXT NOT NULL REFERENCES albums(id),
      target_photo_id TEXT,
      source_file_id TEXT REFERENCES drive_source_files(id),
      source_generation INTEGER,
      job_id TEXT REFERENCES drive_sync_jobs(id),
      job_item_id TEXT REFERENCES drive_sync_job_items(id),
      candidate_prefix TEXT NOT NULL,
      storage_identity TEXT NOT NULL,
      process_id TEXT,
      writer_token TEXT,
      fence INTEGER,
      state TEXT NOT NULL DEFAULT 'prepared',
      photo_id TEXT,
      result_json TEXT,
      retired_at BIGINT,
      created_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0,
      UNIQUE(operation_id,attempt)
    );
    CREATE INDEX IF NOT EXISTS photo_ingest_unresolved ON photo_ingest_attempts(state,process_id);
    CREATE UNIQUE INDEX IF NOT EXISTS photo_ingest_published_operation
      ON photo_ingest_attempts(operation_id) WHERE state = 'published';
    CREATE TABLE IF NOT EXISTS gallery_submissions (
      id TEXT PRIMARY KEY,
      album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      request_key TEXT NOT NULL,
      catalog_revision INTEGER NOT NULL,
      selection_revision INTEGER NOT NULL,
      submission_generation INTEGER NOT NULL,
      selected_photos TEXT NOT NULL,
      stale INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT 0,
      UNIQUE(album_id,request_key)
    );
    CREATE INDEX IF NOT EXISTS gallery_submission_album ON gallery_submissions(album_id,created_at);
    CREATE TABLE IF NOT EXISTS drive_worker_heartbeats (
      id TEXT PRIMARY KEY,
      process_id TEXT NOT NULL,
      heartbeat_at BIGINT NOT NULL,
      started_at BIGINT NOT NULL,
      state TEXT NOT NULL,
      storage_identity TEXT NOT NULL
    );
  `);
  await addColumns(db, 'drive_connections', {
    folder_scope: "TEXT NOT NULL DEFAULT 'root' CHECK(folder_scope IN ('root','shared'))",
  });
  if (db.cloud) {
    await db.exec(driveTables.map(table => `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`).join('\n'));
  }
  await db.run("UPDATE albums SET drive_review_required = 1 WHERE selection_status = 'submitted' AND drive_review_required = 0");
  await installDriveRevisionTriggers(db);
}
