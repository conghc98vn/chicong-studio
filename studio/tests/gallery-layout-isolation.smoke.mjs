import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.mjs';

const playwright = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
const dir = await mkdtemp(path.join(tmpdir(), 'gallery-layout-isolation-'));
const fixture = await createApp({dataDir: dir, env: {}, seed: false});
const server = fixture.app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const evidence = process.env.STUDIO_BROWSER_EVIDENCE_DIR;
let browser;
try {
  const album = 'a'.repeat(32), filename = 'b'.repeat(32);
  await fixture.db.run('INSERT INTO albums(id,title,category,status) VALUES(?,?,?,?)', [album, 'Bộ ảnh thử giao diện', 'wedding', 'private']);
  const image = await sharp({create: {width: 120, height: 80, channels: 3, background: '#65755d'}}).webp().toBuffer();
  await fixture.storage.put(filename + '.webp', image);
  await fixture.storage.put(filename + '-thumb.webp', image);
  for (let i = 0; i < 361; i++) await fixture.db.run('INSERT INTO photos(id,album_id,filename,original,caption,width,height,position) VALUES(?,?,?,?,?,?,?,?)', [(i+1).toString(16).padStart(32,'0'), album, filename, `photo-${i}.jpg`, `Ảnh ${i}`,120,80,i]);
  browser = await playwright.chromium.launch({channel: 'chrome', headless: true});
  const context = await browser.newContext({viewport: {width: 320, height: 740}});
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [], driveRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {if (/\/app\/drive-/.test(request.url())) driveRequests.push(request.url());});
  await page.goto(base + '/gallery/' + album);
  await page.locator('.client-toolbar').waitFor();
  assert.equal(await page.locator('.photo-pagination').evaluate(el => getComputedStyle(el).display), 'flex', 'public pagination must be styled without loading the admin Drive stylesheet');
  await page.locator('.pick').first().click();
  const submit = page.locator('[data-action=submit-selection]');
  await page.waitForFunction(() => !document.querySelector('[data-action=submit-selection]').disabled);
  await submit.click();
  await page.locator('[data-submission-status]').filter({hasText: 'Studio đã nhận'}).waitFor();
  const accessibility = [];
  for (const width of [320,390,1280]) {
    await page.setViewportSize({width, height: 844});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const boxes = await page.locator('.client-toolbar').evaluate(toolbar => ({
      width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
      controls: [...toolbar.querySelectorAll('button:not([hidden])')].map(button => {
        const rect = button.getBoundingClientRect();return {left: rect.left,right: rect.right,top: rect.top,bottom: rect.bottom};
      })
    }));
    assert.equal(boxes.overflow, false, `document overflow at ${width}px`);
    assert.ok(boxes.controls.every(rect => rect.left >= 0 && rect.right <= width && rect.top >= 0 && rect.bottom <= 844), `proofing actions must remain reachable at ${width}px: ${JSON.stringify(boxes)}`);
    if (evidence) {
      await mkdir(evidence, {recursive: true});
      await page.screenshot({path: path.join(evidence, `gallery-layout-${width}.png`)});
    }
    if (process.env.STUDIO_AXE_MODULE) {
      const {default: AxeBuilder} = await import(process.env.STUDIO_AXE_MODULE);
      const scan = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      accessibility.push({width, violations: scan.violations, incomplete: scan.incomplete});
      if (evidence) {
        await writeFile(path.join(evidence, 'gallery-layout-accessibility.json'), JSON.stringify(accessibility, null, 2));
      }
      assert.deepEqual(scan.violations.map(item => ({id: item.id, nodes: item.nodes.map(node => node.target)})), [], `Accessibility violations at ${width}px`);
    }
  }
  console.log(`Gallery layout accessibility scans: ${accessibility.length}${accessibility.length ? '' : ' (STUDIO_AXE_MODULE not configured)'}`);
  await page.locator('[data-action=gallery-page][data-page="1"]').focus();
  await page.keyboard.press('Enter');
  assert.match(await page.locator('.photo-pagination [role=status]').textContent(), /Trang 2\/5/);
  assert.deepEqual(driveRequests, [], 'public styling must remain independent of admin Drive code');
  assert.deepEqual(errors, []);
  console.log('PASS: public gallery pagination and submitted-selection actions on 320/390/1280px, keyboard navigation, no Drive resources or browser errors');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await fixture.photoCleanup.close();
  await fixture.mediaControl.close();
  await fixture.db.close();
  await rm(dir, {recursive: true, force: true});
}
