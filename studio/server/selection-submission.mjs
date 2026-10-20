import {createHash} from 'node:crypto';
import {id} from './db.mjs';

const fail = (status, message) => Object.assign(new Error(message), {status});
const validRevision = value => /^(0|[1-9]\d*)$/.test(String(value ?? ''));
const same = (left, right) => String(left) === String(right);

export function selectionRevisions(album) {
  return {
    catalog_revision: Number(album.catalog_revision || 0),
    selection_revision: Number(album.selection_revision || 0),
    submission_generation: Number(album.submission_generation || 0),
    drive_review_required: Boolean(album.drive_review_required)
  };
}

export async function saveSubmission(tx, album, body, state, {requireRevisions = false} = {}) {
  const expectedPhotos = body.photos;
  if (expectedPhotos !== undefined && (
    !Array.isArray(expectedPhotos) ||
    expectedPhotos.some(photo => typeof photo !== 'string') ||
    new Set(expectedPhotos).size !== expectedPhotos.length
  )) {
    throw fail(422, 'Danh sách ảnh không hợp lệ. Vui lòng kiểm tra rồi gửi lại.');
  }

  // Older galleries may submit their saved picks until Drive is connected.
  // New clients always send revisions; Drive albums never accept a blind submit.
  const linked = await tx.get('SELECT id FROM drive_album_links WHERE album_id=? LIMIT 1', [album.id]);
  const supplied = body.catalog_revision !== undefined || body.selection_revision !== undefined;
  const strict = requireRevisions || Boolean(linked) || supplied;
  if (strict && (!validRevision(body.catalog_revision) || !validRevision(body.selection_revision))) {
    return {conflict: true, ...state};
  }
  if (body.request_key !== undefined && (
    typeof body.request_key !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(body.request_key)
  )) {
    throw fail(422, 'Mã gửi lựa chọn không hợp lệ. Hãy tải lại trang.');
  }
  const expectedCatalog = strict ? body.catalog_revision : album.catalog_revision;
  const expectedSelection = strict ? body.selection_revision : album.selection_revision;
  const requestKey = body.request_key || createHash('sha256')
    .update(JSON.stringify([album.id, expectedCatalog, expectedSelection, state.selected]))
    .digest('hex');
  const previous = await tx.get(
    'SELECT * FROM gallery_submissions WHERE album_id=? AND request_key=?',
    [album.id, requestKey]
  );
  if (previous) {
    const previousPhotos = new Set(JSON.parse(previous.selected_photos).map(photo => photo.id));
    if (!same(previous.catalog_revision, expectedCatalog) ||
        !same(previous.selection_revision, expectedSelection) ||
        (expectedPhotos !== undefined && (expectedPhotos.length !== previousPhotos.size ||
          expectedPhotos.some(photo => !previousPhotos.has(photo))))) {
      throw fail(409, 'Lượt gửi này đã được dùng với nội dung khác. Hãy kiểm tra lại bộ ảnh.');
    }
    return {...state, submission_id: previous.id, submission_stale: Boolean(previous.stale), reused: true};
  }
  if ((strict && (!same(album.catalog_revision, expectedCatalog) ||
      !same(album.selection_revision, expectedSelection))) ||
      (expectedPhotos !== undefined && (
        expectedPhotos.length !== state.selected.length ||
        expectedPhotos.some(photo => !state.selected.includes(photo))
      ))) {
    return {conflict: true, ...state};
  }
  if (!state.selected.length) {
    throw fail(422, 'Vui lòng chọn ít nhất một ảnh trước khi gửi danh sách.');
  }

  const photos = await tx.all(
    'SELECT p.id,p.filename,p.original FROM photos p JOIN selections s ON s.photo_id=p.id AND s.album_id=p.album_id WHERE p.album_id=? ORDER BY p.position,p.id',
    [album.id]
  );
  const generation = Number(album.submission_generation || 0) + 1;
  const submissionId = id();
  await tx.run(
    "UPDATE albums SET selection_status='submitted',drive_review_required=1,submission_generation=? WHERE id=?",
    [generation, album.id]
  );
  await tx.run(
    'INSERT INTO gallery_submissions(id,album_id,request_key,catalog_revision,selection_revision,submission_generation,selected_photos,stale,created_at) VALUES(?,?,?,?,?,?,?,0,?)',
    [submissionId, album.id, requestKey, album.catalog_revision, album.selection_revision, generation, JSON.stringify(photos), Date.now()]
  );
  return {
    ...state,
    selection_status: 'submitted',
    drive_review_required: true,
    submission_generation: generation,
    submission_id: submissionId,
    submission_stale: false
  };
}
