import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';

// Entirely isolated: no production database, email provider, or remote assets.
const pw = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.STUDIO_BROWSER || 'chromium';
const out = process.env.STUDIO_BROWSER_EVIDENCE_DIR || 'output/feedback-2026-10-23';
const dir = await mkdtemp(path.join(tmpdir(), 'customer-feedback-browser-'));
const env = {FEEDBACK_LINK_SECRET: randomBytes(32).toString('base64url'), NOTIFICATION_EMAIL: 'studio@example.test'};
const mails = [];
const f = await createApp({dataDir: dir, env, seed: false, mailer: {enabled: true, sendEmail: async message => {mails.push(message); return {success: true, id: 'test-mail'};}}});
const server = f.app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
env.SITE_URL = base;
let browser;
const errors = [], externalRequests = [], accessibility = [];
try {
  await mkdir(out, {recursive: true});
  browser = await pw[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
  const adminContext = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const customerContext = await browser.newContext({viewport: {width: 390, height: 844}});
  for (const context of [adminContext, customerContext]) {
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== base) {externalRequests.push(route.request().url()); return route.abort();}
      return route.continue();
    });
    context.on('page', page => {page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));});
  }
  const setup = await adminContext.request.post(base + '/api/admin/setup', {headers: {Origin: base}, data: {email: 'qa@example.test', password: 'feedback-test-password-123'}});
  assert.equal(setup.status(), 201, await setup.text());
  const admin = await adminContext.newPage(), customer = await customerContext.newPage();
  const api = async endpoint => {const response = await adminContext.request.get(base + '/api/admin/handovers' + endpoint); assert.equal(response.status(), 200, await response.text()); return response.json();};
  const act = name => admin.locator(`[data-feedback-action="${name}"]`);
  const command = async name => {
    const button = admin.locator(`[data-feedback-action="command"][data-command="${name}"]`);
    if (!await button.isVisible()) await admin.locator('.feedback-actions-menu>summary').click();
    const refreshed = admin.waitForResponse(response => response.url().endsWith('/api/admin/handovers/' + handoverId) && response.request().method() === 'GET');
    await button.click();
    const confirm = admin.locator(`[data-feedback-action="confirm-command"][data-command="${name}"]`);
    if (await confirm.count()) await confirm.click();
    await refreshed;
    await admin.locator('.feedback-editor').waitFor();
  };
  const screenshots = async (page, prefix) => {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({width, height: width >= 768 ? 1000 : 844});
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${prefix}: horizontal overflow at ${width}px`);
      await page.screenshot({path: path.join(out, `${engine}-${prefix}-${width}.png`), fullPage: true});
    }
  };
  const axe = async (page, name, include) => {
    if (!process.env.STUDIO_AXE_MODULE) return;
    const {default: AxeBuilder} = await import(process.env.STUDIO_AXE_MODULE);
    let builder = new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']);
    if (include) builder = builder.include(include);
    const result = await builder.analyze();
    accessibility.push({name, violations: result.violations});
    assert.deepEqual(result.violations.map(({id, impact, nodes}) => ({id, impact, targets: nodes.map(node => node.target)})), [], `${name}: accessibility violations`);
  };

  await admin.goto(base + '/admin#feedback');
  await act('new').click();
  await admin.locator('[name=clientName]').fill('Hoàng & Trang');
  await admin.locator('[name=title]').fill('Một ngày thật đẹp');
  await admin.locator('[name=service]').fill('Ảnh cưới');
  await admin.locator('[name=shootDate]').fill('2026-10-20');
  await admin.locator('[name=deliveredOn]').fill('2026-10-23');
  await admin.locator('.feedback-editor [type=submit]').click();
  await admin.locator('[data-command=complete]').waitFor();
  const handoverId = new URL(admin.url()).hash.split('/')[1];
  let handover = (await api('/' + handoverId)).handover;
  assert.deepEqual(handover.albumIds, []);
  assert.equal(handover.deliveryState, 'draft');
  assert.equal(await act('copy-link').count(), 0);
  await command('complete');
  await admin.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async () => {throw new Error('Clipboard disabled in acceptance test');}}}));
  await act('copy-link').click();
  const fallback = admin.locator('[data-feedback-copy] textarea');
  await fallback.waitFor();
  const invitationUrl = await fallback.inputValue();
  assert.equal(new URL(invitationUrl).origin, base);
  assert.ok(new URL(invitationUrl).hash.length > 20);
  await act('copy-invitation').click();
  await admin.waitForFunction(() => document.querySelector('[data-feedback-copy] textarea')?.value.startsWith('Chào'));
  assert.ok((await fallback.inputValue()).includes(invitationUrl));
  console.log('PASS: Admin creates a handover without gallery, completes delivery and copies a private invitation with clipboard fallback.');

  const shell = await customer.goto(invitationUrl);
  assert.match(shell.headers()['cache-control'], /no-store/);
  assert.equal(shell.headers()['referrer-policy'], 'no-referrer');
  await customer.locator('.feedback-form').waitFor();
  assert.equal(await customer.locator('[name=name]').inputValue(), 'Hoàng & Trang');
  assert.equal(await customer.locator('[type=radio]:checked').count(), 0);
  await customer.locator('[type=submit]').click();
  await customer.locator('[name=message][aria-invalid=true]').waitFor();
  assert.equal(await customer.locator('[name=message]').evaluate(node => node === document.activeElement), true);
  await customer.locator('[name=message]').fill('Cảm ơn Công, buổi chụp rất thoải mái và ảnh giữ được nhiều cảm xúc.');
  for (const [key, value] of Object.entries({overall: 5, shoot: 4, product: 5, delivery: 3})) await customer.locator(`[name=rating-${key}][value="${value}"]`).check();
  await customer.locator('[data-clear=delivery]').click();
  assert.equal(await customer.locator('[name=rating-delivery]:checked').count(), 0);
  await customer.locator('[name=rating-delivery][value="4"]').check();
  await customer.locator('[name=improvement]').fill('Mình mong nhận lịch bàn giao sớm hơn một chút.');
  await screenshots(customer, 'customer-form');
  await axe(customer, 'customer form');
  await customer.locator('[type=submit]').click();
  await customer.getByRole('heading', {name: 'Cảm ơn bạn đã chia sẻ', exact: true}).waitFor();
  await customer.locator('[data-action=view]').click();
  await customer.locator('[data-action=edit]').click();
  await customer.locator('[name=message]').fill('Bổ sung: cả nhà đều rất thích bộ ảnh. Cảm ơn Công nhiều!');
  // Clearing a rating must persist null, since every criterion is optional.
  await customer.locator('[data-clear=shoot]').click();
  await customer.locator('[type=submit]').click();
  await customer.getByRole('heading', {name: 'Đã lưu cập nhật của bạn', exact: true}).waitFor();
  await customer.reload();
  await customer.locator('.feedback-saved').waitFor();
  assert.match(await customer.locator('.feedback-saved').innerText(), /Bổ sung: cả nhà/);
  handover = (await api('/' + handoverId)).handover;
  assert.equal(handover.latestVersion, 2);
  assert.deepEqual(handover.latestFeedback.ratings, {overall: 5, shoot: null, product: 5, delivery: 4});
  assert.equal(handover.unread, true);
  await screenshots(customer, 'customer-saved');
  await axe(customer, 'customer saved');
  console.log('PASS: Customer validation, four optional ratings, clear rating, first submit, edit and reload persist two revisions.');

  await admin.reload();
  await act('history').click();
  await admin.waitForFunction(() => document.querySelectorAll('.feedback-history-item').length === 2);
  assert.equal(await admin.locator('.feedback-history-item').count(), 2);
  await admin.locator('.feedback-history-item').last().locator('summary').click();
  assert.match(await admin.locator('.feedback-history-item').last().innerText(), /buổi chụp rất thoải mái/);
  assert.equal((await api('/' + handoverId)).handover.unread, true);
  await act('read').click();
  await admin.waitForFunction(() => document.querySelector('.feedback-badges')?.textContent.includes('Đã đọc'));
  assert.equal((await api('/' + handoverId)).handover.readVersion, 2);
  await screenshots(admin, 'admin-detail');
  await axe(admin, 'admin feedback detail', '.feedback-admin');
  await act('back').click();
  await admin.locator('.feedback-list-row').waitFor();
  await screenshots(admin, 'admin-list');
  await admin.locator('.feedback-list-row').click();
  await admin.locator('.feedback-editor').waitFor();
  console.log('PASS: Admin history retains exact prior content, does not auto-read, and explicitly marks only the observed version read.');

  await command('pause');
  await customer.reload();
  await customer.getByRole('heading', {name: 'Đường dẫn hiện không dùng được', exact: true}).waitFor();
  assert.equal(await customer.locator('.feedback-saved,.feedback-form').count(), 0);
  await screenshots(customer, 'customer-unavailable');
  await axe(customer, 'customer unavailable');
  await command('resume');
  await customer.locator('[data-action=reload]').click();
  await customer.locator('.feedback-saved').waitFor();
  await command('revoke');
  await customer.reload();
  await customer.getByRole('heading', {name: 'Đường dẫn hiện không dùng được', exact: true}).waitFor();
  await command('issue');
  await customer.reload();
  await customer.getByRole('heading', {name: 'Đường dẫn hiện không dùng được', exact: true}).waitFor();
  const newUrl = (await api('/' + handoverId + '/link')).url;
  assert.notEqual(newUrl, invitationUrl);
  await customer.goto(newUrl);
  await customer.locator('.feedback-saved').waitFor();
  assert.equal((await api('/' + handoverId)).handover.latestVersion, 2);
  await f.feedbackDispatcher.runOnce();
  assert.ok(mails.length >= 1);
  assert.ok(mails.every(mail => mail.to === 'studio@example.test'));
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  console.log(`PASS: Pause/resume, revoke/reissue, old-link denial, preserved history, local fake notifications, responsive widths 320/390/768/1440 and no external requests/runtime errors (${engine}).`);
} finally {
  await writeFile(path.join(out, `${engine}-accessibility.json`), JSON.stringify(accessibility, null, 2));
  await browser?.close();
  await f.feedbackDispatcher.stop();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await f.db.close();
  await rm(dir, {recursive: true, force: true});
}
