import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// These suites create and remove their own fixtures. Exclude scripts requiring
// a live deployment, real credentials, an existing browser or data/live.
const suites = [
  'admin-drive-loading', 'gallery-password-flow', 'gallery-sync-browser',
  'gallery-download-browser', 'photo-management-browser', 'prepared-upload-browser',
  'admin-proofing-regression', 'proofing-concurrency', 'photo-management-recovery',
  'album-drive-entry-browser', 'drive-folder-browser',
  'drive-panel-polling', 'album-slug-browser'
];
for (const suite of suites) {
  console.log('\nBrowser smoke: ' + suite);
  const file = fileURLToPath(new URL(suite + '.smoke.mjs', import.meta.url));
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], {stdio: 'inherit', env: process.env});
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
  if (code !== 0) process.exit(code);
}
console.log('\nAll ' + suites.length + ' isolated browser smoke suites passed.');
