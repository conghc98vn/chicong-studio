import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';

// Real browser, HTTP routes and database commits; no production data or mail.
const pw = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.STUDIO_BROWSER || 'chromium';
const dir = await mkdtemp(path.join(tmpdir(), 'feedback-customer-recovery-'));
const env = {FEEDBACK_LINK_SECRET: randomBytes(32).toString('base64url'), NOTIFICATION_EMAIL: 'studio@example.test'};
const mails = [];
const f = await createApp({dataDir: dir, env, seed: false, mailer: {enabled: true, sendEmail: async message => {
  mails.push(message); return {success: true, id: 'isolated-customer-recovery'};
}}});
const server = f.app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
env.SITE_URL = base;
let browser;
const releases = [];
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
try {
  browser = await pw[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
  const admin = await browser.newContext();
  const customers = await browser.newContext({viewport: {width: 390, height: 844}});
  const errors = [], external = [];
  for (const context of [admin, customers]) {
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== base) {external.push(route.request().url()); return route.abort();}
      return route.continue();
    });
    context.on('page', page => {page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));});
  }
  await customers.addInitScript(() => {
    // Transport may complete after cancellation (e.g. queued cached responses).
    // Force that case so generation checks, rather than AbortController alone,
    // protect the DOM against stale access and invitation contexts.
    const originalFetch = window.fetch.bind(window);
    window.fetch = (url, options = {}) => originalFetch(url, String(url).startsWith('/api/feedback/') && options.method === 'GET' ? {...options, signal: undefined} : options);
    window.__feedbackStorageWrites = [];
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      window.__feedbackStorageWrites.push({key, value});
      return setItem.call(this, key, value);
    };
  });
  const setup = await admin.request.post(base + '/api/admin/setup', {headers: {Origin: base}, data: {email: 'customer-recovery@example.test', password: 'isolated-customer-recovery-123'}});
  assert.equal(setup.status(), 201, await setup.text());
  const get = async suffix => {
    const response = await admin.request.get(base + '/api/admin/handovers' + suffix);
    assert.equal(response.status(), 200, await response.text()); return response.json();
  };
  const write = async (suffix, data) => {
    const response = await admin.request.post(base + '/api/admin/handovers' + suffix, {headers: {Origin: base}, data: {...data, requestKey: randomUUID()}});
    assert.ok(response.ok(), await response.text()); return response.json();
  };
  const command = async (id, name) => {
    const {handover} = await get('/' + id);
    return write('/' + id + '/commands', {command: name, expectedVersion: handover.version});
  };
  const create = async label => {
    const {handover} = await write('', {clientName: 'Khách ' + label, title: 'Buổi chụp ' + label, service: 'Ảnh gia đình'});
    await command(handover.id, 'complete');
    return {id: handover.id, url: (await get('/' + handover.id + '/link')).url};
  };
  const open = async invitation => {
    const page = await customers.newPage();
    await page.goto(invitation.url); await page.locator('.feedback-form,.feedback-saved').waitFor();
    return page;
  };
  const assertPrivateStorage = async page => {
    assert.deepEqual(await page.evaluate(() => ({local: {...localStorage}, session: {...sessionStorage}, writes: window.__feedbackStorageWrites})), {local: {}, session: {}, writes: []}, 'Private names, drafts and invitation tokens must never enter browser storage');
  };
  const close = async page => {await assertPrivateStorage(page); await page.close();};
  const submit = async page => {
    await page.locator('[type=submit]').click();
    await page.locator('[data-action=view]').waitFor();
  };
  const settleDOM = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const revalidate = page => page.evaluate(() => window.dispatchEvent(new Event('online')));
  const holdNextRead = async (page, id) => {
    const captured = deferred(), release = deferred(), delivered = deferred();
    releases.push(release.resolve);
    let held = false;
    const endpoint = base + '/api/feedback/' + id;
    const handler = async route => {
      if (route.request().method() !== 'GET' || held) return route.fallback();
      held = true;
      try {
        const response = await route.fetch();
        assert.equal(response.status(), 200, await response.text());
        captured.resolve(await response.json());
        await release.promise;
        await route.fulfill({response});
      } finally {delivered.resolve();}
    };
    await page.route(endpoint, handler);
    return {captured: captured.promise, release: async () => {
      const response = page.waitForResponse(item => item.url() === endpoint && item.request().method() === 'GET');
      release.resolve(); await delivered.promise; await (await response).finished();
      await settleDOM(page); await page.unroute(endpoint, handler);
    }};
  };

  for (const failure of ['invalid-json', 'missing-ack']) {
    const invitation = await create(failure), page = await open(invitation);
    const bodies = [];
    await page.route(base + '/api/feedback/' + invitation.id, async route => {
      if (route.request().method() !== 'PUT') return route.fallback();
      bodies.push({authorization: route.request().headers().authorization, body: route.request().postDataJSON()});
      const response = await route.fetch();
      assert.equal(response.status(), 200, await response.text());
      if (bodies.length !== 1) return route.fulfill({response});
      const data = await response.json();
      delete data.acknowledgedVersion;
      return route.fulfill({status: 200, contentType: 'application/json', body: failure === 'invalid-json' ? '{broken' : JSON.stringify(data)});
    });
    const original = 'Đã gửi nhưng chưa nhận xác nhận: ' + failure;
    const newer = 'Bản nháp mới phải giữ riêng: ' + failure;
    await page.locator('[name=message]').fill(original);
    await page.locator('[name=rating-shoot][value="5"]').check();
    await page.locator('[type=submit]').click();
    await page.locator('[data-action=retry-save]').waitFor();
    assert.equal((await get('/' + invitation.id)).handover.latestVersion, 1);
    assert.equal(await page.locator('[type=submit]').isDisabled(), true);
    await page.locator('[name=message]').fill(newer);
    await page.locator('[name=improvement]').fill('Phần bổ sung chưa được gửi');
    await page.locator('[data-clear=shoot]').click();
    await page.locator('[data-action=retry-save]').click();
    await page.locator('[data-action=retry-save]').waitFor({state: 'detached'});
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[1], bodies[0], 'Retry must replay exact original identity, version and payload');
    assert.equal(await page.locator('[name=message]').inputValue(), newer);
    assert.equal(await page.locator('[name=improvement]').inputValue(), 'Phần bổ sung chưa được gửi');
    assert.equal(await page.locator('[name=rating-shoot]:checked').count(), 0);
    let stored = (await get('/' + invitation.id)).handover;
    assert.equal(stored.latestVersion, 1); assert.equal(stored.latestFeedback.message, original);
    await submit(page);
    assert.equal(bodies.length, 3);
    assert.notEqual(bodies[2].body.requestKey, bodies[0].body.requestKey);
    assert.equal(bodies[2].body.expectedVersion, 1);
    stored = (await get('/' + invitation.id)).handover;
    assert.equal(stored.latestVersion, 2); assert.equal(stored.latestFeedback.message, newer);
    assert.equal(stored.latestFeedback.ratings.shoot, null);
    assert.equal((await get('/' + invitation.id + '/revisions')).revisions.length, 2);
    await close(page);
  }
  console.log('PASS: malformed JSON and missing ACK after commit replay the exact original request, retain newer text/rating edits, and require an explicit single-version update.');

  const shared = await create('hai tab'), first = await open(shared), second = await open(shared);
  await first.locator('[name=message]').fill('Nội dung đã gửi từ tab thứ nhất');
  const secondDraft = 'Phần đang viết trong tab thứ hai';
  await second.locator('[name=message]').fill(secondDraft);
  await second.locator('[name=rating-delivery][value="3"]').check();
  await submit(first);
  await second.locator('[type=submit]').click();
  await second.locator('[data-action=review]').waitFor();
  assert.equal(await second.locator('[name=message]').inputValue(), secondDraft);
  assert.equal(await second.locator('[type=submit]').isDisabled(), true);
  assert.equal((await get('/' + shared.id)).handover.latestVersion, 1);
  await second.locator('[data-action=review]').click();
  await second.locator('[data-action=accept-review]').waitFor();
  assert.match(await second.locator('.feedback-saved').innerText(), /tab thứ nhất/);
  await second.locator('.feedback-recovery>summary').click();
  assert.ok((await second.locator('.feedback-recovery textarea').inputValue()).includes(secondDraft));
  assert.equal((await get('/' + shared.id)).handover.latestVersion, 1, 'Review must not save automatically');
  await second.locator('[data-action=accept-review]').click();
  assert.equal(await second.locator('[name=message]').inputValue(), secondDraft);
  assert.equal(await second.locator('[name=rating-delivery]:checked').inputValue(), '3');
  await submit(second);
  assert.equal((await get('/' + shared.id)).handover.latestVersion, 2);
  await close(first); await close(second);
  console.log('PASS: two-tab conflict preserves text and ratings and requires review, explicit acceptance, and an explicit save.');

  const a = await create('ngữ cảnh A'), b = await create('ngữ cảnh B'), moving = await open(a);
  const originalHash = new URL(moving.url()).hash;
  // Keyboard activation is the intended skip-link flow and must not replace the bearer fragment.
  await moving.locator('[data-action=skip]').focus(); await moving.keyboard.press('Enter');
  assert.equal(new URL(moving.url()).hash, originalHash);
  assert.equal(await moving.locator('main').evaluate(node => node === document.activeElement), true);
  const aRead = await holdNextRead(moving, a.id);
  await revalidate(moving); await aRead.captured;
  assert.equal(await moving.locator('.feedback-form,.feedback-context').count(), 0);
  await moving.evaluate(url => {history.replaceState(null, '', url); window.dispatchEvent(new HashChangeEvent('hashchange'));}, b.url);
  await moving.locator('.feedback-form').waitFor();
  assert.equal(await moving.locator('[name=name]').inputValue(), 'Khách ngữ cảnh B');
  await aRead.release();
  assert.equal(await moving.locator('[name=name]').inputValue(), 'Khách ngữ cảnh B');
  assert.doesNotMatch(await moving.locator('main').innerText(), /ngữ cảnh A/);
  await moving.locator('[name=message]').fill('Bản nháp chỉ thuộc ngữ cảnh B');
  await moving.evaluate(url => {history.replaceState(null, '', url); window.dispatchEvent(new HashChangeEvent('hashchange'));}, a.url);
  await moving.locator('[data-action=change-context]').waitFor();
  assert.equal(await moving.locator('.feedback-form,.feedback-context').count(), 0);
  await moving.locator('.feedback-recovery>summary').click();
  assert.match(await moving.locator('.feedback-recovery textarea').inputValue(), /chỉ thuộc ngữ cảnh B/);
  await moving.locator('[data-action=change-context]').click();
  await moving.locator('.feedback-form').waitFor();
  assert.equal(await moving.locator('[name=name]').inputValue(), 'Khách ngữ cảnh A');
  assert.equal(await moving.locator('[name=message]').inputValue(), '');
  await close(moving);
  console.log('PASS: keyboard skip preserves the token; delayed context A cannot overwrite B; a dirty context switch requires explicit continuation and never mixes drafts.');

  for (const dirty of [false, true]) {
    const invitation = await create(dirty ? 'thu hồi bản nháp' : 'thu hồi bản đã lưu');
    const page = await open(invitation);
    const savedText = 'Nội dung riêng đã lưu cần ẩn khi kiểm tra quyền';
    await page.locator('[name=message]').fill(savedText); await submit(page);
    await page.locator('[data-action=view]').click(); await page.locator('.feedback-saved').waitFor();
    const draft = 'Chỉ giữ phần sửa chưa gửi sau thu hồi';
    if (dirty) {await page.locator('[data-action=edit]').click(); await page.locator('[name=message]').fill(draft);}
    const oldActive = await holdNextRead(page, invitation.id);
    await revalidate(page); await oldActive.captured;
    assert.equal(await page.locator('.feedback-saved,.feedback-form,.feedback-context').count(), 0, 'Revalidation must immediately hide server-provided body');
    assert.ok(!(await page.locator('main').innerText()).includes(savedText));
    if (!dirty) assert.equal(await page.locator('.feedback-recovery').count(), 0);
    await command(invitation.id, 'revoke');
    await revalidate(page);
    await page.getByRole('heading', {name: 'Đường dẫn hiện không dùng được', exact: true}).waitFor();
    await oldActive.release();
    await page.getByRole('heading', {name: 'Đường dẫn hiện không dùng được', exact: true}).waitFor();
    assert.equal(await page.locator('.feedback-saved,.feedback-form,.feedback-context').count(), 0, 'An old active response cannot reopen revoked access');
    assert.ok(!(await page.locator('main').innerText()).includes(savedText));
    if (dirty) {
      await page.locator('.feedback-recovery>summary').click();
      const recovered = await page.locator('.feedback-recovery textarea').inputValue();
      assert.ok(recovered.includes(draft)); assert.ok(!recovered.includes(savedText));
    } else assert.equal(await page.locator('.feedback-recovery').count(), 0, 'Clean saved feedback must not remain as a recoverable draft');
    await close(page);
  }
  await f.feedbackDispatcher.runOnce();
  assert.ok(mails.length > 0); assert.ok(mails.every(mail => mail.to === 'studio@example.test'));
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(`PASS: revalidation immediately hides saved details, stale active reads cannot reopen revoked access, only dirty text remains recoverable, and private storage/external requests remain empty (${engine}).`);
} finally {
  for (const release of releases) release();
  await browser?.close(); await f.feedbackDispatcher.stop();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await f.db.close(); await rm(dir, {recursive: true, force: true});
}
