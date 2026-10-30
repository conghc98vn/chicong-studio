#!/usr/bin/env node

/**
 * Prepare an isolated VPS release. Activation is deliberately an operator step:
 * web, Drive workers and backup runners share a database and a media write fence.
 * Usage: npm run deploy:vps -- --stage
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.VPS_HOST || 'chicong-vps';
const live = '/var/www/chicongphoto';
const usage = `Usage: npm run deploy:vps -- --stage

This command uploads source and installs dependencies in a new private directory.
It does not copy .env, credentials or data; stop/restart services; or run migrations.
There is no unattended activation or automatic database rollback.

Required activation procedure (see HOSTING.md and docs/google-drive-sync-operations.md):
1. Save the current source, private runtime configuration and service definitions.
   Set FEEDBACK_API_PAUSED, FEEDBACK_NOTIFICATIONS_PAUSED and
   INQUIRY_NOTIFICATIONS_PAUSED to true on every web instance; restart to apply,
   verify feedback returns 503 and drain both email dispatchers.
2. Using the current runtime and explicit production environment, acquire a media
   maintenance lease and drain writers/cleanup with studio/tools/media-ops.mjs.
   Stop Drive workers and backup runners gracefully; verify every writer exited.
3. While holding the lease, take and verify a database + media baseline backup.
   Keep the lease valid through activation; an expired lease is not permission to
   proceed. Use a schema-v4 backup runner and record a rollback revision compatible
   with the current Drive, feedback and inquiry notification schemas.
4. Stop chicong-photo gracefully and verify its process exited. Preserve the live
   .env (0600), external secrets and data when replacing the source directory.
   Make release directories and runtime modules readable/traversable by the worker
   user while keeping .env and external credentials private. Verify as that user.
   Start only the web process with Drive disabled and all three pause flags still
   enabled so migration has one owner.
5. Check public/admin health, album/photo counts and media reads; then install the
   matching worker/backup runtime with explicit shared database/storage settings.
6. Verify worker heartbeat and media checks, enable manual Drive sync, and unlock
   with the same lease. Validate a draft pilot after the write fence is released.
   Do not enable scheduled Drive imports unless their schedule was approved.
   Verify feedback/inquiry guards and queue state, then restore the intended pause
   flags and restart to apply. Keep signing keys and the deletion ledger intact.
7. If checks fail, keep writers stopped and use the compatible rollback procedure.
   Never automatically restore an old database over newly accepted customer data.

PM2 runs this app in fork mode: activation includes a brief service interruption.
`;

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log(usage);
  process.exit(0);
}
if (args.length !== 1 || args[0] !== '--stage') {
  console.error('Refusing an unattended production deployment. Explicit staging is required.\n' + usage);
  process.exit(2);
}
// The host is passed as an argument, never interpolated into a local shell.
// Restrict it further because scp also parses the host:path destination syntax.
if (!/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(host) || host.length > 255) {
  console.error('Invalid VPS_HOST: use an SSH alias or hostname, optionally user@host.');
  process.exit(2);
}

const run = (command, commandArgs, options = {}) => execFileSync(command, commandArgs, {
  cwd: root, stdio: 'inherit', ...options,
});
const ssh = script => run('ssh', [host, 'bash -s'], { input: script, stdio: ['pipe', 'inherit', 'inherit'] });
const releaseId = new Date().toISOString().replace(/[-:.]/g, '') + '-' + randomUUID().slice(0, 8);
const release = `/var/www/chicongphoto-releases/${releaseId}`;
const remoteArchive = `${release}/source.tar.gz`;
let temporary;

try {
  run(process.execPath, ['studio/tests/check-syntax.mjs']);
  // An allowlist avoids packaging local test data, OAuth downloads or credentials
  // that broad directory archives can accidentally include in future releases.
  const files = ['package.json', 'package-lock.json', 'ecosystem.config.cjs'];
  for (const file of files) {
    if (!lstatSync(path.join(root, file)).isFile()) throw new Error(`Release input must be a regular file: ${file}`);
  }
  const collect = (directory, extensions) => {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.name.startsWith('.') || entry.isSymbolicLink() || /[\r\n]/.test(relative)) {
        throw new Error(`Release source contains a hidden, linked or invalid entry: ${relative}`);
      }
      if (entry.isDirectory()) collect(relative, extensions);
      else if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(relative);
      else throw new Error(`Review this file before adding it to the release allowlist: ${relative}`);
    }
  };
  collect('studio/server', new Set(['.mjs', '.js', '.cjs']));
  collect('studio/tools', new Set(['.mjs', '.js', '.cjs']));
  collect('studio/web', new Set(['.mjs', '.js', '.css', '.html', '.svg', '.woff2', '.txt']));
  collect('scripts', new Set(['.mjs', '.js', '.sh', '.command', '.service']));
  collect('certs', new Set(['.crt']));
  files.sort();
  temporary = mkdtempSync(path.join(tmpdir(), 'chicong-release-'));
  const archive = path.join(temporary, 'source.tar.gz');
  const manifest = path.join(temporary, 'release-manifest.json');
  // macOS provenance/download metadata is not application source. Exclude it
  // explicitly as COPYFILE_DISABLE alone does not strip all extended headers.
  run('tar', ['--no-xattrs', '-czf', archive, '--', ...files], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
  writeFileSync(manifest, JSON.stringify({ releaseId, sha256, files, activated: false }, null, 2) + '\n', { mode: 0o600 });

  // All interpolated remote values below are generated paths/hex, never config.
  ssh(`set -eu
umask 077
test -d '${live}'
test -f '${live}/.env'
test ! -L /var/www/chicongphoto-releases
mkdir -p /var/www/chicongphoto-releases
mkdir '${release}'
`);
  run('scp', [archive, manifest, `${host}:${release}/`]);
  ssh(`set -eu
umask 077
cd '${release}'
printf '%s  %s\\n' '${sha256}' source.tar.gz | sha256sum --check --status
tar -xzf source.tar.gz
rm '${remoteArchive}'
test ! -e .env
test ! -e data
npm ci --omit=dev --no-audit --no-fund
node --check studio/server/start.mjs
node --check studio/tools/drive-sync.mjs
node --check ecosystem.config.cjs
printf '%s\\n' 'staged; activation not performed' > STAGED
`);
  console.log(`\nRelease staged and dependencies installed: ${host}:${release}`);
  console.log('Production has not been activated. Preserve this release manifest with the deployment evidence.\n');
  console.log(usage);
} catch (error) {
  console.error(`Release staging failed (${error.code || error.status || 'error'}). Production activation was not attempted.`);
  console.error(error.message);
  console.error(`If a partial stage exists, inspect ${host}:${release} before removing that directory.`);
  process.exitCode = 1;
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
