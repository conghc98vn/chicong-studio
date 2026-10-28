import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';

// Real routes and commits, fake local data, no provider or production access.
const pw = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.STUDIO_BROWSER || 'chromium';
const dir = await mkdtemp(path.join(tmpdir(), 'feedback-recovery-browser-'));
const env = {FEEDBACK_LINK_SECRET: randomBytes(32).toString('base64url')};
const f = await createApp({dataDir: dir, env, seed: false});
const server = f.app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
env.SITE_URL = base;
let browser;
try {
  browser = await pw[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
  const adminContext = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const customerContext = await browser.newContext({viewport: {width: 390, height: 844}});
  const errors = [], external = [];
  for (const context of [adminContext, customerContext]) {
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== base) {external.push(route.request().url()); return route.abort();}
      return route.continue();
    });
    context.on('page', page => {page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));});
  }
  const setup = await adminContext.request.post(base + '/api/admin/setup', {headers: {Origin: base}, data: {email: 'recovery@example.test', password: 'isolated-feedback-recovery-123'}});
  assert.equal(setup.status(), 201, await setup.text());
  const admin = await adminContext.newPage(), customer = await customerContext.newPage();
  const get = async suffix => {
    const response = await adminContext.request.get(base + '/api/admin/handovers' + suffix);
    assert.equal(response.status(), 200, await response.text()); return response.json();
  };
  const write = async (suffix, data, method = 'POST') => {
    const response = await adminContext.request.fetch(base + '/api/admin/handovers' + suffix, {method, headers: {Origin: base}, data: {...data, requestKey: randomUUID()}});
    assert.ok(response.ok(), await response.text()); return response.json();
  };
  const act = name => admin.locator(`[data-feedback-action="${name}"]`);
  const visit = async id => {
    await admin.goto(base + '/admin#feedback/' + id);
    await admin.locator('.feedback-editor').waitFor();
  };
  const loss = async (suffix, method) => {
    const bodies = []; let committed;
    const routeHandler = async route => {
      if (route.request().method() !== method) return route.fallback();
      bodies.push(route.request().postDataJSON());
      const response = await route.fetch();
      assert.ok(response.ok(), await response.text());
      if (bodies.length === 1) {committed = await response.json(); return route.fulfill({status: 200, contentType: 'application/json', body: '{}'});}
      return route.fulfill({response});
    };
    const pattern = base + '/api/admin/handovers' + suffix;
    await admin.route(pattern, routeHandler);
    return {bodies, committed: () => committed, close: () => admin.unroute(pattern, routeHandler)};
  };

  // A syntactically valid, incomplete ACK after commit must retain exact identity.
  const createLoss = await loss('', 'POST');
  await visit('new');
  await admin.locator('[name=clientName]').fill('Khách kiểm tra');
  await admin.locator('[name=title]').fill('Buổi chụp kiểm tra');
  await admin.locator('[name=service]').fill('Ảnh gia đình');
  await admin.locator('[name=shootDate]').fill('2026-10-20');
  await admin.locator('[name=deliveredOn]').fill('2026-10-21');
  const saveButton = admin.locator('.feedback-editor [type=submit]');
  await saveButton.click();
  await admin.getByRole('button', {name: 'Thử lại đúng thông tin vừa lưu', exact: true}).waitFor();
  assert.equal(await admin.locator('[name=clientName]').isDisabled(), true);
  assert.equal((await get('?archived=all')).total, 1);
  const id = createLoss.committed().handover.id;
  // Simulate a script/autofill changing the disabled DOM, proving the retry uses
  // the frozen submitted snapshot rather than reconstructing form values.
  await admin.locator('[name=title]').evaluate(node => {node.value = 'Must never create another handover';});
  await saveButton.click();
  await admin.waitForURL('**#feedback/' + id);
  await admin.locator('[data-command=complete]').waitFor();
  assert.deepEqual(createLoss.bodies[1], createLoss.bodies[0]);
  assert.equal((await get('?archived=all')).total, 1);
  assert.equal((await get('/' + id)).handover.title, 'Buổi chụp kiểm tra');
  await createLoss.close();

  const patchLoss = await loss('/' + id, 'PATCH');
  await admin.locator('[name=notes]').fill('Lưu đúng một lần');
  await saveButton.click();
  await admin.getByRole('button', {name: 'Thử lại đúng thông tin vừa lưu', exact: true}).waitFor();
  const patchVersion = patchLoss.committed().handover.version;
  const refreshed = admin.waitForResponse(response => response.url() === base + '/api/admin/handovers/' + id && response.request().method() === 'GET');
  await saveButton.click(); await refreshed;
  await admin.locator('[data-command=complete]').waitFor();
  assert.deepEqual(patchLoss.bodies[1], patchLoss.bodies[0]);
  assert.equal((await get('/' + id)).handover.version, patchVersion);
  await patchLoss.close();

  const commandLoss = await loss('/' + id + '/commands', 'POST');
  await admin.locator('[data-command=complete]').click();
  await act('confirm-command').click();
  await act('retry-command').waitFor();
  assert.equal(await saveButton.isDisabled(), true);
  const completedVersion = commandLoss.committed().handover.version;
  await act('retry-command').click(); await act('copy-link').waitFor();
  assert.deepEqual(commandLoss.bodies[1], commandLoss.bodies[0]);
  assert.equal((await get('/' + id)).handover.version, completedVersion);
  await commandLoss.close();
  console.log('PASS: incomplete HTTP 200 ACK after create, patch and command commit retains the exact request and reconciles without duplicate/version increment.');

  // A customer drafting against stale context must see all updated fields and
  // be able to recover their exact draft before agreeing to continue.
  await customer.goto((await get('/' + id + '/link')).url);
  await customer.locator('.feedback-form').waitFor();
  const message = 'Bản nháp này phải được giữ nguyên trước khi xác nhận.';
  await customer.locator('[name=message]').fill(message);
  const changed = {clientName: 'Khách đã sửa', title: 'Buổi chụp đã sửa', service: 'Dịch vụ mới', shootDate: '2026-10-22', deliveredOn: '2026-10-23'};
  await write('/' + id, {...changed, expectedVersion: completedVersion}, 'PATCH');
  await customer.locator('[type=submit]').click();
  await customer.locator('[data-action=review]').waitFor();
  assert.equal(await customer.locator('[type=submit]').isDisabled(), true);
  await customer.locator('[data-action=review]').click();
  await customer.locator('[data-action=accept-review]').waitFor();
  const contextFields = await customer.locator('.feedback-context dl>div').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.querySelector('dt').textContent, node.querySelector('dd').textContent])));
  assert.deepEqual(Object.keys(contextFields), ['Khách hàng', 'Buổi chụp / đơn', 'Dịch vụ', 'Ngày chụp', 'Ngày bàn giao']);
  assert.equal(contextFields['Khách hàng'], changed.clientName);
  assert.equal(contextFields['Buổi chụp / đơn'], changed.title);
  assert.equal(contextFields['Dịch vụ'], changed.service);
  assert.match(contextFields['Ngày chụp'], /22\/10\/2026/);
  assert.match(contextFields['Ngày bàn giao'], /23\/10\/2026/);
  await customer.locator('.feedback-recovery>summary').click();
  assert.ok((await customer.locator('.feedback-recovery textarea').inputValue()).includes(message));
  assert.equal((await get('/' + id)).handover.latestVersion, 0);
  if (process.env.STUDIO_AXE_MODULE) {
    const {default: AxeBuilder} = await import(process.env.STUDIO_AXE_MODULE);
    const result = await new AxeBuilder({page: customer}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(result.violations.map(item => item.id), [], 'Customer context review accessibility');
  }
  for (const width of [320, 390, 768, 1440]) {
    await customer.setViewportSize({width, height: 900});
    assert.equal(await customer.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await customer.locator('[data-action=accept-review]').click();
  assert.equal(await customer.locator('[name=message]').inputValue(), message);
  await customer.locator('[type=submit]').click();
  await customer.getByRole('heading', {name: 'Cảm ơn bạn đã chia sẻ', exact: true}).waitFor();
  assert.equal((await get('/' + id)).handover.latestFeedback.message, message);
  console.log('PASS: all five changed context fields are visible before acceptance, the unsent draft remains recoverable, and submission requires explicit return.');

  const albumResponse = await adminContext.request.post(base + '/api/admin/albums', {headers: {Origin: base}, data: {title: 'Bộ ảnh chuyển đúng hồ sơ', category: 'wedding', status: 'draft'}});
  assert.equal(albumResponse.status(), 201, await albumResponse.text());
  const album = await albumResponse.json();
  let source = (await write('', {clientName: 'Khách nguồn', title: 'Buổi nguồn', albumIds: [album.id]})).handover;
  let target = (await write('', {clientName: 'Khách đích', title: 'Buổi đích', shootDate: '2026-10-12'})).handover;
  target = (await write('/' + target.id + '/commands', {command: 'archive', expectedVersion: target.version})).handover;
  await visit(source.id);
  await admin.locator('.feedback-transfer>summary').click();
  await admin.locator('[data-transfer-query]').fill('Khách đích');
  await act('find-transfer').click();
  await admin.locator(`[data-transfer-target] option[value="${target.id}"]`).waitFor({state: 'attached'});
  await admin.locator('[data-transfer-target]').selectOption(target.id);
  await act('prepare-transfer').click();
  const confirmation = await admin.locator('[data-transfer-confirm]').innerText();
  for (const value of ['Khách nguồn', 'Buổi nguồn', 'Khách đích', 'Buổi đích', 'Đã lưu trữ']) assert.ok(confirmation.includes(value));

  // Change the target after the user reviewed it: neither link may move on conflict.
  target = (await write('/' + target.id, {expectedVersion: target.version, title: 'Buổi đích đã sửa'}, 'PATCH')).handover;
  const transfers = [], mutations = [];
  admin.on('request', request => {if (request.method() !== 'GET' && request.url().startsWith(base + '/api/admin/handovers')) mutations.push(request.url());});
  admin.on('request', request => {if (request.url().endsWith('/transfer-album')) transfers.push(request.postDataJSON());});
  await act('confirm-transfer').click(); await act('reload-transfer').waitFor();
  assert.equal(await admin.locator('[data-transfer-target]').inputValue(), target.id);
  assert.equal(await admin.locator('[data-transfer-album]').inputValue(), album.id);
  assert.deepEqual((await get('/' + source.id)).handover.albumIds, [album.id]);
  assert.deepEqual((await get('/' + target.id)).handover.albumIds, []);
  assert.equal(await act('confirm-transfer').count(), 0);
  await act('reload-transfer').click(); await act('confirm-transfer').waitFor();
  assert.ok((await admin.locator('[data-transfer-confirm]').innerText()).includes('Buổi đích đã sửa'));
  if (process.env.STUDIO_AXE_MODULE) {
    const {default: AxeBuilder} = await import(process.env.STUDIO_AXE_MODULE);
    const result = await new AxeBuilder({page: admin}).include('.feedback-transfer').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(result.violations.map(item => ({id:item.id,nodes:item.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})), [], 'Album correction accessibility');
  }
  const transferLoss = await loss('/' + source.id + '/transfer-album', 'POST');
  await act('confirm-transfer').click(); await act('retry-transfer').waitFor();
  assert.equal(await admin.locator('[data-transfer-target]').isDisabled(), true);
  assert.deepEqual((await get('/' + source.id)).handover.albumIds, []);
  assert.deepEqual((await get('/' + target.id)).handover.albumIds, [album.id]);
  const transferVersion = transferLoss.committed().handover.version;
  await act('retry-transfer').click();
  await admin.locator('.feedback-transfer').waitFor({state: 'detached'});
  assert.deepEqual(transferLoss.bodies[1], transferLoss.bodies[0]);
  assert.equal((await get('/' + source.id)).handover.version, transferVersion);
  assert.deepEqual((await get('/' + target.id)).handover.albumIds, [album.id]);
  assert.ok((await get('/' + target.id)).handover.archivedAt);
  assert.equal(mutations.length, 3);
  assert.ok(mutations.every(url => url.endsWith('/transfer-album')), 'Never unlink and relink through separate patch calls');
  assert.notEqual(transfers[0].requestKey, transfers[1].requestKey, 'Explicit conflict review creates a new operation');
  assert.equal(transfers[1].requestKey, transfers[2].requestKey, 'Uncertain transfer replays the same operation');
  await transferLoss.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(`PASS: archived target lookup, explicit transfer confirmation, target-version conflict retains both selections/links, atomic transfer and incomplete-ACK replay (${engine}).`);
} finally {
  await browser?.close();
  await f.feedbackDispatcher.stop();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await f.db.close();
  await rm(dir, {recursive: true, force: true});
}
