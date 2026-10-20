import {validateSection} from './album-sections.mjs';
import {uploadPhoto} from './photo-upload.mjs';
import {quietUploadTrace} from './upload-trace.mjs';

const fail = (status, message) => Object.assign(new Error(message), {status});
const lockSuffix = db => db.cloud ? ' FOR UPDATE' : '';

export async function updatePhotoMetadata(db, photoId, input) {
  const found = await db.get('SELECT album_id FROM photos WHERE id=?', [photoId]);
  if (!found) throw fail(404, 'Không tìm thấy ảnh.');
  return db.transaction(async tx => {
    await tx.get('SELECT id FROM albums WHERE id=?' + lockSuffix(tx), [found.album_id]);
    const photo = await tx.get('SELECT * FROM photos WHERE id=? AND album_id=?', [photoId, found.album_id]);
    if (!photo) throw fail(404, 'Không tìm thấy ảnh.');
    const fields = [];
    const values = [];
    if (input.caption !== undefined) {
      fields.push('caption=?');
      values.push(typeof input.caption === 'string' ? input.caption.trim().slice(0, 300) : '');
    }
    if (Number.isInteger(input.position)) {
      fields.push('position=?');
      values.push(input.position);
    }
    if (input.section_id !== undefined) {
      fields.push('section_id=?');
      values.push(await validateSection(tx, photo.album_id, input.section_id));
    }
    if (fields.length) {
      await tx.run('UPDATE photos SET ' + fields.join(',') + ' WHERE id=?', [...values, photo.id]);
    }
    return {success: true};
  });
}

export function registerPhotoCatalogRoutes(app, {db, storage, mediaControl, routeWrapper, upload, deletedPhotos}) {
  app.post('/api/admin/albums/:id/move', routeWrapper(async (req, res) => {
    const result = await db.transaction(async tx => {
      const album = await tx.get('SELECT * FROM albums WHERE id=?' + lockSuffix(tx), [req.params.id]);
      if (!album) throw fail(404, 'Không tìm thấy bộ ảnh.');
      if (String(req.body.catalog_revision) !== String(album.catalog_revision)) {
        throw fail(409, 'Bộ ảnh đã thay đổi. Hãy cập nhật rồi sắp xếp lại.');
      }
      const photo = await tx.get('SELECT * FROM photos WHERE id=? AND album_id=?', [req.body.photo_id, album.id]);
      const neighbor = await tx.get('SELECT * FROM photos WHERE id=? AND album_id=?', [req.body.neighbor_id, album.id]);
      if (!photo || !neighbor || photo.id === neighbor.id || photo.section_id !== neighbor.section_id) {
        throw fail(422, 'Chọn hai ảnh liền kề trong cùng phần.');
      }
      const section = await tx.all(
        'SELECT id FROM photos WHERE album_id=? AND ' +
        (photo.section_id === null ? 'section_id IS NULL' : 'section_id=?') + ' ORDER BY position,id',
        photo.section_id === null ? [album.id] : [album.id, photo.section_id]
      );
      const positions = new Map(section.map((row, index) => [row.id, index]));
      if (Math.abs(positions.get(photo.id) - positions.get(neighbor.id)) !== 1) {
        throw fail(409, 'Thứ tự ảnh đã thay đổi. Hãy cập nhật bộ ảnh.');
      }
      if (photo.position === neighbor.position) {
        await tx.run(
          'WITH ranked AS (SELECT id,ROW_NUMBER() OVER(ORDER BY position,id)-1 AS next_position FROM photos WHERE album_id=?) ' +
          'UPDATE photos SET position=(SELECT next_position FROM ranked WHERE ranked.id=photos.id) WHERE album_id=?',
          [album.id, album.id]
        );
        photo.position = (await tx.get('SELECT position FROM photos WHERE id=?', [photo.id])).position;
        neighbor.position = (await tx.get('SELECT position FROM photos WHERE id=?', [neighbor.id])).position;
      }
      await tx.run('UPDATE photos SET position=? WHERE id=?', [neighbor.position, photo.id]);
      await tx.run('UPDATE photos SET position=? WHERE id=?', [photo.position, neighbor.id]);
      const current = await tx.get('SELECT catalog_revision FROM albums WHERE id=?', [album.id]);
      return {success: true, catalog_revision: Number(current.catalog_revision)};
    });
    res.json(result);
  }));

  app.post('/api/admin/photos/:id/replace', upload.single('photo'), routeWrapper(async (req, res) => {
    const photo = await db.get('SELECT * FROM photos WHERE id=?', [req.params.id]);
    if (!photo) throw fail(404, 'Không tìm thấy ảnh.');
    if (!req.file) throw fail(422, 'Chọn ảnh thay thế.');
    const revision = req.get('X-Catalog-Revision');
    if (!/^(0|[1-9]\d*)$/.test(revision || '')) throw fail(422, 'Hãy cập nhật bộ ảnh trước khi thay ảnh.');
    const requestKey = req.get('X-Upload-Key');
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(requestKey || '')) throw fail(422, 'Không nhận diện được lượt thay ảnh.');
    const result = await uploadPhoto({
      db,
      storage,
      mediaControl,
      albumId: photo.album_id,
      file: req.file,
      policy: 'overwrite',
      sectionId: photo.section_id,
      targetId: photo.id,
      expectedRevision: revision,
      uploadKey: requestKey,
      trace: req.uploadTrace || quietUploadTrace,
      onCleanup: () => deletedPhotos.schedule()
    });
    deletedPhotos.schedule();
    res.json(result);
  }));
}
