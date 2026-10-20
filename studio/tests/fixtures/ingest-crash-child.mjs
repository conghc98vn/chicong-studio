import sharp from 'sharp';
import path from 'node:path';
import {openDatabase} from '../../server/db.mjs';
import {createStorage} from '../../server/storage.mjs';
import {createMediaControl, trackedStorage} from '../../server/media-control.mjs';
import {optimizePhoto} from '../../server/image-optimizer.mjs';
import {ingestPhoto} from '../../server/photo-ingest.mjs';

const [directory, albumId] = process.argv.slice(2);
const db = await openDatabase(directory, {url: null});
const raw = createStorage(path.join(directory, 'uploads'), {MEDIA_STORAGE_PROVIDER: 'local'});
const control = await createMediaControl(db, raw.identity);
const storage = trackedStorage(db, raw, control);
const decoded = await optimizePhoto(await sharp({create: {width: 120, height: 80, channels: 3, background: '#44aa88'}}).jpeg().toBuffer());
await ingestPhoto({db, storage, mediaControl: control, albumId, sourceName: 'crash.jpg', operationId: 'crash-operation', decoded,
  beforePublish: async () => {
    process.send({staged: true, processId: control.processId});
    await new Promise(() => {});
  }
});
