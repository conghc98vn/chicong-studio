// Isolated synthetic benchmark. Never reads .env, user data or credentials.
// Run with Node 24 and STUDIO_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs.
// STUDIO_SCALE_LABEL distinguishes repeated before/after evidence directories.
import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import express from 'express';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';

const label = process.env.STUDIO_SCALE_LABEL || 'baseline';
assert.match(label, /^[a-z0-9-]+$/);
const evidence = path.resolve('output/gallery-scale-' + label);
const temporary = await mkdtemp(path.join(tmpdir(), 'gallery-scale-'));
const playwright = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const requestScope = new AsyncLocalStorage();
const apiRequests = [];
const rounded = value => Math.round(value * 10) / 10;
const report = {
  label,
  recorded_at: new Date().toISOString(),
  fixture: {
    sizes: [500, 5000],
    note: 'Synthetic local SQLite/media fixture. Browser tests use desktop local network and mobile simulated 1.6 Mbps, 100 ms RTT, 4x CPU slowdown. These are lab observations, not production or real-device measurements.',
    credentials: 'Synthetic admin session only; no Google or production services.'
  },
  api: [],
  browser: [],
  findings: [],
  errors: []
};
let instance;
let server;
let browser;

function observeDatabase(db) {
  for (const method of ['all', 'get', 'run']) {
    const original = db[method].bind(db);
    db[method] = async (...args) => {
      const observation = requestScope.getStore();
      const started = performance.now();
      if (observation) observation.queries++;
      const result = await original(...args);
      if (observation) {
        observation.query_ms += performance.now() - started;
        if (/\bFROM photos\b/i.test(args[0])) {
          observation.photo_rows += Array.isArray(result) ? result.length : result ? 1 : 0;
        }
      }
      return result;
    };
  }
}

async function seedPhotos(count) {
  const albumId = String(count).padStart(32, 'a');
  const object = 'f'.repeat(32);
  await instance.db.run('INSERT INTO albums(id,title,category,status,description) VALUES(?,?,?,?,?)', [albumId, 'Bộ ảnh kiểm thử ' + count, 'wedding', 'private', 'Dữ liệu tổng hợp để đo UI và hiệu năng.']);
  for (let offset = 0; offset < count; offset += 100) {
    const rows = Array.from({length: Math.min(100, count - offset)}, (_, index) => {
      const position = offset + index;
      return [(count * 10000 + position + 1).toString(16).padStart(32, '0'), albumId, object, 'CC-' + String(position + 1).padStart(4, '0') + '.jpg', 'Khoảnh khắc ' + (position + 1), 2400, 1600, position];
    });
    await instance.db.run('INSERT INTO photos(id,album_id,filename,original,caption,width,height,position) VALUES ' + rows.map(() => '(?,?,?,?,?,?,?,?)').join(','), rows.flat());
  }
  return albumId;
}

async function measureAPI(base, albumId, count, route, authenticated) {
  const runs = [];
  for (let index = 0; index < 3; index++) {
    const start = performance.now();
    const response = await fetch(base + route, {headers: authenticated ? {Cookie: 'studio_admin=synthetic-scale-session'} : {}});
    const body = await response.text();
    assert.equal(response.status, 200, route);
    const observation = apiRequests.findLast(item => item.path === route);
    runs.push({
      duration_ms: rounded(performance.now() - start),
      json_bytes: Buffer.byteLength(body),
      gzip_estimate_bytes: gzipSync(body).length,
      content_encoding: response.headers.get('content-encoding'),
      query_count: observation.queries,
      query_ms: rounded(observation.query_ms),
      photo_rows_read: observation.photo_rows
    });
  }
  report.api.push({photo_count: count, route: route.replace(albumId, ':album'), runs});
}

