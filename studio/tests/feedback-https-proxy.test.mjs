import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer as httpsServer, request as httpsRequest} from 'node:https';
import {request as httpRequest} from 'node:http';
import pg from 'pg';
import {createApp} from '../server/app.mjs';
import {openDatabase} from '../server/db.mjs';
import {createStorage} from '../server/storage.mjs';

// Explicit opt-in: only a disposable, loopback PostgreSQL database is accepted.
// No .env loading, global TLS overrides, remote storage or real mail transport.
// Optional STUDIO_PLAYWRIGHT_MODULE runs Chromium and WebKit against the same
// TLS proxy. STUDIO_FEEDBACK_HTTPS_EVIDENCE_DIR persists synthetic evidence.
const databaseUrl = process.env.STUDIO_FEEDBACK_HTTPS_POSTGRES_URL;
test('production HTTPS proxy: privacy, authenticated writes, lifecycle and persisted restore gate', {skip: !databaseUrl, timeout: 120000}, async t => {
  const configured = new URL(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(configured.hostname), 'Only a disposable local database may be used');
  const dir = await mkdtemp(path.join(tmpdir(), 'feedback-https-'));
  const schema = 'feedback_tls_' + randomUUID().replaceAll('-', '');
  const pool = new pg.Pool({connectionString: databaseUrl});
  let db, instance, upstream, proxy, schemaCreated = false;
  const shutdownApp = async () => {
    if (upstream) {upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); upstream = null;}
    if (instance) {await instance.feedbackDispatcher.stop(); await instance.photoCleanup.close(); await instance.mediaControl.close(); instance.storage.close?.(); instance = null;}
  };
  t.after(async () => {
    if (proxy) {proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve));}
    await shutdownApp(); await db?.close();
    try {if (schemaCreated) await pool.query('DROP SCHEMA ' + schema + ' CASCADE');} finally {await pool.end(); await rm(dir, {recursive: true, force: true});}
  });
  await pool.query('CREATE SCHEMA ' + schema); schemaCreated = true;
  configured.searchParams.set('options', '-c search_path=' + schema);
  db = await openDatabase(dir, {url: configured.href});
  const keyFile = path.join(dir, 'key.pem'), certFile = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', keyFile, '-out', certFile], {stdio: 'ignore'});
  const cert = await readFile(certFile), key = await readFile(keyFile), wire = [];
  proxy = httpsServer({key, cert}, (req, res) => {
    // Record URLs/referrers only, as a normal access log would. Bearer headers
    // are deliberately excluded from persisted evidence.
    wire.push({url: req.url, referer: req.headers.referer || null});
    const forwarded = httpRequest({hostname: '127.0.0.1', port: upstream.address().port, path: req.url, method: req.method,
      headers: {...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-for': req.socket.remoteAddress}}, response => {res.writeHead(response.statusCode, response.headers); response.pipe(res);});
    forwarded.on('error', () => {res.writeHead(502); res.end();}); req.pipe(forwarded);
  });
  proxy.listen(0, '127.0.0.1'); await new Promise(resolve => proxy.once('listening', resolve));
  const base = 'https://127.0.0.1:' + proxy.address().port;
  const env = {NODE_ENV: 'production', DATABASE_URL: configured.href, SITE_URL: base, TRUST_PROXY: 'loopback',
    FEEDBACK_LINK_SECRET: randomBytes(32).toString('base64url'), FEEDBACK_NOTIFICATIONS_PAUSED: 'true', SETUP_TOKEN: randomUUID(),
    ANALYTICS_ENABLED: 'true', CF_BEACON_TOKEN: 'synthetic-analytics-token', NOTIFICATION_EMAIL: 'fixture@example.invalid'};
  let sentMail = 0;
  const start = async config => {
    instance = await createApp({db, dataDir: dir, env: config, seed: false,
      storage: createStorage(path.join(dir, 'synthetic-private-media'), {MEDIA_STORAGE_PROVIDER: 'local'}),
      mailer: {enabled: true, sendEmail: async () => {sentMail++; return {success: true, id: 'synthetic-transport'};}}});
    upstream = instance.app.listen(0, '127.0.0.1'); await new Promise(resolve => upstream.once('listening', resolve));
  };
  await start(env);
  const request = (route, {method = 'GET', headers = {}, body} = {}) => new Promise((resolve, reject) => {
    const req = httpsRequest(base + route, {method, ca: cert, headers: {Origin: base, ...(body ? {'Content-Type': 'application/json'} : {}), ...headers}}, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => {const text = Buffer.concat(chunks).toString(); resolve({status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text)});});
    }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  const setup = await request('/api/admin/setup', {method: 'POST', body: {email: 'fixture@example.invalid', password: 'synthetic-local-password', token: env.SETUP_TOKEN}});
  assert.equal(setup.status, 201, setup.text);
  const cookieHeader = setup.headers['set-cookie'][0];
  for (const flag of [/; Secure/i, /; HttpOnly/i, /; SameSite=Strict/i]) assert.match(cookieHeader, flag);
  const cookie = cookieHeader.split(';')[0], admin = (route, options = {}) => request('/api/admin/handovers' + route, {...options, headers: {Cookie: cookie, ...options.headers}});
  assert.equal((await admin('')).status, 200);
  assert.equal((await request('/api/admin/handovers')).status, 401);
  const created = await admin('', {method: 'POST', body: {clientName: 'TLS synthetic customer', title: 'Local HTTPS portrait', requestKey: randomUUID()}});
  assert.equal(created.status, 200, created.text); let handover = created.json().handover;
  const command = async command => {const response = await admin('/' + handover.id + '/commands', {method: 'POST', body: {command, expectedVersion: handover.version, requestKey: randomUUID()}}); assert.equal(response.status, 200, response.text); handover = response.json().handover;};
  await command('complete');
  const link = (await admin('/' + handover.id + '/link')).json().url, token = new URL(link).hash.slice(1);
  assert.equal(new URL(link).origin, base);
  const api = '/api/feedback/' + handover.id, authorization = {Authorization: 'Bearer ' + token};
  const payload = {name: 'TLS synthetic sender', message: 'Private feedback over local TLS', improvement: '', ratings: {overall: 5, shoot: null, product: 4, delivery: null}, formVersion: 1, expectedVersion: 0, expectedContextVersion: handover.contextVersion, requestKey: randomUUID()};
  await t.test('strict private shell and origin checks through HTTPS forwarding', async () => {
    const publicShell = await request('/'); assert.match(publicShell.text, /synthetic-analytics-token/);
    const shell = await request('/feedback/' + handover.id);
    assert.equal(shell.status, 200); assert.match(shell.headers['strict-transport-security'], /max-age=31536000/);
    assert.match(shell.headers['cache-control'], /no-store/); assert.equal(shell.headers['referrer-policy'], 'no-referrer'); assert.match(shell.headers['x-robots-tag'], /noindex/);
    assert.doesNotMatch(shell.headers['content-security-policy'], /cloudflare|unsafe-inline/);
    assert.match(shell.text, /feedback-page.mjs/); assert.doesNotMatch(shell.text, /main\.js|bootstrap\.js|cloudflare|synthetic-analytics-token|TLS synthetic/);
    for (const origin of ['', 'https://attacker.invalid', 'http://' + new URL(base).host]) {
      const denied = await request(api, {method: 'PUT', headers: {...authorization, Origin: origin}, body: payload}); assert.equal(denied.status, 403); assert.match(denied.headers['cache-control'], /no-store/);
    }
    const rejectedAdmin = await admin('', {method: 'POST', headers: {Origin: 'https://attacker.invalid'}, body: {clientName: 'Attack', title: 'Denied', requestKey: randomUUID()}}); assert.equal(rejectedAdmin.status, 403);
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM feedback_revisions')).n), 0);
  });
  const browserEvidence = [];
  if (process.env.STUDIO_PLAYWRIGHT_MODULE) {
    const pw = await import(process.env.STUDIO_PLAYWRIGHT_MODULE);
    for (const engine of ['chromium', 'webkit']) await t.test(engine + ' follows fragment link without external beacon or referrer', async () => {
      const browser = await pw[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
      try {
        const context = await browser.newContext({ignoreHTTPSErrors: true, viewport: {width: 390, height: 844}}), external = [], errors = [], requests = [];
        await context.route('**/*', route => {const url = route.request().url(); requests.push(url); if (new URL(url).origin !== base) {external.push(url); return route.abort();} return route.continue();});
        const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(link); await page.locator('.feedback-form').waitFor();
        assert.equal(await page.locator('[name=name]').inputValue(), 'TLS synthetic customer');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(external, []); assert.deepEqual(errors, []);
        assert.ok(requests.every(url => !url.includes(token)), 'Fragment secret must not appear in network URLs');
        if (process.env.STUDIO_FEEDBACK_HTTPS_EVIDENCE_DIR) {await mkdir(process.env.STUDIO_FEEDBACK_HTTPS_EVIDENCE_DIR, {recursive: true}); await page.screenshot({path: path.join(process.env.STUDIO_FEEDBACK_HTTPS_EVIDENCE_DIR, engine + '-https-feedback.png'), fullPage: true});}
        browserEvidence.push({engine, requests: requests.length, externalRequests: external.length, pageErrors: errors.length});
      } finally {await browser.close();}
    });
  }
  await t.test('submit, durable replay, pause and revoked-token rejection through proxy', async () => {
    const saved = await request(api, {method: 'PUT', headers: authorization, body: payload}); assert.equal(saved.status, 200, saved.text); assert.equal(saved.json().acknowledgedVersion, 1);
    const replay = await request(api, {method: 'PUT', headers: authorization, body: payload}); assert.equal(replay.status, 200); assert.equal(replay.json().replayed, true);
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM feedback_revisions')).n), 1);
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM feedback_notifications')).n), 1);
    await command('pause');
    for (const options of [{headers: authorization}, {method: 'PUT', headers: authorization, body: payload}]) {const closed = await request(api, options); assert.ok(closed.status >= 400); assert.doesNotMatch(closed.text, /Private feedback over local TLS/);}
    await command('resume'); assert.equal((await request(api, {headers: authorization})).status, 200);
    await command('revoke'); assert.ok((await request(api, {headers: authorization})).status >= 400);
    await command('issue'); assert.ok((await request(api, {headers: authorization})).status >= 400);
    const currentToken = new URL((await admin('/' + handover.id + '/link')).json().url).hash.slice(1);
    assert.notEqual(currentToken, token); assert.equal((await request(api, {headers: {Authorization: 'Bearer ' + currentToken}})).status, 200);
  });
  await t.test('persisted restore flag gates a production restart even with new secret and unpaused environment', async () => {
    await db.run("INSERT INTO settings(key,value) VALUES('feedback_restore_pending','true') ON CONFLICT(key) DO UPDATE SET value='true'");
    await shutdownApp(); await start({...env, FEEDBACK_LINK_SECRET: randomBytes(32).toString('base64url'), FEEDBACK_NOTIFICATIONS_PAUSED: 'false', FEEDBACK_API_PAUSED: 'false'});
    for (const response of [await request(api, {headers: authorization}), await admin(''), await request('/api/admin/export', {headers: {Cookie: cookie}})]) {assert.equal(response.status, 503); assert.doesNotMatch(response.text, /Private feedback over local TLS/);}
    await instance.feedbackDispatcher.runOnce(); assert.equal(sentMail, 0);
    assert.equal((await db.get("SELECT value FROM settings WHERE key='feedback_restore_pending'")).value, 'true');
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM feedback_revisions')).n), 1);
  });
  assert.ok(wire.every(entry => !entry.url.includes(token) && !entry.referer?.includes(token)));
  assert.ok(wire.filter(entry => /feedback-page|feedback\.css|api\/feedback/.test(entry.url)).every(entry => !entry.referer));
  if (process.env.STUDIO_FEEDBACK_HTTPS_EVIDENCE_DIR) await writeFile(path.join(process.env.STUDIO_FEEDBACK_HTTPS_EVIDENCE_DIR, 'https-proxy-evidence.json'), JSON.stringify({runtime: process.version, production: true, database: 'disposable local PostgreSQL, isolated schema', tls: 'temporary self-signed local certificate', trustedProxy: 'loopback', syntheticStorage: true, realEmailSent: false, browserEvidence, requestCount: wire.length, fragmentAbsentFromNetworkUrlsAndReferrers: true, restoreStartupGate: true, boundaries: ['No real Zalo or physical device', 'No production ingress/CDN', 'No real storage or email provider', 'Restore startup flag tested; backup byte restoration covered separately']}, null, 2) + '\n');
});
