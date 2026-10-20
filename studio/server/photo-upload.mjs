import {createHash} from 'node:crypto';
import {id} from './db.mjs';
import {optimizePhoto, photoOptimization} from './image-optimizer.mjs';
import {decodePreparedPhoto, isPreparedPhoto} from './prepared-photo.mjs';
import {ingestPhoto} from './photo-ingest.mjs';
import {quietUploadTrace} from './upload-trace.mjs';

// Only the multipart adapter decodes Latin-1. Drive names are already Unicode.
const multipartName = value => {
  if ([...value].some(character => character.codePointAt(0) > 255)) return value;
  try { return new TextDecoder('utf-8', {fatal: true}).decode(Buffer.from(value, 'latin1')); }
  catch { return value; }
};
const nameKey = value => value.normalize('NFC').toLowerCase();
const issue = (message, code = 'UPLOAD_CONFLICT') => Object.assign(Error(message), {code, status: code === 'CATALOG_REQUIRED' ? 422 : 409, retryable: false});

export async function uploadPhoto({db, storage, mediaControl, albumId, file, uploadKey, policy, sectionId, targetId, expectedRevision, trace = quietUploadTrace, onCleanup = () => {}}) {
  const bytesHash = createHash('sha256').update(file.buffer).digest('hex');
  const hash = 'v2:' + createHash('sha256').update(JSON.stringify({bytesHash, targetId: targetId || null, policy, sectionId: sectionId || null, original: multipartName(file.originalname).normalize('NFC')})).digest('hex');
  const matchesHash = stored => stored === hash || (!targetId && stored === bytesHash);
  const previous = async tx => {
    if (!uploadKey) return;
    const receipt = await tx.get('SELECT file_hash,result FROM photo_upload_receipts WHERE album_id=? AND upload_key=?', [albumId, uploadKey]);
    if (receipt) {
      if (!matchesHash(receipt.file_hash)) throw issue('Lượt tải này đã lưu một tệp hoặc thao tác khác. Hãy chọn lại ảnh.');
      return {...JSON.parse(receipt.result), reused: true};
    }
    const old = await tx.get('SELECT * FROM photos WHERE album_id=? AND upload_key=?', [albumId, uploadKey]);
    if (old) {
      if (!matchesHash(old.upload_hash)) throw issue('Lượt tải này đã lưu một tệp hoặc thao tác khác. Hãy chọn lại ảnh.');
      return {success: true, id: old.id, reused: true, optimization: photoOptimization(old)};
    }
  };
  const remember = async (tx, result) => {
    if (uploadKey) await tx.run('INSERT INTO photo_upload_receipts(album_id,upload_key,file_hash,result) VALUES(?,?,?,?)', [albumId, uploadKey, hash, JSON.stringify(result)]);
    return result;
  };
  const replay = await trace.run('deduplicate', () => previous(db));
  if (replay) return replay;
  if (targetId && (expectedRevision == null || expectedRevision === '' || !Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) < 0)) throw issue('Cần phiên bản bộ ảnh để thay đúng ảnh.', 'CATALOG_REQUIRED');
  const prepared = /\.ccphoto$/i.test(file.originalname) || isPreparedPhoto(file.buffer);
  const decoded = prepared ? await trace.run('prepared_validate', () => decodePreparedPhoto(file.buffer)) : await optimizePhoto(file.buffer, {runStage: (name, fn) => trace.run('optimize_' + name, fn)});
  const original = (decoded.originalName || multipartName(file.originalname)).trim().normalize('NFC').slice(0, 180);
  const resolveTarget = async (tx, originalName) => {
    if (targetId) return null;
    const matches = (await tx.all("SELECT * FROM photos WHERE album_id=? AND source='manual' ORDER BY position,id", [albumId])).filter(photo => nameKey(photo.original) === nameKey(originalName));
    if (matches.length && policy === 'skip') return {result: {success: true, id: matches[0].id, skipped: true, reused: false}};
    if (matches.length > 1) throw issue('Có nhiều ảnh cùng tên trong bộ ảnh. Hãy chọn ảnh cụ thể để thay.', 'AMBIGUOUS_FILENAME');
    return {target: matches[0]};
  };
  // Validate even skipped inputs, but avoid remote PUTs for known duplicates.
  if (!targetId && policy === 'skip') {
    const skipped = await db.transaction(async tx => {
      if (!await tx.get('SELECT id FROM albums WHERE id=?' + (tx.cloud ? ' FOR UPDATE' : ''), [albumId])) throw issue('Bộ ảnh không còn tồn tại.', 'ALBUM_REMOVED');
      const old = await previous(tx);
      if (old) return old;
      const resolved = await resolveTarget(tx, original);
      return resolved?.result ? remember(tx, resolved.result) : null;
    });
    if (skipped) return skipped;
  }
  const result = await ingestPhoto({db, storage, mediaControl, albumId, source: 'manual', sourceName: original,
    operationId: 'manual:' + albumId + ':' + (uploadKey || id()), decoded, targetPhotoId: targetId,
    expectedRevision, sectionId, uploadKey, uploadHash: hash, previous, remember, resolveTarget, trace, onCleanup});
  trace.mark('saved');
  return result;
}
