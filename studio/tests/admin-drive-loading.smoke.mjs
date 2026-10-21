import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';

const pw = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const directory = await mkdtemp(path.join(tmpdir(), 'admin-drive-loading-'));
let instance, server, browser;
try {
  instance = await createApp({dataDir: directory, env: {}, mailer: {notifyNewInquiry: async () => ({skipped: true})}});
  server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  browser = await pw.chromium.launch({channel: 'chrome', headless: true});
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [], errors = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  page.on('pageerror', error => errors.push(error.message));
  for (const route of ['/', '/portfolio', '/about', '/contact', '/admin']) {
    await page.goto(base + route);
    await page.locator('#root').waitFor({state: 'visible'});
  }
  assert.deepEqual(requests.filter(url => /\/app\/drive-/.test(url)), []);
  const setup = await page.request.post(base + '/api/admin/setup', {
    headers: {Origin: base}, data: {email: 'loading@example.invalid', password: 'isolated-loading-password'}
  });
  assert.equal(setup.status(), 201);
  await page.goto(base + '/admin#portfolio');
  await page.locator('[data-action=new-album]').click();
  await page.locator('[name=photo_source]').selectOption('drive');
  await page.locator('[data-drive-entry]').waitFor({state: 'visible'});
  assert.ok(requests.includes('/app/drive-panel.mjs'));
  assert.ok(requests.includes('/app/drive-album-entry.mjs'));
  assert.equal(await page.locator('link[href^="/app/drive-sync.css"]').count(), 1);
  await page.waitForFunction(() => [...document.styleSheets].some(sheet => sheet.href && new URL(sheet.href).pathname === '/app/drive-sync.css'));
  assert.deepEqual(errors, []);
  console.log('Public pages/login omit Drive assets; authenticated album editor loads one stylesheet and working Drive controls.');

  // Drive styling is optional for the rest of admin: a failed CSS request must
  // not prevent opening inquiries, and a later navigation should retry it.
  const degraded = await page.context().newPage();
  degraded.on('pageerror', error => errors.push(error.message));
  let stylesheetAttempts = 0;
  await degraded.route('**/app/drive-sync.css*', route => {
    stylesheetAttempts++;
    return stylesheetAttempts === 1 ? route.abort('failed') : route.continue();
  });
  await degraded.goto(base + '/admin#inquiries');
  await degraded.locator('.admin-heading h1').filter({hasText: 'Yêu cầu tư vấn'}).waitFor({timeout: 5000});
  assert.equal(stylesheetAttempts, 1);
  await degraded.waitForFunction(() => !document.querySelector('link[href^="/app/drive-sync.css"]'));
  await degraded.locator('[data-action=admin-view][data-view=portfolio]').click();
  await degraded.locator('[data-action=new-album]').waitFor();
  await degraded.waitForFunction(() => [...document.styleSheets].some(sheet => sheet.href && new URL(sheet.href).pathname === '/app/drive-sync.css'));
  assert.equal(stylesheetAttempts, 2);
  assert.equal(await degraded.locator('link[href^="/app/drive-sync.css"]').count(), 1);
  assert.deepEqual(errors, []);
  await degraded.close();
  console.log('A failed Drive stylesheet leaves inquiries usable and retries once on admin navigation.');

  const stalled = await context.newPage();
  stalled.on('pageerror', error => errors.push(error.message));
  await stalled.clock.install();
  let stalledRoute;
  let stalledAttempts = 0;
  await stalled.route('**/app/drive-sync.css*', route => {
    stalledAttempts++;
    if (stalledAttempts === 1) stalledRoute = route;
    else return route.continue();
  });
  try {
    await stalled.goto(base + '/admin#inquiries', {waitUntil: 'domcontentloaded'});
    await stalled.locator('.admin-heading h1').filter({hasText: 'Yêu cầu tư vấn'}).waitFor({timeout: 5000});
    assert.equal(stalledAttempts, 1);
    assert.ok(stalledRoute, 'stylesheet request is still pending while inquiries are usable');
    await stalled.clock.fastForward(10001);
    await stalled.waitForFunction(() => !document.querySelector('link[href^="/app/drive-sync.css"]'));
    await stalled.locator('[data-action=admin-view][data-view=portfolio]').click();
    await stalled.locator('[data-action=new-album]').waitFor();
    await stalled.waitForFunction(() => [...document.styleSheets].some(sheet => sheet.href && new URL(sheet.href).pathname === '/app/drive-sync.css'));
    assert.equal(stalledAttempts, 2);
    assert.equal(await stalled.locator('link[href^="/app/drive-sync.css"]').count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    await stalledRoute?.abort().catch(() => {});
    await stalled.close();
  }
  console.log('A stalled Drive stylesheet does not block admin and can retry after its deadline.');
} finally {
  await browser?.close();
  if (server) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
  await instance?.photoCleanup.close();
  await instance?.mediaControl.close();
  await instance?.db.close();
  await rm(directory, {recursive: true, force: true});
}
