import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';

// Synthetic localhost-only data. Never use deployment credentials or real mail.
const pw = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.STUDIO_BROWSER || 'chromium';
const out = process.env.STUDIO_BROWSER_EVIDENCE_DIR || 'output/feedback-verify-2026-10-23/browser';
const dir = await mkdtemp(path.join(tmpdir(), 'feedback-adversarial-'));
const env = {FEEDBACK_LINK_SECRET: randomBytes(32).toString('base64url')};
const f = await createApp({dataDir: dir, env, seed: false});
const server = f.app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
env.SITE_URL = base;
let browser, releaseSave;
const results = [], errors = [], external = [];
try {
  await mkdir(out, {recursive: true});
  browser = await pw[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
  const adminContext = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const customerContext = await browser.newContext({viewport: {width: 320, height: 844}});
  for (const context of [adminContext, customerContext]) {
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== base) {external.push(route.request().url()); return route.abort();}
      return route.continue();
    });
    context.on('page', page => {page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));});
  }
  const setup = await adminContext.request.post(base + '/api/admin/setup', {headers: {Origin: base}, data: {email: 'adversarial@example.test', password: 'isolated-adversarial-feedback-123'}});
  assert.equal(setup.status(), 201, await setup.text());
  const get = async suffix => {
    const response = await adminContext.request.get(base + '/api/admin/handovers' + suffix);
    assert.equal(response.status(), 200, await response.text()); return response.json();
  };
  const write = async (suffix, data) => {
    const response = await adminContext.request.post(base + '/api/admin/handovers' + suffix, {headers: {Origin: base}, data: {...data, requestKey: randomUUID()}});
    assert.ok(response.ok(), await response.text()); return response.json();
  };
  const axe = async (page, name, include) => {
    if (!process.env.STUDIO_AXE_MODULE) return;
    const {default: AxeBuilder} = await import(process.env.STUDIO_AXE_MODULE);
    let builder = new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']);
    if (include) builder = builder.include(include);
    const result = await builder.analyze();
    results.push({name, violations: result.violations});
    assert.deepEqual(result.violations.map(v => ({id: v.id, targets: v.nodes.map(n => n.target)})), [], name);
  };
  const hostile = '<img src=x onerror="window.__feedbackXss=1"> & </textarea><script>window.__feedbackXss=2</script>';
  let {handover} = await write('', {clientName: hostile, title: 'Kiểm tra an toàn nội dung', service: 'Ảnh gia đình'});
  const id = handover.id;
  const admin = await adminContext.newPage();
  await admin.goto(base + '/admin#feedback/' + id);
  await admin.locator('.feedback-editor').waitFor();
  assert.equal(await admin.locator('[name=clientName]').inputValue(), hostile);
  assert.equal(await admin.evaluate(() => window.__feedbackXss), undefined);

  // Hold a real committed save ACK. Editable controls at this point allow
  // genuine keystrokes to be silently discarded when the page refreshes.
  let captureSave;
  const captured = new Promise(resolve => {captureSave = resolve;});
  const released = new Promise(resolve => {releaseSave = resolve;});
  const patchHandler = async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const response = await route.fetch();
    assert.equal(response.status(), 200, await response.text());
    captureSave(); await released; await route.fulfill({response});
  };
  await admin.route(base + '/api/admin/handovers/' + id, patchHandler);
  await admin.locator('[name=notes]').fill('Ghi chú đã gửi');
  await admin.locator('.feedback-editor [type=submit]').click();
  await captured;
  assert.equal(await admin.locator('[name=notes]').isDisabled(), true, 'Admin fields must be locked while saving to prevent silently dropping later keystrokes');
  releaseSave();
  await admin.waitForFunction(() => document.querySelector('[name=notes]')?.disabled === false);
  assert.equal(await admin.locator('[name=notes]').inputValue(), 'Ghi chú đã gửi');
  await admin.unroute(base + '/api/admin/handovers/' + id, patchHandler);
  console.log('PASS: Slow admin save locks editable controls until its committed ACK and preserves submitted notes.');

  handover = (await get('/' + id)).handover;
  await write('/' + id + '/commands', {command: 'complete', expectedVersion: handover.version});
  const invitation = (await get('/' + id + '/link')).url;
  const customer = await customerContext.newPage();
  await customer.goto(invitation);
  await customer.locator('.feedback-form').waitFor();
  assert.equal(await customer.locator('[name=name]').inputValue(), hostile);
  assert.equal(await customer.locator('.feedback-context img,.feedback-context script').count(), 0);
  assert.equal(await customer.evaluate(() => window.__feedbackXss), undefined);
  await customer.locator('[name=message]').fill('a'.repeat(3001));
  await customer.locator('[type=submit]').click();
  await customer.locator('[name=message][aria-invalid=true]').waitFor();
  assert.equal(await customer.locator('[name=message]').evaluate(el => el === document.activeElement), true);
  assert.equal((await get('/' + id)).handover.latestVersion, 0);
  await axe(customer, 'oversize validation at 320px');
  await customer.locator('[name=message]').fill(hostile);
  await customer.locator('[name=rating-overall][value="1"]').focus();
  await customer.keyboard.press('Space'); await customer.keyboard.press('ArrowRight');
  assert.equal(await customer.locator('[name=rating-overall]:checked').inputValue(), '2');
  await customer.locator('[data-clear=overall]').click();
  assert.equal(await customer.locator('[name=rating-overall]:checked').count(), 0);
  await customer.locator('[type=submit]').click();
  await customer.locator('[data-action=view]').waitFor();
  await customer.locator('[data-action=view]').click();
  assert.ok((await customer.locator('.feedback-saved').innerText()).includes(hostile));
  assert.equal(await customer.locator('.feedback-saved img,.feedback-saved script').count(), 0);
  assert.equal(await customer.evaluate(() => window.__feedbackXss), undefined);
  assert.equal(await customer.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Long escaped name must not overflow the narrow saved view');
  await axe(customer, 'escaped saved content at 320px');
  await customer.screenshot({path: path.join(out, engine + '-adversarial-saved-320.png'), fullPage: true});
  await admin.reload(); await admin.locator('.feedback-revision').waitFor();
  assert.ok((await admin.locator('.feedback-revision').first().innerText()).includes(hostile));
  assert.equal(await admin.locator('.feedback-admin img,.feedback-admin script').count(), 0);
  assert.equal(await admin.evaluate(() => window.__feedbackXss), undefined);
  await axe(admin, 'escaped admin detail', '.feedback-admin');
  await admin.setViewportSize({width: 320, height: 844});
  assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Long escaped name must not overflow narrow admin detail');
  await admin.screenshot({path: path.join(out, engine + '-adversarial-admin-320.png'), fullPage: true});
  console.log('PASS: Stored markup is inert in admin/customer views; oversize text focuses its error; native keyboard ratings and clear work.');

  await customer.locator('[data-action=edit]').click();
  await customer.locator('[name=message]').fill('Phần đang viết vẫn cần sao chép khi studio tạm đóng.');
  handover = (await get('/' + id)).handover;
  await write('/' + id + '/commands', {command: 'pause', expectedVersion: handover.version});
  await customer.evaluate(() => window.dispatchEvent(new Event('online')));
  await customer.getByRole('heading', {name: 'Đường dẫn hiện không dùng được', exact: true}).waitFor();
  await customer.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async () => {throw new Error('Isolated clipboard denial');}}}));
  await customer.locator('[data-action=copy]').click();
  assert.equal(await customer.locator('.feedback-recovery').evaluate(el => el.open), true);
  assert.match(await customer.locator('.feedback-recovery textarea').inputValue(), /vẫn cần sao chép/);
  assert.equal(await customer.locator('.feedback-saved,.feedback-context').count(), 0);
  await axe(customer, 'paused link draft clipboard fallback');
  assert.deepEqual(await customer.evaluate(() => ({local: {...localStorage}, session: {...sessionStorage}})), {local: {}, session: {}});
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(`PASS: Paused access hides saved data, clipboard-denied draft recovery stays accessible, and private storage/external requests/runtime errors remain empty (${engine}).`);
} finally {
  releaseSave?.();
  await writeFile(path.join(out, engine + '-adversarial-accessibility.json'), JSON.stringify(results, null, 2));
  await browser?.close(); await f.feedbackDispatcher.stop();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await f.db.close(); await rm(dir, {recursive: true, force: true});
}
