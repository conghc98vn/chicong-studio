import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';

const pw = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const directory = await mkdtemp(path.join(tmpdir(), 'chicong-inquiry-editor-'));
let instance, server, browser;
try {
  instance = await createApp({dataDir: directory, env: {}, seed: false});
  const id = 'b'.repeat(32);
  await instance.db.run('INSERT INTO inquiries(id,name,email,date,service,message,status,created,notes) VALUES(?,?,?,?,?,?,?,?,?)',
    [id, 'Synthetic customer', 'customer@example.invalid', '2099-11-20', 'Wedding', 'A synthetic inquiry', 'new', new Date().toISOString(), 'Original notes']);
  server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  browser = await pw.chromium.launch({channel: 'chrome', headless: true});
  const context = await browser.newContext();
  assert.equal((await context.request.post(base + '/api/admin/setup', {
    headers: {Origin: base}, data: {email: 'inquiry@example.invalid', password: 'synthetic-inquiry-password'}
  })).status(), 201);
  const first = await context.newPage();
  const second = await context.newPage();
  const errors = [];
  for (const page of [first, second]) {
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/admin#inquiries');
    await page.locator('[data-action=inquiry-detail]').click();
    await page.locator('[data-form=inquiry-status]').waitFor();
  }
  const firstForm = first.locator('[data-form=inquiry-status]');
  await firstForm.locator('[name=status]').selectOption('cancelled');
  await firstForm.locator('[name=notes]').fill('Customer cancelled in the other tab');
  await firstForm.getByRole('button', {name: 'Lưu yêu cầu', exact: true}).click();
  await first.locator('#editor').waitFor({state: 'hidden'});

  const secondForm = second.locator('[data-form=inquiry-status]');
  const save = secondForm.getByRole('button', {name: 'Lưu yêu cầu', exact: true});
  await secondForm.locator('[name=status]').selectOption('contacted');
  await secondForm.locator('[name=notes]').fill('Keep my unsaved draft');
  const response = second.waitForResponse(response => response.request().method() === 'PATCH');
  await save.click();
  assert.equal((await response).status(), 409, 'a stale browser editor must not overwrite another tab');
  await secondForm.locator('.form-error').filter({hasText: 'đã thay đổi'}).waitFor();
  assert.equal(await secondForm.locator('[name=notes]').inputValue(), 'Keep my unsaved draft');
  assert.equal(await save.isEnabled(), true);
  assert.equal((await instance.db.get('SELECT status FROM inquiries WHERE id=?', [id])).status, 'cancelled');
  const accessibility = [];
  for (const width of [320, 1280]) {
    await second.setViewportSize({width, height: 844});
    await second.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(await second.locator('#editor').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), `Inquiry dialog overflow at ${width}px`);
    const reloadControl = secondForm.locator('[data-inquiry-reload]');
    await reloadControl.scrollIntoViewIfNeeded();
    await reloadControl.focus();
    assert.ok(await reloadControl.evaluate(button => {
      const rect = button.getBoundingClientRect();
      return button === document.activeElement && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
    }), `Reload must be reachable by keyboard at ${width}px`);
    if (process.env.STUDIO_BROWSER_EVIDENCE_DIR) {
      await mkdir(process.env.STUDIO_BROWSER_EVIDENCE_DIR, {recursive: true});
      await second.screenshot({path: path.join(process.env.STUDIO_BROWSER_EVIDENCE_DIR, `inquiry-conflict-${width}.png`)});
    }
    if (process.env.STUDIO_AXE_MODULE) {
      const {default: AxeBuilder} = await import(process.env.STUDIO_AXE_MODULE);
      const scan = await new AxeBuilder({page: second}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      accessibility.push({width, violations: scan.violations, incomplete: scan.incomplete});
      if (process.env.STUDIO_BROWSER_EVIDENCE_DIR) {
        await writeFile(path.join(process.env.STUDIO_BROWSER_EVIDENCE_DIR, 'inquiry-accessibility.json'), JSON.stringify(accessibility, null, 2));
      }
      assert.deepEqual(scan.violations.map(item => ({id: item.id, nodes: item.nodes.map(node => node.target)})), [], `Inquiry accessibility violations at ${width}px`);
    }
  }
  console.log(`Inquiry accessibility scans: ${accessibility.length}${accessibility.length ? '' : ' (STUDIO_AXE_MODULE not configured)'}`);

  // A failed explicit reload must preserve the draft and allow a retry.
  const reload = secondForm.getByRole('button', {name: 'Tải lại yêu cầu (bỏ thay đổi chưa lưu)', exact: true});
  await second.route('**/api/admin/inquiries', route => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({error: 'Synthetic reload failure'})
  }), {times: 1});
  await reload.click();
  await second.locator('[role=status]').filter({hasText: 'Synthetic reload failure'}).waitFor();
  assert.equal(await secondForm.locator('[name=notes]').inputValue(), 'Keep my unsaved draft');
  assert.equal(await reload.isEnabled(), true);
  await reload.click();
  await second.waitForFunction(() => document.querySelector('[data-form=inquiry-status] [name=notes]')?.value === 'Customer cancelled in the other tab');
  assert.equal(await secondForm.locator('[name=status]').inputValue(), 'cancelled');
  await secondForm.locator('[name=notes]').fill('Reviewed cancellation');
  await save.click();
  await second.locator('#editor').waitFor({state: 'hidden'});
  const latest = await instance.db.get('SELECT status,notes FROM inquiries WHERE id=?', [id]);
  assert.deepEqual({...latest}, {status: 'cancelled', notes: 'Reviewed cancellation'});
  assert.deepEqual(errors, []);
  console.log('PASS: Two real inquiry editors reject stale changes, preserve the draft, retry a failed reload, and save the refreshed record.');
} finally {
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve));
  await instance?.photoCleanup.close();
  await instance?.mediaControl.close();
  await instance?.db.close();
  await rm(directory, {recursive: true, force: true});
}
