import {driveFolderScope} from './drive-folder-scope.mjs';
import {randomUUID} from 'node:crypto';
import {hashPassword,verifyPassword} from './db.mjs';
import {driveError, driveId} from './drive-client.mjs';

export const DRIVE_ALBUM_CHECK_TTL_MS = 15 * 60 * 1000;
const lock = tx => tx.cloud ? ' FOR UPDATE' : '';
const parse = value => {
  try {
    const result = JSON.parse(value || '{}');
    return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  } catch { return {}; }
};
const albumFields = ['title', 'slug', 'category', 'description', 'status', 'password',
  'require_password', 'client_name', 'event_date'];
// The request can contain a gallery password. Never persist a fast digest
// which would bypass the password table's salted scrypt verification cost.
const canonicalRequest = body => JSON.stringify([
  'drive-album-create-v1', body.drive_check_job_id, body.drive_folder_id,
  ...albumFields.map(field => [field, body[field] === undefined ? null : body[field]]),
]);
const result = receipt => ({id: receipt.album_id, slug: receipt.slug,
  mapping_id: receipt.mapping_id, drive_check_job_id: receipt.check_job_id, drive_linked: true});

/**
 * Atomically consume one completed folder check and create an album + mapping.
 *
 * The authenticated album route must validate its normal album fields first.
 * createAlbum(tx) must reserve the slug and INSERT a NEW album using tx, returning
 * {id, slug}; it must not start another transaction, use db, or touch existing
 * albums. Password hashing/normalization remain the route's responsibility.
 *
 * body contains normal album fields plus drive_check_job_id, drive_folder_id and
 * request_key. Returns {id, slug, mapping_id, drive_check_job_id, drive_linked}.
 * Exact retries return the persisted result without calling createAlbum again.
 * No preview, apply, schedule, or baseline approval is created here.
 */
export async function createAlbumFromDriveCheck(db, body, createAlbum, {env = process.env, now = Date.now} = {}) {
  if (env.DRIVE_SYNC_ENABLED !== 'true') throw driveError('drive_feature_disabled', 503);
  if (!body || typeof body.request_key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.request_key)) {
    throw driveError('drive_invalid_request_key', 422);
  }
  const checkId = driveId(body.drive_check_job_id);
  const folderId = driveId(body.drive_folder_id);
  if (typeof createAlbum !== 'function') throw new TypeError('createAlbum(tx) is required');
  // Namespace excludes all user-facing Drive request keys (which disallow ':').
  const requestKey = 'album-create:' + body.request_key;
  const canonical = canonicalRequest(body);

  return db.transaction(async tx => {
    // Existing operations lock album -> connection -> mapping -> job. Our album
    // does not exist yet: lock connection first and never lock an existing album.
    // Link workers use this same connection lock before checking folder ownership.
    const connection = await tx.get('SELECT * FROM drive_connections WHERE id=?' + lock(tx), ['studio']);
    if (!connection) throw driveError('drive_not_configured');
    const previous = await tx.get('SELECT * FROM drive_job_requests WHERE request_key=?', [requestKey]);
    if (previous) {
      if (!previous.fingerprint.startsWith('scrypt:v1:') || !verifyPassword(canonical,previous.fingerprint.slice(10)) || previous.job_id !== checkId) throw driveError('drive_request_conflict');
      const previousJob = await tx.get('SELECT progress_json FROM drive_sync_jobs WHERE id=? AND connection_id=?', [checkId, connection.id]);
      const receipt = parse(previousJob?.progress_json).album_creation;
      if (!receipt || receipt.request_key !== body.request_key || receipt.check_job_id !== checkId || receipt.folder_id !== folderId) {
        throw driveError('drive_request_conflict');
      }
      // Deletion/unlinking must never cause a replay to recreate or relink data.
      if (!await tx.get('SELECT id FROM albums WHERE id=?', [receipt.album_id])) throw driveError('drive_album_unavailable', 404);
      return result(receipt);
    }
    if (connection.status !== 'active') throw driveError('drive_connection_not_ready');
    const rootId = driveId(connection.root_folder_id);
    const scope = driveFolderScope(connection);
    const check = await tx.get('SELECT * FROM drive_sync_jobs WHERE id=? AND connection_id=?' + lock(tx), [checkId, connection.id]);
    const payload = parse(check?.payload_json);
    const progress = parse(check?.progress_json);
    if (!check || check.kind !== 'check' || check.status !== 'completed' || check.mapping_id != null ||
        Number(check.cancel_requested) !== 0 || check.error_code || payload.operation !== 'inspect-folder' ||
        payload.folderId !== folderId || progress.checked !== true || progress.linked === true ||
        progress.folder?.id !== folderId || typeof progress.folder?.name !== 'string') {
      throw driveError('drive_folder_check_invalid');
    }
    // Connection updates always advance generation, binding legacy checks to the
    // checked root and service account. New jobs may additionally snapshot root.
    if (progress.scope !== undefined && progress.scope !== scope ||
        Number(check.connection_generation) !== Number(connection.generation) ||
        payload.rootFolderId !== undefined && payload.rootFolderId !== rootId ||
        progress.rootFolderId !== undefined && progress.rootFolderId !== rootId) {
      throw driveError('drive_folder_check_stale');
    }
    const timestamp = now();
    const finished = Number(check.finished_at);
    if (!Number.isSafeInteger(finished) || finished <= 0 || finished > timestamp || timestamp - finished > DRIVE_ALBUM_CHECK_TTL_MS) {
      throw driveError('drive_folder_check_expired');
    }
    if (progress.album_creation) throw driveError('drive_request_conflict');
    const occupied = await tx.get("SELECT id FROM drive_album_links WHERE connection_id=? AND folder_id=? AND state<>'unlinked'", [connection.id, folderId]);
    if (occupied) throw driveError('drive_folder_already_linked');

    const album = await createAlbum(tx);
    const saved = album?.id && await tx.get('SELECT id,slug,status FROM albums WHERE id=?', [album.id]);
    if (!saved || saved.slug !== album.slug || !saved.slug || saved.status === 'archived') throw driveError('drive_album_unavailable');
    const mappingId = randomUUID();
    await tx.run(`INSERT INTO drive_album_links
      (id,connection_id,album_id,folder_id,state,enabled,baseline_preview_id,next_run_at,created_at,updated_at)
      VALUES(?,?,?,?,'attached',1,NULL,NULL,?,?)`, [mappingId, connection.id, album.id, folderId, timestamp, timestamp]);
    const receipt = {request_key: body.request_key, check_job_id: checkId, album_id: album.id,
      slug: album.slug, mapping_id: mappingId, folder_id: folderId, root_folder_id: rootId, folder_scope: scope,
      connection_generation: Number(connection.generation), created_at: timestamp};
    await tx.run('UPDATE drive_sync_jobs SET progress_json=? WHERE id=?', [JSON.stringify({...progress, album_creation: receipt}), checkId]);
    await tx.run('INSERT INTO drive_job_requests(request_key,job_id,fingerprint,created_at) VALUES(?,?,?,?)',
      [requestKey, checkId, 'scrypt:v1:'+hashPassword(canonical), timestamp]);
    return result(receipt);
  });
}
