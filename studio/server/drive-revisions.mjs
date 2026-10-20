// Database triggers cover legacy writers as well as the importer. They change
// counters inside the writer transaction; worker approvals read the new counter
// after their own writes instead of bypassing trigger updates.
export async function installDriveRevisionTriggers(db) {
  const albumFields = ['title', 'category', 'description', 'status', 'password',
    'cover_id', 'client_name', 'event_date', 'slug'];
  const photoFields = ['album_id', 'filename', 'original', 'caption', 'width',
    'height', 'position', 'section_id', 'source'];
  if (db.cloud) {
    await installPostgres(db, albumFields, photoFields);
  } else {
    await installSqlite(db, albumFields, photoFields);
  }
}

async function installSqlite(db, albumFields, photoFields) {
  const changed = fields => fields.map(field => `OLD.${field} IS NOT NEW.${field}`).join(' OR ');
  const bump = expression => `
    UPDATE albums SET catalog_revision = catalog_revision + 1 WHERE id = ${expression};
    UPDATE gallery_submissions SET stale = 1 WHERE album_id = ${expression} AND stale = 0;
  `;
  const definitions = [
    ['drive_link_identity', `BEFORE UPDATE ON drive_album_links WHEN ${changed(['connection_id', 'album_id', 'folder_id'])}`, `
      SELECT RAISE(ABORT, 'Drive link identity is immutable; unlink and create a new mapping');
    `],
    ['drive_photos_insert', 'AFTER INSERT ON photos', bump('NEW.album_id')],
    ['drive_photos_delete', 'AFTER DELETE ON photos', bump('OLD.album_id')],
    ['drive_photos_update', `AFTER UPDATE ON photos WHEN ${changed(photoFields)}`, `
      ${bump('NEW.album_id')}
      UPDATE albums SET catalog_revision = catalog_revision + 1
        WHERE id = OLD.album_id AND OLD.album_id <> NEW.album_id;
      UPDATE gallery_submissions SET stale = 1
        WHERE album_id = OLD.album_id AND OLD.album_id <> NEW.album_id AND stale = 0;
    `],
    ['drive_sections_insert', 'AFTER INSERT ON album_sections', bump('NEW.album_id')],
    ['drive_sections_delete', 'AFTER DELETE ON album_sections', bump('OLD.album_id')],
    ['drive_sections_update', `AFTER UPDATE ON album_sections WHEN ${changed(['album_id', 'title', 'position'])}`, `
      ${bump('NEW.album_id')}
      UPDATE albums SET catalog_revision = catalog_revision + 1
        WHERE id = OLD.album_id AND OLD.album_id <> NEW.album_id;
      UPDATE gallery_submissions SET stale = 1
        WHERE album_id = OLD.album_id AND OLD.album_id <> NEW.album_id AND stale = 0;
    `],
    ['drive_album_catalog', `AFTER UPDATE ON albums WHEN ${changed(albumFields)}`, bump('NEW.id')],
    ['drive_album_hold_insert', "AFTER INSERT ON albums WHEN NEW.selection_status = 'submitted' AND NEW.drive_review_required = 0", `
      UPDATE albums SET drive_review_required = 1 WHERE id = NEW.id;
    `],
    ['drive_album_hold_update', "AFTER UPDATE ON albums WHEN NEW.selection_status = 'submitted' AND NEW.drive_review_required = 0", `
      UPDATE albums SET drive_review_required = 1 WHERE id = NEW.id;
    `],
    ['drive_selections_insert', 'AFTER INSERT ON selections', `
      UPDATE albums SET selection_revision = selection_revision + 1 WHERE id = NEW.album_id;
    `],
    ['drive_selections_delete', 'AFTER DELETE ON selections', `
      UPDATE albums SET selection_revision = selection_revision + 1 WHERE id = OLD.album_id;
    `],
    ['drive_selections_update', `AFTER UPDATE ON selections WHEN ${changed(['album_id', 'photo_id'])}`, `
      UPDATE albums SET selection_revision = selection_revision + 1 WHERE id = NEW.album_id;
      UPDATE albums SET selection_revision = selection_revision + 1
        WHERE id = OLD.album_id AND OLD.album_id <> NEW.album_id;
    `],
  ];
  for (const [name, condition, body] of definitions) {
    await db.exec(`CREATE TRIGGER IF NOT EXISTS ${name} ${condition} BEGIN ${body} END;`);
  }
}

