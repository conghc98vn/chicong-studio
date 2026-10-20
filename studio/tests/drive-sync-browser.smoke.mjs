import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';
import {createDriveWorker} from '../server/drive-worker.mjs';
import {DRIVE_FOLDER} from '../server/drive-client.mjs';

const playwright = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const directory = await mkdtemp(path.join(tmpdir(), 'drive-browser-'));
const output = process.env.STUDIO_BROWSER_EVIDENCE_DIR || 'output/drive-sync';
const env = {DRIVE_SYNC_ENABLED: 'true', DRIVE_SYNC_BATCH_SIZE: '2'};
const fixture = await createApp({dataDir: directory, env, seed: false});
const server = fixture.app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const album = 'a'.repeat(32);
const photoId = value => value.toString(16).padStart(32, '0');
const jpeg = await sharp({create: {width: 600, height: 400, channels: 3, background: '#809074'}}).jpeg().toBuffer();
const checksum = createHash('md5').update(jpeg).digest('hex');
const file = {id: 'driveImage001', name: 'Studio full resolution.jpg', mimeType: 'image/jpeg', size: String(jpeg.length), version: '1', md5Checksum: checksum, parents: ['albumFolder'], capabilities: {canDownload: true}};
const drive = {
  serviceAccountEmail: 'sync@test.iam.gserviceaccount.com',
  async getFile(id) {
    if (id === file.id) return structuredClone(file);
    return {id, name: id, mimeType: DRIVE_FOLDER, version: '1', parents: id === 'rootFolder' ? [] : ['rootFolder']};
  },
  async listFiles() { return {files: [structuredClone(file)]}; },
  async download(id, destination) {
    assert.equal(id, file.id);
    await writeFile(destination, jpeg, {flag: 'wx', mode: 0o600});
    return {bytes: jpeg.length, checksum};
  }
};
const worker = createDriveWorker({db: fixture.db, storage: fixture.storage, control: fixture.mediaControl, drive, env, logger: () => {}});
let browser;
try {
  await mkdir(output, {recursive: true});
  await fixture.db.run('INSERT INTO albums(id,title,category,status) VALUES(?,?,?,?)', [album, 'Bộ ảnh 5.000 tấm', 'wedding', 'private']);
  const webp = await sharp(jpeg).webp().toBuffer();
  const object = 'f'.repeat(32);
  await fixture.storage.put(object + '.webp', webp);
  await fixture.storage.put(object + '-thumb.webp', webp);
  for (let offset = 0; offset < 5000; offset += 100) {
    const rows = Array.from({length: 100}, (_, index) => [photoId(offset + index + 1), album, object, `CC-${String(offset + index + 1).padStart(4, '0')}.jpg`, 600, 400, offset + index]);
    await fixture.db.run('INSERT INTO photos(id,album_id,filename,original,width,height,position) VALUES ' + rows.map(() => '(?,?,?,?,?,?,?)').join(','), rows.flat());
  }
  browser = await playwright.chromium.launch({channel: 'chrome', headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(15000);
  assert.equal((await context.request.post(base + '/api/admin/setup', {
    headers: {Origin: base}, data: {email: 'drive-browser@test.local', password: 'drive-browser-password-123'}
  })).status(), 201);
  await page.goto(base + '/admin#settings');
  const connection = page.locator('[data-drive-form=connection]');
  await connection.locator('[name=email]').fill(drive.serviceAccountEmail);
  await connection.locator('[name=root]').fill('https://drive.google.com/drive/folders/rootFolder');
  await connection.locator('button').click();
  await page.locator('[data-drive-action=check]').waitFor({state: 'visible'});
  await page.waitForFunction(() => !document.querySelector('[data-drive-action=check]').disabled);
  await page.locator('[data-drive-action=check]').click();
  await page.locator('[data-drive-feedback]').filter({hasText: 'Đã ghi nhận'}).waitFor();
  assert.equal((await worker.runOnce()).status, 'completed');
  await page.locator('[data-drive-action=refresh]').click();
  await page.locator('.drive-panel').filter({hasText: 'Đã kết nối tài khoản studio.'}).waitFor();
  await page.goto(base + '/admin#album/' + album);
  await page.locator('[data-admin-photo]').first().waitFor();
  assert.equal(await page.locator('[data-admin-photo]').count(), 120);
  await page.locator('[data-action=admin-photo-page][data-page="1"]').click();
  assert.equal(await page.locator('[data-admin-photo]').count(), 120);
  assert.equal(await page.locator('[data-admin-photo]').first().getAttribute('data-admin-photo'), photoId(121));
  await page.locator('[data-admin-photo-search]').fill('CC-5000');
  assert.equal(await page.locator('[data-admin-photo]').count(), 1);
  await page.locator('[data-admin-photo-search]').fill('');
  await page.locator('.album-drive-tool > summary').click();
  const link = page.locator('[data-drive-form=link]');
  await link.locator('[name=folder]').fill('https://drive.google.com/drive/folders/albumFolder');
  await link.locator('button').click();
  await page.locator('[data-drive-feedback]').filter({hasText: 'Đã ghi nhận'}).waitFor();
  assert.equal((await worker.runOnce()).status, 'completed');
  await page.locator('[data-drive-action=refresh]').click();
  await page.locator('[data-drive-action=preview]').waitFor();
  await page.locator('[data-drive-action=preview]').click();
  await page.locator('[data-drive-feedback]').filter({hasText: 'Đã ghi nhận'}).waitFor();
  assert.equal((await worker.runOnce()).status, 'awaiting_review');
  await page.locator('[data-drive-action=refresh]').click();
  await page.locator('[data-drive-reviewed]').waitFor();
  assert.equal(await page.locator('[data-drive-action=approve]').isDisabled(), true);
  await page.locator('[data-drive-reviewed]').check();
  await page.locator('[data-drive-action=approve]').click();
  await page.locator('[data-drive-feedback]').filter({hasText: 'Đã ghi nhận'}).waitFor();
  assert.equal((await worker.runOnce()).status, 'completed');
  assert.equal(Number((await fixture.db.get('SELECT COUNT(*) AS count FROM photos')).count), 5001);
  await page.locator('[data-drive-action=refresh]').click();
  await page.locator('.drive-job [role=status]').filter({hasText: 'Đã xử lý 1/1 file'}).waitFor();
  await page.locator('[data-drive-action=reload-album]').click();
  await page.locator('[data-admin-photo-search]').fill('Studio full resolution');
  await page.locator('[data-action=detach-drive-photo]').waitFor({state: 'attached'});
  console.log('PASS: Real admin forms configure, check, link, preview, explicitly approve and import via worker');
  await page.screenshot({path: output + '/admin-drive-5000.png'});
  assert.equal(await page.locator('.album-drive-tool').evaluate(element => element.open), true, 'Refreshing album content retains the open Drive tool');
  await page.locator('[data-drive-action=schedule]').click();
  await page.locator('.drive-panel').filter({hasText: 'lịch toàn studio vẫn đang tắt'}).waitFor();
  assert.ok((await fixture.db.get('SELECT next_run_at FROM drive_album_links')).next_run_at);
  await page.locator('[data-drive-action=schedule]').click();
  await page.locator('.drive-panel').filter({hasText: 'Bộ ảnh chưa bật đồng bộ định kỳ.'}).waitFor();
  const imported = await fixture.db.get("SELECT * FROM photos WHERE source='google_drive'");
  // Another admin changes only source ownership; polling must update the menu.
  const detached = await context.request.post(base + '/api/admin/photos/' + imported.id + '/drive/detach', {
    headers: {Origin: base}, data: {}
  });
  assert.equal(detached.status(), 200);
  await page.locator('[data-action=replace-manual-photo]').waitFor({state: 'attached'});
  assert.equal((await fixture.db.get('SELECT source FROM photos WHERE id=?', [imported.id])).source, 'manual');
  await page.locator('[data-admin-photo] .photo-menu > summary').click();
  await page.locator('[data-action=replace-manual-photo]').click();
  const replacement = page.locator('[data-form=replace-photo]');
  const newJpeg = await sharp({create: {width: 640, height: 480, channels: 3, background: '#bb6655'}}).jpeg().toBuffer();
  await replacement.locator('[type=file]').setInputFiles({name: 'replacement.jpg', mimeType: 'image/jpeg', buffer: newJpeg});
  await replacement.locator('button').click();
  await replacement.waitFor({state: 'hidden'});
  const replaced = await fixture.db.get('SELECT * FROM photos WHERE id=?', [imported.id]);
  assert.notEqual(replaced.filename, imported.filename);
  assert.equal(replaced.original, imported.original);
  assert.equal(replaced.source, 'manual');
  assert.equal(Number((await fixture.db.get('SELECT COUNT(*) AS count FROM photos')).count), 5001);
  console.log('PASS: Schedule opt-in stays gated globally; admin polling sees external detach; replace by ID retains one manual photo');
  const client = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const gallery = await client.newPage();
  gallery.on('pageerror', error => errors.push(error.message));
  await gallery.goto(base + '/gallery/' + album);
  await gallery.locator('.photo-item').first().waitFor();
  assert.equal(await gallery.locator('.photo-item').count(), 90);
  assert.equal(await gallery.locator('[data-gallery-more]').count(), 0);
  await gallery.locator('[data-action=gallery-page][data-page="1"]').click();
  assert.equal(await gallery.locator('.photo-item').count(), 90);
  assert.equal(await gallery.locator('.photo-open').first().getAttribute('data-photo'), photoId(91));
  // Preserve photo ID while changing image contents immediately before selection PUT.
  // The PUT response must not acknowledge this unseen catalog for submission.
  const updatedObject = 'e'.repeat(32);
  const updatedWebp = await sharp(newJpeg).webp().toBuffer();
  await fixture.storage.put(updatedObject + '.webp', updatedWebp);
  await fixture.storage.put(updatedObject + '-thumb.webp', updatedWebp);
  await gallery.route('**/api/gallery/' + album + '/selection/' + photoId(91), async route => {
    await fixture.db.run('UPDATE photos SET filename=? WHERE id=?', [updatedObject, photoId(91)]);
    await route.continue();
  });
  await gallery.locator('.pick').first().click();
  await gallery.locator('.client-toolbar strong').filter({hasText: '1 ảnh đã lưu'}).waitFor();
  await gallery.locator('[data-action=submit-selection]').click();
  await gallery.locator('#toast').filter({hasText: 'Hãy xem lại'}).waitFor();
  assert.equal(Number((await fixture.db.get('SELECT COUNT(*) AS count FROM gallery_submissions')).count), 0);
  await gallery.unroute('**/api/gallery/' + album + '/selection/' + photoId(91));
  console.log('PASS: Selection PUT cannot acknowledge unseen replacement; first submit conflicts and refreshes catalog');
  // Change catalog only after the displayed snapshot is submitted.
  let intercept = true;
  await gallery.route('**/api/gallery/' + album + '/submit', async route => {
    if (intercept) {
      intercept = false;
      await fixture.db.run('UPDATE photos SET caption=? WHERE id=?', ['Thay đổi trong lúc gửi', photoId(91)]);
    }
    await route.continue();
  });
  await gallery.locator('[data-action=submit-selection]').click();
  await gallery.locator('#toast').filter({hasText: 'Hãy xem lại'}).waitFor();
  assert.equal(Number((await fixture.db.get('SELECT COUNT(*) AS count FROM gallery_submissions')).count), 0);
  await gallery.locator('[data-action=submit-selection]').click();
  await gallery.locator('[data-submission-status]').filter({hasText: 'Studio đã nhận'}).waitFor();
  assert.equal((await fixture.db.get('SELECT drive_review_required FROM albums WHERE id=?', [album])).drive_review_required, 1);
  assert.equal(Number((await fixture.db.get('SELECT COUNT(*) AS count FROM gallery_submissions')).count), 1);
  await gallery.locator('[data-action=selected-only]').click();
  assert.equal(await gallery.locator('.photo-item').count(), 1);
  await gallery.locator('.photo-open').click();
  assert.equal(await gallery.locator('#lightbox-counter').textContent(), '1 / 1');
  await gallery.locator('[data-action=close-lightbox]').click();
  await gallery.locator('[data-action=selected-only]').click();
  for (const width of [390, 320]) {
    await gallery.setViewportSize({width, height: 844});
    await gallery.screenshot({path: output + `/gallery-${width}-5000.png`});
    const overflow = await gallery.evaluate(() => [...document.querySelectorAll('body *')]
      .filter(element => element.getBoundingClientRect().right > innerWidth + 1)
      .map(element => ({tag: element.tagName, class: element.className, width: element.getBoundingClientRect().width}))
      .slice(0, 12));
    assert.equal(await gallery.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, JSON.stringify(overflow));
    assert.ok(await gallery.locator('.photo-item').count() <= 90);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: 5001-photo bounded admin/gallery DOM, paging, search, stale-submit conflict, receipt and persistent hold; mobile320/390 no overflow or JS errors');
} finally {
  worker.stop();
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await fixture.mediaControl.close();
  await fixture.db.close();
  await rm(directory, {recursive: true, force: true});
}
