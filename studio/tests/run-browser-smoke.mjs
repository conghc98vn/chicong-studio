import {spawn} from 'node:child_process';
import {access, mkdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// These suites create and remove their own fixtures. Exclude scripts requiring
// a live deployment, real credentials, an existing browser or data/live.
const suites = [
  'admin-drive-loading', 'gallery-password-flow', 'album-password-form', 'gallery-layout-isolation', 'gallery-sync-browser',
  'gallery-download-browser', 'photo-management-browser', 'prepared-upload-browser',
  'admin-proofing-regression', 'proofing-concurrency', 'photo-management-recovery',
  'album-drive-entry-browser', 'drive-folder-browser',
  'drive-panel-polling', 'drive-panel-pagination', 'album-slug-browser', 'inquiry-editor',
  'customer-feedback-browser', 'feedback-recovery-browser', 'feedback-customer-recovery', 'feedback-adversarial-browser'
];
// The runner deliberately does not inherit cloud credentials, database URLs,
// NODE_OPTIONS, or optional customer-image fixtures from the invoking shell.
const inheritedKeys = [
  'PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR',
  'LANG', 'LC_ALL', 'DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR',
  'PLAYWRIGHT_BROWSERS_PATH', 'STUDIO_PLAYWRIGHT_MODULE', 'STUDIO_AXE_MODULE',
  'STUDIO_BROWSER', 'STUDIO_BROWSER_EVIDENCE_DIR', 'CHROME_BIN'
];
const childEnv = {NODE_ENV: 'test'};
for (const key of inheritedKeys) if (process.env[key] !== undefined) childEnv[key] = process.env[key];

if (process.argv[2] === '--suite' && process.argv.length === 4 && suites.includes(process.argv[3])) {
  // Configure the already shared Playwright instance before the suite imports
  // it. This keeps standalone suites' installed-Chrome default intact while CI
  // can use the exact Chromium revision shipped with its pinned Playwright.
  if (process.env.CHROME_BIN) {
    if (!path.isAbsolute(process.env.CHROME_BIN)) throw new Error('CHROME_BIN must be an absolute executable path');
    await access(process.env.CHROME_BIN, constants.X_OK);
    const playwright = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
    const launch = playwright.chromium.launch.bind(playwright.chromium);
    playwright.chromium.launch = ({channel: _channel, ...options} = {}) => launch({...options, executablePath: process.env.CHROME_BIN});
  }
  await import(new URL(process.argv[3] + '.smoke.mjs', import.meta.url));
} else {
  if (process.argv.length !== 2) throw new Error('Unknown browser smoke suite or arguments');
  const timeoutMs = Number(process.env.STUDIO_BROWSER_SUITE_TIMEOUT_MS || 180000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 3600000) throw new Error('STUDIO_BROWSER_SUITE_TIMEOUT_MS must be an integer from 100 to 3600000');
  for (const suite of suites) {
    console.log('\nBrowser smoke: ' + suite);
    const env = {...childEnv};
    if (env.STUDIO_BROWSER_EVIDENCE_DIR) {
      env.STUDIO_BROWSER_EVIDENCE_DIR = path.resolve(env.STUDIO_BROWSER_EVIDENCE_DIR, suite);
      await mkdir(env.STUDIO_BROWSER_EVIDENCE_DIR, {recursive: true});
    }
    const started = Date.now();
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--suite', suite], {stdio: 'inherit', env});
      let killTimer, timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        console.error('Browser smoke timed out: ' + suite + ' after ' + timeoutMs + ' ms');
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
      }, timeoutMs);
      const clearTimers = () => {clearTimeout(timer); clearTimeout(killTimer);};
      child.once('error', error => {clearTimers(); reject(error);});
      child.once('exit', (code, signal) => {
        clearTimers();
        if (signal) console.error('Browser smoke exited by signal: ' + suite + ' (' + signal + ')');
        resolve(timedOut ? 124 : code ?? 1);
      });
    });
    if (code !== 0) {
      console.error('Browser smoke failed: ' + suite + ' (exit ' + code + ')');
      process.exit(code);
    }
    console.log('Browser smoke passed: ' + suite + ' (' + (Date.now() - started) + ' ms)');
  }
  console.log('\nAll ' + suites.length + ' isolated browser smoke suites passed.');
}