async function measureBrowser(base, albumId, count, type, mobile) {
  const context = await browser.newContext({
    viewport: mobile ? {width: 390, height: 844} : {width: 1440, height: 1000},
    deviceScaleFactor: mobile ? 2 : 1,
    reducedMotion: 'reduce',
    hasTouch: mobile
  });
  if (type === 'admin') {
    await context.addCookies([{name: 'studio_admin', value: 'synthetic-scale-session', url: base, httpOnly: true, sameSite: 'Strict'}]);
  }
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', {cacheDisabled: true});
  if (mobile) {
    await cdp.send('Network.emulateNetworkConditions', {offline: false, latency: 100, downloadThroughput: 200000, uploadThroughput: 100000});
    await cdp.send('Emulation.setCPUThrottlingRate', {rate: 4});
  }
  await page.addInitScript(() => {
    window.scaleLab = {longTasks: [], cls: 0};
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) window.scaleLab.longTasks.push(entry.duration);
    }).observe({type: 'longtask', buffered: true});
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.scaleLab.cls += entry.value;
    }).observe({type: 'layout-shift', buffered: true});
  });
  const requests = [];
  page.on('request', request => requests.push({path: new URL(request.url()).pathname, type: request.resourceType()}));
  const route = type === 'admin' ? '/admin#album/' + albumId : '/gallery/' + albumId;
  const selector = type === 'admin' ? '[data-admin-photo]' : '.photo-item';
  const start = performance.now();
  await page.goto(base + route, {waitUntil: 'domcontentloaded'});
  await page.locator(selector).first().waitFor();
  const ready = performance.now() - start;
  await page.waitForFunction(selector => {
    const image = document.querySelector(selector + ' img');
    return image?.complete && image.naturalWidth > 0;
  }, selector);
  const firstImage = performance.now() - start;
  await page.waitForTimeout(mobile ? 1500 : 500);
  const initial = await page.evaluate(selector => ({
    dom_nodes: document.querySelectorAll('*').length,
    photo_cards: document.querySelectorAll(selector).length,
    image_elements: document.images.length,
    loaded_images: [...document.images].filter(image => image.complete && image.naturalWidth > 0).length,
    horizontal_overflow: document.documentElement.scrollWidth > innerWidth,
    long_tasks_ms: window.scaleLab.longTasks.map(value => Math.round(value * 10) / 10),
    cls: window.scaleLab.cls,
    resources: performance.getEntriesByType('resource').filter(item => item.name.includes('/api/')).map(item => ({path: new URL(item.name).pathname, bytes: item.decodedBodySize, transfer_bytes: item.transferSize, duration_ms: Math.round(item.duration * 10) / 10}))
  }), selector);
  const result = {
    photo_count: count,
    page: type,
    profile: mobile ? 'mobile-simulated-slow' : 'desktop-local',
    metadata_ready_ms: rounded(ready),
    first_image_ready_ms: rounded(firstImage),
    initial_media_requests: requests.filter(request => request.path.startsWith('/media/')).length,
    initial
  };
  assert.ok(initial.photo_cards <= (type === 'admin' ? 120 : 90), 'Photo DOM must stay bounded.');
  assert.equal(initial.horizontal_overflow, false);
  await page.screenshot({path: path.join(evidence, `${type}-${count}-${mobile ? '390' : '1440'}.png`)});

  if (type === 'gallery' && !mobile) {
    const cards = page.locator('.photo-open');
    const lastOnPage = await cards.last().getAttribute('data-photo');
    await cards.last().click();
    const before = await page.locator('#lightbox-counter').textContent();
    const crossStart = performance.now();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(count => document.querySelector('#lightbox-counter').textContent === '91 / ' + count, count);
    result.cross_page_lightbox = {before, after: await page.locator('#lightbox-counter').textContent(), navigation_ms: rounded(performance.now() - crossStart)};
    await page.locator('[data-action=close-lightbox]').click();
    result.cross_page_lightbox.returned_to_opening_photo = await page.evaluate(id => document.activeElement?.dataset.photo === id, lastOnPage);
    const pagingStart = performance.now();
    await page.locator('[data-action=gallery-page][data-page="1"]').first().click();
    await page.waitForFunction(last => document.querySelector('.photo-open')?.dataset.photo !== last, lastOnPage);
    result.page_change_ms = rounded(performance.now() - pagingStart);
  }

  if (type === 'admin') {
    // Focus dispatch executes the same quiet polling path without waiting 15 s.
    // Capture selection response and verify no full catalog reload follows it.
    const requestStart = requests.length;
    const selectionResponse = page.waitForResponse(response => response.url().endsWith('/api/admin/albums/' + albumId + '/selection'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await selectionResponse;
    await page.waitForTimeout(500);
    result.quiet_poll_requests = requests.slice(requestStart).filter(request => request.path.startsWith('/api/'));
    const poll = apiRequests.findLast(item => item.path === '/api/admin/albums/' + albumId + '/selection');
    result.quiet_poll_query_count = poll?.queries;
    result.quiet_poll_photo_rows_read = poll?.photo_rows;
    const search = page.locator('[data-admin-photo-search]');
    const searchStart = performance.now();
    await search.fill('CC-' + String(count).padStart(4, '0'));
    await page.waitForFunction(() => document.querySelectorAll('[data-admin-photo]').length === 1);
    result.search_last_photo_ms = rounded(performance.now() - searchStart);
    result.quiet_poll_full_catalog_reload = result.quiet_poll_requests.some(request => request.path === '/api/admin/albums/' + albumId);
    assert.equal(result.quiet_poll_full_catalog_reload, false, 'Unchanged quiet polling must not reload the full catalog.');
  }
  report.browser.push(result);
  console.log(JSON.stringify({photo_count: count, page: type, profile: result.profile, metadata_ready_ms: result.metadata_ready_ms, dom_nodes: initial.dom_nodes, media_requests: result.initial_media_requests}));
  await context.close();
}

try {
  await mkdir(evidence, {recursive: true});
  instance = await createApp({dataDir: temporary, env: {MEDIA_CLEANUP_ENABLED: 'false'}, seed: false});
  observeDatabase(instance.db);
  const image = sharp({create: {width: 2400, height: 1600, channels: 3, background: '#91a187'}});
  const [webp, thumb] = await Promise.all([image.clone().webp().toBuffer(), image.clone().resize(900).webp().toBuffer()]);
  await instance.storage.put('f'.repeat(32) + '.webp', webp);
  await instance.storage.put('f'.repeat(32) + '-thumb.webp', thumb);
  report.fixture.renditions = {webp_bytes: webp.length, thumbnail_bytes: thumb.length, note: 'Flat synthetic images intentionally isolate catalog/DOM work; image byte timings underestimate photographic payloads.'};
  await instance.db.run('INSERT INTO admins(id,email,password) VALUES(?,?,?)', ['synthetic-owner', 'scale@example.test', 'unused']);
  await instance.db.run('INSERT INTO sessions(token,admin_id,expires) VALUES(?,?,?)', [createHash('sha256').update('synthetic-scale-session').digest('hex'), 'synthetic-owner', Date.now() + 3600000]);
  const outer = express();
  outer.use((req, res, next) => {
    const observation = {path: req.url, queries: 0, query_ms: 0, photo_rows: 0};
    res.once('finish', () => { if (req.url.startsWith('/api/')) apiRequests.push(observation); });
    requestScope.run(observation, next);
  });
  outer.use(instance.app);
  server = outer.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  browser = await playwright.chromium.launch({channel: 'chrome', headless: true});
  report.browser_version = browser.version();
  for (const count of report.fixture.sizes) {
    const albumId = await seedPhotos(count);
    for (const [route, authenticated] of [
      ['/api/gallery/' + albumId, false],
      ['/api/gallery/' + albumId + '/selection', false],
      ['/api/admin/albums/' + albumId, true],
      ['/api/admin/albums/' + albumId + '/selection', true],
      ['/api/admin/albums?view=summary', true]
    ]) await measureAPI(base, albumId, count, route, authenticated);
    await measureBrowser(base, albumId, count, 'gallery', false);
    await measureBrowser(base, albumId, count, 'gallery', true);
    await measureBrowser(base, albumId, count, 'admin', false);
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.errors.push(error.stack || error.message);
  process.exitCode = 1;
} finally {
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await instance?.mediaControl.close();
  await instance?.db.close();
  await rm(temporary, {recursive: true, force: true});
  console.log('Performance report: ' + path.join(evidence, 'report.json'));
}
