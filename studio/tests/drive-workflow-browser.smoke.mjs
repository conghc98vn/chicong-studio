import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import express from 'express';
import sharp from 'sharp';
import {openDatabase} from '../server/db.mjs';
import {createMediaControl} from '../server/media-control.mjs';
import {createDriveJobs} from '../server/drive-jobs.mjs';
import {createDriveWorker} from '../server/drive-worker.mjs';
import {registerDriveRoutes} from '../server/drive-routes.mjs';
import {registerDriveComparisonRoutes} from '../server/drive-comparisons.mjs';
import {DRIVE_FOLDER} from '../server/drive-client.mjs';

// Exercise the production panel, route handlers and comparison worker with an
// isolated database. Only Drive itself and the test admin session are fixtures.
const playwright = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const directory = await mkdtemp(path.join(tmpdir(), 'drive-workflow-browser-'));
const db = await openDatabase(directory);
const control = await createMediaControl(db, 'drive-workflow-browser');
const jobs = createDriveJobs(db);
const bytes = await sharp({create: {width: 120, height: 80, channels: 3, background: '#aa3344'}}).jpeg().toBuffer();
const currentThumb = await sharp({create: {width: 120, height: 80, channels: 3, background: '#3355aa'}}).webp().toBuffer();
const checksum = createHash('md5').update(bytes).digest('hex');
const files = Array.from({length: 53}, (_, index) => ({id: `file${String(index).padStart(3, '0')}`,
  name: `Photo-${index}-${'long-name-'.repeat(12)}.jpg`, version: '2', mimeType: 'image/jpeg',
  size: String(bytes.length), md5Checksum: checksum, parents: ['folder'], capabilities: {canDownload: true}}));
