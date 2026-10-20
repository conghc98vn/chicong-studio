import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';

// Serve the real browser modules; only API responses and elapsed poll time are fixtures.
const playwright = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
let reads = 0, failures = 0, unauthorized = false, completed = false, actionRequests = 0;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (['/drive-panel.mjs', '/drive-album-entry.mjs', '/api-request.mjs'].includes(url.pathname)) {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(await readFile(new URL('../web' + url.pathname, import.meta.url)));
    return;
  }
  if (url.pathname === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><div id="panel"></div><script type="module">import {mountDrivePanel} from "/drive-panel.mjs"; mountDrivePanel(document.querySelector("#panel"));</script>');
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  const job = {id: 'job', kind: 'check', status: completed ? 'completed' : 'running'};
  if (url.pathname === '/api/admin/drive/status') {
    reads++;
    if (unauthorized || failures > 0) {
      response.statusCode = unauthorized ? 401 : 503;
      if (failures) failures--;
      response.end(JSON.stringify({error: 'status-failure-' + reads}));
    } else response.end(JSON.stringify({enabled: true, connection: {status: 'active'}, workers: [], jobs: [job]}));
  } else if (url.pathname === '/api/admin/drive/jobs/job/cancel') {
    actionRequests++;
    response.statusCode = 503;
    response.end(JSON.stringify({error: 'action-failure'}));
  } else if (url.pathname === '/api/admin/drive/jobs/job') response.end(JSON.stringify({job, items: []}));
  else { response.statusCode = 404; response.end('{}'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await playwright.chromium.launch({channel: 'chrome', headless: true});
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    // Keep API timeout timers real. Advance only the panel's polling timers explicitly.
    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeClearTimeout = window.clearTimeout.bind(window);
    const pollDelays = new Set([4000, 8000, 16000, 30000]);
    window.pollTimers = new Map();
    let nextId = -1;
    window.setTimeout = (callback, delay, ...args) => {
      if (!pollDelays.has(delay)) return nativeSetTimeout(callback, delay, ...args);
      const id = nextId--;
      window.pollTimers.set(id, {delay, run: () => callback(...args)});
      return id;
    };
    window.clearTimeout = id => {
      window.pollTimers.delete(id);
      nativeClearTimeout(id);
    };
    window.runPoll = () => {
      const [id, timer] = window.pollTimers.entries().next().value;
      window.pollTimers.delete(id);
      timer.run();
    };
    let hidden = false;
    Object.defineProperty(document, 'hidden', {get: () => hidden});
    window.setHidden = value => {
      hidden = value;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
  const timerDelay = async expected => {
    await page.waitForFunction(() => window.pollTimers.size === 1);
    assert.deepEqual(await page.evaluate(() => [...window.pollTimers.values()].map(timer => timer.delay)), [expected]);
  };
  const noTimer = async () => assert.equal(await page.evaluate(() => window.pollTimers.size), 0);
  const failed = count => page.locator('[data-drive-feedback]').filter({hasText: 'status-failure-' + count}).waitFor();
  await page.goto(base);
  await timerDelay(4000);
  assert.equal(reads, 1);
  await page.locator('[name=email]').fill('draft@test.local');
  await page.locator('[name=email]').focus();
  failures = 5;
  for (const delay of [4000, 8000, 16000, 30000, 30000]) {
    const expectedReads = reads + 1;
    await page.evaluate(() => window.runPoll());
    await failed(expectedReads);
    await timerDelay(delay);
  }
  assert.equal(reads, 6, 'Polling survives more than two consecutive failures');
  await page.evaluate(() => window.runPoll());
  await timerDelay(4000);
  assert.equal(reads, 7);
  assert.equal(await page.locator('[name=email]').inputValue(), 'draft@test.local');
  assert.equal(await page.evaluate(() => document.activeElement.name), 'email');
  await page.locator('[data-drive-action=cancel]').evaluate(button => { button.click(); button.click(); });
  await page.locator('[data-drive-feedback]').filter({hasText: 'action-failure'}).waitFor();
  await timerDelay(4000);
  assert.equal(actionRequests, 1, 'Failed actions still deduplicate double clicks');
  await page.evaluate(() => window.runPoll());
  await timerDelay(4000);
  assert.equal(reads, 8, 'Failed action rearms polling');
  await page.evaluate(() => window.setHidden(true));
  await noTimer();
  await page.evaluate(() => window.setHidden(false));
  await timerDelay(4000);
  assert.equal(reads, 8, 'Visibility alone does not issue duplicate requests');
  completed = true;
  await page.evaluate(() => window.runPoll());
  await page.locator('[data-drive-job] option:checked').filter({hasText: 'Hoàn tất'}).waitFor({state: 'attached'});
  await noTimer();
  await page.evaluate(() => { window.setHidden(true); window.setHidden(false); });
  await noTimer();
  assert.equal(reads, 9, 'Idle panels do not keep polling');
  completed = false;
  await page.locator('[data-drive-action=refresh]').click();
  await timerDelay(4000);
  unauthorized = true;
  await page.evaluate(() => window.runPoll());
  await failed(11);
  await noTimer();
  await page.evaluate(() => { window.setHidden(true); window.setHidden(false); });
  await noTimer();
  assert.equal(reads, 11, '401 stops automatic polling');
  unauthorized = false;
  await page.locator('[data-drive-action=refresh]').click();
  await timerDelay(4000);
  assert.equal(reads, 12, 'Explicit refresh can recover a restored session');
  await page.locator('#panel').evaluate(container => container.remove());
  await noTimer();
  await page.evaluate(() => { window.setHidden(true); window.setHidden(false); });
  await noTimer();
  assert.equal(reads, 12, 'Removing the panel clears its timer and visibility listener');
  failures = 2;
  await page.goto(base);
  await failed(13);
  await timerDelay(4000);
  await page.evaluate(() => window.runPoll());
  await failed(14);
  await timerDelay(8000);
  await page.evaluate(() => window.runPoll());
  await timerDelay(4000);
  assert.equal(reads, 15, 'Initial-load failures also recover automatically');
  assert.deepEqual(errors, []);
  console.log('PASS: repeated failures, capped backoff/reset, failed action, draft/focus, deduplication, visibility, idle, 401, removal and initial-load recovery');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
