import {id} from './db.mjs';
import {encodeDrivePhoto} from './drive-image-encoder.mjs';
import {validateSection} from './album-sections.mjs';
import {quietUploadTrace} from './upload-trace.mjs';

const issue = (message, code = 'UPLOAD_CONFLICT') => Object.assign(Error(message), {code, status: 409, retryable: false});
const suffixes = ['.webp', '-thumb.webp', '-download.jpg'];

export async function retirePhotoFiles(tx, photo, cleanupId = id()) {
  await tx.run("INSERT INTO photo_cleanup(photo_id,filename,has_download,kind) VALUES(?,?,?,'retired') ON CONFLICT(photo_id) DO NOTHING", [cleanupId, photo.filename, photo.download_bytes == null ? 0 : 1]);
}

// Storage is immutable. An album transaction is the sole visibility boundary;
// the caller's guard and publication receipt run inside that same transaction.
export async function ingestPhoto(options) {
  const {db, storage, mediaControl, albumId, source = 'google_drive', sourceName,
    inputPath, inputPolicy, signal, targetPhotoId, expectedFilename, operationId = id(),
    sourceId, sourceGeneration, jobId, jobItemId, fence, guard, beforePublish, publish,
    resolveTarget, previous, remember, decoded, sectionId = null, uploadKey = null,
    uploadHash = null, expectedRevision, trace = quietUploadTrace, onCleanup = () => {}} = options;
  if (!['manual', 'google_drive'].includes(source)) throw issue('Invalid photo source');
  const execute = async () => {
    const candidate = id();
    let attemptId;
    let staged = false;
    let published = false;
    let publishing = false;
    const replay = async tx => {
      const existing = await previous?.(tx);
      if (existing) return existing;
      const receipt = await tx.get("SELECT result_json FROM photo_ingest_attempts WHERE operation_id=? AND state='published' ORDER BY attempt LIMIT 1", [operationId]);
      return receipt?.result_json ? {...JSON.parse(receipt.result_json), reused: true} : null;
    };
    const albumLock = async tx => {
      const album = await tx.get('SELECT * FROM albums WHERE id=?' + (tx.cloud ? ' FOR UPDATE' : ''), [albumId]);
      if (!album) throw issue('Bộ ảnh không còn tồn tại.', 'ALBUM_REMOVED');
      return album;
    };
    try {
      signal?.throwIfAborted();
      const existing = await replay(db);
      if (existing) return existing;
      const result = decoded || await encodeDrivePhoto(inputPath, {policy: inputPolicy, signal});
      const original = String(result.originalName || sourceName || '').trim().normalize('NFC').slice(0, 180);
      const optimization = result.optimization;
      await db.transaction(async tx => {
        await albumLock(tx);
        const latest = await tx.get('SELECT MAX(attempt) AS attempt FROM photo_ingest_attempts WHERE operation_id=?', [operationId]);
        attemptId = id();
        const writer = mediaControl?.writerContext?.();
        const now = Date.now();
        await tx.run('INSERT INTO photo_ingest_attempts(id,operation_id,attempt,album_id,target_photo_id,source_file_id,source_generation,job_id,job_item_id,candidate_prefix,storage_identity,process_id,writer_token,fence,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [attemptId, operationId, Number(latest?.attempt || 0) + 1, albumId, targetPhotoId || null, sourceId || null, sourceGeneration ?? null, jobId || null, jobItemId || null, candidate, mediaControl?.identity || storage.identity || 'untracked-test', mediaControl?.processId || null, writer?.token || null, fence ?? null, 'prepared', now, now]);
      });
      staged = true;
      for (const [index, bytes] of [result.data, result.thumbnail, result.download].entries()) {
        signal?.throwIfAborted();
        await trace.run(['store_webp', 'store_thumbnail', 'store_jpeg'][index], () => storage.put(candidate + suffixes[index], bytes, {signal}));
      }
      await db.run("UPDATE photo_ingest_attempts SET state='stored',updated_at=? WHERE id=?", [Date.now(), attemptId]);
      await beforePublish?.({candidate, optimization});
      signal?.throwIfAborted();
      publishing = true;
      const outcome = await db.transaction(async tx => {
        const album = await albumLock(tx);
        const existing = await replay(tx);
        if (existing) return existing;
        if (expectedRevision != null && Number(album.catalog_revision) !== Number(expectedRevision)) throw issue('Bộ ảnh đã thay đổi. Hãy tải lại trước khi thay ảnh.', 'CATALOG_CHANGED');
        const resolved = resolveTarget ? await resolveTarget(tx, original) : null;
        if (resolved?.result) return remember ? remember(tx, resolved.result) : resolved.result;
        const target = resolved?.target || (targetPhotoId ? await tx.get('SELECT * FROM photos WHERE id=? AND album_id=?', [targetPhotoId, albumId]) : null);
        if (targetPhotoId && !target) throw issue('Ảnh cần thay đã bị xóa.', 'PHOTO_REMOVED');
        if (target && target.source !== source) throw issue('Ảnh thuộc nguồn khác. Hãy ngắt liên kết trước khi thay ảnh.', 'SOURCE_CONFLICT');
        if (target && expectedFilename != null && target.filename !== expectedFilename) throw issue('Ảnh đã thay đổi trong lúc xử lý.', 'PHOTO_CHANGED');
        await guard?.(tx, {album, target, original, candidate});
        signal?.throwIfAborted();
        const section = target ? target.section_id : await validateSection(tx, albumId, sectionId);
        trace.mark('database_insert');
        if (target) {
          await tx.run('UPDATE photos SET filename=?,width=?,height=?,source_bytes=?,image_bytes=?,thumb_bytes=?,download_bytes=?' + (source === 'google_drive' ? ',original=?' : '') + ' WHERE id=?', [candidate, optimization.width, optimization.height, optimization.source_bytes, optimization.image_bytes, optimization.thumb_bytes, optimization.download_bytes, ...(source === 'google_drive' ? [original] : []), target.id]);
          await retirePhotoFiles(tx, target);
        } else {
          await tx.run('INSERT INTO photos(id,album_id,filename,original,caption,width,height,position,upload_key,upload_hash,section_id,source_bytes,image_bytes,thumb_bytes,download_bytes,source) SELECT ?,?,?,?,?,?,?,COALESCE(MAX(position),-1)+1,?,?,?,?,?,?,?,? FROM photos WHERE album_id=?', [candidate, albumId, candidate, original, original.replace(/\.[^.]+$/, ''), optimization.width, optimization.height, uploadKey, uploadHash, section, optimization.source_bytes, optimization.image_bytes, optimization.thumb_bytes, optimization.download_bytes, source, albumId]);
          await tx.run('UPDATE albums SET cover_id=? WHERE id=? AND cover_id IS NULL', [candidate, albumId]);
        }
        const response = {success: true, id: target?.id || candidate, photoId: target?.id || candidate, filename: candidate, reused: false, replaced: !!target, optimization};
        await publish?.(tx, response);
        await tx.run("UPDATE photo_ingest_attempts SET state='published',photo_id=?,result_json=?,updated_at=? WHERE id=?", [response.id, JSON.stringify(response), Date.now(), attemptId]);
        return remember ? remember(tx, response) : response;
      });
      published = !outcome.reused && !outcome.skipped;
      if (outcome.replaced) onCleanup();
      return outcome;
    } finally {
      if (staged && !published) {
        trace.mark('rollback');
        // A failed COMMIT response may have published all three files. Acquire
        // the album lock before deciding; database uncertainty protects bytes.
        const unused = await db.transaction(async tx => {
          await tx.get('SELECT id FROM albums WHERE id=?' + (tx.cloud ? ' FOR UPDATE' : ''), [albumId]);
          return !await tx.get('SELECT id FROM photos WHERE filename=?', [candidate]);
        }).catch(async () => {
          await storage.markUncertainPrefix?.(candidate);
          await db.run("UPDATE photo_ingest_attempts SET state='unknown',updated_at=? WHERE id=? AND state<>'published'", [Date.now(), attemptId]).catch(() => {});
          return false;
        });
        if (unused) {
          let queued = false;
          try {
            await db.run("INSERT INTO photo_cleanup(photo_id,filename,has_download,kind,not_before) VALUES(?,?,1,'candidate',0) ON CONFLICT(photo_id) DO NOTHING", [candidate, candidate]);
            queued = true;
          } catch {}
          const removed = await Promise.allSettled(suffixes.map(suffix => storage.remove(candidate + suffix)));
          if (queued && removed.every(item => item.status === 'fulfilled')) await db.run('DELETE FROM photo_cleanup WHERE photo_id=?', [candidate]).catch(() => {});
          if (queued) {
            await db.run("UPDATE photo_ingest_attempts SET state='abandoned',updated_at=? WHERE id=? AND state<>'published'", [Date.now(), attemptId]).catch(() => {});
            onCleanup();
          }
        } else if (publishing) onCleanup();
      }
    }
  };
  return mediaControl ? mediaControl.run('photo-ingest', execute) : execute();
}