let downloads = 0;
const drive = {serviceAccountEmail: 'test@studio.iam.gserviceaccount.com',
  async getFile(id) { return structuredClone(files.find(file => file.id === id) || {id, name: id, mimeType: DRIVE_FOLDER, parents: id === 'root' ? [] : ['root']}); },
  async listFiles() { return {files: structuredClone(files)}; },
  async download(id, destination) { downloads++; await writeFile(destination, bytes, {flag: 'wx', mode: 0o600}); return {bytes: bytes.length, checksum}; }
};
const storage = {async get() { return currentThumb; }, async put() { throw Error('Comparison must not publish'); }};
const env = {DRIVE_SYNC_ENABLED: 'true', DRIVE_SYNC_TEMP_DIR: path.join(directory, 'temporary')};
const worker = createDriveWorker({db, storage, control, drive, jobs, env, logger: () => {}});
const app = express();
app.use(express.json());
app.use('/api/admin', (request, response, next) => {
  if (!request.headers.cookie?.includes('test-admin=yes')) return response.status(401).json({error: 'Unauthorized'});
  request.admin = 'browser-smoke';
  next();
});
registerDriveRoutes(app, {db, control, env});
registerDriveComparisonRoutes(app, {db, storage, control, env, jobs});
app.use((error, request, response, next) => response.status(error.status || 500).json({error: error.code || error.message}));
app.use('/app', express.static(fileURLToPath(new URL('../web/', import.meta.url))));
app.get('/', (request, response) => response.send(`<!doctype html><html lang="vi"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/style.css"><link rel="stylesheet" href="/app/drive-sync.css"></head><body><main style="padding:16px"><div id="panel"></div></main><script type="module">import {mountDrivePanel} from '/app/drive-panel.mjs'; mountDrivePanel(document.querySelector('#panel'), {album: {id: 'album'}});</script></body></html>`));
const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  await db.run("INSERT INTO albums(id,title,category,status) VALUES('album','Browser workflow','wedding','private')");
  await db.run("INSERT INTO drive_connections(id,service_account_email,root_folder_id,status) VALUES('studio',?,'root','active')", [drive.serviceAccountEmail]);
  await db.run("INSERT INTO drive_album_links(id,connection_id,album_id,folder_id) VALUES('mapping','studio','album','folder')");
  for (const [index, file] of files.entries()) {
    await db.run("INSERT INTO photos(id,album_id,filename,original,width,height,source) VALUES(?,'album',?,'old.jpg',120,80,'google_drive')", ['photo' + index, 'current' + index]);
    await db.run("INSERT INTO drive_source_files(id,connection_id,drive_file_id,mapping_id,photo_id,imported_generation,imported_version) VALUES(?,'studio',?,'mapping',?,1,'1')", ['source' + index, file.id, 'photo' + index]);
  }
  const album = await db.get("SELECT * FROM albums WHERE id='album'");
  const manifest = {complete: true, count: 53, hash: 'browser-exact-preview', catalogRevision: album.catalog_revision, selectionRevision: album.selection_revision, submissionGeneration: album.submission_generation};
  const preview = await jobs.enqueue({mappingId: 'mapping', kind: 'preview', requestKey: 'browser-preview'});
  const lease = await jobs.claim('browser-fixture');
  await jobs.putItems(lease, files.map((file, index) => ({id: 'item' + index, fileId: file.id, action: index < 51 ? 'replace' : index === 51 ? 'rename' : 'unchanged', sourceGeneration: 1, version: '2', source: {sourceId: 'source' + index, file}})));
  await jobs.finish(lease, {status: 'awaiting_review', manifest, progress: {total: 53}});
  browser = await playwright.chromium.launch({channel: 'chrome', headless: true});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  await context.addCookies([{name: 'test-admin', value: 'yes', url: base}]);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let comparisonPosts = 0, comparisonReads = 0, retryPosts = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/comparison')) comparisonPosts++;
    if (request.method() === 'GET' && /\/comparisons\/[^/?]+$/.test(request.url())) comparisonReads++;
    if (request.method() === 'POST' && request.url().endsWith('/retry')) retryPosts++;
  });
  await page.goto(base);
  const action = name => page.locator(`[data-drive-action="${name}"]`);
  const feedback = page.locator('[data-drive-feedback]');
  const settled = () => feedback.filter({hasText: 'Đã cập nhật trạng thái.'}).waitFor();
  const refresh = async () => { await action('refresh').click(); await settled(); };
  const filter = async (kind, value) => { await page.locator(`[data-drive-filter="${kind}"]`).selectOption(value); await settled(); };
  const reviewed = page.locator('[data-drive-reviewed]');
  await reviewed.check();
  assert.equal(comparisonPosts, 0, 'Comparison is never requested in advance');
  assert.match(await page.locator('[data-drive-filter=action] option[value=replace]').textContent(), /\(51\)/);
  await action('items-next').click(); await settled();
  assert.equal(await page.locator('.drive-job tbody tr').count(), 3);
  await filter('action', 'replace');
  assert.equal(await page.locator('.drive-job tbody tr').count(), 50, 'Filter changes reset the page');
  assert.equal(await page.locator('[data-drive-page]').textContent(), 'File 1–50 / 51');
  await action('items-next').click(); await settled();
  assert.equal(await page.locator('.drive-job tbody tr').count(), 1);
  assert.equal(await action('items-next').isDisabled(), true);
  assert.equal(await reviewed.isChecked(), true);
  await filter('status', 'failed');
  assert.match(await page.locator('[data-drive-empty]').textContent(), /Không có file khớp/);
  assert.equal(await page.locator('[data-drive-page]').textContent(), '0 / 0 file');
  assert.equal(await action('items-next').isDisabled(), true);
  assert.equal(await reviewed.isChecked(), true);
  await filter('status', '');
  const compare = page.locator('[data-drive-compare="item0"]');
  await compare.click();
  await page.locator('.drive-comparison-loading').waitFor();
  await page.waitForFunction(() => document.activeElement?.matches('[data-comparison-action=close]'));
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.querySelector('.drive-comparison').contains(document.activeElement)), true, 'Keyboard focus stays inside the modal');
  assert.equal((await worker.runOnce()).status, 'completed');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-comparison-image]')].length === 2 && [...document.querySelectorAll('[data-comparison-image]')].every(img => img.complete && img.naturalWidth > 0));
  assert.equal(downloads, 1);
  assert.equal(await page.locator('[data-drive-job]').inputValue(), preview.id, 'Comparison does not select its background job');
  assert.equal(await reviewed.isChecked(), true);
  const imageUrl = await page.locator('[data-comparison-image]').first().getAttribute('src');
  assert.match(imageUrl, /\/api\/admin\/drive\/comparisons\//);
  assert.equal((await fetch(imageUrl)).status, 401, 'Comparison images require the admin session');
  for (const width of [390, 320]) {
    await page.setViewportSize({width, height: 844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Page fits ${width}px`);
    assert.equal(await page.locator('.drive-comparison').evaluate(dialog => dialog.scrollWidth > dialog.clientWidth), false, `Modal fits ${width}px`);
  }
  await page.keyboard.press('Escape');
  await page.locator('.drive-comparison').waitFor({state: 'detached'});
  assert.equal(await compare.evaluate(button => button === document.activeElement), true);
  const readsAfterClose = comparisonReads;
  await page.waitForTimeout(1700);
  assert.equal(comparisonReads, readsAfterClose, 'No comparison polling after close');
  // Closing while queued also stops the poll, including a response arriving later.
  await compare.click();
  await page.locator('.drive-comparison-loading').waitFor();
  await page.waitForTimeout(100);
  await page.locator('[data-comparison-action=close]').click();
  const readsWhileClosed = comparisonReads;
  await page.waitForTimeout(1700);
  assert.equal(comparisonReads, readsWhileClosed);
  const queuedComparison = await db.get("SELECT id FROM drive_sync_jobs WHERE kind='check' AND status='queued'");
  await jobs.cancel(queuedComparison.id);
  // A stale comparison invalidates the checkbox and offers a fresh preview.
  await db.run("UPDATE photos SET caption='Changed while reviewing' WHERE id='photo0'");
  await compare.click();
  await page.locator('.drive-comparison [role=alert]').filter({hasText: 'xem trước mới'}).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await reviewed.count(), 0);
  await action('fresh-preview').waitFor();
  assert.equal(await action('fresh-preview').isDisabled(), false);
  // Seed a completed apply job to test actual failed-only HTTP retry semantics.
  const currentAlbum = await db.get("SELECT * FROM albums WHERE id='album'");
  const retryManifest = {...manifest, count: 2, catalogRevision: currentAlbum.catalog_revision};
  const apply = await jobs.enqueue({mappingId: 'mapping', kind: 'apply', requestKey: 'browser-apply'});
  const applyLease = await jobs.claim('browser-fixture');
  await jobs.putItems(applyLease, [
    {fileId: files[0].id, action: 'replace', status: 'applied', sourceGeneration: 1, source: {sourceId: 'source0', file: files[0]}, result: {photoId: 'photo0'}},
    {fileId: files[1].id, action: 'replace', status: 'failed', sourceGeneration: 1, source: {sourceId: 'source1', file: files[1]}, errorCode: 'drive_temporary_failure'}
  ]);
  await jobs.finish(applyLease, {status: 'completed_with_errors', manifest: retryManifest, progress: {total: 2, applied: 1, failed: 1}});
  await refresh();
  await page.locator('[data-drive-job]').selectOption(apply.id); await settled();
  await filter('status', 'failed');
  assert.equal(await page.locator('.drive-job tbody tr').count(), 1);
  const receiptBefore = (await jobs.items(apply.id)).find(item => item.status === 'applied');
  await action('retry-failed').evaluate(button => { button.click(); button.click(); });
  await feedback.filter({hasText: 'Đã ghi nhận'}).waitFor();
  assert.equal(retryPosts, 1);
  const after = await jobs.items(apply.id);
  assert.deepEqual(after.find(item => item.status === 'applied'), receiptBefore);
  assert.equal(after.find(item => item.file_id === files[1].id).status, 'pending');
  assert.equal((await jobs.get(apply.id)).status, 'queued');
  assert.equal(await action('retry-failed').count(), 0);
  // Simulate another bounded failure and change a revision before retrying.
  await db.run("UPDATE drive_sync_jobs SET status='completed_with_errors' WHERE id=?", [apply.id]);
  await db.run("UPDATE drive_sync_job_items SET status='failed',error_code='drive_temporary_failure' WHERE job_id=? AND file_id=?", [apply.id, files[1].id]);
  await db.run("UPDATE albums SET selection_revision=selection_revision+1 WHERE id='album'");
  await refresh();
  await action('retry-failed').click();
  await feedback.filter({hasText: 'xem trước mới'}).waitFor();
  assert.equal(await action('retry-failed').isDisabled(), true);
  await action('fresh-preview').click();
  await feedback.filter({hasText: 'Đã ghi nhận'}).waitFor();
  assert.notEqual(await page.locator('[data-drive-job]').inputValue(), apply.id);
  assert.equal((await db.get("SELECT COUNT(*) AS count FROM photos")).count, 53, 'Comparisons and retry enqueue never publish images');
  assert.deepEqual(errors, []);
  console.log('PASS: live counts, combined filters, paging, preview approval retention, private before/after images, modal keyboard and mobile, close stops polling, stale preview recovery, failed-only retry and receipt preservation');
} finally {
  worker.stop();
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await control.close();
  await db.close();
  await rm(directory, {recursive: true, force: true});
}
