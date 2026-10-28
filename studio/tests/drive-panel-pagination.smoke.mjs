import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';

// Real UI modules with deterministic, local API fixtures; no Drive or data directory.
const playwright = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
let failure = '', failStatus = false;
const offsets = [];
const job = {id: 'preview', kind: 'preview', status: 'completed'};
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (['/drive-panel.mjs', '/drive-album-entry.mjs', '/api-request.mjs'].includes(url.pathname)) {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(await readFile(new URL('../web' + url.pathname, import.meta.url))); return;
  }
  if (url.pathname === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><div id="panel"></div><script type="module">import {mountDrivePanel} from "/drive-panel.mjs"; mountDrivePanel(document.querySelector("#panel"),{album:{id:"album"}});</script>'); return;
  }
  response.setHeader('Content-Type', 'application/json');
  const fail = () => {response.statusCode = 503; response.end(JSON.stringify({error: 'fixture-page-failure'}));};
  if (url.pathname === '/api/admin/drive/status') {
    if (failStatus) return fail();
    response.end(JSON.stringify({enabled: true, connection: {status: 'active'}, workers: [], jobs: [job]}));
  } else if (url.pathname === '/api/admin/albums/album/drive') {
    const offset = Number(url.searchParams.get('offset')); offsets.push(offset);
    if (failure === 'sources' && offset === 50) return fail();
    response.end(JSON.stringify({mapping: {folder_id: 'folder', state: 'attached', baseline_preview_id: 'preview'}, jobs: [job], total: 125,
      sources: Array.from({length: Math.min(50,125-offset)}, (_,i) => ({drive_file_id: 'photo'+(offset+i), source_name: `Photo ${offset+i}`, state: 'active'}))}));
  } else if (url.pathname === '/api/admin/drive/jobs/preview') {
    if (failure === 'detail') return fail();
    response.end(JSON.stringify({job, items: []}));
  } else {response.statusCode = 404;response.end('{}');}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await playwright.chromium.launch({channel: 'chrome', headless: true});
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors=[];page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  const action = name => page.locator(`[data-drive-action="${name}"]`);
  const firstSource = page.locator('.drive-sources li').first();
  const feedback = page.locator('[data-drive-feedback]');
  await page.locator('[data-drive-sources] > summary').click();
  for (const stage of ['sources','detail']) {
    failure = stage;
    await action('sources-next').click();
    await feedback.filter({hasText: 'fixture-page-failure'}).waitFor();
    assert.equal(await firstSource.textContent(), 'Photo 0 · Đã đồng bộ', `${stage}: a failed page must keep previous source rows`);
    assert.equal(await action('sources-prev').isDisabled(), true, `${stage}: failed navigation must restore the page index`);
    assert.equal(await action('sources-next').isEnabled(), true);
    failure = '';
    const previous = offsets.length;
    await action('sources-next').focus();
    await page.keyboard.press('Enter');
    await feedback.filter({hasText: 'Đã cập nhật trạng thái.'}).waitFor();
    assert.equal(offsets[previous], 50, `${stage}: retry must not skip the failed page`);
    assert.equal(await firstSource.textContent(), 'Photo 50 · Đã đồng bộ');
    assert.equal(await action('sources-prev').isEnabled(), true);
    await action('sources-prev').click();
    await feedback.filter({hasText: 'Đã cập nhật trạng thái.'}).waitFor();
    assert.equal(await firstSource.textContent(), 'Photo 0 · Đã đồng bộ');
  }
  // The first status payload must also remain absent until job details succeed.
  failure = 'detail';
  await page.reload();
  await feedback.filter({hasText: 'fixture-page-failure'}).waitFor();
  assert.equal(await page.locator('[data-drive-sources]').count(), 0);
  failStatus = true;
  await action('refresh').click();
  await feedback.filter({hasText: 'fixture-page-failure'}).waitFor();
  assert.equal(await page.locator('[data-drive-sources]').count(), 0, 'a failed refresh must not draw a partially loaded catalog');
  failStatus = false; failure = '';
  await action('refresh').click();
  await page.locator('[data-drive-sources] > summary').click();
  assert.equal(await firstSource.textContent(), 'Photo 0 · Đã đồng bộ');
  assert.deepEqual(errors, []);
  console.log('PASS: Drive source pagination rolls back failed requests, commits complete responses, retries without skipping, and recovers initial partial failure');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
