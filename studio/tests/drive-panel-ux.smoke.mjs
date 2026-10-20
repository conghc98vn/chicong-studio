import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';
import {createDriveWorker} from '../server/drive-worker.mjs';
import {DRIVE_FOLDER} from '../server/drive-client.mjs';

const playwright = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const directory = await mkdtemp(path.join(tmpdir(), 'drive-panel-ux-'));
const env = {DRIVE_SYNC_ENABLED: 'true', DRIVE_SYNC_BATCH_SIZE: '25'};
const fixture = await createApp({dataDir: directory, env, seed: false});
const server = fixture.app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const album = 'a'.repeat(32), otherAlbum = 'b'.repeat(32);
const jpeg = await sharp({create: {width: 120, height: 80, channels: 3, background: '#809074'}}).jpeg().toBuffer();
const checksum = createHash('md5').update(jpeg).digest('hex');
const files = Array.from({length: 51}, (_, index) => ({id: 'image' + String(index).padStart(3, '0'),
  name: `Studio-${index}-${'long-filename-'.repeat(15)}.jpg`, mimeType: 'image/jpeg', size: String(jpeg.length),
  version: '1', md5Checksum: checksum, parents: ['albumFolder'], capabilities: {canDownload: true}}));
const drive = {
  serviceAccountEmail: 'sync@test.iam.gserviceaccount.com',
  async getFile(id) { return structuredClone(files.find(file => file.id === id) || {
    id, name: id, mimeType: DRIVE_FOLDER, version: '1', parents: id === 'rootFolder' ? [] : ['rootFolder']
  }); },
  async listFiles() { return {files: structuredClone(files)}; },
  async download(id, destination) {
    await writeFile(destination, jpeg, {flag: 'wx', mode: 0o600});
    return {bytes: jpeg.length, checksum};
  }
};
const worker = createDriveWorker({db: fixture.db, storage: fixture.storage, control: fixture.mediaControl, drive, env, logger: () => {}});
let browser;
try {
  for (const id of [album, otherAlbum]) await fixture.db.run('INSERT INTO albums(id,title,category,status) VALUES(?,?,?,?)', [id, 'Drive UX test', 'wedding', 'private']);
  browser = await playwright.chromium.launch({channel: 'chrome', headless: true});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(15000);
  const request = async (url, data, method = 'POST') => {
    const response = await context.request.fetch(base + url, {method, headers: {Origin: base}, data});
    assert.ok(response.ok(), await response.text());
    return response.json();
  };
  await request('/api/admin/setup', {email: 'ux@test.local', password: 'ux-test-password-123'});
  await request('/api/admin/drive/connection', {service_account_email: drive.serviceAccountEmail, root_folder_id: 'rootFolder'}, 'PUT');
  await request('/api/admin/drive/check', {request_key: randomUUID()});
  assert.equal((await worker.runOnce()).status, 'completed');
  await request(`/api/admin/albums/${otherAlbum}/drive`, {folder_id: 'occupiedFolder', request_key: randomUUID()}, 'PUT');
  assert.equal((await worker.runOnce()).status, 'completed');
  await page.goto(base + '/admin#album/' + album);
  await page.locator('.album-drive-tool > summary').click();
  const action = name => page.locator(`[data-drive-action="${name}"]`);
  const input = page.locator('[data-drive-form=link] [name=folder]');
  const feedback = page.locator('[data-drive-feedback]');
  const refresh = async () => { await action('refresh').click(); await feedback.filter({hasText: 'Đã cập nhật trạng thái.'}).waitFor(); };
  let linkRequests = 0, statusRequests = 0, approveRequests = 0;
  page.on('request', req => {
    if (req.method() === 'PUT' && req.url() === base + `/api/admin/albums/${album}/drive`) linkRequests++;
    if (req.url() === base + '/api/admin/drive/status') statusRequests++;
    if (req.method() === 'POST' && req.url().endsWith('/drive/approve')) approveRequests++;
  });
  await input.fill('https://drive.google.com/file/d/image001/view');
  await page.locator('[data-drive-form=link] button.btn').click();
  await feedback.filter({hasText: 'không dùng link của một ảnh'}).waitFor();
  assert.equal(linkRequests, 0);
  await input.fill('https://drive.google.com/drive/folders/occupiedFolder');
  await page.locator('[data-drive-form=link]').evaluate(form => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await feedback.filter({hasText: 'Đã ghi nhận'}).waitFor();
  assert.equal(linkRequests, 1);
  assert.equal(await page.locator('[data-drive-form=link] button.btn').isDisabled(), true);
  assert.equal((await worker.runOnce()).status, 'failed');
  await refresh();
  await page.locator('.drive-job .form-error').filter({hasText: 'đã gắn với bộ ảnh khác'}).waitFor();
  assert.equal(await input.inputValue(), 'https://drive.google.com/drive/folders/occupiedFolder');
  assert.match(await page.locator('[data-drive-job] option:checked').textContent(), /Kiểm tra và gắn folder/);
  await input.fill('https://drive.google.com/drive/u/0/folders/albumFolder?usp=sharing');
  await page.locator('[data-drive-form=link] button.btn').click();
  await feedback.filter({hasText: 'Đã ghi nhận'}).waitFor();
  assert.equal((await worker.runOnce()).status, 'completed');
  await refresh();
  assert.equal(await action('sync').count(), 0);
  await action('preview').click();
  await feedback.filter({hasText: 'Đã ghi nhận'}).waitFor();
  assert.equal(await action('preview').isDisabled(), true);
  assert.equal((await worker.runOnce()).status, 'awaiting_review');
  await refresh();
  const reviewed = page.locator('[data-drive-reviewed]');
  assert.equal(await action('approve').isDisabled(), true);
  await reviewed.check();
  const beforeRefresh = statusRequests;
  await refresh();
  assert.equal(statusRequests - beforeRefresh, 1, 'A manual refresh must not issue duplicate status requests');
  assert.equal(await reviewed.isChecked(), true);
  assert.equal(await action('approve').isDisabled(), false);
  await action('items-next').click();
  await feedback.filter({hasText: 'Đã cập nhật trạng thái.'}).waitFor();
  assert.equal(await page.locator('.drive-job tbody tr').count(), 1);
  assert.equal(await action('items-next').isDisabled(), true);
  assert.equal(await reviewed.isChecked(), true);
  await action('items-prev').click();
  await feedback.filter({hasText: 'Đã cập nhật trạng thái.'}).waitFor();
  await page.locator('[data-drive-sources] > summary').click();
  await refresh();
  assert.equal(await page.locator('[data-drive-sources]').evaluate(element => element.open), true);
  // A second pending preview makes the panel poll while the first is being reviewed.
  const queued = await request(`/api/admin/albums/${album}/drive/preview`, {request_key: randomUUID()});
  await refresh();
  await reviewed.focus();
  const nextPoll = page.waitForResponse(response => response.url() === base + '/api/admin/drive/status');
  await nextPoll;
  await page.waitForFunction(() => document.activeElement?.matches('[data-drive-reviewed]') && document.activeElement.checked);
  assert.equal(await reviewed.isChecked(), true);
  await request('/api/admin/drive/jobs/' + queued.job_id + '/cancel', {});
  await refresh();
  assert.equal(await reviewed.isChecked(), true);
  for (const width of [390, 320]) {
    await page.setViewportSize({width, height: 844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}px`);
    assert.equal(await page.locator('.drive-job td').first().evaluate(element => getComputedStyle(element, '::before').content), '"File"');
  }
  await action('approve').evaluate(button => { button.click(); button.click(); });
  await feedback.filter({hasText: 'Đã ghi nhận'}).waitFor();
  assert.equal(approveRequests, 1);
  for (let index = 0; index < 4; index++) {
    const job = await worker.runOnce();
    if (job?.status === 'completed') break;
  }
  assert.equal(Number((await fixture.db.get('SELECT COUNT(*) AS count FROM photos')).count), 51);
  await refresh();
  assert.equal(await action('sync').count(), 1);
  await fixture.db.run('UPDATE albums SET drive_review_required=1 WHERE id=?', [album]);
  await page.reload();
  await page.locator('.album-drive-tool > summary').click();
  await action('preview').waitFor();
  assert.equal(await action('sync').count(), 0, 'Submitted galleries must go through preview approval');
  assert.deepEqual(errors, []);
  console.log('PASS: invalid URL, duplicate folder feedback/draft retention, first-import and review gates, single requests, preview checkbox/focus retention across polling and paging, source disclosure, mobile320/390 and explicit approval');
} finally {
  worker.stop();
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await fixture.mediaControl.close();
  await fixture.db.close();
  await rm(directory, {recursive: true, force: true});
}