async function installPostgres(db, albumFields, photoFields) {
  const changed = fields => fields.map(field => `OLD.${field} IS DISTINCT FROM NEW.${field}`).join(' OR ');
  await db.exec(`
    CREATE OR REPLACE FUNCTION drive_link_identity_changed() RETURNS trigger AS $$
    BEGIN
      IF ${changed(['connection_id', 'album_id', 'folder_id'])} THEN
        RAISE EXCEPTION 'Drive link identity is immutable; unlink and create a new mapping';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE OR REPLACE FUNCTION drive_catalog_row_changed() RETURNS trigger AS $$
    DECLARE current_album TEXT; previous_album TEXT;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        current_album := OLD.album_id;
      ELSE
        current_album := NEW.album_id;
      END IF;
      UPDATE albums SET catalog_revision = catalog_revision + 1 WHERE id = current_album;
      UPDATE gallery_submissions SET stale = 1 WHERE album_id = current_album AND stale = 0;
      IF TG_OP = 'UPDATE' AND OLD.album_id IS DISTINCT FROM NEW.album_id THEN
        previous_album := OLD.album_id;
        UPDATE albums SET catalog_revision = catalog_revision + 1 WHERE id = previous_album;
        UPDATE gallery_submissions SET stale = 1 WHERE album_id = previous_album AND stale = 0;
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
    CREATE OR REPLACE FUNCTION drive_album_changed() RETURNS trigger AS $$
    BEGIN
      IF NEW.selection_status = 'submitted' THEN
        NEW.drive_review_required := 1;
      END IF;
      IF TG_OP = 'UPDATE' THEN
        IF ${changed(albumFields)} THEN
          NEW.catalog_revision := OLD.catalog_revision + 1;
          UPDATE gallery_submissions SET stale = 1 WHERE album_id = NEW.id AND stale = 0;
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE OR REPLACE FUNCTION drive_selection_changed() RETURNS trigger AS $$
    DECLARE current_album TEXT;
    BEGIN
      IF TG_OP = 'DELETE' THEN current_album := OLD.album_id;
      ELSE current_album := NEW.album_id;
      END IF;
      UPDATE albums SET selection_revision = selection_revision + 1 WHERE id = current_album;
      IF TG_OP = 'UPDATE' AND OLD.album_id IS DISTINCT FROM NEW.album_id THEN
        UPDATE albums SET selection_revision = selection_revision + 1 WHERE id = OLD.album_id;
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);
  const triggers = [
    ['drive_link_identity', 'drive_album_links', 'BEFORE UPDATE', '', 'drive_link_identity_changed'],
    ['drive_photos_insert_delete', 'photos', 'AFTER INSERT OR DELETE', '', 'drive_catalog_row_changed'],
    ['drive_photos_update', 'photos', 'AFTER UPDATE', `WHEN (${changed(photoFields)})`, 'drive_catalog_row_changed'],
    ['drive_sections_insert_delete', 'album_sections', 'AFTER INSERT OR DELETE', '', 'drive_catalog_row_changed'],
    ['drive_sections_update', 'album_sections', 'AFTER UPDATE', `WHEN (${changed(['album_id', 'title', 'position'])})`, 'drive_catalog_row_changed'],
    ['drive_album_revision', 'albums', 'BEFORE INSERT OR UPDATE', '', 'drive_album_changed'],
    ['drive_selections_insert_delete', 'selections', 'AFTER INSERT OR DELETE', '', 'drive_selection_changed'],
    ['drive_selections_update', 'selections', 'AFTER UPDATE', `WHEN (${changed(['album_id', 'photo_id'])})`, 'drive_selection_changed'],
  ];
  // PostgreSQL has no CREATE TRIGGER IF NOT EXISTS. A metadata guard avoids
  // dropping triggers while another process is using the database.
  for (const [name, table, event, condition, fn] of triggers) {
    await db.exec(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${name}' AND tgrelid = '${table}'::regclass) THEN
        CREATE TRIGGER ${name} ${event} ON ${table} FOR EACH ROW ${condition} EXECUTE FUNCTION ${fn}();
      END IF;
    END $$;`);
  }
}
